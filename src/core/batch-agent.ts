import { QueryEngineImpl, createQueryEngine } from "./query-engine.js";
import { CostTracker } from "./cost-tracker.js";
import type {
  Session,
  Message,
  PlatformInfo,
  Config,
  UserInput,
  SessionContext,
} from "../types/index.js";
import { SessionStore, ConfigStore } from "../storage/index.js";
import { v4 as uuidv4 } from "uuid";

export interface BatchTask {
  id: string;
  description: string;
  projectPath: string;
  startedAt: string;
  completedAt?: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: BatchResult;
  error?: string;
}

export interface BatchResult {
  summary: string;
  turnsExecuted: number;
  cost: number;
  tokensUsed: number;
  durationMs: number;
}

export interface BatchAgentOptions {
  platform: PlatformInfo;
  workingDir?: string;
  onProgress?: (task: BatchTask, turn: number, message: string) => void;
  onComplete?: (task: BatchTask) => void;
  onError?: (task: BatchTask, error: string) => void;
}

export class BatchAgent {
  private options: BatchAgentOptions;
  private tasks: Map<string, BatchTask>;
  private sessionStore: SessionStore;
  private configStore: ConfigStore;

  constructor(options: BatchAgentOptions) {
    this.options = options;
    this.tasks = new Map();
    this.sessionStore = new SessionStore();
    this.configStore = new ConfigStore();
  }

  async executeTask(
    description: string,
    projectPath: string
  ): Promise<BatchTask> {
    const task: BatchTask = {
      id: uuidv4(),
      description,
      projectPath,
      startedAt: new Date().toISOString(),
      status: "running",
    };

    this.tasks.set(task.id, task);

    const startTime = Date.now();

    try {
      const config = this.configStore.load();
      const engine = createQueryEngine(config?.chosen_provider || "anthropic");
      const costTracker = new CostTracker(task.id);

      engine.on("thinking", (_model, turn) => {
        this.options.onProgress?.(task, turn, `Thinking (turn ${turn})...`);
      });

      engine.on("toolExecuting", (toolName) => {
        this.options.onProgress?.(task, 0, `Executing: ${toolName}`);
      });

      engine.on("error", (message) => {
        this.options.onError?.(task, `Agent error: ${message}`);
      });

      engine.on("taskCompleted", (_files, commitHash) => {
        this.options.onProgress?.(task, 0, `Complete.${commitHash ? ` Commit: ${commitHash}` : ""}`);
      });

      engine.on("streaming", () => {
        // progress tracking
      });

      const session = this.sessionStore.create(
        projectPath,
        this.options.platform.os,
        this.options.platform.terminal || "unknown",
        config?.chosen_provider || "anthropic",
        config?.model || "claude-sonnet-4-20250514"
      );

      const effectiveConfig: Config = {
        ...config,
        chosen_provider: config?.chosen_provider || "anthropic",
        model: config?.model || "claude-sonnet-4-20250514",
        max_turns: 50,
        permission_mode: config?.permission_mode || "default",
        auto_commit: config?.auto_commit ?? false,
        working_dir: projectPath,
      };

      const input: UserInput = {
        text: description,
        timestamp: new Date().toISOString(),
      };

      const context: SessionContext = {
        messages: [],
        config: effectiveConfig,
        platform: this.options.platform,
        projectMemory: "",
        working_dir: projectPath,
      };

      const result = await engine.query(input, context);

      task.status = "completed";
      task.completedAt = new Date().toISOString();

      const tokensInput = result.response?.usage?.input || 0;
      const tokensOutput = result.response?.usage?.output || 0;
      costTracker.trackTokens(tokensInput, tokensOutput, config?.model || "claude-sonnet-4-20250514");

      task.result = {
        summary: result.response?.content || "Task completed.",
        turnsExecuted: 0,
        cost: costTracker.getMetrics().estimatedCostUSD,
        tokensUsed: tokensInput + tokensOutput,
        durationMs: Date.now() - startTime,
      };

      this.options.onComplete?.(task);
      return task;
    } catch (err: unknown) {
      task.status = "failed";
      task.completedAt = new Date().toISOString();
      task.error = err instanceof Error ? err.message : String(err);
      task.result = {
        summary: `Task failed: ${task.error}`,
        turnsExecuted: 0,
        cost: 0,
        tokensUsed: 0,
        durationMs: Date.now() - startTime,
      };

      this.options.onError?.(task, task.error);
      return task;
    }
  }

  getTask(taskId: string): BatchTask | undefined {
    return this.tasks.get(taskId);
  }

  listTasks(): BatchTask[] {
    return Array.from(this.tasks.values());
  }

  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "running") return false;

    task.status = "failed";
    task.error = "Cancelled by user";
    task.completedAt = new Date().toISOString();
    return true;
  }
}

export function createBatchAgent(options: BatchAgentOptions): BatchAgent {
  return new BatchAgent(options);
}