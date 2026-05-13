import {
  Tool,
  ToolCall,
  ToolResult,
  ExecutionContext,
  PermissionDecision,
  AuditLogEntry,
} from "../types/index.js";
import { PermissionPipeline } from "../permissions/index.js";
import { AuditLogger } from "../storage/index.js";

export class StreamingToolExecutor {
  private permissionPipeline: PermissionPipeline;
  private auditLogger: AuditLogger | null = null;

  constructor(permissionPipeline: PermissionPipeline, auditLogger?: AuditLogger) {
    this.permissionPipeline = permissionPipeline;
    this.auditLogger = auditLogger || null;
  }

  setAuditLogger(logger: AuditLogger): void {
    this.auditLogger = logger;
  }

  async executeStream(
    toolCalls: ToolCall[],
    tools: Tool[],
    context: ExecutionContext
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    const readonlyCalls = toolCalls.filter((tc) => {
      const tool = tools.find((t) => t.name === tc.name);
      return tool?.readonly === true;
    });
    const writeCalls = toolCalls.filter((tc) => {
      const tool = tools.find((t) => t.name === tc.name);
      return tool?.readonly === false;
    });

    if (readonlyCalls.length > 0) {
      const readonlyResults = await Promise.all(
        readonlyCalls.map((tc) => this.executeOne(tc, tools, context))
      );
      results.push(...readonlyResults);
    }

    for (const tc of writeCalls) {
      const result = await this.executeOne(tc, tools, context);
      results.push(result);
    }

    return results;
  }

  private async executeOne(
    toolCall: ToolCall,
    tools: Tool[],
    context: ExecutionContext
  ): Promise<ToolResult> {
    const tool = tools.find((t) => t.name === toolCall.name);

    if (!tool) {
      this.logAudit(context, toolCall, "denied", "UNKNOWN_TOOL");
      return {
        success: false,
        output: `Unknown tool: ${toolCall.name}`,
        errorCode: "UNKNOWN_TOOL",
      };
    }

    if (!tool.readonly) {
      const decision = await this.permissionPipeline.check(
        toolCall,
        context
      );

      if (!decision.allowed) {
        this.logAudit(context, toolCall, decision.allowed ? "allowed" : "denied", decision.reason);
        return {
          success: false,
          output: `Permission denied (${decision.layer}): ${decision.reason}`,
          errorCode: "PERMISSION_DENIED",
        };
      }

      if (decision.confirmationRequired) {
        this.logAudit(context, toolCall, "denied", `Confirmation required: ${decision.reason}`);
      }
    }

    try {
      const result = await tool.execute(toolCall.arguments, {
        ...context,
        permissionLevel: {
          allowed: true,
          layer: "whitelist",
          canOverride: false,
        },
      });
      this.logAudit(context, toolCall, "allowed", result.success ? "success" : result.errorCode || "error");
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logAudit(context, toolCall, "denied", `Error: ${message}`);
      return {
        success: false,
        output: message || "Tool execution failed",
        errorCode: "TOOL_ERROR",
      };
    }
  }

  private logAudit(
    context: ExecutionContext,
    toolCall: ToolCall,
    decision: AuditLogEntry["decision"],
    reason?: string
  ): void {
    if (!this.auditLogger) return;

    const commandSummary = toolCall.name === "shell_command"
      ? String(toolCall.arguments.command || "").slice(0, 200)
      : `${toolCall.name}(${JSON.stringify(toolCall.arguments).slice(0, 200)})`;

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