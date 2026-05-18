import type {
  BridgeMessage,
  BridgeTransport,
  BridgeConfig,
  UserInputPayload,
} from "./types.js";
import { makeMessage } from "./cli-transport.js";
import type { QueryEngineImpl, QueryEngineEvents } from "../engine/query-engine.js";
import type {
  UserInput,
  SessionContext,
  TokenUsage,
  ToolResult,
  Config,
  PlatformInfo,
  Session,
} from "../types/index.js";
import { detectPlatform } from "../pal/index.js";
import { ConfigStore, SessionStore } from "../storage/index.js";
import { loadProjectMemory } from "../intelligence/index.js";
import {
  tryHandleSlashCommand,
  buildWelcomeLines,
} from "./slash-commands.js";

// Agent Bridge — [Transport] → [AgentBridge] → [QueryEngine]
export class AgentBridge {
  private readonly engine: QueryEngineImpl;
  private readonly transport: BridgeTransport;
  private readonly config: BridgeConfig;
  private readonly configStore: ConfigStore;
  private readonly sessionStore: SessionStore;

  private appConfig: Config;
  private platform: PlatformInfo;
  private projectMemory: string;
  private session: Session | null = null;
  private unsubTransport: (() => void) | null = null;
  private running = false;
  private abortController: AbortController | null = null;
  private lastStreamedContent = "";
  private pendingResponse = false;

  constructor(
    engine: QueryEngineImpl,
    transport: BridgeTransport,
    config: BridgeConfig,
  ) {
    this.engine = engine;
    this.transport = transport;
    this.config = config;
    this.configStore = new ConfigStore();
    this.sessionStore = new SessionStore();
    this.appConfig = this.configStore.load();
    this.platform = detectPlatform();
    this.projectMemory = loadProjectMemory(config.projectPath);
    this.wireEngineEvents();
  }

  // -- Lifecycle --

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.initializeSession();

    this.unsubTransport = this.transport.onMessage((msg: BridgeMessage) => {
      this.handleTransportMessage(msg).catch((err: unknown) => {
        this.sendError(
          err instanceof Error ? err.message : String(err),
          "bridge-internal",
        );
      });
    });

    // Headless: execute initial prompt and stop
    if (this.config.initialPrompt && this.config.noInteractive) {
      await this.handleUserInput(this.config.initialPrompt);
      return;
    }

    // CLI: show welcome and start prompting
    if (this.config.transport === "cli") {
      this.showWelcome();
      (this.transport as { promptForInput?: () => void }).promptForInput?.();
    }
  }

  async handleUserInput(text: string, interrupt = false): Promise<void> {
    if (!this.running) return;

    // Slash commands (delegated to separate module)
    const slashResult = tryHandleSlashCommand(
      text,
      this.engine,
      this.sessionStore,
      this.appConfig,
      this.config,
      { os: this.platform.os, terminal: this.platform.terminal },
      (detail) => this.emitStatus("thinking", detail),
      () => this.pendingResponse,
    );
    if (slashResult === "handled") return;
    if (slashResult === "exit") { await this.shutdown(); return; }

    // Interrupt in-flight query
    if (interrupt && this.abortController) this.abort();
    if (this.pendingResponse) {
      this.sendError("A query is already in progress. Send >> to interrupt.", "busy");
      return;
    }

    this.pendingResponse = true;
    this.lastStreamedContent = "";
    this.abortController = new AbortController();

    const userInput: UserInput = { text, timestamp: new Date().toISOString(), interrupt };
    const sessionContext = this.buildSessionContext();

    try {
      this.transport.send(
        makeMessage("user-input", this.config.sessionId, {
          text,
          interrupt,
        } satisfies UserInputPayload),
      );

      const result = await this.engine.query(
        userInput,
        sessionContext,
        this.abortController.signal,
      );

      this.sessionStore.saveSession(this.session!);

      if (
        result.response.content &&
        result.response.content !== this.lastStreamedContent
      ) {
        this.sendResponse(
          result.response.content,
          result.response.model,
          result.response.usage,
        );
      }
      this.emitStatus("task-completed");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (/abort|Abort/i.test(message)) {
        this.transport.send(
          makeMessage("abort", this.config.sessionId, { reason: "user-interrupt" }),
        );
      } else {
        this.sendError(message, "query-failed");
      }
    } finally {
      this.pendingResponse = false;
      this.abortController = null;
      if (this.config.transport === "cli" && this.running) {
        (this.transport as { promptForInput?: () => void }).promptForInput?.();
      }
    }
  }

  sendResponse(content: string, model: string, usage?: TokenUsage): void {
    this.transport.send(
      makeMessage("assistant-output", this.config.sessionId, {
        content,
        model,
        usage,
        streaming: false,
        done: true,
      }),
    );
  }

  sendToolExecution(
    toolName: string,
    status: "executing" | "success" | "error",
    output: string,
  ): void {
    this.transport.send(
      makeMessage("tool-execution", this.config.sessionId, {
        toolName, status, output,
      }),
    );
  }

  abort(): void {
    if (this.abortController) this.abortController.abort();
    this.engine.abort();
  }

  async shutdown(): Promise<void> {
    this.running = false;
    this.abort();
    this.engine.dispose();
    this.unsubTransport?.();
    this.transport.close();
    await this.engine.executeStopHooks(this.session?.messages.length ?? 0);
  }

  // -- Transport dispatch --

  private async handleTransportMessage(msg: BridgeMessage): Promise<void> {
    if (msg.type === "user-input") {
      const payload = msg.payload as UserInputPayload;
      await this.handleUserInput(payload.text, payload.interrupt);
    } else if (msg.type === "abort") {
      this.abort();
    }
  }

  // -- Engine events -> transport --

  private wireEngineEvents(): void {
    // Helper: register a typed event listener
    const on =<E extends keyof QueryEngineEvents>(
      event: E,
      fn: (...args: Parameters<QueryEngineEvents[E]>) => void,
    ) => this.engine.on(event as string, fn as (...args: unknown[]) => void);

    on("thinking", (model, attempt, usage) => {
      this.emitStatus("thinking", undefined, model, attempt);
    });

    on("toolExecuting", (toolName, command) => {
      this.sendToolExecution(toolName, "executing", command);
    });

    this.engine.on("toolResult", (result: ToolResult) => {
      const name = ("_toolName" in result ? (result as unknown as Record<string, unknown>)._toolName : undefined) as string ?? "unknown";
      this.sendToolExecution(name, result.success ? "success" : "error", result.output);
      if (!result.success && result.errorCode) {
        this.sendError(`Tool failed: ${result.errorCode}`, result.errorCode);
      }
    });

    on("permissionDenied", (reason, layer, canOverride) => {
      this.emitStatus(
        "permission-denied",
        `${reason} [${layer}]${canOverride ? " (can override)" : ""}`,
      );
    });

    on("compacting", (from, to) => {
      this.emitStatus("compacting", `Messages reduced from ${from} to ${to}`);
    });

    on("maxTurnsReached", () => {
      this.emitStatus("max-turns", "Maximum turn count reached");
    });

    on("taskCompleted", (files, commitHash) => {
      this.emitStatus("task-completed", undefined, undefined, undefined, files, commitHash);
    });

    on("error", (message) => {
      this.sendError(message, "engine-error");
    });

    on("streaming", (text) => {
      this.lastStreamedContent += text;
      this.transport.send(
        makeMessage("assistant-output", this.config.sessionId, {
          content: text,
          model: this.engine.getMode(),
          streaming: true,
          done: false,
        }),
      );
    });
  }

  // -- Session & context --

  private initializeSession(): void {
    const lastSessionId = this.sessionStore.getLastSessionId();
    if (lastSessionId) {
      const restored = this.sessionStore.loadSession(lastSessionId);
      if (restored) {
        this.session = restored;
        this.engine.setSession(restored);
        return;
      }
    }
    this.session = this.sessionStore.create(
      this.config.projectPath,
      this.platform.os,
      this.platform.terminal,
      this.appConfig.chosen_provider,
      this.appConfig.model,
    );
    this.engine.setSession(this.session);
  }

  private buildSessionContext(): SessionContext {
    const cfg = this.configStore.load();
    this.appConfig = cfg;
    return {
      messages: this.session?.messages ?? [],
      config: cfg,
      platform: this.platform,
      projectMemory: this.projectMemory,
      working_dir: this.config.projectPath,
    };
  }

  // -- Helpers --

  private sendError(message: string, code?: string): void {
    this.transport.send(
      makeMessage("error", this.config.sessionId, {
        message, code, recoverable: true,
      }),
    );
  }

  private emitStatus(
    state: string,
    detail?: string,
    model?: string,
    attempt?: number,
    files?: string[],
    commitHash?: string,
  ): void {
    this.transport.send(
      makeMessage("status-update", this.config.sessionId, {
        state, detail, model, attempt, files, commitHash,
      }),
    );
  }

  private showWelcome(): void {
    for (const line of buildWelcomeLines(this.config, this.appConfig)) {
      this.emitStatus("thinking", line);
    }
  }
}
