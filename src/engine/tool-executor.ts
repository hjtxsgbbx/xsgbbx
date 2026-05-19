import type { ToolCall, ToolResult, ExecutionContext, Message } from "../types/index.js";
import type { Tool } from "../tools/index.js";
import type { PermissionPipeline } from "../permissions/index.js";
import { classifyBashCommand } from "../permissions/index.js";
import { hooksSystem } from "../security/hooks.js";
import { invalidateEnvSnapshotCache } from "../observability/env-snapshot.js";
import type { CostTracker } from "../observability/cost-tracker.js";
import { AsyncHookRegistry } from "../hooks/async-hook-registry.js";
import { LIMITS, TIMEOUTS } from "../core/constants.js";

const HEAL_MAX_ATTEMPTS = LIMITS.MAX_RETRIES;
const HEAL_RETRY_DELAY_MS = TIMEOUTS.HEAL_RETRY_MS;
const TOOL_SUMMARY_MAX_LENGTH = LIMITS.MAX_TOOL_SUMMARY_LENGTH;

const DEFAULT_PERMISSION = {
  allowed: true,
  layer: "whitelist" as const,
  canOverride: false,
};

export interface ToolExecutionCallbacks {
  onToolExecuting: (name: string, command: string) => void;
  onToolResult: (result: ToolResult) => void;
  onPermissionDenied: (reason: string, layer: string, canOverride: boolean) => void;
  onRequestConfirmation: (toolCall: ToolCall, command: string, reason: string) => void;
  onError: (message: string) => void;
  getProjectPath: () => string;
}

export class ToolExecutor {
  private tools: Tool[];
  private toolMap: Map<string, Tool>;
  private permissionPipeline: PermissionPipeline;
  private userHookRegistry: AsyncHookRegistry | null = null;

  constructor(tools: Tool[], permissionPipeline: PermissionPipeline) {
    this.tools = tools;
    this.toolMap = new Map(tools.map((t) => [t.name, t]));
    this.permissionPipeline = permissionPipeline;
  }

  /** Set user-configurable hooks (from settings.json / project frontmatter) */
  setUserHookRegistry(registry: AsyncHookRegistry): void {
    this.userHookRegistry = registry;
  }

  registerTools(tools: Tool[]): void {
    for (const tool of tools) {
      this.tools.push(tool);
      this.toolMap.set(tool.name, tool);
    }
  }

  getToolMap(): Map<string, Tool> {
    return this.toolMap;
  }

  /**
   * Extract the shell command string from a tool call, if applicable.
   * Returns empty string for non-shell tools.
   */
  private extractShellCommand(tc: ToolCall): string {
    if (tc.name !== 'shell_command') {
      return '';
    }
    return (tc.arguments.command as string) || '';
  }

  /**
   * Run the bash security classifier on a tool call's command.
   * Returns a ToolResult if the command should be denied, null otherwise.
   *
   * - 'deny': Returns a blocked ToolResult immediately
   * - 'ask':  Returns null (let the permission pipeline handle confirmation)
   * - 'allow': Returns null (let the normal flow continue)
   */
  private checkBashSecurity(tc: ToolCall): ToolResult | null {
    const command = this.extractShellCommand(tc);
    if (command.length === 0) {
      return null;
    }

    const classification = classifyBashCommand(command);

    if (classification.tier === 'deny') {
      return {
        success: false,
        output: `Bash security blocked [check ${classification.checkId ?? '?'}]: ${classification.reason}`,
        errorCode: 'BASH_SECURITY_DENY',
      };
    }

    // 'ask' and 'allow' continue through the normal flow
    return null;
  }

  async executeWithHealing(
    toolCalls: ToolCall[],
    context: { platform: unknown; session: unknown },
    costTracker: CostTracker | null,
    _metricsCollector: unknown,
    callbacks: ToolExecutionCallbacks
  ): Promise<ToolResult[]> {
    const readonlyTools: ToolCall[] = [];
    const writeTools: ToolCall[] = [];

    for (const tc of toolCalls) {
      const tool = this.toolMap.get(tc.name);
      if (tool?.readonly) {
        readonlyTools.push(tc);
      } else {
        writeTools.push(tc);
      }
    }

    const results: ToolResult[] = new Array(toolCalls.length);
    const indexMap = new Map<ToolCall, number>();
    toolCalls.forEach((tc, i) => indexMap.set(tc, i));

    // Execute readonly tools in parallel
    if (readonlyTools.length > 0) {
      const readonlyResults = await Promise.all(
        readonlyTools.map((tc) => this.executeOne(tc, context, callbacks))
      );
      readonlyTools.forEach((tc, j) => {
        const idx = indexMap.get(tc) ?? 0;
        results[idx] = readonlyResults[j]!;
        callbacks.onToolResult(readonlyResults[j]!);
      });
    }

    // Execute write tools sequentially with healing
    for (const tc of writeTools) {
      const idx = indexMap.get(tc) ?? 0;
      results[idx] = await this.executeOneWithHealing(tc, context, callbacks);
      callbacks.onToolResult(results[idx]!);
      invalidateEnvSnapshotCache(callbacks.getProjectPath());
    }

    return results;
  }

  private async executeOne(
    tc: ToolCall,
    context: { platform: unknown; session: unknown },
    callbacks: ToolExecutionCallbacks
  ): Promise<ToolResult> {
    const tool = this.toolMap.get(tc.name);

    if (!tool) {
      return { success: false, output: `Unknown tool: ${tc.name}`, errorCode: "UNKNOWN_TOOL" };
    }

    callbacks.onToolExecuting(tool.name, JSON.stringify(tc.arguments).slice(0, TOOL_SUMMARY_MAX_LENGTH));

    const execContext: ExecutionContext = {
      session: context.session as ExecutionContext["session"],
      platform: context.platform as ExecutionContext["platform"],
      permissionLevel: DEFAULT_PERMISSION,
    };

    const preHookResult = await hooksSystem.executePreTool(tc, execContext);
    if (!preHookResult.allowed) {
      return { success: false, output: `Blocked by security hook: ${preHookResult.messages.join("; ")}`, errorCode: "HOOK_BLOCKED" };
    }

    // User-configurable PreToolUse hooks (from settings.json / project frontmatter)
    if (this.userHookRegistry) {
      try {
        const userResults = await Promise.race([
          this.userHookRegistry.preToolUse(tc.name, tc.arguments),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("PreToolUse hook timed out")), 10_000)),
        ]);
        if (AsyncHookRegistry.isBlocked(userResults)) {
          return { success: false, output: `Blocked by user hook: ${AsyncHookRegistry.getBlockMessage(userResults)}`, errorCode: "USER_HOOK_BLOCKED" };
        }
        // Log hook results for observability
        const formatted = AsyncHookRegistry.formatResults(userResults);
        if (formatted) callbacks.onError(`[PreToolUse:${tc.name}]\n${formatted}`);
      } catch (hookErr: unknown) {
        // Hook failure should NOT crash the tool — log and continue
        const msg = hookErr instanceof Error ? hookErr.message : String(hookErr);
        callbacks.onError(`[PreToolUse:${tc.name}] Hook error (continuing): ${msg}`);
      }
    }

    // Bash security classification — deny dangerous shell commands immediately
    const bashSecurityResult = this.checkBashSecurity(tc);
    if (bashSecurityResult) {
      callbacks.onPermissionDenied(bashSecurityResult.output, 'cache', false);
      return bashSecurityResult;
    }

    if (!tool.readonly) {
      const decision = await this.permissionPipeline.check(tc, execContext);
      if (!decision.allowed) {
        callbacks.onPermissionDenied(decision.reason || "unknown", decision.layer, decision.canOverride || false);
        return { success: false, output: `Permission denied: ${decision.reason}`, errorCode: "PERMISSION_DENIED" };
      }
      if (decision.confirmationRequired) {
        callbacks.onRequestConfirmation(tc, JSON.stringify(tc.arguments).slice(0, TOOL_SUMMARY_MAX_LENGTH), decision.reason || "confirmation required");
        return { success: false, output: `Confirmation required: ${decision.reason}`, errorCode: "CONFIRMATION_REQUIRED" };
      }
    }

    let result: ToolResult;
    try {
      result = await tool.execute(tc.arguments, execContext);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      result = { success: false, output: message, errorCode: "TOOL_ERROR" };
    }

    // User-configurable PostToolUse hooks (non-blocking, fire-and-forget with log)
    if (this.userHookRegistry) {
      try {
        const postResults = await Promise.race([
          this.userHookRegistry.postToolUse(tc.name, tc.arguments, { success: result.success, output: result.output }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("PostToolUse hook timed out")), 10_000)),
        ]);
        const formatted = AsyncHookRegistry.formatResults(postResults);
        if (formatted) callbacks.onError(`[PostToolUse:${tc.name}]\n${formatted}`);
      } catch (hookErr: unknown) {
        // Hook failure should NOT crash the tool — log and continue
        const msg = hookErr instanceof Error ? hookErr.message : String(hookErr);
        callbacks.onError(`[PostToolUse:${tc.name}] Hook error (continuing): ${msg}`);
      }
    }

    return result;
  }

  private async executeOneWithHealing(
    tc: ToolCall,
    context: { platform: unknown; session: unknown },
    callbacks: ToolExecutionCallbacks
  ): Promise<ToolResult> {
    const tool = this.toolMap.get(tc.name);

    if (!tool) {
      return { success: false, output: `Unknown tool: ${tc.name}`, errorCode: "UNKNOWN_TOOL" };
    }

    callbacks.onToolExecuting(tool.name, JSON.stringify(tc.arguments).slice(0, TOOL_SUMMARY_MAX_LENGTH));

    const execContext: ExecutionContext = {
      session: context.session as ExecutionContext["session"],
      platform: context.platform as ExecutionContext["platform"],
      permissionLevel: DEFAULT_PERMISSION,
    };

    const preHookResult = await hooksSystem.executePreTool(tc, execContext);
    if (!preHookResult.allowed) {
      return { success: false, output: `Blocked by security hook: ${preHookResult.messages.join("; ")}`, errorCode: "HOOK_BLOCKED" };
    }

    // User-configurable PreToolUse hooks
    if (this.userHookRegistry) {
      try {
        const userResults = await Promise.race([
          this.userHookRegistry.preToolUse(tc.name, tc.arguments),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("PreToolUse hook timed out")), 10_000)),
        ]);
        if (AsyncHookRegistry.isBlocked(userResults)) {
          return { success: false, output: `Blocked by user hook: ${AsyncHookRegistry.getBlockMessage(userResults)}`, errorCode: "USER_HOOK_BLOCKED" };
        }
        const formatted = AsyncHookRegistry.formatResults(userResults);
        if (formatted) callbacks.onError(`[PreToolUse:${tc.name}]\n${formatted}`);
      } catch (hookErr: unknown) {
        const msg = hookErr instanceof Error ? hookErr.message : String(hookErr);
        callbacks.onError(`[PreToolUse:${tc.name}] Hook error (continuing): ${msg}`);
      }
    }

    // Bash security classification — deny dangerous shell commands immediately
    const bashSecurityResult = this.checkBashSecurity(tc);
    if (bashSecurityResult) {
      callbacks.onPermissionDenied(bashSecurityResult.output, 'cache', false);
      return bashSecurityResult;
    }

    // Simple retry loop without ErrorHealer dependency
    let result = await tool.execute(tc.arguments, execContext);
    let attempts = 0;

    while (!result.success && attempts < HEAL_MAX_ATTEMPTS && result.errorCode) {
      attempts++;
      callbacks.onError(`Tool "${tc.name}" failed (attempt ${attempts}/${HEAL_MAX_ATTEMPTS}): ${result.output}`);
      await new Promise((r) => setTimeout(r, HEAL_RETRY_DELAY_MS));
      try {
        result = await tool.execute(tc.arguments, execContext);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, output: message, errorCode: "TOOL_ERROR" };
      }
    }

    // User-configurable PostToolUse hooks (non-blocking, fire-and-forget with log)
    if (this.userHookRegistry) {
      try {
        const postResults = await Promise.race([
          this.userHookRegistry.postToolUse(tc.name, tc.arguments, { success: result.success, output: result.output }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("PostToolUse hook timed out")), 10_000)),
        ]);
        const formatted = AsyncHookRegistry.formatResults(postResults);
        if (formatted) callbacks.onError(`[PostToolUse:${tc.name}]\n${formatted}`);
      } catch (hookErr: unknown) {
        const msg = hookErr instanceof Error ? hookErr.message : String(hookErr);
        callbacks.onError(`[PostToolUse:${tc.name}] Hook error (continuing): ${msg}`);
      }
    }

    return result;
  }

  appendToolMessages(
    context: { messages: Message[] },
    toolCalls: ToolCall[],
    toolResults: ToolResult[],
    reasoningContent?: string,
  ): void {
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i]!;
      const tr = toolResults[i]!;
      // DeepSeek V4: reasoning_content MUST be round-tripped on assistant messages
      context.messages.push({
        role: "assistant",
        content: [tc],
        timestamp: new Date().toISOString(),
        critical: false,
        reasoning_content: reasoningContent || "",
      });
      context.messages.push({
        role: "tool",
        content: tr.output,
        timestamp: new Date().toISOString(),
        critical: tr.errorCode ? true : false,
        tool_id: tc.id,
      });
    }
  }
}
