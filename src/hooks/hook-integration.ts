/**
 * Hook Integration Points Map
 *
 * Single file documenting ALL hook integration points in the query engine.
 * Each function handles timeout, error isolation, and result formatting.
 *
 * Integration points:
 *   SessionStart  — when setSession() is called
 *   SessionEnd    — when dispose() is called
 *   PreToolUse    — before each tool execution (in tool-executor)
 *   PostToolUse   — after each tool execution (in tool-executor)
 *   PreCompact    — before message compaction
 *   PostCompact   — after message compaction
 *   PreQuery      — before each API call
 *   PostQuery     — after each API response
 *   Stop          — before session exit (blocking)
 */

import { AsyncHookRegistry } from "./async-hook-registry.js";
import type { HookResult } from "./hook-events.js";

const DEFAULT_HOOK_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Timeout & error isolation helpers
// ---------------------------------------------------------------------------

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = DEFAULT_HOOK_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Hook timed out")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function formatAndLog(
  results: HookResult[],
  label: string,
  logFn: (msg: string) => void,
): void {
  if (results.length === 0) return;
  const formatted = AsyncHookRegistry.formatResults(results);
  if (formatted) {
    logFn(`[${label} hooks]\n${formatted}`);
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle hooks
// ---------------------------------------------------------------------------

/**
 * Called when session starts (from setSession).
 * Executes Notification hooks with type 'startup'.
 */
export async function executeSessionStartHooks(
  registry: AsyncHookRegistry | null,
  sessionId: string,
  projectPath: string,
): Promise<HookResult[]> {
  if (!registry) return [];
  try {
    const results = await withTimeout(
      registry.sessionStart(sessionId, projectPath),
    );
    return results;
  } catch {
    return [];
  }
}

/**
 * Called when session ends (from dispose).
 */
export async function executeSessionEndHooks(
  registry: AsyncHookRegistry | null,
  sessionId: string,
  messageCount: number,
): Promise<HookResult[]> {
  if (!registry) return [];
  try {
    const results = await withTimeout(
      registry.sessionEnd(sessionId, messageCount),
    );
    return results;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tool hooks
// ---------------------------------------------------------------------------

/**
 * Called before each tool execution (in tool-executor).
 * If any hook returns allow=false, the tool is blocked.
 */
export async function executePreToolUseHooks(
  registry: AsyncHookRegistry | null,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<HookResult[]> {
  if (!registry) return [];
  try {
    const results = await withTimeout(
      registry.preToolUse(toolName, toolInput),
    );
    return results;
  } catch {
    return [];
  }
}

/**
 * Called after each tool execution (in tool-executor).
 * Hooks run for side effects, results are logged.
 */
export async function executePostToolUseHooks(
  registry: AsyncHookRegistry | null,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResult: { success: boolean; output: string },
): Promise<HookResult[]> {
  if (!registry) return [];
  try {
    const results = await withTimeout(
      registry.postToolUse(toolName, toolInput, toolResult),
    );
    return results;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Compaction hooks
// ---------------------------------------------------------------------------

/**
 * Called before message compaction.
 */
export async function executePreCompactHooks(
  registry: AsyncHookRegistry | null,
  messageCount: number,
  tokenUsage: string,
): Promise<HookResult[]> {
  if (!registry) return [];
  try {
    const results = await withTimeout(
      registry.preCompact(messageCount, tokenUsage),
    );
    return results;
  } catch {
    return [];
  }
}

/**
 * Called after message compaction.
 */
export async function executePostCompactHooks(
  registry: AsyncHookRegistry | null,
  messageCountAfter: number,
  tokenSaved: string,
): Promise<HookResult[]> {
  if (!registry) return [];
  try {
    const results = await withTimeout(
      registry.postCompact(messageCountAfter, tokenSaved),
    );
    return results;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Query lifecycle hooks
// ---------------------------------------------------------------------------

/**
 * Called before each API query (turn).
 */
export async function executePreQueryHooks(
  registry: AsyncHookRegistry | null,
  turnNumber: number,
  modelName: string,
): Promise<HookResult[]> {
  if (!registry) return [];
  try {
    const results = await withTimeout(
      registry.preQuery(turnNumber, modelName),
    );
    return results;
  } catch {
    return [];
  }
}

/**
 * Called after each API response.
 */
export async function executePostQueryHooks(
  registry: AsyncHookRegistry | null,
  turnNumber: number,
  modelName: string,
  tokenUsage: string,
): Promise<HookResult[]> {
  if (!registry) return [];
  try {
    const results = await withTimeout(
      registry.postQuery(turnNumber, modelName, tokenUsage),
    );
    return results;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Stop hooks (blocking)
// ---------------------------------------------------------------------------

/**
 * Execute stop hooks and check for blocking.
 * Returns true if any stop hook blocked the exit.
 */
export async function executeStopHooksBlocking(
  registry: AsyncHookRegistry | null,
  messageCount: number,
  sessionId: string | undefined,
  logFn: (msg: string) => void,
): Promise<boolean> {
  if (!registry) return false;
  try {
    const results = await withTimeout(
      registry.stop(messageCount, sessionId),
    );
    formatAndLog(results, "Stop", logFn);
    if (AsyncHookRegistry.isBlocked(results)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
