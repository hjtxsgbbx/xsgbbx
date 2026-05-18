import { estimateTokens, estimateMessagesTokens, getModelLimit } from "../observability/token-counter.js";
import { MODEL_CONTEXT_WINDOWS, LIMITS } from "../core/constants.js";

// ---------------------------------------------------------------------------
// TokenBudget — context window accounting
// ---------------------------------------------------------------------------

export interface TokenBudget {
  /** Total context window size for this model */
  total: number;
  /** Estimated tokens currently consumed */
  used: number;
  /** Estimated tokens remaining */
  remaining: number;
  /** Percentage of context window used (0-100) */
  percentUsed: number;
  /** Status label for human consumption */
  status: TokenBudgetStatus;
  /** Whether auto-compaction is recommended */
  needsCompaction: boolean;
  /** Whether the hard limit is exceeded (model will reject) */
  hardLimitExceeded: boolean;
}

export type TokenBudgetStatus =
  | "healthy"     // < 60%
  | "elevated"    // 60-80%
  | "warning"     // 80-90%
  | "critical"    // 90-100%
  | "exceeded";   // > 100%

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const COMPACT_THRESHOLD = 0.85;
const BLOCKING_THRESHOLD = 0.95;

// ---------------------------------------------------------------------------
// Core calculation
// ---------------------------------------------------------------------------

export function calculateTokenBudget(
  messages: Array<{ role: string; content: string }>,
  model: string,
  systemPrompt: string,
  maxOutputTokens?: number,
): TokenBudget {
  const contextWindow = MODEL_CONTEXT_WINDOWS[model] ?? getModelLimit(model);
  const outputBudget = maxOutputTokens ?? LIMITS.DEFAULT_MAX_TOKENS;
  const reservedOverhead = 200; // message framing, function defs, etc.

  const systemTokens = estimateTokens(systemPrompt, model);
  const messagesTokens = estimateMessagesTokens(messages, model);
  const used = systemTokens + messagesTokens + outputBudget + reservedOverhead;
  const remaining = Math.max(0, contextWindow - used);
  const percentUsed = Math.min(100, Math.round((used / contextWindow) * 100));

  const status = resolveStatus(percentUsed);
  const needsCompaction = percentUsed > COMPACT_THRESHOLD * 100;
  const hardLimitExceeded = percentUsed > BLOCKING_THRESHOLD * 100 || remaining < 500;

  return {
    total: contextWindow,
    used,
    remaining,
    percentUsed,
    status,
    needsCompaction,
    hardLimitExceeded,
  };
}

// ---------------------------------------------------------------------------
// Derived checks
// ---------------------------------------------------------------------------

export function isBudgetExceeded(budget: TokenBudget): boolean {
  return budget.hardLimitExceeded || budget.status === "exceeded";
}

export function getBudgetWarning(budget: TokenBudget): string | null {
  switch (budget.status) {
    case "warning":
      return `Context window at ${budget.percentUsed}% — approaching limit.`;
    case "critical":
      return `Context window at ${budget.percentUsed}% — compaction will trigger next turn.`;
    case "exceeded":
      return `Context window exceeded (${budget.percentUsed}%). Cannot continue without compaction.`;
    case "healthy":
    case "elevated":
    default:
      return null;
  }
}

export function getBudgetSummary(budget: TokenBudget): string {
  return `${budget.used.toLocaleString()} / ${budget.total.toLocaleString()} tokens (${budget.percentUsed}%) — ${budget.status}`;
}

// ---------------------------------------------------------------------------
// Helper — resolve numeric percent to status label
// ---------------------------------------------------------------------------

function resolveStatus(percent: number): TokenBudgetStatus {
  if (percent >= 100) return "exceeded";
  if (percent >= 90) return "critical";
  if (percent >= 80) return "warning";
  if (percent >= 60) return "elevated";
  return "healthy";
}
