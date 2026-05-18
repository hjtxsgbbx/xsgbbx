import {
  type Tool,
  type ToolCall,
  type ToolResult,
  type ExecutionContext,
  type PermissionDecision,
  type AuditLogEntry,
} from "../types/index.js";
import { type PermissionPipeline } from "../permissions/index.js";
import { type AuditLogger } from "../storage/index.js";
import { executePreToolUseHooks, executePostToolUseHooks, type HooksSettings } from "../engine/hook-system.js";

const ERROR_UNKNOWN_TOOL = "UNKNOWN_TOOL";
const ERROR_PERMISSION_DENIED = "PERMISSION_DENIED";
const ERROR_CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED";
const ERROR_TOOL_ERROR = "TOOL_ERROR";
const AUDIT_SUMMARY_MAX_LENGTH = 200;

const DEFAULT_PERMISSION: PermissionDecision = {
  allowed: true,
  layer: "whitelist",
  canOverride: false,
};

export class StreamingToolExecutor {
  private permissionPipeline: PermissionPipeline;
  private auditLogger: AuditLogger | null = null;
  private sessionHooks: HooksSettings = {};

  constructor(permissionPipeline: PermissionPipeline, auditLogger?: AuditLogger) {
    this.permissionPipeline = permissionPipeline;
    this.auditLogger = auditLogger || null;
  }

  setHooks(hooks: HooksSettings): void {
    this.sessionHooks = hooks;
  }

  setAuditLogger(logger: AuditLogger): void {
    this.auditLogger = logger;
  }

  async executeStream(
    toolCalls: ToolCall[],
    tools: Tool[],
    context: ExecutionContext
  ): Promise<ToolResult[]> {
    const toolMap = new Map(tools.map((t) => [t.name, t]));
    const results: ToolResult[] = [];
    const readonlyCalls: ToolCall[] = [];
    const writeCalls: ToolCall[] = [];

    for (const tc of toolCalls) {
      const tool = toolMap.get(tc.name);
      if (tool?.readonly) {
        readonlyCalls.push(tc);
      } else {
        writeCalls.push(tc);
      }
    }

    if (readonlyCalls.length > 0) {
      const readonlyResults = await Promise.all(
        readonlyCalls.map((tc) => this.executeOne(tc, toolMap, context))
      );
      results.push(...readonlyResults);
    }

    for (const tc of writeCalls) {
      const result = await this.executeOne(tc, toolMap, context);
      results.push(result);
    }

    return results;
  }

  private async executeOne(
    toolCall: ToolCall,
    toolMap: Map<string, Tool>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const tool = toolMap.get(toolCall.name);

    if (!tool) {
      this.logAudit(context, toolCall, "denied", ERROR_UNKNOWN_TOOL);
      return {
        success: false,
        output: `Unknown tool: ${toolCall.name}`,
        errorCode: ERROR_UNKNOWN_TOOL,
      };
    }

    if (!tool.readonly) {
      const decision = await this.permissionPipeline.check(
        toolCall,
        context
      );

      if (!decision.allowed) {
        this.logAudit(context, toolCall, "denied", decision.reason);
        return {
          success: false,
          output: `Permission denied (${decision.layer}): ${decision.reason}`,
          errorCode: ERROR_PERMISSION_DENIED,
        };
      }

      if (decision.confirmationRequired) {
        this.logAudit(context, toolCall, "denied", `Confirmation required: ${decision.reason}`);
        return {
          success: false,
          output: `Confirmation required (${decision.layer}): ${decision.reason}. Please approve this action to proceed.`,
          errorCode: ERROR_CONFIRMATION_REQUIRED,
        };
      }
    }

    // Pre-tool hooks
    const preHookResults = await executePreToolUseHooks(
      toolCall.name,
      toolCall.arguments,
      this.sessionHooks
    );
    const blocked = preHookResults.find(r => !r.allow);
    if (blocked) {
      return {
        success: false,
        output: blocked.message || `Blocked by PreToolUse hook`,
        errorCode: "HOOK_BLOCKED",
      };
    }

    try {
      const result = await tool.execute(toolCall.arguments, {
        ...context,
        permissionLevel: DEFAULT_PERMISSION,
      });

      // Post-tool hooks (fire-and-forget)
      executePostToolUseHooks(toolCall.name, toolCall.arguments, result, this.sessionHooks)
        .catch(() => {});

      this.logAudit(context, toolCall, "allowed", result.success ? "success" : result.errorCode || "error");
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logAudit(context, toolCall, "denied", `Error: ${message}`);
      return {
        success: false,
        output: message || "Tool execution failed",
        errorCode: ERROR_TOOL_ERROR,
      };
    }
  }

  private logAudit(
    context: ExecutionContext,
    toolCall: ToolCall,
    decision: AuditLogEntry["decision"],
    _reason?: string
  ): void {
    if (!this.auditLogger) return;

    const commandSummary = toolCall.name === "shell_command"
      ? String(toolCall.arguments.command || "").slice(0, AUDIT_SUMMARY_MAX_LENGTH)
      : `${toolCall.name}(${JSON.stringify(toolCall.arguments).slice(0, AUDIT_SUMMARY_MAX_LENGTH)})`;

    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      session_id: context.session.session_id,
      action: "tool_exec",
      tool_name: toolCall.name,
      command_summary: commandSummary,
      decision,
    };

    this.auditLogger.log(entry);
  }
}

export function findToolByName(name: string, tools: Tool[]): Tool | undefined {
  return tools.find((t) => t.name === name);
}

export function getToolSignatures(tools: Tool[]): string {
  return tools
    .map(
      (t) =>
        `${t.name}: ${t.description}\nParams: ${JSON.stringify(t.parameters)}`
    )
    .join("\n\n");
}
