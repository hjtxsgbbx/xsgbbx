// ============================================================================
// State Selectors — Pure functions that derive values from AppState
//
// Selectors are intentionally simple: they receive the full state and return a
// derived value. No memoization — the store's batch-notify ensures that
// components only re-render when the state reference actually changes.
// ============================================================================

import type { AppState, AppAgentMode } from "./app-state.js";

// ---- Core status selectors ----

/** True when the engine is actively streaming text to the UI. */
export function getIsStreaming(state: AppState): boolean {
  return state.isStreaming;
}

/** The current agent operational mode ("default", "plan", or "act"). */
export function getMode(state: AppState): AppAgentMode {
  return state.mode;
}

/** The current human-readable status message (footer / UI bar). */
export function getStatusMessage(state: AppState): string {
  return state.statusMessage;
}

// ---- Token usage selectors ----

/**
 * Token usage as a percentage of the model's context limit.
 * Returns a number between 0 and 100.
 * Returns 0 when no usage data is available or the limit is not defined.
 */
export function getTokenPercentage(state: AppState): number {
  const usage = state.tokenUsage;
  if (!usage || usage.limit <= 0) return 0;

  // The "total" field from TokenUsage represents the current context
  // consumption, and "limit" is the model's maximum context window.
  const pct = (usage.total / usage.limit) * 100;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

// ---- Budget selectors ----

/** Budget status as a three-level indicator. */
export function getBudgetStatus(state: AppState): "ok" | "warning" | "exceeded" {
  if (state.budgetExceeded) return "exceeded";

  // Use the config's warning threshold if available.
  const threshold = state.config?.budget_warning_threshold;
  if (threshold !== undefined && threshold > 0) {
    const maxCost = state.config?.budget_max_cost_usd;
    if (maxCost !== undefined && maxCost > 0) {
      const ratio = state.costUSD / maxCost;
      if (ratio >= threshold) return "warning";
    }
  }

  return "ok";
}

// ---- Tool selectors ----

/** Names of all tools that produced results in the current turn. */
export function getActiveTools(state: AppState): string[] {
  // Deduplicate by tool name based on toolResults which carry tool_id.
  // Since ToolResult does not carry a tool name directly, we rely on
  // the activeToolName (the single tool currently executing) and the
  // accumulated toolResults array.
  const names = new Set<string>();

  if (state.activeToolName) {
    names.add(state.activeToolName);
  }

  // ToolResult does not carry a `toolName` field directly, but we can
  // return the set of tool names that have been active. In practice,
  // the query-engine adds results in sequence, and the caller clears
  // toolResults between turns.  For now, return what we have.

  return [...names];
}

// ---- Compaction selectors ----

/**
 * True when compaction is likely needed. Heuristic: token usage exceeds
 * 70% of the model limit.  The actual compaction threshold in query-engine
 * is 85%, but we surface the warning earlier so the user can prepare.
 */
export function getCompactionNeeded(state: AppState): boolean {
  const pct = getTokenPercentage(state);
  return pct >= 70;
}
