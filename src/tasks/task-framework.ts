import { randomUUID } from "crypto";
import type { Task, TaskStatus, TaskRunner, TaskOptions } from "./types.js";

// ---------------------------------------------------------------------------
// Base task implementation — lifecycle state machine
//
//   pending → running → completed
//                     → failed
//            → cancelled  (from pending or running)
// ---------------------------------------------------------------------------

interface TaskInternals<T> {
  status: TaskStatus;
  startTime: string | null;
  endTime: string | null;
  error: Error | null;
  result: T | null;
  completeCallbacks: Array<(result: T | null, error: Error | null) => void>;
}

/**
 * Maximum number of concurrently running tasks across the process.
 * Enforced at the TaskManager level; checked here as a sanity guard.
 */
const MAX_CONCURRENCY = 5;

/** Active abort controllers keyed by task ID */
const activeAbortControllers = new Map<string, AbortController>();

function getActiveCount(): number {
  return activeAbortControllers.size;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBaseTask<T>(
  type: string,
  runner: TaskRunner<T>,
  options: TaskOptions,
): Task<T> {
  const id = randomUUID();
  const abortController = new AbortController();
  const internals: TaskInternals<T> = {
    status: "pending",
    startTime: null,
    endTime: null,
    error: null,
    result: null,
    completeCallbacks: [],
  };

  // -----------------------------------------------------------------------
  // Task public API
  // -----------------------------------------------------------------------

  const task: Task<T> = {
    id,
    type,
    get status() {
      return internals.status;
    },

    async start(): Promise<T> {
      if (internals.status === "running") {
        throw new Error(`Task ${id} is already running.`);
      }
      if (internals.status === "completed" || internals.status === "failed") {
        throw new Error(`Task ${id} has already completed.`);
      }
      if (internals.status === "cancelled") {
        throw new Error(`Task ${id} was cancelled.`);
      }

      // Concurrency guard
      if (getActiveCount() >= MAX_CONCURRENCY) {
        throw new Error(
          `Max concurrency (${MAX_CONCURRENCY}) reached. Cannot start task ${id}.`,
        );
      }

      // Transition: pending → running
      internals.status = "running";
      internals.startTime = new Date().toISOString();
      activeAbortControllers.set(id, abortController);

      // Timeout guard
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      if (options.timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          if (internals.status === "running") {
            abortController.abort();
          }
        }, options.timeoutMs);
      }

      try {
        const signal = abortController.signal;
        // Wrap runner so it can observe cancellation
        const cancellableRunner: TaskRunner<T> = async (t) => {
          if (signal.aborted) throw new DOMException("Task cancelled", "AbortError");
          const abortHandler = () => {
            // AbortSignal as cancellation notification inside the runner
          };
          signal.addEventListener("abort", abortHandler, { once: true });
          try {
            return await runner(t);
          } finally {
            signal.removeEventListener("abort", abortHandler);
          }
        };
        const result = await cancellableRunner(task);
        internals.result = result;
        internals.status = "completed";
        internals.endTime = new Date().toISOString();
        notifyComplete(result, null);
        return result;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        // Distinguish cancellation from genuine failure
        if (
          error.name === "AbortError" ||
          error.message?.includes("cancelled") ||
          abortController.signal.aborted
        ) {
          internals.status = "cancelled";
          internals.error = new Error(`Task ${id} cancelled.`);
        } else {
          internals.status = "failed";
          internals.error = error;
        }
        internals.endTime = new Date().toISOString();
        notifyComplete(null, internals.error);
        throw error;
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        activeAbortControllers.delete(id);
      }
    },

    cancel(): void {
      if (internals.status === "pending" || internals.status === "running") {
        abortController.abort();
        internals.status = "cancelled";
        internals.endTime = new Date().toISOString();
        internals.error = new Error(`Task ${id} cancelled.`);
        activeAbortControllers.delete(id);
        notifyComplete(null, internals.error);
      }
    },

    onComplete(cb: (result: T | null, error: Error | null) => void): void {
      internals.completeCallbacks.push(cb);
      // If already completed, invoke immediately
      if (
        internals.status === "completed" ||
        internals.status === "failed" ||
        internals.status === "cancelled"
      ) {
        cb(internals.result, internals.error);
      }
    },
  };

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  function notifyComplete(result: T | null, error: Error | null): void {
    const cbs = internals.completeCallbacks.splice(0);
    for (const cb of cbs) {
      try {
        cb(result, error);
      } catch {
        // Callback errors must not cascade
      }
    }
  }

  return task;
}
