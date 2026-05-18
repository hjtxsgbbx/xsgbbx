/**
 * Spawn Utilities
 *
 * Convenience functions for spawning one or more teammates through
 * a TeammateExecutor. Handles error wrapping, parallel spawning with
 * Promise.allSettled, result aggregation, and timeout enforcement.
 *
 * DeepSeek-optimized: teammates share provider config; concurrent
 * spawns benefit from DeepSeek's high-throughput API.
 */

import type {
  TeammateExecutor,
  TeammateSpawnConfig,
  TeammateSpawnResult,
  TeammateMessage,
} from "./types.js";

// ---------------------------------------------------------------------------
// Single Spawn
// ---------------------------------------------------------------------------

/**
 * Spawn a single teammate with full error handling.
 *
 * Wraps executor.spawn() in a try/catch and normalizes the result.
 * Any synchronous error from spawn() is caught and returned as a
 * failed TeammateSpawnResult rather than thrown.
 *
 * @param config   - Teammate spawn configuration.
 * @param executor - The executor backend to use.
 * @returns TeammateSpawnResult (always success:true/false, never throws).
 */
export function spawnTeammate(
  config: TeammateSpawnConfig,
  executor: TeammateExecutor,
): TeammateSpawnResult {
  try {
    return executor.spawn(config);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      agentId: `failed_${Date.now()}`,
      error: `Failed to spawn teammate "${config.identity.name}": ${msg}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Parallel Spawn
// ---------------------------------------------------------------------------

/**
 * Result from a parallel spawn operation.
 */
export interface ParallelSpawnResult {
  /** All spawn results (both successes and failures). */
  results: TeammateSpawnResult[];
  /** Number of successfully spawned teammates. */
  successCount: number;
  /** Number of failed spawns. */
  failureCount: number;
  /** Error summaries for failed spawns. */
  errors: string[];
}

/**
 * Spawn multiple teammates in parallel.
 *
 * Uses Promise.allSettled internally even though spawn() is synchronous —
 * this provides a consistent API for future async backends and allows
 * the caller to handle results uniformly.
 *
 * @param configs  - Array of spawn configurations.
 * @param executor - The executor backend to use.
 * @returns Aggregated parallel spawn results.
 */
export function spawnTeammates(
  configs: TeammateSpawnConfig[],
  executor: TeammateExecutor,
): ParallelSpawnResult {
  const results: TeammateSpawnResult[] = [];
  const errors: string[] = [];

  for (const config of configs) {
    const result = spawnTeammate(config, executor);
    results.push(result);

    if (!result.success && result.error) {
      errors.push(`[${config.identity.name}] ${result.error}`);
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  return { results, successCount, failureCount, errors };
}

// ---------------------------------------------------------------------------
// Wait for Completion
// ---------------------------------------------------------------------------

/**
 * Wait for all spawned teammates to complete (or timeout).
 *
 * Polls the executor's isActive() method. When all teammates are
 * inactive, resolves with the final states.
 *
 * @param results    - Spawn results from spawnTeammate/spawnTeammates.
 * @param executor   - The executor backend.
 * @param timeoutMs  - Maximum wait time in ms (default: 300_000 = 5 min).
 * @returns Array of (agentId, message) pairs for completed teammates.
 */
export async function waitForTeammates(
  results: TeammateSpawnResult[],
  executor: TeammateExecutor,
  timeoutMs: number = 300_000,
): Promise<Array<{ agentId: string; lastMessage?: TeammateMessage }>> {
  const activeAgentIds = results
    .filter((r) => r.success && r.agentId)
    .map((r) => r.agentId);

  if (activeAgentIds.length === 0) {
    return [];
  }

  const startTime = Date.now();
  const pollIntervalMs = 500;

  return new Promise((resolve) => {
    const poll = (): void => {
      const stillActive = activeAgentIds.filter((id) =>
        executor.isActive(id),
      );

      // All done
      if (stillActive.length === 0) {
        resolve(
          activeAgentIds.map((id) => {
            const state = executor.getState(id);
            return {
              agentId: id,
              lastMessage: state?.lastMessage,
            };
          }),
        );
        return;
      }

      // Timeout
      if (Date.now() - startTime >= timeoutMs) {
        // Terminate any still-running teammates
        for (const id of stillActive) {
          try {
            executor.kill(id);
          } catch {
            // Ignore kill errors during timeout.
          }
        }

        resolve(
          activeAgentIds.map((id) => {
            const state = executor.getState(id);
            return {
              agentId: id,
              lastMessage: state?.lastMessage,
            };
          }),
        );
        return;
      }

      // Poll again
      setTimeout(poll, pollIntervalMs);
    };

    // Start polling on next tick to give microtasks a chance to run
    setTimeout(poll, pollIntervalMs);
  });
}

// ---------------------------------------------------------------------------
// Result Aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregated output from a teammate execution.
 */
export interface TeammateResultSummary {
  agentId: string;
  agentName: string;
  success: boolean;
  output: string;
  turnCount: number;
  durationMs: number;
  error?: string;
}

/**
 * Collect and aggregate results from completed teammates.
 *
 * Reads the final state from the executor for each result entry
 * and builds a normalized summary.
 *
 * @param results  - Spawn results.
 * @param executor - The executor backend.
 * @returns Array of result summaries.
 */
export function collectTeammateResults(
  results: TeammateSpawnResult[],
  executor: TeammateExecutor,
): TeammateResultSummary[] {
  const summaries: TeammateResultSummary[] = [];

  for (const result of results) {
    if (!result.success) {
      summaries.push({
        agentId: result.agentId,
        agentName: "unknown",
        success: false,
        output: "",
        turnCount: 0,
        durationMs: 0,
        error: result.error ?? "Unknown spawn error",
      });
      continue;
    }

    const state = executor.getState(result.agentId);

    summaries.push({
      agentId: result.agentId,
      agentName: state?.identity.name ?? "unknown",
      success: state?.status === "completed",
      output: state?.lastMessage?.text ?? "",
      turnCount: state?.turnCount ?? 0,
      durationMs: state?.endTime
        ? state.endTime - state.startTime
        : Date.now() - (state?.startTime ?? Date.now()),
      error: state?.status === "failed" ? "Teammate execution failed" : undefined,
    });
  }

  return summaries;
}

// ---------------------------------------------------------------------------
// Convenience: spawn + run + collect
// ---------------------------------------------------------------------------

/**
 * Complete spawn-and-collect flow for a single teammate.
 *
 * Spawns the teammate, polls until completion or timeout, then
 * collects the result. This is the simplest "fire and wait" API.
 *
 * @param config      - Teammate spawn configuration.
 * @param executor    - The executor backend.
 * @param runFn       - Optional async function to run the teammate's logic.
 * @param timeoutMs   - Maximum wait time in ms.
 * @returns Result summary.
 */
export async function runTeammate(
  config: TeammateSpawnConfig,
  executor: TeammateExecutor,
  runFn?: (agentId: string, signal: AbortSignal) => Promise<string>,
  timeoutMs: number = 300_000,
): Promise<TeammateResultSummary> {
  const spawnResult = spawnTeammate(config, executor);

  if (!spawnResult.success) {
    return {
      agentId: spawnResult.agentId,
      agentName: config.identity.name,
      success: false,
      output: "",
      turnCount: 0,
      durationMs: 0,
      error: spawnResult.error ?? "Spawn failed",
    };
  }

  // If a run function is provided, execute it
  if (runFn && spawnResult.abortController) {
    const startTime = Date.now();

    try {
      const output = await runFn(
        spawnResult.agentId,
        spawnResult.abortController.signal,
      );

      // Update the state
      const state = executor.getState(spawnResult.agentId);
      if (state) {
        state.status = "completed";
        state.endTime = Date.now();
      }

      return {
        agentId: spawnResult.agentId,
        agentName: config.identity.name,
        success: true,
        output,
        turnCount: state?.turnCount ?? 0,
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      const state = executor.getState(spawnResult.agentId);
      if (state) {
        state.status = "failed";
        state.endTime = Date.now();
      }

      return {
        agentId: spawnResult.agentId,
        agentName: config.identity.name,
        success: false,
        output: "",
        turnCount: state?.turnCount ?? 0,
        durationMs: Date.now() - startTime,
        error: msg,
      };
    }
  }

  // No run function — wait for the teammate to finish via polling
  await waitForTeammates([spawnResult], executor, timeoutMs);
  const summaries = collectTeammateResults([spawnResult], executor);
  return summaries[0];
}
