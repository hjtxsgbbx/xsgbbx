import { EventEmitter } from "events";
import { type ToolCall, type ToolResult, type ExecutionContext } from "../types/index.js";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

export type HookEvent =
  | "pre_tool" | "post_tool"
  | "pre_commit" | "post_commit"
  | "on_error" | "on_delivery"
  | "session_start" | "session_end"
  | "pre_query" | "post_query"
  | "goal_achieved" | "goal_failed"
  | "iteration_start" | "iteration_end"
  | "agent_spawn" | "agent_complete";

export interface HookContext {
  event: HookEvent;
  toolCall?: ToolCall;
  result?: ToolResult;
  error?: Error;
  sessionId?: string;
  timestamp: string;
  projectPath: string;
  metadata?: Record<string, unknown>;
}

export interface HookResult {
  continue: boolean;
  message?: string;
  modifiedCommand?: string;
  modifiedArgs?: Record<string, unknown>;
  skip?: boolean;
  retry?: boolean;
  data?: Record<string, unknown>;
}

export type HookHandler = (context: HookContext) => Promise<HookResult>;

export interface HookDefinition {
  id: string;
  event: HookEvent;
  handler: HookHandler;
  description: string;
  priority: number;
  enabled: boolean;
  source: "builtin" | "config" | "plugin" | "manual";
  tags: string[];
}

export interface HookConfig {
  id: string;
  event: HookEvent;
  command?: string;
  script?: string;
  description: string;
  priority: number;
  enabled: boolean;
  tags: string[];
}

interface HookEntry {
  definition: HookDefinition;
  handler: HookHandler;
}

const _BUILTIN_HOOK_CONFIGS: HookConfig[] = [
  {
    id: "builtin-block-dangerous-commands",
    event: "pre_tool",
    description: "Block dangerous shell commands",
    priority: 100,
    enabled: true,
    tags: ["security", "builtin"],
  },
  {
    id: "builtin-log-tool-execution",
    event: "post_tool",
    description: "Log tool execution results",
    priority: 50,
    enabled: true,
    tags: ["observability", "builtin"],
  },
  {
    id: "builtin-validate-session",
    event: "session_start",
    description: "Validate session configuration on start",
    priority: 90,
    enabled: true,
    tags: ["validation", "builtin"],
  },
  {
    id: "builtin-cleanup-session",
    event: "session_end",
    description: "Cleanup resources on session end",
    priority: 10,
    enabled: true,
    tags: ["cleanup", "builtin"],
  },
  {
    id: "builtin-error-notifier",
    event: "on_error",
    description: "Notify on errors",
    priority: 50,
    enabled: true,
    tags: ["observability", "builtin"],
  },
];

export class HooksSystem extends EventEmitter {
  private hooks: Map<string, HookEntry> = new Map();
  private nextId = 1;
  private configPath: string | null = null;
  private executionLog: Array<{ hookId: string; event: HookEvent; timestamp: string; result: HookResult }> = [];

  constructor(configPath?: string) {
    super();
    this.configPath = configPath || null;
    this.loadConfig();
  }

  register(
    event: HookEvent,
    handler: HookHandler,
    description = "",
    options?: { priority?: number; source?: HookDefinition["source"]; tags?: string[]; id?: string }
  ): string {
    const id = options?.id || `hook-${this.nextId++}`;
    const definition: HookDefinition = {
      id,
      event,
      handler,
      description,
      priority: options?.priority ?? 50,
      enabled: true,
      source: options?.source ?? "manual",
      tags: options?.tags ?? [],
    };

    this.hooks.set(id, { definition, handler });
    this.emit("hook:registered", definition);
    return id;
  }

  unregister(id: string): boolean {
    const entry = this.hooks.get(id);
    if (!entry) return false;

    this.hooks.delete(id);
    this.emit("hook:unregistered", entry.definition);
    return true;
  }

  enable(id: string): boolean {
    const entry = this.hooks.get(id);
    if (!entry) return false;
    entry.definition.enabled = true;
    return true;
  }

  disable(id: string): boolean {
    const entry = this.hooks.get(id);
    if (!entry) return false;
    entry.definition.enabled = false;
    return true;
  }

  getHooks(event?: HookEvent): HookDefinition[] {
    const entries = [...this.hooks.values()];
    const filtered = event
      ? entries.filter((e) => e.definition.event === event)
      : entries;
    return filtered
      .map((e) => e.definition)
      .sort((a, b) => b.priority - a.priority);
  }

  getHook(id: string): HookDefinition | undefined {
    return this.hooks.get(id)?.definition;
  }

  async executeEvent(
    event: HookEvent,
    context: Omit<HookContext, "event" | "timestamp">
  ): Promise<{ allowed: boolean; modifiedCommand?: string; modifiedArgs?: Record<string, unknown>; messages: string[]; data: Record<string, unknown> }> {
    const fullContext: HookContext = {
      ...context,
      event,
      timestamp: new Date().toISOString(),
    };

    const eventHooks = [...this.hooks.values()]
      .filter((e) => e.definition.event === event && e.definition.enabled)
      .sort((a, b) => b.definition.priority - a.definition.priority);

    const messages: string[] = [];
    let modifiedCommand: string | undefined;
    let modifiedArgs: Record<string, unknown> | undefined;
    const data: Record<string, unknown> = {};

    for (const entry of eventHooks) {
      try {
        const result = await entry.handler(fullContext);
        this.executionLog.push({
          hookId: entry.definition.id,
          event,
          timestamp: fullContext.timestamp,
          result,
        });

        if (result.message) messages.push(result.message);
        if (result.modifiedCommand) modifiedCommand = result.modifiedCommand;
        if (result.modifiedArgs) modifiedArgs = { ...modifiedArgs, ...result.modifiedArgs };
        if (result.data) Object.assign(data, result.data);

        if (result.skip) {
          return { allowed: true, modifiedCommand, modifiedArgs, messages: [...messages, `Skipped by ${entry.definition.id}`], data };
        }

        if (result.retry) {
          return { allowed: true, modifiedCommand, modifiedArgs, messages: [...messages, `Retry requested by ${entry.definition.id}`], data };
        }

        if (!result.continue) {
          this.emit("hook:blocked", entry.definition, fullContext);
          return { allowed: false, messages, data };
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        messages.push(`Hook ${entry.definition.id} error: ${message}`);
        this.emit("hook:error", entry.definition, err);
      }
    }

    this.emit("hook:executed", event, fullContext);
    return { allowed: true, modifiedCommand, modifiedArgs, messages, data };
  }

  async executePreTool(
    toolCall: ToolCall,
    context: ExecutionContext
  ): Promise<{ allowed: boolean; modifiedCommand?: string; messages: string[] }> {
    const result = await this.executeEvent("pre_tool", {
      toolCall,
      projectPath: context.session.meta.project_path,
      sessionId: context.session.session_id,
    });
    return { allowed: result.allowed, modifiedCommand: result.modifiedCommand, messages: result.messages };
  }

  async executePostTool(
    toolCall: ToolCall,
    result: ToolResult,
    context: ExecutionContext
  ): Promise<{ allowed: boolean; messages: string[] }> {
    const hookResult = await this.executeEvent("post_tool", {
      toolCall,
      result,
      projectPath: context.session.meta.project_path,
      sessionId: context.session.session_id,
    });
    return { allowed: hookResult.allowed, messages: hookResult.messages };
  }

  async executeOnError(
    error: Error,
    context: ExecutionContext
  ): Promise<{ allowed: boolean; messages: string[] }> {
    const result = await this.executeEvent("on_error", {
      error,
      projectPath: context.session.meta.project_path,
      sessionId: context.session.session_id,
    });
    return { allowed: result.allowed, messages: result.messages };
  }

  async executeSessionStart(sessionId: string, projectPath: string, metadata?: Record<string, unknown>): Promise<{ allowed: boolean; messages: string[] }> {
    const result = await this.executeEvent("session_start", {
      sessionId,
      projectPath,
      metadata,
    });
    return { allowed: result.allowed, messages: result.messages };
  }

  async executeSessionEnd(sessionId: string, projectPath: string, metadata?: Record<string, unknown>): Promise<{ allowed: boolean; messages: string[] }> {
    const result = await this.executeEvent("session_end", {
      sessionId,
      projectPath,
      metadata,
    });
    return { allowed: result.allowed, messages: result.messages };
  }

  async executePreQuery(query: string, projectPath: string, sessionId?: string): Promise<{ allowed: boolean; modifiedCommand?: string; messages: string[] }> {
    const result = await this.executeEvent("pre_query", {
      projectPath,
      sessionId,
      metadata: { query },
    });
    return { allowed: result.allowed, modifiedCommand: result.modifiedCommand, messages: result.messages };
  }

  async executePostQuery(query: string, response: string, projectPath: string, sessionId?: string): Promise<{ allowed: boolean; messages: string[] }> {
    const result = await this.executeEvent("post_query", {
      projectPath,
      sessionId,
      metadata: { query, response },
    });
    return { allowed: result.allowed, messages: result.messages };
  }

  getExecutionLog(limit?: number): Array<{ hookId: string; event: HookEvent; timestamp: string; result: HookResult }> {
    const log = [...this.executionLog].reverse();
    return limit ? log.slice(0, limit) : log;
  }

  saveConfig(): void {
    if (!this.configPath) return;

    const configs: HookConfig[] = [];
    for (const entry of this.hooks.values()) {
      if (entry.definition.source === "builtin") continue;
      configs.push({
        id: entry.definition.id,
        event: entry.definition.event,
        description: entry.definition.description,
        priority: entry.definition.priority,
        enabled: entry.definition.enabled,
        tags: entry.definition.tags,
      });
    }

    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(configs, null, 2), "utf-8");
  }

  loadConfig(): void {
    if (!this.configPath || !fs.existsSync(this.configPath)) return;

    try {
      const configs: HookConfig[] = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
      for (const config of configs) {
        if (config.command) {
          this.registerFromCommand(config);
        } else if (config.script) {
          this.registerFromScript(config);
        }
      }
    } catch { /* best effort */ }
  }

  registerFromCommand(config: HookConfig): string {
    const handler: HookHandler = async (context) => {
      try {
        const env = {
          ...process.env,
          HOOK_EVENT: context.event,
          HOOK_SESSION: context.sessionId || "",
          HOOK_PROJECT: context.projectPath,
          HOOK_TIMESTAMP: context.timestamp,
        };
        const output = execSync(config.command!, { timeout: 30000, encoding: "utf-8", env }).trim();
        return { continue: true, message: output || undefined };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { continue: false, message: `Command hook failed: ${msg}` };
      }
    };

    return this.register(config.event, handler, config.description, {
      priority: config.priority,
      source: "config",
      tags: config.tags,
      id: config.id,
    });
  }

  registerFromScript(config: HookConfig): string {
    const handler: HookHandler = async (context) => {
      try {
        const scriptPath = config.script ?? "";
        if (!scriptPath || !fs.existsSync(scriptPath)) {
          return { continue: false, message: `Script not found: ${scriptPath}` };
        }

        const scriptModule = await import(scriptPath);
        const scriptHandler = scriptModule.default || scriptModule.handler;
        if (typeof scriptHandler !== "function") {
          return { continue: false, message: `Script has no handler function: ${scriptPath}` };
        }

        return await scriptHandler(context);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { continue: false, message: `Script hook failed: ${msg}` };
      }
    };

    return this.register(config.event, handler, config.description, {
      priority: config.priority,
      source: "plugin",
      tags: config.tags,
      id: config.id,
    });
  }

  clear(): void {
    this.hooks.clear();
    this.executionLog = [];
  }

  destroy(): void {
    this.clear();
    this.removeAllListeners();
  }
}

export const hooksSystem = new HooksSystem();
