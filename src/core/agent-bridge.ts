import { EventEmitter } from "events";
import {
  AgentBridge,
  UserInput,
  SessionContext,
  QueryResult,
  WSMessage,
  Session,
  PlatformInfo,
  Config,
  TokenUsage,
  AuditLogEntry,
} from "../types/index.js";
import { QueryEngineImpl, createQueryEngine } from "./query-engine.js";
import { loadProjectMemory } from "./project-memory.js";
import { ConfigStore, SessionStore, AuditLogger } from "../storage/index.js";
import { detectPlatform } from "../pal/index.js";
import { v4 as uuidv4 } from "uuid";

export interface BridgeEvents {
  stream: (chunk: string) => void;
  stateChange: (state: string, data?: unknown) => void;
  error: (message: string) => void;
  abort: () => void;
}

export class AgentBridgeImpl extends EventEmitter implements AgentBridge {
  private engine: QueryEngineImpl;
  private platform: PlatformInfo;
  private config: Config;
  private sessionStore: SessionStore;
  private auditLogger: AuditLogger;
  private currentSession: Session | null = null;
  private abortController: AbortController | null = null;
  private streamCallbacks: Array<(chunk: string) => void> = [];

  constructor(providerName?: string) {
    super();
    this.platform = detectPlatform();
    const configStore = new ConfigStore();
    this.config = configStore.load();
    this.sessionStore = new SessionStore();
    this.auditLogger = new AuditLogger();
    this.engine = createQueryEngine(providerName || this.config.chosen_provider || "anthropic");
    this.bindEngineEvents();
  }

  private bindEngineEvents(): void {
    this.engine.on("thinking", (model: string, attempt: number, usage?: TokenUsage) => {
      this.emit("stateChange", "thinking", { model, attempt, usage });
    });

    this.engine.on("toolExecuting", (toolName: string, command: string) => {
      this.emit("stateChange", "executing", { toolName, command });
    });

    this.engine.on("toolResult", (result: { success: boolean; output: string }) => {
      this.emit("stateChange", "tool_result", result);
    });

    this.engine.on("permissionDenied", (reason: string, layer: string, canOverride: boolean) => {
      this.emit("stateChange", "permission_denied", { reason, layer, canOverride });
    });

    this.engine.on("requestConfirmation", (toolCall: unknown, command: string, reason: string) => {
      this.emit("stateChange", "needs_confirmation", { toolCall, command, reason });
    });

    this.engine.on("compacting", (from: string, to: string) => {
      this.emit("stateChange", "compacting", { from, to });
    });

    this.engine.on("error", (message: string) => {
      this.emit("error", message);
      this.emit("stateChange", "error", { message });
    });

    this.engine.on("progress", (percent: number) => {
      this.emit("stateChange", "progress", { percent });
    });
  }

  async initSession(
    projectPath: string,
    clientType: "cli" | "desktop" | "web" = "desktop"
  ): Promise<Session> {
    const projectMemory = loadProjectMemory(projectPath);
    const existingSession = this.sessionStore.getLastSession(projectPath);

    if (existingSession && existingSession.status === "active") {
      this.currentSession = existingSession;
      this.engine.setSession(existingSession);
      return existingSession;
    }

    const session: Session = {
      session_id: uuidv4(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      client_type: clientType,
      status: "active",
      messages: [],
      meta: {
        project_path: projectPath,
        model: this.config.model || "claude-sonnet-4-20250514",
        provider: this.config.chosen_provider || "anthropic",
        cost_estimate: 0,
        platform: `${this.platform.os} ${this.platform.arch}`,
        terminal: this.platform.terminal,
      },
    };

    this.currentSession = session;
    this.engine.setSession(session);
    this.sessionStore.saveSession(session);
    return session;
  }

  async invokeQuery(input: UserInput): Promise<QueryResult> {
    if (!this.currentSession) {
      throw new Error("No active session. Call initSession() first.");
    }

    this.abortController = new AbortController();

    const context: SessionContext = {
      messages: this.currentSession.messages,
      config: this.config,
      platform: this.platform,
      projectMemory: loadProjectMemory(this.currentSession.meta.project_path),
    };

    if (input.interrupt) {
      this.currentSession.messages.push({
        role: "user",
        content: `[INTERRUPT] ${input.text}`,
        timestamp: input.timestamp,
        critical: true,
      });
    } else {
      this.currentSession.messages.push({
        role: "user",
        content: input.text,
        timestamp: input.timestamp,
        critical: false,
      });
    }

    try {
      const result = await this.engine.query(input, context);
      this.currentSession.updated_at = new Date().toISOString();
      this.currentSession.messages = context.messages;

      if (result.stopReason === "end_turn" && !result.toolCalls) {
        this.currentSession.status = "completed";
        await this.tryAutoCreatePR();
      }

      this.sessionStore.saveSession(this.currentSession);
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Query failed: ${message}`);
    }
  }

  private async tryAutoCreatePR(): Promise<void> {
    if (!this.currentSession) return;
    if (!this.config.auto_create_pr) return;

    try {
      const { PRManager } = await import("./pr-manager.js");
      const prManager = new PRManager(
        this.currentSession.session_id,
        this.currentSession.meta.project_path
      );

      const hasGhCli = prManager.checkGHCliInstalled();
      if (!hasGhCli) {
        this.emit("stateChange", "error", {
          message: "auto_create_pr enabled but GitHub CLI (gh) is not installed",
        });
        return;
      }

      const result = await prManager.createPRFromShadow();
      if (result.success) {
        this.emit("stateChange", "pr_created", result);
      } else {
        this.emit("stateChange", "pr_error", result);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit("stateChange", "error", {
        message: `Auto PR creation failed: ${message}`,
      });
    }
  }

  onStreamData(callback: (chunk: string) => void): void {
    this.streamCallbacks.push(callback);
  }

  abortQuery(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      this.emit("abort");
    }
  }

  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  getPlatform(): PlatformInfo {
    return this.platform;
  }

  getConfig(): Config {
    return this.config;
  }

  updateConfig(updates: Partial<Config>): void {
    const oldConfig = { ...this.config };
    Object.assign(this.config, updates);
    const configStore = new ConfigStore();
    configStore.save(this.config);

    if (this.currentSession) {
      const changedKeys = Object.keys(updates).join(", ");
      const auditEntry: AuditLogEntry = {
        timestamp: new Date().toISOString(),
        session_id: this.currentSession.session_id,
        action: "config_change",
        command_summary: `Config updated: ${changedKeys}`,
        decision: "allowed",
      };
      this.auditLogger.log(auditEntry);
    }
  }

  handleWSMessage(message: WSMessage): void {
    switch (message.type) {
      case "query":
        this.invokeQuery(message.payload).then((result) => {
          const responseMsg: WSMessage = {
            type: "result",
            payload: result,
          };
          this.emit("ws_message", responseMsg);
        }).catch((err) => {
          const errorMsg: WSMessage = {
            type: "error",
            code: 500,
            message: err.message,
          };
          this.emit("ws_message", errorMsg);
        });
        break;

      case "result":
        this.emit("ws_result", message.payload);
        break;

      case "error":
        this.emit("ws_error", message.code, message.message);
        break;
    }
  }

  destroy(): void {
    this.engine.removeAllListeners();
    this.removeAllListeners();
    this.streamCallbacks = [];
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.currentSession) {
      this.currentSession.status = "terminated";
      this.currentSession.updated_at = new Date().toISOString();
      this.sessionStore.saveSession(this.currentSession);
    }
  }
}

export function createAgentBridge(providerName?: string): AgentBridgeImpl {
  return new AgentBridgeImpl(providerName);
}