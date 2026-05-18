import type { ExecutionContext, Message, SessionContext } from "../types/index.js";
import type { Tool } from "../tools/index.js";
import { debug } from "../observability/debug.js";
import { LIMITS } from "../core/constants.js";

const COMMIT_MESSAGE_MAX_LENGTH = LIMITS.MAX_COMMIT_MESSAGE_LENGTH;

export interface DeliveryCallbacks {
  onTaskCompleted: (files: string[], commitHash?: string) => void;
  makeExecutionContext: (platform: unknown) => ExecutionContext;
}

export class DeliveryManager {
  private toolMap: Map<string, Tool>;

  constructor(toolMap: Map<string, Tool>) {
    this.toolMap = toolMap;
  }

  updateToolMap(toolMap: Map<string, Tool>): void {
    this.toolMap = toolMap;
  }

  appendAssistantMessage(context: SessionContext, content: string, reasoningContent?: string): void {
    const assistantMsg: Message = {
      role: "assistant",
      content,
      timestamp: new Date().toISOString(),
      critical: false,
      reasoning_content: reasoningContent || "",
    };
    context.messages.push(assistantMsg);
  }

  async performDelivery(
    context: SessionContext,
    callbacks: DeliveryCallbacks
  ): Promise<void> {
    const commitTool = this.toolMap.get("git_commit");
    if (!commitTool) return;

    try {
      const lastUserInput = context.messages
        .filter((m) => m.role === "user")
        .pop();

      const commitMessage = lastUserInput
        ? `feat: ${typeof lastUserInput.content === "string" ? lastUserInput.content.slice(0, COMMIT_MESSAGE_MAX_LENGTH) : "apply changes"}`
        : "feat: apply changes";

      const result = await commitTool.execute(
        { message: commitMessage },
        callbacks.makeExecutionContext(context.platform)
      );

      if (result.success) {
        callbacks.onTaskCompleted([], result.artifacts?.[0]);
      }

      const pushTool = this.toolMap.get("git_push");
      if (pushTool) {
        try {
          await pushTool.execute({}, callbacks.makeExecutionContext(context.platform));
        } catch (err) {
          debug.warn("delivery-manager", "Git push failed (non-critical)", err);
        }
      }
    } catch (err) {
      debug.warn("delivery-manager", "Git commit failed (non-critical)", err);
    }
  }
}
