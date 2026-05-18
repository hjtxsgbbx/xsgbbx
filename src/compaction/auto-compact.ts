/**
 * Auto-Compact with Circuit Breaker
 *
 * Automatic context compaction that fires when token usage approaches the
 * model's context limit. Includes circuit breaker, turn tracking, and
 * DeepSeek-specific optimizations (higher thresholds for 1M context).
 */

import type { Message, TokenUsage, CompactionLevel } from "../types/index.js";
import { estimateTokens, estimateMessagesTokens } from "../observability/token-counter.js";
import { debug } from "../observability/debug.js";
import { suppressCompactWarning } from "./compact-warning.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Buffer reserved before context limit. When remaining < this, auto-compact fires. */
export const AUTOCOMPACT_BUFFER_TOKENS = 13000;

/** Buffer reserved for manual compaction calls. */
export const MANUAL_COMPACT_BUFFER = 3000;

/** Max consecutive failures before circuit breaker opens. */
export const MAX_CONSECUTIVE_FAILURES = 3;

const DEFAULT_MAX_OUTPUT_TOKENS = 20000;
const DEEPSEEK_MAX_OUTPUT_TOKENS = 8192;
const DEEPSEEK_AUTOCOMPACT_RATIO = 0.85;
const DEFAULT_AUTOCOMPACT_RATIO = 0.70;
const DEEPSEEK_MODEL_PATTERN = /deepseek/i;

// ---------------------------------------------------------------------------
// Tracking State
// ---------------------------------------------------------------------------

export interface AutoCompactTrackingState {
  compacted: boolean;
  turnCounter: number;
  turnId: number;
  consecutiveFailures: number;
}

export function createAutoCompactTracking(): AutoCompactTrackingState {
  return { compacted: false, turnCounter: 0, turnId: -1, consecutiveFailures: 0 };
}

export function advanceTurn(tracking: AutoCompactTrackingState): void {
  tracking.turnCounter++;
  tracking.compacted = false;
}

export function resetCircuitBreaker(tracking: AutoCompactTrackingState): void {
  tracking.consecutiveFailures = 0;
}

// ---------------------------------------------------------------------------
// Context Window Calculations
// ---------------------------------------------------------------------------

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "deepseek-chat": 1_000_000, "deepseek-reasoner": 1_000_000,
  "deepseek-v3": 1_048_576, "deepseek-r1": 1_048_576,
  "claude-sonnet-4-20250514": 200_000, "claude-opus-4-20250514": 200_000,
  "claude-3-5-sonnet-20241022": 200_000, "claude-3-5-haiku-20241022": 200_000,
  "gpt-4o": 128_000, "gpt-4o-mini": 128_000, "gpt-4-turbo": 128_000,
  "gpt-4.1": 1_000_000, "gpt-4.1-mini": 1_000_000,
  "gemini-2.5-pro": 1_000_000, "gemini-2.5-flash": 1_000_000,
};
const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Raw context window size for a model (before output token reservation). */
export function getContextWindow(model: string): number {
  if (MODEL_CONTEXT_WINDOWS[model] !== undefined) return MODEL_CONTEXT_WINDOWS[model];
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (model.startsWith(key)) return value;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

/** Effective context window: raw window minus reserved output tokens. */
export function getEffectiveContextWindow(model: string): number {
  const contextWindow = getContextWindow(model);
  const maxOutputTokens = DEEPSEEK_MODEL_PATTERN.test(model)
    ? DEEPSEEK_MAX_OUTPUT_TOKENS : DEFAULT_MAX_OUTPUT_TOKENS;
  return contextWindow - maxOutputTokens;
}

/** Warning threshold: when usage exceeds this, show token warnings. */
export function getWarningThreshold(model: string): number {
  return getEffectiveContextWindow(model) - 20000;
}

/** Auto-compact threshold. DeepSeek uses ratio-based (85%), others use absolute buffer. */
export function getAutoCompactThreshold(model: string): number {
  const effectiveWindow = getEffectiveContextWindow(model);
  if (DEEPSEEK_MODEL_PATTERN.test(model)) {
    return Math.floor(effectiveWindow * DEEPSEEK_AUTOCOMPACT_RATIO);
  }
  return effectiveWindow - AUTOCOMPACT_BUFFER_TOKENS;
}

// ---------------------------------------------------------------------------
// Token Warning State
// ---------------------------------------------------------------------------

export interface TokenWarningState {
  percentLeft: number;
  isAboveWarning: boolean;
  isAboveError: boolean;
  isAboveAutoCompact: boolean;
  isAtBlocking: boolean;
}

export function calculateTokenWarningState(
  tokenUsage: TokenUsage,
  model: string,
): TokenWarningState {
  const effectiveWindow = getEffectiveContextWindow(model);
  const contextWindow = getContextWindow(model);
  const autoCompactThreshold = getAutoCompactThreshold(model);
  const warningThreshold = getWarningThreshold(model);
  const used = tokenUsage.total;

  const percentLeft = effectiveWindow > 0
    ? Math.max(0, Math.round(((effectiveWindow - used) / effectiveWindow) * 100))
    : 0;

  return {
    percentLeft,
    isAboveWarning: used > warningThreshold,
    isAboveError: effectiveWindow - used < 5000,
    isAboveAutoCompact: used > autoCompactThreshold,
    isAtBlocking: contextWindow - used < 1000,
  };
}

// ---------------------------------------------------------------------------
// Auto-Compact Decision
// ---------------------------------------------------------------------------

/** Decide whether auto-compact should run. Checks threshold, recursion guard, circuit breaker. */
export function shouldAutoCompact(
  messages: Message[],
  model: string,
  tracking?: AutoCompactTrackingState,
  querySource?: string,
  snipTokensFreed?: number,
): boolean {
  const nonSystemMessages = messages.filter(
    (m) => !(typeof m.content === "string" && m.content.startsWith("[System")),
  );
  if (nonSystemMessages.length < 4) return false;
  if (tracking?.compacted) return false; // recursion guard

  if (tracking && tracking.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    debug.warn("auto-compact",
      `Circuit breaker open (${tracking.consecutiveFailures} failures). Skipping.`);
    return false;
  }

  const asTyped = messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));
  const estimatedTokens = estimateMessagesTokens(asTyped, model);
  const effectiveTokens = snipTokensFreed
    ? Math.max(0, estimatedTokens - snipTokensFreed) : estimatedTokens;
  const autoCompactThreshold = getAutoCompactThreshold(model);
  const exceedsThreshold = effectiveTokens > autoCompactThreshold;

  if (querySource === "system" || querySource === "auto") {
    return exceedsThreshold && effectiveTokens > getContextWindow(model) * 0.92;
  }
  return exceedsThreshold;
}

// ---------------------------------------------------------------------------
// Auto-Compact Execution
// ---------------------------------------------------------------------------

export interface AutoCompactResult {
  wasCompacted: boolean;
  compactionResult: CompactionRunResult | null;
  consecutiveFailures: number;
}

export interface CompactionRunResult {
  messages: Message[];
  compactedCount: number;
  level: CompactionLevel;
  summary?: string;
}

export interface AutoCompactContext {
  model: string;
  tokenUsage: TokenUsage;
  querySource?: string;
  snipTokensFreed?: number;
}

export type AutoCompactSummarizer = (messages: Message[]) => Promise<string>;

/** Main entry point: run auto-compaction if thresholds are met. */
export async function autoCompactIfNeeded(
  messages: Message[],
  context: AutoCompactContext,
  tracking?: AutoCompactTrackingState,
  summarizer?: AutoCompactSummarizer,
): Promise<AutoCompactResult> {
  const shouldRun = shouldAutoCompact(
    messages, context.model, tracking, context.querySource, context.snipTokensFreed,
  );

  if (!shouldRun) {
    return { wasCompacted: false, compactionResult: null, consecutiveFailures: tracking?.consecutiveFailures ?? 0 };
  }

  const criticalMessages = messages.filter((m) => m.critical);
  const nonCriticalMessages = messages.filter((m) => !m.critical);

  if (nonCriticalMessages.length < 3) {
    return { wasCompacted: false, compactionResult: null, consecutiveFailures: tracking?.consecutiveFailures ?? 0 };
  }

  const isDeepSeek = DEEPSEEK_MODEL_PATTERN.test(context.model);
  const keepRatio = isDeepSeek ? 0.30 : 0.15;
  const keepCount = Math.max(2, Math.floor(nonCriticalMessages.length * keepRatio));
  const recentMessages = nonCriticalMessages.slice(-keepCount);
  const oldMessages = nonCriticalMessages.slice(0, nonCriticalMessages.length - keepCount);

  try {
    const summary = summarizer
      ? await summarizer(oldMessages)
      : generateLocalFallbackSummary(oldMessages);

    const summaryMessage: Message = {
      role: "user",
      content: `[Previous conversation auto-compacted (${oldMessages.length} messages): ${summary}]`,
      timestamp: new Date().toISOString(),
      critical: false,
    };

    const compactedMessages = [...criticalMessages, summaryMessage, ...recentMessages];

    if (tracking) {
      tracking.compacted = true;
      tracking.turnId = tracking.turnCounter;
      resetCircuitBreaker(tracking);
    }

    suppressCompactWarning();

    debug.info("auto-compact",
      `Compacted ${oldMessages.length} messages, kept ${recentMessages.length} recent. ` +
      `Model: ${context.model}, Ratio: ${keepRatio}`);

    return {
      wasCompacted: true,
      compactionResult: {
        messages: compactedMessages, compactedCount: oldMessages.length,
        level: "auto", summary,
      },
      consecutiveFailures: 0,
    };
  } catch (err) {
    if (tracking) tracking.consecutiveFailures++;
    debug.error("auto-compact",
      `Compaction failed (${tracking?.consecutiveFailures ?? "?"}/${MAX_CONSECUTIVE_FAILURES}).`, err);
    return {
      wasCompacted: false, compactionResult: null,
      consecutiveFailures: tracking?.consecutiveFailures ?? 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Fallback Summary (no LLM)
// ---------------------------------------------------------------------------

function generateLocalFallbackSummary(messages: Message[]): string {
  const userMessages = messages.filter((m) => m.role === "user");
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const toolMessages = messages.filter((m) => m.role === "tool");

  const userSnippets = userMessages.slice(0, 5).map((m) => {
    const text = typeof m.content === "string" ? m.content : "[tool calls]";
    return text.slice(0, 80).replace(/\n/g, " ");
  }).join(" | ");

  const successCount = toolMessages.filter(
    (m) => typeof m.content === "string" &&
      (m.content.includes("success") || m.content.includes('"ok":true')),
  ).length;

  const parts: string[] = [];
  if (userMessages.length > 0) parts.push(`${userMessages.length} user queries`);
  if (assistantMessages.length > 0) parts.push(`${assistantMessages.length} assistant responses`);
  if (toolMessages.length > 0) parts.push(`${toolMessages.length} tool results (${successCount} successful)`);
  if (userSnippets) parts.push(`Topics: ${userSnippets}`);
  return parts.join(". ") || "Empty conversation.";
}
