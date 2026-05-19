import { EventEmitter } from "events";
import {
  type QueryEngine,
  type UserInput,
  type SessionContext,
  type QueryResult,
  type ToolCall,
  type ToolResult,
  type TokenUsage,
  type Message,
  type Session,
  type Config,
  type StopReason,
  type PermissionDecision,
  type ExecutionContext,
} from "../types/index.js";
import { type Tool, getAllTools, mcpManager } from "../tools/index.js";
import { PermissionPipeline } from "../permissions/index.js";
import { type AIProvider, createProviderFromConfig, createSystemPrompt, type AgentMode, getLocalProviderScanner } from "../api/index.js";
import { SessionStore, AuditLogger, TelemetryLogger } from "../storage/index.js";
import { repoMap } from "../intelligence/repo-map.js";
import { TokenBudgetExceededError, calculateBudget } from "../observability/token-counter.js";
import { CircuitBreakerOpenError } from "../resilience/circuit-breaker.js";
import { ensureError } from "../common/index.js";
import { captureEnvSnapshot, formatEnvSnapshot } from "../observability/env-snapshot.js";
import { CostTracker } from "../observability/cost-tracker.js";
import { DEFAULT_MODEL, FALLBACK_MODEL, LIMITS, TIMEOUTS } from "../core/constants.js";
import { ApiStreamer } from "./api-streamer.js";
import { ToolExecutor } from "./tool-executor.js";
import { ContextManager } from "./context-manager.js";
import { DeliveryManager } from "./delivery-manager.js";
import { loadXsgbbxMd, formatXsgbbxMdContext, type XsgbbxMdLoadResult } from "../intelligence/xsgbbx-md-loader.js";
import { AsyncHookRegistry } from "../hooks/async-hook-registry.js";
import { HooksConfigManager } from "../hooks/hooks-config-manager.js";
import {
  executeSessionStartHooks,
  executeSessionEndHooks,
  executePreCompactHooks,
  executePostCompactHooks,
  executePreQueryHooks,
  executePostQueryHooks,
} from "../hooks/hook-integration.js";

// ============================================================================
// Query Engine — State Machine Architecture
//
// Based on Claude Code's query.ts design patterns:
//   - Immutable State passed between iterations
//   - Multiple Continue reasons for graceful recovery
//   - Auto-compaction with circuit breaker
//   - Model fallback on persistent errors
//   - Streaming tool execution for latency hiding
//
// Optimized for DeepSeek:
//   - 1M context window → compaction threshold raised to 85%
//   - reasoning_content captured and emitted as thinking events
//   - Native function calling (no Anthropic-specific beta headers)
// ============================================================================

const DEFAULT_MAX_TURNS = LIMITS.MAX_TURNS;
const MAX_CONSECUTIVE_FAILURES = LIMITS.MAX_CONSECUTIVE_FAILURES;
const RETRY_DELAY_MS = TIMEOUTS.QUERY_RETRY_MS;
const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3;

// DeepSeek 1M context: compaction only at 85%, blocking at 95%
const COMPACT_THRESHOLD = 0.85;
const BLOCKING_THRESHOLD = 0.95;

const DEFAULT_PERMISSION: PermissionDecision = {
  allowed: true,
  layer: "whitelist",
  canOverride: false,
};

// ---------------------------------------------------------------------------
// State Machine Types
// ---------------------------------------------------------------------------

type ContinueReason =
  | "next_turn"                    // Normal: tools executed, continue with results
  | "fallback_model"               // Model failed, switching to fallback
  | "max_output_tokens_recovery"   // Hit output limit, inject recovery message
  | "compact_and_retry"            // Context overflow, compact and retry
  | "stop_hook_blocking";          // Stop hook rejected, inject feedback

interface QueryState {
  messages: Message[];
  turnCount: number;
  consecutiveFailures: number;
  usingFallbackModel: boolean;
  maxOutputTokensRecoveryCount: number;
  hasAttemptedCompaction: boolean;
  transition: ContinueReason | null;
}

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
  reasoning: (text: string) => void;
}

export class QueryEngineImpl extends EventEmitter implements QueryEngine {
  private tools: Tool[];
  private toolMap: Map<string, Tool>;
  private permissionPipeline: PermissionPipeline;
  private toolExecutor: ToolExecutor;
  private contextManager: ContextManager;
  private deliveryManager: DeliveryManager;
  private apiStreamer: ApiStreamer;
  private sessionStore: SessionStore;
  private auditLogger: AuditLogger;
  private telemetryLogger: TelemetryLogger;
  private provider: AIProvider;
  private config: Config;
  private currentSession: Session | null = null;
  private mode: AgentMode = "default";
  private cachedRepoMap: string | null = null;
  private repoMapTurnCount = 0;
  private costTracker: CostTracker | null = null;
  private abortController: AbortController | null = null;
  private userHookRegistry: AsyncHookRegistry | null = null;
  private hooksConfigManager: HooksConfigManager;
  private static readonly REPO_MAP_REFRESH_INTERVAL = 5;

  constructor(config: Config) {
    super();
    this.config = config;
    this.tools = getAllTools();
    this.toolMap = new Map(this.tools.map((t) => [t.name, t]));
    this.permissionPipeline = new PermissionPipeline("default");
    this.toolExecutor = new ToolExecutor(this.tools, this.permissionPipeline);
    this.provider = createProviderFromConfig(config);
    this.apiStreamer = new ApiStreamer(this.provider);
    this.contextManager = new ContextManager(this.provider);
    this.deliveryManager = new DeliveryManager(this.toolMap);
    this.sessionStore = new SessionStore();
    this.auditLogger = new AuditLogger();
    this.telemetryLogger = new TelemetryLogger();
    this.hooksConfigManager = new HooksConfigManager();

    // Load user-configured hooks from settings + project
    this.refreshUserHooks(config.working_dir || process.cwd());

    // Local provider scanner for Ollama/LMStudio discovery
    const scanner = getLocalProviderScanner();
    scanner.start(config);
    scanner.on("provider:auto-activated", (data: { name: string; model: string }) => {
      this.config.chosen_provider = data.name;
      this.config.model = data.model;
      this.provider = createProviderFromConfig(this.config);
      this.apiStreamer.updateProvider(this.provider);
      this.contextManager.updateProvider(this.provider);
    });
    scanner.on("provider:started", (data: { name: string; models: string[] }) => {
      const pc = this.config.provider_configs?.[data.name];
      if (pc) pc.models = [...data.models];
      this.emit("local-provider-available" as never, data);
    });
  }

  /** Reload user hooks (call when settings or project changes) */
  refreshUserHooks(projectPath: string): void {
    const hooksSettings = this.hooksConfigManager.loadAll(projectPath);
    this.userHookRegistry = new AsyncHookRegistry(hooksSettings);
    this.toolExecutor.setUserHookRegistry(this.userHookRegistry);
  }

  /** Get the hooks config manager (for CLI /hooks command) */
  getHooksConfigManager(): HooksConfigManager {
    return this.hooksConfigManager;
  }

  // ---- Public API ----

  refreshProvider(config: Config): void {
    this.config = config;
    this.provider = createProviderFromConfig(config);
    this.apiStreamer.updateProvider(this.provider);
    this.contextManager.updateProvider(this.provider);
    getLocalProviderScanner().updateConfig(config);
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      this.emit("error", "Query aborted by user");
    }
  }

  abortQuery(): void { this.abort(); }

  setMode(mode: AgentMode): void {
    this.mode = mode;
    this.permissionPipeline.setMode(mode === "plan" ? "plan" : "default");
  }

  getMode(): AgentMode { return this.mode; }

  setSession(session: Session): void {
    this.currentSession = session;
    if (!this.costTracker && session) {
      this.costTracker = new CostTracker(session.session_id, this.config.max_turns || DEFAULT_MAX_TURNS, {
        maxCostUSD: this.config.budget_max_cost_usd,
        maxTokens: this.config.budget_max_tokens,
        warningThreshold: this.config.budget_warning_threshold,
      });
      this.costTracker.on("budgetWarning", (metric: "cost" | "tokens", current: number, limit: number) => {
        this.emit("error", `Budget warning (${metric}): ${metric === "cost" ? `$${current.toFixed(4)}` : `${current} tokens`} approaching ${limit}`);
      });
      this.costTracker.on("budgetExceeded", (metric: "cost" | "tokens", current: number, limit: number) => {
        this.emit("error", `Budget EXCEEDED (${metric}): surpassed limit`);
      });
    }

    // Execute SessionStart hooks (notification with type 'startup')
    if (this.userHookRegistry && session) {
      const projectPath = this.config.working_dir || process.cwd();
      executeSessionStartHooks(this.userHookRegistry, session.session_id, projectPath)
        .then((results) => {
          const formatted = AsyncHookRegistry.formatResults(results);
          if (formatted) this.emit("error", `[SessionStart hooks]\n${formatted}`);
        })
        .catch(() => { /* hook failure must not crash session init */ });
    }
  }

  getSession(): Session | null { return this.currentSession; }
  getCostTracker(): CostTracker | null { return this.costTracker; }

  setPermissionMode(mode: "default" | "plan"): void {
    this.permissionPipeline.setMode(mode);
  }

  getPermissionPipeline(): PermissionPipeline { return this.permissionPipeline; }

  async loadMCPTools(servers?: Array<{ name: string; transport: "stdio" | "http"; command?: string; args?: string[]; url?: string; enabled: boolean }>): Promise<number> {
    if (!servers || servers.length === 0) return 0;
    let loaded = 0;
    for (const server of servers) {
      try {
        const serverTools = await mcpManager.addServer(server);
        this.toolExecutor.registerTools(serverTools);
        this.toolMap = this.toolExecutor.getToolMap();
        loaded += serverTools.length;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit("error", `MCP server "${server.name}" failed: ${message}`);
      }
    }
    return loaded;
  }

  dispose(): void {
    // Execute Stop + SessionEnd hooks before cleanup
    if (this.userHookRegistry && this.currentSession) {
      const messageCount = this.currentSession.messages?.length ?? 0;
      const sessionId = this.currentSession.session_id;

      // Fire hooks but don't block disposal
      Promise.allSettled([
        this.userHookRegistry.stop(messageCount, sessionId),
        executeSessionEndHooks(this.userHookRegistry, sessionId, messageCount),
      ])
        .then(([stopRes, endRes]) => {
          const allResults = [
            ...(stopRes.status === "fulfilled" ? stopRes.value : []),
            ...(endRes.status === "fulfilled" ? endRes.value : []),
          ];
          const formatted = AsyncHookRegistry.formatResults(allResults);
          if (formatted) this.emit("error", `[SessionEnd hooks]\n${formatted}`);
        })
        .catch(() => { /* hook failure must not block disposal */ });
    }
    this.auditLogger.flush();
    this.auditLogger.dispose();
  }

  /** Execute stop hooks (call before session exit) */
  async executeStopHooks(messageCount: number): Promise<void> {
    if (this.userHookRegistry) {
      const results = await this.userHookRegistry.stop(
        messageCount,
        this.currentSession?.session_id,
      );
      if (results.length > 0) {
        // Log hook results — stop hooks don't block, just side effects
        const formatted = AsyncHookRegistry.formatResults(results);
        if (formatted) this.emit("error", `[Stop hooks]\n${formatted}`);
      }
    }
  }

  // ---- Private helpers ----

  private getProjectPath(context: SessionContext): string {
    return this.currentSession?.meta.project_path || context.config.working_dir || process.cwd();
  }

  private selectModel(context: SessionContext, usingFallback: boolean): string {
    return usingFallback
      ? (context.config.fallback_model || FALLBACK_MODEL)
      : (context.config.model || DEFAULT_MODEL);
  }

  private makeExecutionContext(platform: SessionContext["platform"]): ExecutionContext {
    if (!this.currentSession) {
      throw new Error("No active session. Call setSession() first.");
    }
    return { session: this.currentSession, platform, permissionLevel: DEFAULT_PERMISSION };
  }

  private refreshRepoMap(projectPath: string): void {
    try {
      this.cachedRepoMap = repoMap.generateMapText(projectPath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit("error", `Repo map refresh failed: ${message}`);
    }
  }

  private xsgbbxMdResult: XsgbbxMdLoadResult | null = null;

  private buildSystemPrompt(context: SessionContext): string {
    const projectPath = this.getProjectPath(context);

    // Load xsgbbx.md + rules on first call (limit 1000 chars for DeepSeek V4)
    if (!this.xsgbbxMdResult) {
      this.xsgbbxMdResult = loadXsgbbxMd(projectPath);
    }

    const xsgbbxContext = formatXsgbbxMdContext(this.xsgbbxMdResult);

    return createSystemPrompt(
      `${context.platform.os} (${context.platform.terminal})`,
      context.config.permission_mode,
      xsgbbxContext,
      this.mode,
    );
  }

  // ---- Compaction (simplified for DeepSeek 1M context) ----

  private needsCompaction(context: SessionContext, systemPrompt: string, model: string): boolean {
    const budget = calculateBudget(
      systemPrompt,
      context.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
      this.cachedRepoMap || "",
      model
    );
    return budget.percentUsed > COMPACT_THRESHOLD * 100;
  }

  private isAtBlockingLimit(context: SessionContext, systemPrompt: string, model: string): boolean {
    const budget = calculateBudget(
      systemPrompt,
      context.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
      this.cachedRepoMap || "",
      model
    );
    return budget.percentUsed > BLOCKING_THRESHOLD * 100;
  }

  private async performCompaction(context: SessionContext): Promise<void> {
    // DeepSeek 1M: compact by summarizing the oldest messages using the model itself
    // Simple strategy: summarize first 60% of messages, keep last 40% verbatim
    const messages = context.messages;
    if (messages.length < 10) return;

    const beforeCount = messages.length;

    // Execute PreCompact hooks (non-blocking, log side effects)
    if (this.userHookRegistry) {
      try {
        const preResults = await executePreCompactHooks(
          this.userHookRegistry,
          beforeCount,
          `messages:${beforeCount}`,
        );
        const formatted = AsyncHookRegistry.formatResults(preResults);
        if (formatted) this.emit("error", `[PreCompact hooks]\n${formatted}`);
      } catch {
        // Hook failure must not block compaction
      }
    }

    const splitPoint = Math.floor(messages.length * 0.6);
    const toSummarize = messages.slice(0, splitPoint);
    const toKeep = messages.slice(splitPoint);

    let afterCount: number;

    try {
      const summary = await this.contextManager.llmSummarize(toSummarize, this.config, this.provider);
      const summaryMessage: Message = {
        role: "tool",
        content: `[Context compaction: earlier conversation summarized]\n${summary}`,
        timestamp: new Date().toISOString(),
        critical: true,
      };
      context.messages = [summaryMessage, ...toKeep];
      afterCount = context.messages.length;
      this.emit("compacting", `${beforeCount} messages`, `${afterCount} messages`);
    } catch {
      // Fallback: simple truncation
      context.messages = toKeep;
      afterCount = context.messages.length;
      this.emit("compacting", `${beforeCount} messages`, `${afterCount} messages (truncated)`);
    }

    // Execute PostCompact hooks (non-blocking, log side effects)
    if (this.userHookRegistry) {
      try {
        const saved = beforeCount - afterCount;
        const postResults = await executePostCompactHooks(
          this.userHookRegistry,
          afterCount,
          `saved:${saved}`,
        );
        const formatted = AsyncHookRegistry.formatResults(postResults);
        if (formatted) this.emit("error", `[PostCompact hooks]\n${formatted}`);
      } catch {
        // Hook failure must not block post-compaction flow
      }
    }
  }

  // ======================================================================
  // Core Query Loop — State Machine
  // ======================================================================

  async query(
    input: UserInput,
    context: SessionContext,
    abortSignal?: AbortSignal
  ): Promise<QueryResult> {
    const maxTurns = context.config.max_turns || DEFAULT_MAX_TURNS;
    this.abortController = new AbortController();
    if (abortSignal) {
      abortSignal.addEventListener("abort", () => this.abortController?.abort());
    }

    // Initialize state
    let state: QueryState = {
      messages: [...context.messages],
      turnCount: 0,
      consecutiveFailures: 0,
      usingFallbackModel: false,
      maxOutputTokensRecoveryCount: 0,
      hasAttemptedCompaction: false,
      transition: null,
    };

    const projectPath = this.getProjectPath(context);
    if (!this.cachedRepoMap) this.refreshRepoMap(projectPath);

    const systemPrompt = this.buildSystemPrompt(context);
    const apiKey = context.config.api_key_ref;

    // ---- Main state machine loop ----
    while (state.turnCount < maxTurns) {
      // Check abort
      if (this.abortController?.signal.aborted) {
        this.emit("error", "Query aborted by user");
        break;
      }

      state.turnCount++;
      this.repoMapTurnCount++;

      // Refresh repo map periodically
      if (this.repoMapTurnCount % QueryEngineImpl.REPO_MAP_REFRESH_INTERVAL === 0) {
        this.refreshRepoMap(projectPath);
      }

      // Budget check
      if (this.costTracker) {
        this.costTracker.trackTurn();
        try {
          this.costTracker.checkBudgetAndThrow();
        } catch (budgetErr) {
          if (budgetErr instanceof TokenBudgetExceededError) {
            this.emit("error", budgetErr.message);
            return {
              response: { content: `Session stopped: ${budgetErr.message}`, model: context.config.model || "" },
              stopReason: "stop_sequence",
            };
          }
          throw budgetErr;
        }
      }

      // ---- Compaction check (DeepSeek 1M: only at 85%) ----
      if (
        !state.hasAttemptedCompaction &&
        this.needsCompaction(context, systemPrompt, this.selectModel(context, state.usingFallbackModel))
      ) {
        await this.performCompaction(context);
        state = { ...state, hasAttemptedCompaction: true, transition: "compact_and_retry" };
        continue;
      }

      // Blocking limit check
      if (this.isAtBlockingLimit(context, systemPrompt, this.selectModel(context, state.usingFallbackModel))) {
        await this.performCompaction(context);
        state = { ...state, hasAttemptedCompaction: true };
      }

      const currentModel = this.selectModel(context, state.usingFallbackModel);
      this.emit("thinking", currentModel, state.turnCount);

      // ---- PreQuery hooks (before API call) ----
      if (this.userHookRegistry) {
        try {
          const preQueryResults = await executePreQueryHooks(
            this.userHookRegistry,
            state.turnCount,
            currentModel,
          );
          const formatted = AsyncHookRegistry.formatResults(preQueryResults);
          if (formatted) this.emit("error", `[PreQuery:turn${state.turnCount}]\n${formatted}`);
        } catch {
          // Hook failure must not block the query
        }
      }

      const apiStartTime = Date.now();

      try {
        // ---- Stream API call ----
        const streamResult = await this.apiStreamer.streamApiCall(
          context, systemPrompt, currentModel, apiKey, this.tools,
          (text) => this.emit("streaming", text),
          (reasoning) => this.emit("reasoning", reasoning)
        );

        // Response time: ${Date.now() - apiStartTime}ms

        // Reset failure count on success
        state = { ...state, consecutiveFailures: 0, hasAttemptedCompaction: false };

        const hasToolCalls = streamResult.toolCalls.length > 0;
        const stopReason: StopReason = hasToolCalls ? "tool_use" : "end_turn";

        // NOTE: Do NOT append assistant message to context.messages here.
        // The caller (app.tsx) adds it from the return value.
        // Double-append causes message array corruption and response lag.

        // Track token usage
        if (this.costTracker && streamResult.usage) {
          this.costTracker.trackTokens(streamResult.usage.input, streamResult.usage.output, currentModel);
          // token usage tracked via costTracker
        }

        // ---- PostQuery hooks (after API response) ----
        if (this.userHookRegistry) {
          try {
            const postQueryResults = await executePostQueryHooks(
              this.userHookRegistry,
              state.turnCount,
              currentModel,
              streamResult.usage
                ? `in:${streamResult.usage.input},out:${streamResult.usage.output}`
                : "unknown",
            );
            const formatted = AsyncHookRegistry.formatResults(postQueryResults);
            if (formatted) this.emit("error", `[PostQuery:turn${state.turnCount}]\n${formatted}`);
          } catch {
            // Hook failure must not block the query loop
          }
        }

        // ---- Execute tools ----
        if (hasToolCalls) {
          const execContext = { platform: context.platform, session: this.currentSession };
          const toolResults = await this.toolExecutor.executeWithHealing(
            streamResult.toolCalls,
            execContext,
            this.costTracker,
            null,
            {
              onToolExecuting: (name, cmd) => this.emit("toolExecuting", name, cmd),
              onToolResult: (result) => this.emit("toolResult", result),
              onPermissionDenied: (reason, layer, canOverride) =>
                this.emit("permissionDenied", reason, layer, canOverride),
              onRequestConfirmation: (tc, cmd, reason) =>
                this.emit("requestConfirmation", tc, cmd, reason),
              onError: (msg) => this.emit("error", msg),
              getProjectPath: () => projectPath,
            }
          );

          this.toolExecutor.appendToolMessages(
            context,
            streamResult.toolCalls,
            toolResults,
            streamResult.reasoningContent,
          );

          // Track tool metrics
          if (this.costTracker) {
            for (let i = 0; i < toolResults.length; i++) {
              const tr = toolResults[i]!;
              const tc = streamResult.toolCalls[i];
              this.costTracker.trackToolCall(tr.success);
              // tool stats tracked via costTracker
            }
          }

          // Check for stop-hook blocking after tool execution
          if (this.userHookRegistry && this.currentSession) {
            try {
              const allMessages = context.messages;
              const blockResults = await Promise.race([
                this.userHookRegistry.stop(allMessages.length, this.currentSession.session_id),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Stop hook timed out")), 10_000)),
              ]);
              if (AsyncHookRegistry.isBlocked(blockResults)) {
                const blockMsg = AsyncHookRegistry.getBlockMessage(blockResults);
                this.emit("error", `Query blocked by stop hook: ${blockMsg}`);
                return {
                  response: {
                    content: `Action blocked by stop hook: ${blockMsg}`,
                    model: currentModel,
                  },
                  stopReason: "stop_sequence",
                };
              }
              const formatted = AsyncHookRegistry.formatResults(blockResults);
              if (formatted) this.emit("error", `[Stop hooks:turn${state.turnCount}]\n${formatted}`);
            } catch {
              // Hook timeout/failure — don't block the turn
            }
          }
          state = {
            ...state,
            transition: "next_turn",
          };
          continue;
        }

        // ---- No tool calls: end of turn ----
        if (!hasToolCalls) {
          // Check max_output_tokens recovery
          if (streamResult.stopReason === "max_tokens" &&
              state.maxOutputTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
            const recoveryMsg: Message = {
              role: "user",
              content: "Output token limit hit. Resume directly — no apology, no recap. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.",
              timestamp: new Date().toISOString(),
              critical: false,
            };
            context.messages.push(recoveryMsg);
            state = {
              ...state,
              maxOutputTokensRecoveryCount: state.maxOutputTokensRecoveryCount + 1,
              transition: "max_output_tokens_recovery",
            };
            continue;
          }

          // Auto-commit if configured
          if (context.config.auto_commit) {
            await this.deliveryManager.performDelivery(context, {
              onTaskCompleted: (files, hash) => this.emit("taskCompleted", files, hash),
              makeExecutionContext: (platform) =>
                this.makeExecutionContext(platform as SessionContext["platform"]),
            });
          }

          return {
            response: {
              content: streamResult.content,
              model: context.config.model || "",
              usage: streamResult.usage,
            },
            stopReason: "end_turn",
          };
        }

        return {
          response: {
            content: streamResult.content,
            model: currentModel,
            usage: streamResult.usage,
          },
          toolCalls: streamResult.toolCalls.length > 0 ? streamResult.toolCalls : undefined,
          stopReason,
        };

      } catch (err: unknown) {
        const wrappedErr = ensureError(err, `API call turn ${state.turnCount}`);

        // Circuit breaker open → hard stop
        if (err instanceof CircuitBreakerOpenError) {
          return {
            response: {
              content: `API is currently unavailable (circuit breaker open). Please wait and try again.`,
              model: currentModel,
            },
            stopReason: "stop_sequence",
          };
        }

        // Token budget exceeded → hard stop
        if (err instanceof TokenBudgetExceededError) {
          return {
            response: {
              content: `Session stopped: ${wrappedErr.message}. Increase the budget to continue.`,
              model: currentModel,
            },
            stopReason: "stop_sequence",
          };
        }

        state = { ...state, consecutiveFailures: state.consecutiveFailures + 1 };
        this.emit("error", wrappedErr.stack || wrappedErr.message);

        if (this.costTracker) this.costTracker.trackError();

        // ---- Recovery: switch to fallback model ----
        if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES &&
            !state.usingFallbackModel &&
            context.config.fallback_model) {
          state = {
            ...state,
            usingFallbackModel: true,
            consecutiveFailures: 0,
            transition: "fallback_model",
          };
          context.messages.push({
            role: "tool",
            content: `Switching to fallback model: ${context.config.fallback_model} (after ${MAX_CONSECUTIVE_FAILURES} failures)`,
            timestamp: new Date().toISOString(),
            critical: true,
          });
          continue;
        }

        // ---- Recovery: retry with delay ----
        if (state.consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
          context.messages.push({
            role: "tool",
            content: `API error (attempt ${state.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${wrappedErr.message}. Retrying in ${RETRY_DELAY_MS / 1000}s...`,
            timestamp: new Date().toISOString(),
            critical: true,
          });
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }

        // ---- All recovery exhausted ----
        return {
          response: {
            content: `All API attempts failed (tried ${state.usingFallbackModel ? "both models" : `${MAX_CONSECUTIVE_FAILURES} times`}). Please check your network and API key.\nLast error: ${wrappedErr.message}`,
            model: currentModel,
          },
          stopReason: "stop_sequence",
        };
      }
    }

    // Max turns reached
    this.emit("maxTurnsReached");
    return {
      response: {
        content: `Task incomplete after ${maxTurns} turns. You can continue or stop.`,
        model: context.config.model || "",
      },
      stopReason: "stop_sequence",
    };
  }
}

export function createQueryEngine(config: Config): QueryEngineImpl {
  return new QueryEngineImpl(config);
}
