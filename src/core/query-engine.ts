import { EventEmitter } from "events";
import {
  QueryEngine,
  UserInput,
  SessionContext,
  QueryResult,
  ToolCall,
  ToolResult,
  TokenUsage,
  Message,
  Session,
  Config,
  StopReason,
  HealDecision,
} from "../types/index.js";
import { Tool, getAllTools, StreamingToolExecutor, mcpManager } from "../tools/index.js";
import { PermissionPipeline } from "../permissions/index.js";
import { AIProvider, createProvider, createSystemPrompt, AgentMode, StreamEvent } from "../api/index.js";
import { ContextCompactor } from "../compaction/index.js";
import { ErrorHealer } from "../tools/healer.js";
import { SessionStore, AuditLogger, TelemetryLogger } from "../storage/index.js";
import { AIGuard } from "./ai-guard.js";
import { RepoMap, repoMap } from "./repo-map.js";
import { calculateBudget, shouldCompact, BudgetExceededError } from "./token-counter.js";
import { apiCircuitBreaker, CircuitBreakerOpenError } from "./circuit-breaker.js";
import { ensureError } from "../common/index.js";
import { captureEnvSnapshot, formatEnvSnapshot } from "./env-snapshot.js";
import { toolCache } from "./tool-cache.js";

export interface QueryEngineEvents {
  thinking: (model: string, attempt: number, tokenUsage?: TokenUsage) => void;
  toolExecuting: (toolName: string, command: string) => void;
  toolResult: (result: ToolResult) => void;
  permissionDenied: (reason: string, layer: string, canOverride: boolean) => void;
  requestConfirmation: (toolCall: ToolCall, command: string, reason: string) => void;
  compacting: (from: string, to: string) => void;
  maxTurnsReached: () => void;
  taskCompleted: (files: string[], commitHash?: string) => void;
  error: (message: string) => void;
  progress: (percent: number) => void;
  streaming: (text: string) => void;
}

export class QueryEngineImpl extends EventEmitter implements QueryEngine {
  private tools: Tool[];
  private permissionPipeline: PermissionPipeline;
  private toolExecutor: StreamingToolExecutor;
  private compactor: ContextCompactor;
  private errorHealer: ErrorHealer;
  private sessionStore: SessionStore;
  private auditLogger: AuditLogger;
  private telemetryLogger: TelemetryLogger;
  private provider: AIProvider;
  private currentSession: Session | null = null;
  private mode: AgentMode = "default";
  private cachedRepoMap: string | null = null;
  private repoMapTurnCount = 0;
  private static readonly REPO_MAP_REFRESH_INTERVAL = 5;

  constructor(providerName: string) {
    super();
    this.tools = getAllTools();
    this.permissionPipeline = new PermissionPipeline("default");
    this.toolExecutor = new StreamingToolExecutor(this.permissionPipeline);
    this.compactor = new ContextCompactor();
    this.errorHealer = new ErrorHealer();
    this.sessionStore = new SessionStore();
    this.auditLogger = new AuditLogger();
    this.telemetryLogger = new TelemetryLogger();
    this.provider = createProvider(providerName);
  }

  setMode(mode: AgentMode): void {
    this.mode = mode;
    if (mode === "plan") {
      this.permissionPipeline.setMode("plan");
    } else {
      this.permissionPipeline.setMode("default");
    }
  }

  getMode(): AgentMode {
    return this.mode;
  }

  setSession(session: Session): void {
    this.currentSession = session;
  }

  getSession(): Session | null {
    return this.currentSession;
  }

  setPermissionMode(mode: "default" | "plan"): void {
    this.permissionPipeline.setMode(mode);
  }

  getPermissionPipeline(): PermissionPipeline {
    return this.permissionPipeline;
  }

  async loadMCPTools(servers?: Array<{ name: string; transport: "stdio" | "http"; command?: string; args?: string[]; url?: string; enabled: boolean }>): Promise<number> {
    if (!servers || servers.length === 0) return 0;
    let loaded = 0;
    for (const server of servers) {
      try {
        const tools = await mcpManager.addServer(server);
        this.tools.push(...tools);
        loaded += tools.length;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit("error", `MCP server "${server.name}" failed to load: ${message}`);
      }
    }
    return loaded;
  }

  async query(
    input: UserInput,
    context: SessionContext
  ): Promise<QueryResult> {
    this.compactor.setActivity();
    const maxTurns = context.config.max_turns || 50;
    let loop = 0;
    let lastResponse: QueryResult | null = null;
    let consecutiveFailures = 0;
    let usingFallbackModel = false;

    if (!this.cachedRepoMap) {
      try {
        this.cachedRepoMap = repoMap.generateMapText(
          this.currentSession?.meta.project_path || context.config.working_dir || process.cwd()
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit("error", `Failed to generate repo map: ${message}`);
        this.cachedRepoMap = "";
      }
    }

    const projectPath = this.currentSession?.meta.project_path || context.config.working_dir || process.cwd();

    const envSnapshot = captureEnvSnapshot(projectPath, context.platform);
    const envSnapshotText = formatEnvSnapshot(envSnapshot);

    const systemPrompt = createSystemPrompt(
      `${context.platform.os} (${context.platform.terminal})`,
      context.config.permission_mode,
      context.projectMemory,
      this.mode,
      this.cachedRepoMap || undefined,
      context.projectMemory || undefined,
      envSnapshotText || undefined
    );

    let apiKey = context.config.api_key_ref;

    while (loop < maxTurns) {
      loop++;
      this.repoMapTurnCount++;
      toolCache.nextTurn();

      if (this.repoMapTurnCount % QueryEngineImpl.REPO_MAP_REFRESH_INTERVAL === 0) {
        try {
          this.cachedRepoMap = repoMap.generateMapText(
            this.currentSession?.meta.project_path || context.config.working_dir || process.cwd()
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.emit("error", `Repo map refresh failed (turn ${this.repoMapTurnCount}): ${message}`);
        }
      }

      const currentModel = usingFallbackModel
        ? (context.config.fallback_model || "gpt-4o")
        : (context.config.model || "claude-sonnet-4-20250514");

      const budget = calculateBudget(
        systemPrompt,
        context.messages.map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        })),
        this.cachedRepoMap || "",
        currentModel
      );

      if (budget.percentUsed > 90) {
        this.emit("error", `Token budget at ${budget.percentUsed}% (${budget.used}/${budget.total}). Compacting...`);
        const compactResult = this.compactor.aggressiveCompact(context.messages);
        context.messages = compactResult;
        this.emit("compacting", `${budget.percentUsed}%`, `${compactResult.length}`);
      }

      if (budget.hardLimitExceeded) {
        this.emit("error", `Token budget exceeded (${budget.used}/${budget.total}). Forcing compaction.`);
        context.messages = this.compactor.forceCompact(context.messages);
      }

      this.emit("thinking", currentModel, loop, lastResponse?.response?.usage);

      try {
        let fullContent = "";
        const rawToolCalls: ToolCall[] = [];
        let streamUsage: TokenUsage | undefined;

        const stream = await apiCircuitBreaker.call(async () => {
          return this.provider.streamChatCompletion(
            context.messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            systemPrompt,
            this.tools,
            { ...context.config, model: currentModel },
            apiKey
          );
        });

        for await (const event of stream) {
          switch (event.type) {
            case "text":
              if (event.text) {
                fullContent += event.text;
                this.emit("streaming", fullContent);
              }
              break;
            case "tool_use":
              if (event.toolCall) {
                rawToolCalls.push(event.toolCall);
              }
              break;
            case "done":
              if (event.usage) streamUsage = event.usage;
              break;
          }
        }

        const result = {
          content: fullContent,
          toolCalls: rawToolCalls.length > 0 ? rawToolCalls : undefined,
          stopReason: (rawToolCalls.length > 0 ? "tool_use" : "end_turn") as StopReason,
          usage: streamUsage,
        };

        if (result.content) {
          const assistantMsg: Message = {
            role: "assistant",
            content: result.content,
            timestamp: new Date().toISOString(),
            critical: false,
          };
          context.messages.push(assistantMsg);

          const aiGuard = new AIGuard(context.platform);
          const frustrated = aiGuard.detectFrustration(result.content);
          if (frustrated) {
            this.emit("error", "AI model appears to be struggling with this task. Consider rephrasing or breaking it down.");
          }
        }

        if (result.usage) {
          const usageRatio = result.usage.total / result.usage.limit;
          if (usageRatio > 0.6) {
            const compactResult = this.compactor.checkAndCompact(
              context.messages,
              result.usage
            );
            if (compactResult.level) {
              context.messages = compactResult.messages;
              this.emit(
                "compacting",
                `${(usageRatio * 100).toFixed(0)}%`,
                `${(compactResult.messages.length / (compactResult.messages.length + compactResult.compactedCount) * 100).toFixed(0)}%`
              );
            }
          }
        }

        if (result.toolCalls && result.toolCalls.length > 0) {
          const toolResults = await this.executeWithHealing(
            result.toolCalls,
            context
          );

          for (let i = 0; i < result.toolCalls.length; i++) {
            const tc = result.toolCalls[i];
            const tr = toolResults[i];

            const toolMsg: Message = {
              role: "tool",
              content: tr.output,
              timestamp: new Date().toISOString(),
              critical: tr.errorCode ? true : false,
              tool_id: tc.id,
            };

            const callMsg: Message = {
              role: "assistant",
              content: [tc],
              timestamp: new Date().toISOString(),
              critical: false,
            };

            context.messages.push(callMsg);
            context.messages.push(toolMsg);
          }

          if (result.stopReason === "tool_use") {
            continue;
          }
        }

        if (result.stopReason === "end_turn" && !result.toolCalls) {
          lastResponse = {
            response: {
              content: result.content,
              model: context.config.model || "",
              usage: result.usage,
            },
            stopReason: "end_turn",
          };

          if (context.config.auto_commit) {
            await this.performDelivery(context);
            // Push to remote for complete delivery closure
            const pushTool = this.tools.find(t => t.name === "git_push");
            if (pushTool) {
              try {
                await pushTool.execute(
                  {},
                  {
                    session: this.currentSession!,
                    platform: context.platform,
                    permissionLevel: { allowed: true, layer: "whitelist", canOverride: false }
                  }
                );
              } catch {
                // push failure is non-critical
              }
            }
          }

          return lastResponse;
        }

        lastResponse = {
          response: {
            content: result.content,
            model: context.config.model || "",
            usage: result.usage,
          },
          toolCalls: result.toolCalls,
          stopReason: result.stopReason,
        };
      } catch (err: unknown) {
        const wrappedErr = ensureError(err, `API call turn ${loop}`);

        if (err instanceof CircuitBreakerOpenError) {
          return {
            response: {
              content: `API is currently unavailable (circuit breaker open). ${wrappedErr.message}\nPlease wait and try again, or check your API key and network connection.`,
              model: currentModel,
            },
            stopReason: "stop_sequence",
          };
        }

        consecutiveFailures++;
        this.emit("error", wrappedErr.stack || wrappedErr.message);

        if (consecutiveFailures >= 3 && !usingFallbackModel && context.config.fallback_model) {
          const failureCount = consecutiveFailures;
          usingFallbackModel = true;
          consecutiveFailures = 0;
          const fbModel = context.config.fallback_model;
          this.emit("error", `Switching to fallback model: ${fbModel} (after ${failureCount} failures)`);

          const errorMsg: Message = {
            role: "tool",
            content: `API errors after ${failureCount} retries. Switching to fallback model: ${fbModel}.`,
            timestamp: new Date().toISOString(),
            critical: true,
          };
          context.messages.push(errorMsg);
          continue;
        }

        if (consecutiveFailures >= 3 && (usingFallbackModel || !context.config.fallback_model)) {
          return {
            response: {
              content: `All API attempts failed (tried ${usingFallbackModel ? 'both models' : '3 times'}). Please check your API key and network connection.\nLast error: ${wrappedErr.message}`,
              model: currentModel,
            },
            stopReason: "stop_sequence",
          };
        }

        const errorMsg: Message = {
          role: "tool",
          content: `API error (attempt ${consecutiveFailures}/3): ${wrappedErr.message}. Retrying...`,
          timestamp: new Date().toISOString(),
          critical: true,
        };
        context.messages.push(errorMsg);

        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
    }

    this.emit("maxTurnsReached");

    return {
      response: {
        content: `Task incomplete after ${maxTurns} turns. You can continue or stop.`,
        model: context.config.model || "",
      },
      stopReason: "stop_sequence",
    };
  }

  private async executeWithHealing(
    toolCalls: ToolCall[],
    context: SessionContext
  ): Promise<ToolResult[]> {
    const readonlyTools = toolCalls.filter((tc) => {
      const tool = this.tools.find((t) => t.name === tc.name);
      return tool?.readonly === true;
    });
    const writeTools = toolCalls.filter((tc) => {
      const tool = this.tools.find((t) => t.name === tc.name);
      return tool?.readonly !== true;
    });

    const results: ToolResult[] = new Array(toolCalls.length);
    const readonlyIndices = new Map<ToolCall, number>();
    toolCalls.forEach((tc, i) => {
      if (readonlyTools.includes(tc)) readonlyIndices.set(tc, i);
    });

    if (readonlyTools.length > 0) {
      const readonlyResults = await Promise.all(
        readonlyTools.map((tc) => this.executeOneTool(tc, context))
      );
      readonlyTools.forEach((tc, j) => {
        const idx = readonlyIndices.get(tc)!;
        results[idx] = readonlyResults[j];
        this.emit("toolResult", readonlyResults[j]);
      });
    }

    let writeIdx = 0;
    for (const tc of writeTools) {
      const globalIdx = toolCalls.indexOf(tc);
      results[globalIdx] = await this.executeOneWithHealing(tc, context);
      this.emit("toolResult", results[globalIdx]);
      writeIdx++;
    }

    return results;
  }

  private async executeOneTool(
    tc: ToolCall,
    context: SessionContext
  ): Promise<ToolResult> {
    const cached = toolCache.get(tc);
    if (cached) return cached;

    const tool = this.tools.find((t) => t.name === tc.name);

    if (!tool) {
      const result: ToolResult = {
        success: false,
        output: `Unknown tool: ${tc.name}`,
        errorCode: "UNKNOWN_TOOL",
      };
      toolCache.set(tc, result);
      return result;
    }

    this.emit("toolExecuting", tool.name, JSON.stringify(tc.arguments).slice(0, 100));

    const result = await tool.execute(tc.arguments, {
      session: this.currentSession!,
      platform: context.platform,
      permissionLevel: {
        allowed: true,
        layer: "whitelist",
        canOverride: false,
      },
    });

    toolCache.set(tc, result);
    return result;
  }

  private async executeOneWithHealing(
    tc: ToolCall,
    context: SessionContext
  ): Promise<ToolResult> {
    const cached = toolCache.get(tc);
    if (cached) return cached;

    const tool = this.tools.find((t) => t.name === tc.name);

    if (!tool) {
      const result: ToolResult = {
        success: false,
        output: `Unknown tool: ${tc.name}`,
        errorCode: "UNKNOWN_TOOL",
      };
      toolCache.set(tc, result);
      return result;
    }

    this.emit("toolExecuting", tool.name, JSON.stringify(tc.arguments).slice(0, 100));

    let result = await tool.execute(tc.arguments, {
      session: this.currentSession!,
      platform: context.platform,
      permissionLevel: {
        allowed: true,
        layer: "whitelist",
        canOverride: false,
      },
    });

    let healAttempts = 0;
    while (!result.success && healAttempts < 3 && result.errorCode) {
      healAttempts++;
      this.emit("error", `Tool "${tc.name}" failed: ${result.output}`);

      const healDecision = this.errorHealer.healError(result, tc.name, tc.arguments);

      if (healDecision.strategy === "ASK") break;

      if (healDecision.strategy === "RETRY") {
        await new Promise((r) => setTimeout(r, 1000));
        result = await tool.execute(
          healDecision.modifiedParams || tc.arguments,
          {
            session: this.currentSession!,
            platform: context.platform,
            permissionLevel: {
              allowed: true,
              layer: "whitelist",
              canOverride: false,
            },
          }
        );
        continue;
      }

      if (healDecision.strategy === "INVESTIGATE" && healDecision.diagnosticCommand) {
        const diagTool = this.tools.find((t) => t.name === "shell_command");
        if (diagTool) {
          const diagResult = await diagTool.execute(
            { command: healDecision.diagnosticCommand },
            {
              session: this.currentSession!,
              platform: context.platform,
              permissionLevel: {
                allowed: true,
                layer: "whitelist",
                canOverride: false,
              },
            }
          );
          result.output += `\n\nDiagnostic info: ${diagResult.output}`;
        }
        break;
      }

      if (healDecision.strategy === "FIX" && healDecision.modifiedParams) {
        result = await tool.execute(healDecision.modifiedParams, {
          session: this.currentSession!,
          platform: context.platform,
          permissionLevel: {
            allowed: true,
            layer: "whitelist",
            canOverride: false,
          },
        });
        continue;
      }

      break;
    }

    toolCache.set(tc, result);
    return result;
  }

  private async performDelivery(context: SessionContext): Promise<void> {
    const commitTool = this.tools.find((t) => t.name === "git_commit");

    if (commitTool) {
      try {
        const lastUserInput = context.messages
          .filter((m) => m.role === "user")
          .pop();

        const commitMessage = lastUserInput
          ? `feat: ${typeof lastUserInput.content === "string" ? lastUserInput.content.slice(0, 80) : "apply changes"}`
          : "feat: apply changes";

        const result = await commitTool.execute(
          { message: commitMessage },
          {
            session: this.currentSession!,
            platform: context.platform,
            permissionLevel: {
              allowed: true,
              layer: "whitelist",
              canOverride: false,
            },
          }
        );

        if (result.success) {
          this.emit("taskCompleted", [], result.artifacts?.[0]);
        }
      } catch {
        // commit failure is not critical
      }
    }
  }
}

export function createQueryEngine(providerName: string): QueryEngineImpl {
  return new QueryEngineImpl(providerName);
}