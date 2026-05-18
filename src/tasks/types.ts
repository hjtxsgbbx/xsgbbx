// ---------------------------------------------------------------------------
// Task types — generic task abstraction for agent operations
// ---------------------------------------------------------------------------

/** Lifecycle status of a task */
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/**
 * Live Task handle — returned to the caller for lifecycle control.
 * Generic over T, the resolved value type.
 */
export interface Task<T = unknown> {
  /** Unique task identifier (UUID v4) */
  readonly id: string;
  /** Human-readable task type (e.g. "file-write", "shell-exec") */
  readonly type: string;
  /** Current lifecycle status */
  readonly status: TaskStatus;

  /** Start execution. Returns a promise that resolves with the task result. */
  start(): Promise<T>;

  /** Cancel the task if still pending or running. */
  cancel(): void;

  /** Register a callback invoked when the task completes (success or failure). */
  onComplete(cb: (result: T | null, error: Error | null) => void): void;
}

/**
 * Immutable snapshot of task state. Safe to serialize or pass between threads.
 */
export interface TaskState {
  id: string;
  type: string;
  status: TaskStatus;
  startTime: string | null;
  endTime: string | null;
  error: string | null;
}

/**
 * A TaskRunner is the function that performs the actual work.
 * Receives the Task handle for cancellation checks, returns the result.
 */
export type TaskRunner<T = unknown> = (task: Task<T>) => Promise<T>;

/**
 * Options for creating a task.
 */
export interface TaskOptions {
  /** Timeout in milliseconds. 0 = no timeout. */
  timeoutMs: number;
  /** Description for observability / logging */
  description?: string;
}

export const DEFAULT_TASK_OPTIONS: TaskOptions = {
  timeoutMs: 300_000, // 5 minutes
};
