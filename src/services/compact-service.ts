/**
 * CompactService
 *
 * Wraps the compaction/ subsystem into a single service interface.
 * Delegates to auto-compact, session-memory-compact, compact-warning,
 * and post-compact-cleanup modules.
 */

import type { Message, TokenUsage } from "../types/index.js";
import {
  shouldAutoCompact,
  autoCompactIfNeeded,
  calculateTokenWarningState,
  createAutoCompactTracking,
  advanceTurn,
  resetCircuitBreaker,
} from "../compaction/auto-compact.js";
import type {
  AutoCompactTrackingState,
  AutoCompactResult,
  AutoCompactSummarizer,
  TokenWarningState,
} from "../compaction/auto-compact.js";
import {
  isCompactWarningSuppressed,
  suppressCompactWarning,
  clearCompactWarningSuppression,
} from "../compaction/compact-warning.js";
import { runPostCompactCleanup } from "../compaction/post-compact-cleanup.js";
import { trySessionMemoryCompaction } from "../compaction/session-memory-compact.js";
import { groupMessagesByApiRound, truncateHeadForPTLRetry } from "../compaction/message-grouper.js";
import type { MessageGroup } from "../compaction/message-grouper.js";
import { debug } from "../observability/debug.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompactServiceConfig {
  /** Resolved model name (used for context-window and threshold calculations) */
  model?: string;
  /** Optional LLM summarizer for auto-compact */
  summarizer?: AutoCompactSummarizer;
  /** Session ID for session-memory-backed compaction */
  sessionId?: string;
}

export interface CompactIfNeededInput {
  messages: Message[];
  tokenUsage: TokenUsage;
  querySource?: string;
  snipTokensFreed?: number;
}

export interface CompactWarningInfo {
  suppressed: boolean;
  state: TokenWarningState;
  consecutiveFailures: number;
  compactedThisTurn: boolean;
}

// ---------------------------------------------------------------------------
// CompactService
// ---------------------------------------------------------------------------

export class CompactService {
  private config: CompactServiceConfig;
  private tracking: AutoCompactTrackingState;

  constructor(config: CompactServiceConfig = {}) {
    this.config = config;
    this.tracking = createAutoCompactTracking();
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  setModel(model: string): void { this.config = { ...this.config, model }; }
  setSummarizer(fn: AutoCompactSummarizer): void { this.config = { ...this.config, summarizer: fn }; }
  setSessionId(sessionId: string): void { this.config = { ...this.config, sessionId }; }

  // -------------------------------------------------------------------------
  // Core compaction
  // -------------------------------------------------------------------------

  async compactIfNeeded(input: CompactIfNeededInput): Promise<AutoCompactResult> {
    const model = this.config.model ?? "deepseek-chat";

    const nonSystem = input.messages.filter(
      (m) => !(typeof m.content === "string" && m.content.startsWith("[System")),
    );
    if (nonSystem.length < 4) return { wasCompacted: false, compactionResult: null, consecutiveFailures: 0 };

    if (this.config.sessionId) {
      try {
        const smResult = trySessionMemoryCompaction(
          input.messages, this.config.sessionId,
          this.tracking.compacted ? 0 : input.tokenUsage.total, model,
        );
        if (smResult.wasApplied) {
          suppressCompactWarning();
          this.tracking.compacted = true;
          return {
            wasCompacted: true,
            compactionResult: { messages: smResult.messages, compactedCount: smResult.compactedCount, level: "auto" },
            consecutiveFailures: 0,
          };
        }
      } catch (err) {
        debug.warn("compact-service", "Session memory compaction failed, continuing", err);
      }
    }

    if (!shouldAutoCompact(input.messages, model, this.tracking, input.querySource, input.snipTokensFreed)) {
      return { wasCompacted: false, compactionResult: null, consecutiveFailures: this.tracking.consecutiveFailures };
    }

    const result = await autoCompactIfNeeded(
      input.messages,
      { model, tokenUsage: input.tokenUsage, querySource: input.querySource, snipTokensFreed: input.snipTokensFreed },
      this.tracking,
      this.config.summarizer,
    );

    if (result.wasCompacted) runPostCompactCleanup("compact-service auto-compact");
    return result;
  }

  // -------------------------------------------------------------------------
  // Threshold & warning checks
  // -------------------------------------------------------------------------

  /**
   * Check whether auto-compaction should run based on current state.
   * Does not modify any tracking state.
   */
  shouldCompact(
    messages: Message[],
    querySource?: string,
    snipTokensFreed?: number,
  ): boolean {
    return shouldAutoCompact(
      messages,
      this.config.model ?? "deepseek-chat",
      this.tracking,
      querySource,
      snipTokensFreed,
    );
  }

  /**
   * Get the full token warning state (percentages, thresholds crossed).
   */
  getTokenWarningState(tokenUsage: TokenUsage): TokenWarningState {
    return calculateTokenWarningState(tokenUsage, this.config.model ?? "deepseek-chat");
  }

  /**
   * Get a compact summary of the warning state: suppressed flag, token
   * state, and circuit-breaker info. Useful for UI rendering.
   */
  getCompactWarningInfo(tokenUsage: TokenUsage): CompactWarningInfo {
    return {
      suppressed: isCompactWarningSuppressed(),
      state: this.getTokenWarningState(tokenUsage),
      consecutiveFailures: this.tracking.consecutiveFailures,
      compactedThisTurn: this.tracking.compacted,
    };
  }

  // -------------------------------------------------------------------------
  // Turn lifecycle
  // -------------------------------------------------------------------------

  /** Advance to the next conversation turn. Call after each user message. */
  advanceTurn(): void {
    advanceTurn(this.tracking);
  }

  /** Reset the circuit breaker after a successful compaction. */
  resetCircuitBreaker(): void {
    resetCircuitBreaker(this.tracking);
  }

  /** Clear warning suppression (shows warnings again next evaluation). */
  resetWarnings(): void {
    clearCompactWarningSuppression();
  }

  // -------------------------------------------------------------------------
  // Message grouping (PTL retry)
  // -------------------------------------------------------------------------

  /** Group messages by API round for PTL (prompt-too-long) retry handling. */
  groupMessages(messages: Message[]): MessageGroup[] {
    return groupMessagesByApiRound(messages, this.config.model);
  }

  /** Truncate head groups to recover a specified token gap. */
  truncateForPTL(groups: MessageGroup[], tokenGap: number): Message[] {
    return truncateHeadForPTLRetry(groups, tokenGap);
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /** Run post-compaction cleanup (cache invalidation, warning resets). */
  cleanup(reason: string): void {
    runPostCompactCleanup(reason);
  }

  /** Get read-only tracking state snapshot. */
  getTracking(): Readonly<AutoCompactTrackingState> {
    return { ...this.tracking };
  }
}
