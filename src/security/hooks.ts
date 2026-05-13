import { ToolCall, ToolResult, ExecutionContext } from "../types/index.js";

export type HookEvent = "pre_tool" | "post_tool" | "pre_commit" | "post_commit" | "on_error" | "on_delivery";

export interface HookContext {
  event: HookEvent;
  toolCall?: ToolCall;
  result?: ToolResult;
  error?: Error;
  sessionId?: string;
  timestamp: string;
  projectPath: string;
}

export type HookHandler = (context: HookContext) => Promise<{ continue: boolean; message?: string; modifiedCommand?: string }>;

interface HookEntry {
  id: string;
  event: HookEvent;
  handler: HookHandler;
  description: string;
}

export class HooksSystem {
  private hooks: HookEntry[] = [];
  private nextId = 1;

  register(event: HookEvent, handler: HookHandler, description = ""): string {
    const id = `hook-${this.nextId++}`;
    this.hooks.push({ id, event, handler, description });
    return id;
  }

  unregister(id: string): boolean {
    const idx = this.hooks.findIndex((h) => h.id === id);
    if (idx >= 0) {
      this.hooks.splice(idx, 1);
      return true;
    }
    return false;
  }

  getHooks(event?: HookEvent): HookEntry[] {
    if (event) {
      return this.hooks.filter((h) => h.event === event);
    }
    return [...this.hooks];
  }

  async executeEvent(
    event: HookEvent,
    context: HookContext
  ): Promise<{ allowed: boolean; modifiedCommand?: string; messages: string[] }> {
    const eventHooks = this.hooks.filter((h) => h.event === event);
    const messages: string[] = [];
    let modifiedCommand: string | undefined;

    for (const hook of eventHooks) {
      try {
        const result = await hook.handler(context);
        messages.push(result.message || "");

        if (result.modifiedCommand) {
          modifiedCommand = result.modifiedCommand;
        }

        if (!result.continue) {
          return { allowed: false, messages };
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        messages.push(`Hook ${hook.id} error: ${message}`);
      }
    }

    return { allowed: true, modifiedCommand, messages };
  }

  async executePreTool(
    toolCall: ToolCall,
    context: ExecutionContext
  ): Promise<{ allowed: boolean; modifiedCommand?: string; messages: string[] }> {
    return this.executeEvent("pre_tool", {
      event: "pre_tool",
      toolCall,
      timestamp: new Date().toISOString(),
      projectPath: context.session.meta.project_path,
    });
  }

  async executePostTool(
    toolCall: ToolCall,
    result: ToolResult,
    context: ExecutionContext
  ): Promise<{ allowed: boolean; messages: string[] }> {
    return this.executeEvent("post_tool", {
      event: "post_tool",
      toolCall,
      result,
      timestamp: new Date().toISOString(),
      projectPath: context.session.meta.project_path,
    });
  }

  async executeOnError(
    error: Error,
    context: ExecutionContext
  ): Promise<{ allowed: boolean; messages: string[] }> {
    return this.executeEvent("on_error", {
      event: "on_error",
      error,
      timestamp: new Date().toISOString(),
      projectPath: context.session.meta.project_path,
    });
  }

  clear(): void {
    this.hooks = [];
  }
}

export const hooksSystem = new HooksSystem();