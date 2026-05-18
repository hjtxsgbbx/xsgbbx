/**
 * Compaction System
 *
 * Multi-level conversation compaction for managing LLM context windows.
 * Integrates auto-compact with circuit breaker, session memory compaction,
 * message grouping for PTL retry, post-compact cleanup, and warning state.
 *
 * DeepSeek optimizations:
 *   - Higher auto-compact threshold (85% vs 70%) — 1M context window
 *   - No prompt cache injection (Anthropic-specific)
 *   - No cache_edits microcompact (Anthropic-specific)
 *   - Simplified forked-agent summarizer (direct LLM call, no cache-sharing)
 */

import { type Message, type TokenUsage, type CompactionLevel } from "../types/index.js";
import { debug } from "../observability/debug.js";
import {
  suppressCompactWarning,
  clearCompactWarningSuppression,
  isCompactWarningSuppressed,
} from "./compact-warning.js";
import {
  autoCompactIfNeeded,
  shouldAutoCompact,
  calculateTokenWarningState,
  getEffectiveContextWindow,
  getAutoCompactThreshold,
  getWarningThreshold,
  getContextWindow,
  createAutoCompactTracking,
  advanceTurn,
  resetCircuitBreaker,
  AUTOCOMPACT_BUFFER_TOKENS,
  MANUAL_COMPACT_BUFFER,
  MAX_CONSECUTIVE_FAILURES,
} from "./auto-compact.js";
import type {
  AutoCompactTrackingState,
  AutoCompactResult,
  AutoCompactContext,
  AutoCompactSummarizer,
  CompactionRunResult,
  TokenWarningState,
} from "./auto-compact.js";
import {
  groupMessagesByApiRound,
  truncateHeadForPTLRetry,
} from "./message-grouper.js";
import type { MessageGroup } from "./message-grouper.js";
import {
  runPostCompactCleanup,
  runMinimalPostCompactCleanup,
  registerCleanupCallbacks,
} from "./post-compact-cleanup.js";
import type { CleanupCallbacks } from "./post-compact-cleanup.js";
import {
  trySessionMemoryCompaction,
} from "./session-memory-compact.js";
import type { SessionMemoryCompactionResult } from "./session-memory-compact.js";

// ---------------------------------------------------------------------------
// Legacy Constants (preserved for backward compatibility)
// ---------------------------------------------------------------------------

export const SNIP_THRESHOLD = 0.6;
export const COLLAPSE_THRESHOLD = 0.7;
export const AUTO_THRESHOLD = 0.92;
export const OUTPUT_MAX_LENGTH = 8000;
export const IDLE_COMPACTION_MS = 300000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SummarizerFn = (messages: Message[]) => Promise<string>;

export interface CompactionResult {
  messages: Message[];
  level: CompactionLevel | null;
  compactedCount: number;
  summary?: string;
}

// ---------------------------------------------------------------------------
// Re-exports from submodules
// ---------------------------------------------------------------------------

export {
  // compact-warning
  suppressCompactWarning,
  clearCompactWarningSuppression,
  isCompactWarningSuppressed,
  // auto-compact
  shouldAutoCompact,
  autoCompactIfNeeded,
  calculateTokenWarningState,
  getEffectiveContextWindow,
  getAutoCompactThreshold,
  getWarningThreshold,
  getContextWindow,
  createAutoCompactTracking,
  advanceTurn,
  resetCircuitBreaker,
  AUTOCOMPACT_BUFFER_TOKENS,
  MANUAL_COMPACT_BUFFER,
  MAX_CONSECUTIVE_FAILURES,
  // message-grouper
  groupMessagesByApiRound,
  truncateHeadForPTLRetry,
  // post-compact-cleanup
  runPostCompactCleanup,
  runMinimalPostCompactCleanup,
  registerCleanupCallbacks,
  // session-memory-compact
  trySessionMemoryCompaction,
};

export type {
  AutoCompactTrackingState,
  AutoCompactResult,
  AutoCompactContext,
  AutoCompactSummarizer,
  CompactionRunResult,
  TokenWarningState,
  MessageGroup,
  CleanupCallbacks,
  SessionMemoryCompactionResult,
};

// ---------------------------------------------------------------------------
// ContextCompactor (Legacy — preserved for backward compatibility)
// ---------------------------------------------------------------------------

/**
 * Legacy ContextCompactor class.
 *
 * Maintains the original 4-level compaction API for code that hasn't yet
 * migrated to the new compaction system factory. Delegates summarization
 * to the injected SummarizerFn.
 *
 * New code should use `createCompactionSystem()` instead.
 */
export class ContextCompactor {
  private lastActivityTime: number = Date.now();
  private summarizer: SummarizerFn | null;

  constructor(summarizer?: SummarizerFn) {
    this.summarizer = summarizer || null;
  }

  setSummarizer(fn: SummarizerFn): void {
    this.summarizer = fn;
  }

  setActivity(): void {
    this.lastActivityTime = Date.now();
  }

  async checkAndCompact(
    messages: Message[],
    tokenUsage: TokenUsage,
  ): Promise<CompactionResult> {
    const usageRatio = tokenUsage.total / tokenUsage.limit;
    const idleTime = Date.now() - this.lastActivityTime;

    const truncated = this.truncateLongOutputs(messages);

    if (idleTime > IDLE_COMPACTION_MS && usageRatio > 0.5) {
      return this.microCompact(truncated);
    }

    if (usageRatio > AUTO_THRESHOLD) {
      return this.autoCompact(truncated, usageRatio);
    }

    if (usageRatio > COLLAPSE_THRESHOLD) {
      return this.collapseCompact(truncated, usageRatio);
    }

    if (usageRatio > SNIP_THRESHOLD) {
      return this.snipCompact(truncated);
    }

    return { messages: truncated, level: null, compactedCount: 0 };
  }

  private truncateLongOutputs(messages: Message[]): Message[] {
    return messages.map((msg) => {
      if (typeof msg.content === "string" && msg.content.length > OUTPUT_MAX_LENGTH) {
        const head = msg.content.slice(0, 4000);
        const tail = msg.content.slice(-4000);
        return {
          ...msg,
          content: head + "\n...(truncated)...\n" + tail,
        };
      }
      return msg;
    });
  }

  private snipCompact(messages: Message[]): CompactionResult {
    const nonCritical = messages.filter((m) => !m.critical);
    if (nonCritical.length < 3) {
      return { messages, level: "snip", compactedCount: 0 };
    }

    const toSnip = nonCritical.slice(0, Math.floor(nonCritical.length * 0.3));
    const snipIds = new Set(toSnip.map((m) => m.tool_id).filter(Boolean));

    const result: CompactionResult = {
      messages: messages.filter((m) => {
        if (m.critical) return true;
        if (m.tool_id && snipIds.has(m.tool_id)) return false;
        return !toSnip.find((s) => s === m);
      }),
      level: "snip",
      compactedCount: toSnip.length,
    };

    return result;
  }

  private microCompact(messages: Message[]): CompactionResult {
    const result: Message[] = [];
    let compactedCount = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (
        !msg.critical &&
        msg.role === "tool" &&
        typeof msg.content === "string" &&
        msg.content.length > 500
      ) {
        const nextMsg = messages[i + 1];
        const prevMsg = messages[i - 1];
        if (
          (nextMsg && nextMsg.role === "tool") ||
          (prevMsg && prevMsg.role === "tool")
        ) {
          result.push({
            ...msg,
            content: "[Tool output folded - see full session for details]",
          });
          compactedCount++;
          continue;
        }
      }
      result.push(msg);
    }

    return {
      messages: result,
      level: "micro",
      compactedCount,
    };
  }

  private async collapseCompact(
    messages: Message[],
    _usageRatio: number,
  ): Promise<CompactionResult> {
    const criticalMessages = messages.filter((m) => m.critical);
    const nonCritical = messages.filter((m) => !m.critical);

    if (nonCritical.length === 0) {
      return { messages, level: "collapse", compactedCount: 0 };
    }

    const keepCount = Math.floor(nonCritical.length * 0.4);
    const recent = nonCritical.slice(-keepCount);
    const old = nonCritical.slice(0, nonCritical.length - keepCount);

    const oldSummary = await this.generateSummary(old);

    const summaryMsg: Message = {
      role: "assistant",
      content: `[Earlier conversation summary (${old.length} messages): ${oldSummary}]`,
      timestamp: new Date().toISOString(),
      critical: false,
    };

    return {
      messages: [...criticalMessages, summaryMsg, ...recent],
      level: "collapse",
      compactedCount: old.length,
      summary: oldSummary,
    };
  }

  private async autoCompact(
    messages: Message[],
    _usageRatio: number,
  ): Promise<CompactionResult> {
    const criticalMessages = messages.filter((m) => m.critical);
    const nonCritical = messages.filter((m) => !m.critical);

    if (nonCritical.length === 0) {
      return { messages, level: "auto", compactedCount: 0 };
    }

    const keepCount = Math.max(2, Math.floor(nonCritical.length * 0.15));
    const recent = nonCritical.slice(-keepCount);
    const old = nonCritical.slice(0, nonCritical.length - keepCount);

    const oldSummary = await this.generateSummary(old);

    const summaryMsg: Message = {
      role: "assistant",
      content: `[Previous conversation aggressively compressed (${old.length} messages): ${oldSummary}]`,
      timestamp: new Date().toISOString(),
      critical: false,
    };

    return {
      messages: [...criticalMessages, summaryMsg, ...recent],
      level: "auto",
      compactedCount: old.length,
      summary: oldSummary,
    };
  }

  private async generateSummary(messages: Message[]): Promise<string> {
    if (this.summarizer && messages.length >= 3) {
      try {
        const llmSummary = await this.summarizer(messages);
        if (llmSummary && llmSummary.trim().length > 0) {
          return llmSummary.trim();
        }
      } catch (err) {
        debug.warn("compaction", "LLM summarization failed, falling back to local summary", err);
      }
    }
    return this.generateLocalSummary(messages);
  }

  private generateLocalSummary(messages: Message[]): string {
    const userMessages = messages.filter((m) => m.role === "user");
    const toolResult = messages.filter(
      (m) => m.role === "tool" || m.role === "assistant",
    );

    const userSummary = userMessages
      .slice(0, 5)
      .map((m) =>
        typeof m.content === "string"
          ? m.content.slice(0, 100)
          : "[tool calls]",
      )
      .join(" | ");

    const successCount = toolResult.filter(
      (m) => typeof m.content === "string" && m.content.includes("success"),
    ).length;

    return userMessages.length > 0
      ? `${userMessages.length} user queries, ${toolResult.length} responses, ${successCount} successful tool executions. Topics: ${userSummary}`
      : `${toolResult.length} system interactions.`;
  }

  aggressiveCompact(messages: Message[]): Message[] {
    const criticalMessages = messages.filter((m) => m.critical);
    const nonCritical = messages.filter((m) => !m.critical);

    if (nonCritical.length === 0) return messages;

    const keepCount = Math.max(2, Math.floor(nonCritical.length * 0.15));
    const recent = nonCritical.slice(-keepCount);
    const old = nonCritical.slice(0, nonCritical.length - keepCount);
    const oldSummary = this.generateLocalSummary(old);

    const summaryMsg: Message = {
      role: "assistant",
      content: `[Compacted ${old.length} messages: ${oldSummary}]`,
      timestamp: new Date().toISOString(),
      critical: false,
    };

    return [...criticalMessages, summaryMsg, ...recent];
  }

  forceCompact(messages: Message[]): Message[] {
    const criticalMessages = messages.filter((m) => m.critical);
    const nonCritical = messages.filter((m) => !m.critical);

    if (nonCritical.length === 0) return messages;

    const keepCount = Math.max(1, Math.floor(nonCritical.length * 0.08));
    const recent = nonCritical.slice(-keepCount);
    const old = nonCritical.slice(0, nonCritical.length - keepCount);

    const summaryMsg: Message = {
      role: "assistant",
      content: `[Forced compaction: ${old.length} messages discarded to preserve token budget. Key topics: ${old.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content.slice(0, 60) : '').filter(Boolean).slice(0, 3).join(' | ')}]`,
      timestamp: new Date().toISOString(),
      critical: false,
    };

    return [...criticalMessages, summaryMsg, ...recent];
  }
}

// ---------------------------------------------------------------------------
// Compaction System Factory (New API)
// ---------------------------------------------------------------------------

export interface CompactionSystemConfig {
  /** LLM summarizer for auto-compact and collapse operations */
  summarizer?: AutoCompactSummarizer;
  /** Model name for context window calculations */
  model: string;
  /** Optional session ID for session memory compaction */
  sessionId?: string;
  /** Cleanup callbacks for post-compact cache invalidation */
  cleanupCallbacks?: CleanupCallbacks;
  /** Enable session memory compaction before LLM compaction */
  enableSessionMemoryCompact?: boolean;
}

export interface CompactionSystem {
  // --- Core compaction ---

  /** Legacy context compactor (backward compat) */
  contextCompactor: ContextCompactor;

  /** Run full compaction pipeline: check thresholds, compact if needed */
  compactIfNeeded(
    messages: Message[],
    tokenUsage: TokenUsage,
    querySource?: string,
    snipTokensFreed?: number,
  ): Promise<AutoCompactResult>;

  /** Run legacy checkAndCompact (ratio-based, for backward compat) */
  legacyCheckAndCompact(
    messages: Message[],
    tokenUsage: TokenUsage,
  ): Promise<CompactionResult>;

  // --- Token monitoring ---

  /** Calculate warning state from current token usage */
  getTokenWarningState(tokenUsage: TokenUsage): TokenWarningState;

  /** Check whether auto-compaction should run */
  shouldCompact(
    messages: Message[],
    querySource?: string,
    snipTokensFreed?: number,
  ): boolean;

  // --- Tracking ---

  /** Advance to the next conversation turn */
  advanceTurn(): void;

  /** Get the current tracking state */
  getTracking(): Readonly<AutoCompactTrackingState>;

  // --- Session memory ---

  /** Try session memory compaction before LLM compaction */
  trySessionMemoryCompact(
    messages: Message[],
    threshold?: number,
  ): SessionMemoryCompactionResult;

  // --- Post-compact cleanup ---

  /** Run cleanup after compaction */
  cleanup(reason: string): void;

  // --- Message grouping (PTL retry) ---

  /** Group messages by API round */
  groupMessages(messages: Message[]): MessageGroup[];

  /** Truncate head for PTL retry */
  truncateForPTL(groups: MessageGroup[], tokenGap: number): Message[];

  // --- Force / aggressive (emergency) ---

  /** Aggressive local-only compaction */
  aggressiveCompact(messages: Message[]): Message[];

  /** Force compaction (emergency, no LLM) */
  forceCompact(messages: Message[]): Message[];
}

/**
 * Create a fully-wired compaction system.
 *
 * This is the recommended way to use the compaction system. It wires
 * together auto-compact, session memory compaction, message grouping,
 * post-compact cleanup, and the legacy ContextCompactor into a single
 * convenient interface.
 */
export function createCompactionSystem(
  config: CompactionSystemConfig,
): CompactionSystem {
  // Wire up cleanup callbacks if provided
  if (config.cleanupCallbacks) {
    registerCleanupCallbacks(config.cleanupCallbacks);
  }

  // Wire summarizer into legacy ContextCompactor
  const compatSummarizer: SummarizerFn | undefined = config.summarizer
    ? async (messages: Message[]): Promise<string> => {
        // The legacy summarizer takes Message[] with (messages: Message[]) => string
        // Our AutoCompactSummarizer takes Message[] => Promise<string>
        // They're compatible
        return config.summarizer!(messages);
      }
    : undefined;

  const contextCompactor = new ContextCompactor(compatSummarizer);

  // Create auto-compact tracking
  const tracking = createAutoCompactTracking();

  const system: CompactionSystem = {
    contextCompactor,

    // --- Core compaction ---

    async compactIfNeeded(
      messages: Message[],
      tokenUsage: TokenUsage,
      querySource?: string,
      snipTokensFreed?: number,
    ): Promise<AutoCompactResult> {
      const autoContext: AutoCompactContext = {
        model: config.model,
        tokenUsage,
        querySource,
        snipTokensFreed,
      };

      const result = await autoCompactIfNeeded(
        messages,
        autoContext,
        tracking,
        config.summarizer,
      );

      if (result.wasCompacted) {
        runPostCompactCleanup("auto-compact succeeded");
      }

      return result;
    },

    async legacyCheckAndCompact(
      messages: Message[],
      tokenUsage: TokenUsage,
    ): Promise<CompactionResult> {
      return contextCompactor.checkAndCompact(messages, tokenUsage);
    },

    // --- Token monitoring ---

    getTokenWarningState(tokenUsage: TokenUsage): TokenWarningState {
      return calculateTokenWarningState(tokenUsage, config.model);
    },

    shouldCompact(
      messages: Message[],
      querySource?: string,
      snipTokensFreed?: number,
    ): boolean {
      return shouldAutoCompact(
        messages,
        config.model,
        tracking,
        querySource,
        snipTokensFreed,
      );
    },

    // --- Tracking ---

    advanceTurn(): void {
      advanceTurn(tracking);
    },

    getTracking(): Readonly<AutoCompactTrackingState> {
      return { ...tracking };
    },

    // --- Session memory ---

    trySessionMemoryCompact(
      messages: Message[],
      threshold?: number,
    ): SessionMemoryCompactionResult {
      if (!config.sessionId) {
        return {
          wasApplied: false,
          messages,
          compactedCount: 0,
          lastCompactedIndex: -1,
          reason: "No sessionId configured for session memory compaction",
        };
      }

      const effectiveThreshold =
        threshold ?? getAutoCompactThreshold(config.model);

      return trySessionMemoryCompaction(
        messages,
        config.sessionId,
        effectiveThreshold,
        config.model,
      );
    },

    // --- Post-compact cleanup ---

    cleanup(reason: string): void {
      runPostCompactCleanup(reason);
    },

    // --- Message grouping ---

    groupMessages(messages: Message[]): MessageGroup[] {
      return groupMessagesByApiRound(messages, config.model);
    },

    truncateForPTL(groups: MessageGroup[], tokenGap: number): Message[] {
      return truncateHeadForPTLRetry(groups, tokenGap);
    },

    // --- Emergency ---

    aggressiveCompact(messages: Message[]): Message[] {
      return contextCompactor.aggressiveCompact(messages);
    },

    forceCompact(messages: Message[]): Message[] {
      return contextCompactor.forceCompact(messages);
    },
  };

  return system;
}
