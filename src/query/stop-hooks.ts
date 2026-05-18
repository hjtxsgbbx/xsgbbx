import { AsyncHookRegistry } from "../hooks/async-hook-registry.js";
import type { HookResult } from "../hooks/hook-events.js";

// ---------------------------------------------------------------------------
// StopHookConfig — what triggers a query stop
// ---------------------------------------------------------------------------

export interface StopHookConfig {
  /** Enable stop-hook evaluation at turn boundaries */
  enabled: boolean;
  /** Max milliseconds to wait for stop hooks before timeout */
  timeoutMs: number;
  /** If true, treat hook timeout as a block */
  blockOnTimeout: boolean;
}

export const DEFAULT_STOP_HOOK_CONFIG: StopHookConfig = {
  enabled: true,
  timeoutMs: 10_000,
  blockOnTimeout: false,
};

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface StopHookResult {
  /** Whether the query should stop */
  shouldStop: boolean;
  /** Human-readable reason for the stop (null if proceeding normally) */
  reason: string | null;
  /** Raw hook results for logging */
  rawResults: HookResult[];
}

// ---------------------------------------------------------------------------
// checkStopHooks — evaluate all Stop hooks against current state
// ---------------------------------------------------------------------------

export async function checkStopHooks(
  messageCount: number,
  sessionId: string | undefined,
  hookRegistry: AsyncHookRegistry | null,
  config: StopHookConfig = DEFAULT_STOP_HOOK_CONFIG,
): Promise<StopHookResult> {
  if (!hookRegistry || !config.enabled) {
    return { shouldStop: false, reason: null, rawResults: [] };
  }

  let rawResults: HookResult[] = [];

  try {
    const hookPromise = hookRegistry.stop(messageCount, sessionId);
    const timeoutPromise = new Promise<HookResult[]>((resolve) => {
      setTimeout(() => resolve([]), config.timeoutMs);
    });
    rawResults = await Promise.race([hookPromise, timeoutPromise]);

    // If we raced to timeout and got empty, hooks are still running — handle per config
    if (rawResults.length === 0 && config.blockOnTimeout) {
      return {
        shouldStop: true,
        reason: "Stop hooks timed out — blocking per configuration.",
        rawResults: [],
      };
    }
  } catch {
    // Hook failure is non-blocking by default
    if (config.blockOnTimeout) {
      return {
        shouldStop: true,
        reason: "Stop hooks error — blocking per configuration.",
        rawResults: [],
      };
    }
    return { shouldStop: false, reason: null, rawResults: [] };
  }

  const blocked = AsyncHookRegistry.isBlocked(rawResults);
  const reason = blocked
    ? AsyncHookRegistry.getBlockMessage(rawResults)
    : null;

  return {
    shouldStop: blocked,
    reason,
    rawResults,
  };
}

// ---------------------------------------------------------------------------
// executeStopHooks — fire-and-forget stop hook execution
// ---------------------------------------------------------------------------

export function executeStopHooks(
  messageCount: number,
  sessionId: string | undefined,
  hookRegistry: AsyncHookRegistry | null,
): void {
  if (!hookRegistry) return;

  hookRegistry
    .stop(messageCount, sessionId)
    .then((results) => {
      const formatted = AsyncHookRegistry.formatResults(results);
      if (formatted && process.env["NODE_ENV"] !== "test") {
        // Side-effect: log stop hook results
        // In production, this goes to telemetry; in tests it's suppressed
        console.error(`[Stop hooks] ${formatted}`);
      }
    })
    .catch(() => {
      // Stop hooks are fire-and-forget; never allow them to crash the process
    });
}
