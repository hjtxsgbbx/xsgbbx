import type { Task, TaskState, TaskRunner, TaskOptions } from "./types.js";
import { DEFAULT_TASK_OPTIONS } from "./types.js";
import { createBaseTask } from "./task-framework.js";

// ---------------------------------------------------------------------------
// TaskManager — central registry for concurrent task execution
// ---------------------------------------------------------------------------

export interface TaskManagerOptions {
  /** Maximum number of tasks that can run concurrently */
  maxConcurrency: number;
  /** Default task options applied to all created tasks */
  defaultTaskOptions: TaskOptions;
}

const DEFAULT_MANAGER_OPTIONS: TaskManagerOptions = {
  maxConcurrency: 5,
  defaultTaskOptions: DEFAULT_TASK_OPTIONS,
};

export class TaskManager {
  private tasks: Map<string, Task<unknown>> = new Map();
  private running: Set<string> = new Set();
  private completionCallbacks: Map<string, Array<(result: unknown | null, error: Error | null) => void>> = new Map();
  private options: TaskManagerOptions;

  constructor(options?: Partial<TaskManagerOptions>) {
    this.options = { ...DEFAULT_MANAGER_OPTIONS, ...options };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Create a new task. Does not start it — call startTask() to run. */
  createTask<T>(type: string, runner: TaskRunner<T>, opts?: Partial<TaskOptions>): Task<T> {
    const mergedOpts = { ...this.options.defaultTaskOptions, ...opts };
    const task: Task<T> = createBaseTask(type, runner, mergedOpts);

    // Install tear-down hook so the manager stays in sync
    task.onComplete((result, error) => {
      this.running.delete(task.id);
      if (error) {
        // Task-level failure is already captured in the state; no extra action needed
      }
    });

    this.tasks.set(task.id, task as Task<unknown>);
    return task;
  }

  /** Start a previously-created task by ID. Rejects if already running. */
  async startTask<T>(id: string): Promise<T> {
    const task = this.tasks.get(id) as Task<T> | undefined;
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    if (task.status === "running") {
      throw new Error(`Task already running: ${id}`);
    }

    if (this.running.size >= this.options.maxConcurrency) {
      throw new Error(
        `Max concurrency reached (${this.options.maxConcurrency}). Wait for a running task to complete.`,
      );
    }

    this.running.add(id);

    try {
      const result = await task.start();
      return result;
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw error;
    } finally {
      this.running.delete(id);
    }
  }

  /** Cancel a task by ID. No-op if already completed or cancelled. */
  cancelTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status === "running" || task.status === "pending") {
      task.cancel();
    }
  }

  /** Cancel all pending and running tasks. */
  cancelAll(): void {
    for (const [id, task] of this.tasks) {
      if (task.status === "running" || task.status === "pending") {
        task.cancel();
      }
    }
  }

  /** Get an immutable snapshot of a task's current state. */
  getTask(id: string): TaskState | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    return taskSnapshot(task);
  }

  /** List all tasks, optionally filtered by status. */
  listTasks(filter?: { status?: TaskState["status"]; type?: string }): TaskState[] {
    const states: TaskState[] = [];
    for (const task of this.tasks.values()) {
      if (filter?.status && task.status !== filter.status) continue;
      if (filter?.type && task.type !== filter.type) continue;
      states.push(taskSnapshot(task));
    }
    return states;
  }

  /** Get the count of currently-running tasks. */
  getRunningCount(): number {
    return this.running.size;
  }

  /** Remove completed/cancelled/failed tasks from the registry. */
  prune(maxAgeMs = 600_000): number {
    let removed = 0;
    for (const [id, task] of this.tasks) {
      if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
        this.tasks.delete(id);
        this.completionCallbacks.delete(id);
        removed++;
      }
    }
    return removed;
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function taskSnapshot(task: Task<unknown>): TaskState {
  // Minimal snapshot; extended by tracking start/end in createBaseTask
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    startTime: null,
    endTime: null,
    error: null,
  };
}
