import { type Tool, type ExecutionContext, type ToolResult, type Config, type UserInput, type SessionContext, type QueryEngine } from "../types/index.js";
import type { QueryEngineImpl } from "../engine/query-engine.js";
import { SessionStore } from "../storage/index.js";
import { extractStringParam, extractNumberParam } from "../api/utils.js";

interface AgentMailbox {
  id: string;
  task: string;
  result?: string;
  status: "pending" | "running" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  tokenUsage?: { input: number; output: number; total: number };
  parentAgentId?: string;
}

interface SubAgentResult {
  id: string;
  success: boolean;
  output: string;
  tokenUsage?: { input: number; output: number; total: number };
  durationMs: number;
}

const mailboxRegistry = new Map<string, AgentMailbox>();
const MAX_CONCURRENT_AGENTS = 10;
const MAX_OUTPUT_LENGTH = 4000;
let activeAgents = 0;

export class AgentTool implements Tool {
  name = "agent";
  description = "Launch one or more sub-agents in isolated contexts to handle specific tasks. Supports parallel execution of multiple tasks. Each sub-agent has its own session and context window. Returns summarized results via mailbox.";
  readonly = false;

  private queryEngineFactory: ((config: Config) => QueryEngine) | null = null;

  setQueryEngineFactory(factory: (config: Config) => QueryEngine): void {
    this.queryEngineFactory = factory;
  }

  parameters = {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "Task description for the sub-agent to complete (single task mode)",
      },
      tasks: {
        type: "array",
        items: { type: "string" },
        description: "Array of task descriptions for parallel execution (multi-task mode). Each task runs in its own isolated sub-agent.",
      },
      context: {
        type: "string",
        description: "Additional context or constraints shared by all sub-agents",
      },
      working_dir: {
        type: "string",
        description: "Working directory for the sub-agent(s) (defaults to parent's working directory)",
      },
      max_concurrent: {
        type: "number",
        description: "Maximum number of sub-agents to run concurrently (default: 5, max: 10)",
      },
      model: {
        type: "string",
        description: "Model to use for sub-agent(s) (e.g. claude-sonnet-4-20250514, claude-3-5-haiku-20241022)",
      },
    },
    required: [],
  };

  async execute(
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const singleTask = extractStringParam(params, "task");
    const multiTasks = params.tasks as string[] | undefined;
    const taskContext = extractStringParam(params, "context", "");
    const workingDir = extractStringParam(params, "working_dir", context.session.meta.project_path);
    const maxConcurrent = Math.min(
      extractNumberParam(params, "max_concurrent", 5),
      MAX_CONCURRENT_AGENTS
    );
    const model = extractStringParam(params, "model");

    const tasks: string[] = [];
    if (multiTasks && multiTasks.length > 0) {
      tasks.push(...multiTasks);
    } else if (singleTask) {
      tasks.push(singleTask);
    } else {
      return {
        success: false,
        output: "Either 'task' or 'tasks' parameter is required.",
        errorCode: "MISSING_TASK",
      };
    }

    if (activeAgents + tasks.length > MAX_CONCURRENT_AGENTS) {
      return {
        success: false,
        output: `Cannot launch ${tasks.length} sub-agent(s): would exceed maximum concurrent agents (${MAX_CONCURRENT_AGENTS}). Currently active: ${activeAgents}.`,
        errorCode: "AGENT_LIMIT_REACHED",
      };
    }

    if (tasks.length === 1) {
      return this.executeSingle(tasks[0], taskContext, workingDir, context, model);
    }

    return this.executeParallel(tasks, taskContext, workingDir, context, maxConcurrent, model);
  }

  private async executeSingle(
    task: string,
    taskContext: string,
    workingDir: string,
    parentContext: ExecutionContext,
    model?: string
  ): Promise<ToolResult> {
    const mailboxId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const mailbox: AgentMailbox = {
      id: mailboxId,
      task,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    mailboxRegistry.set(mailboxId, mailbox);

    const fullTask = taskContext
      ? `Task: ${task}\n\nAdditional Context: ${taskContext}`
      : task;

    mailbox.status = "running";
    activeAgents++;

    try {
      const startTime = Date.now();
      const result = await this.executeSubAgent(fullTask, workingDir, parentContext, model);
      const durationMs = Date.now() - startTime;

      mailbox.status = "completed";
      mailbox.result = result.output;
      mailbox.completedAt = new Date().toISOString();
      if (result.tokenUsage) {
        mailbox.tokenUsage = result.tokenUsage;
      }

      return {
        success: result.success,
        output: `[Sub-agent ${mailboxId}] Completed in ${(durationMs / 1000).toFixed(1)}s\n${result.output}`,
        artifacts: [mailboxId],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      mailbox.status = "failed";
      mailbox.result = message;
      mailbox.completedAt = new Date().toISOString();

      return {
        success: false,
        output: `[Sub-agent ${mailboxId} failed] ${message}`,
        errorCode: "AGENT_ERROR",
      };
    } finally {
      activeAgents--;
    }
  }

  private async executeParallel(
    tasks: string[],
    taskContext: string,
    workingDir: string,
    parentContext: ExecutionContext,
    maxConcurrent: number,
    model?: string
  ): Promise<ToolResult> {
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const mailboxes: AgentMailbox[] = [];

    for (const task of tasks) {
      const mailboxId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const mailbox: AgentMailbox = {
        id: mailboxId,
        task,
        status: "pending",
        createdAt: new Date().toISOString(),
        parentAgentId: batchId,
      };
      mailboxes.push(mailbox);
      mailboxRegistry.set(mailboxId, mailbox);
    }

    const results: SubAgentResult[] = [];
    const executing: Promise<SubAgentResult>[] = [];
    let taskIndex = 0;

    const runTask = async (mailbox: AgentMailbox, task: string): Promise<SubAgentResult> => {
      const fullTask = taskContext
        ? `Task: ${task}\n\nAdditional Context: ${taskContext}`
        : task;

      mailbox.status = "running";
      activeAgents++;
      const startTime = Date.now();

      try {
        const result = await this.executeSubAgent(fullTask, workingDir, parentContext, model);
        const durationMs = Date.now() - startTime;

        mailbox.status = "completed";
        mailbox.result = result.output;
        mailbox.completedAt = new Date().toISOString();
        if (result.tokenUsage) {
          mailbox.tokenUsage = result.tokenUsage;
        }

        return {
          id: mailbox.id,
          success: result.success,
          output: result.output,
          tokenUsage: result.tokenUsage,
          durationMs,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - startTime;

        mailbox.status = "failed";
        mailbox.result = message;
        mailbox.completedAt = new Date().toISOString();

        return {
          id: mailbox.id,
          success: false,
          output: message,
          durationMs,
        };
      } finally {
        activeAgents--;
      }
    };

    const enqueueNext = async (): Promise<void> => {
      while (taskIndex < tasks.length) {
        const currentIdx = taskIndex++;
        const mailbox = mailboxes[currentIdx];
        const task = tasks[currentIdx];

        const promise = runTask(mailbox, task).then((result) => {
          results.push(result);
          return result;
        });

        executing.push(promise);

        if (executing.length >= maxConcurrent) {
          await Promise.race(executing);
          executing.splice(
            executing.findIndex((p) => p !== undefined),
            0
          );
        }
      }
    };

    await enqueueNext();
    await Promise.all(executing);

    results.sort((a, b) => {
      const idxA = tasks.indexOf(mailboxes.find((m) => m.id === a.id)?.task || "");
      const idxB = tasks.indexOf(mailboxes.find((m) => m.id === b.id)?.task || "");
      return idxA - idxB;
    });

    const totalTokens = results.reduce(
      (sum, r) => sum + (r.tokenUsage?.total || 0),
      0
    );
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;
    const totalDuration = Math.max(...results.map((r) => r.durationMs));

    const summary = [
      `Parallel Sub-agent Batch [${batchId}]`,
      `${results.length} tasks: ${successCount} succeeded, ${failCount} failed`,
      `Wall time: ${(totalDuration / 1000).toFixed(1)}s | Total tokens: ${totalTokens.toLocaleString()}`,
      ``,
      ...results.map((r, i) => {
        const status = r.success ? "✓" : "✗";
        const time = (r.durationMs / 1000).toFixed(1);
        const tokens = r.tokenUsage?.total?.toLocaleString() || "N/A";
        return `[${status}] Task ${i + 1} (${time}s, ${tokens} tokens): ${r.output.slice(0, 200)}${r.output.length > 200 ? "..." : ""}`;
      }),
    ].join("\n");

    return {
      success: failCount === 0,
      output: summary,
      artifacts: mailboxes.map((m) => m.id),
    };
  }

  private async executeSubAgent(
    task: string,
    workingDir: string,
    parentContext: ExecutionContext,
    model?: string
  ): Promise<{ success: boolean; output: string; tokenUsage?: { input: number; output: number; total: number } }> {
    const config = this.deriveConfig(parentContext, model);

    if (!this.queryEngineFactory) {
      throw new Error("QueryEngine factory not configured. Call setQueryEngineFactory() before using AgentTool.");
    }

    const sessionStore = new SessionStore();
    const session = sessionStore.create(
      workingDir,
      parentContext.platform.os,
      parentContext.platform.terminal,
      config.chosen_provider || "anthropic",
      config.model || "claude-sonnet-4-20250514"
    );

    const engine = this.queryEngineFactory(config) as QueryEngineImpl;
    engine.setSession(session);

    const userInput: UserInput = {
      text: task,
      timestamp: new Date().toISOString(),
    };

    const sessionContext: SessionContext = {
      messages: [],
      config,
      platform: parentContext.platform,
      projectMemory: "",
      working_dir: workingDir,
    };

    const result = await engine.query(userInput, sessionContext);

    const output = result.response.content;
    const tokenUsage = result.response.usage
      ? {
          input: result.response.usage.input,
          output: result.response.usage.output,
          total: result.response.usage.total,
        }
      : undefined;

    return {
      success: true,
      output: output.slice(0, MAX_OUTPUT_LENGTH),
      tokenUsage,
    };
  }

  private deriveConfig(parentContext: ExecutionContext, model?: string): Config {
    const parentConfig = parentContext.session.meta as unknown as Record<string, unknown>;
    const provider = (parentConfig.provider as string) || "anthropic";
    const effectiveModel = model || (parentConfig.model as string) || "claude-sonnet-4-20250514";

    return {
      version: 3,
      permission_mode: "default",
      auto_create_pr: false,
      auto_commit: false,
      accept_terms: true,
      chosen_provider: provider,
      session_retention_days: 7,
      telemetry_enabled: false,
      max_turns: 15,
      model: effectiveModel,
      api_key_ref: "",
      ui: { color_theme: "dark", compact_mode: false },
      provider_configs: {},
      sandbox_mode: "workspace",
    };
  }
}

export function getAgentMailbox(id: string): AgentMailbox | undefined {
  return mailboxRegistry.get(id);
}

export function getAgentMailboxes(): AgentMailbox[] {
  return Array.from(mailboxRegistry.values());
}

export function clearMailbox(id: string): void {
  mailboxRegistry.delete(id);
}

export function getActiveAgentCount(): number {
  return activeAgents;
}
