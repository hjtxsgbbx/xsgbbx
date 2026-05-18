/**
 * Post-Compaction Cleanup
 *
 * After compaction runs, several cached states become stale and must be
 * cleared. This module encapsulates all post-compaction cleanup operations
 * so compaction callers don't need to know the internal cache structure of
 * every subsystem.
 *
 * Cleanup operations performed:
 * 1. Clear compact warning suppression — fresh state for next evaluation
 * 2. Clear file read cache — compacted summaries may reference stale file reads
 * 3. Reset microcompact state — stale tool-result fold state
 * 4. Invalidate env snapshot cache — compaction may have occurred after
 *    file operations that changed git state
 *
 * Explicitly NOT cleared:
 * - Skill content cache (skills are deterministic, unaffected by compaction)
 * - Sent skill names (skills already applied should stay applied)
 */

import { clearCompactWarningSuppression } from "./compact-warning.js";
import { clearTokenCache } from "../observability/token-counter.js";
import { debug } from "../observability/debug.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callbacks for subsystems that need cleanup. Provided during init. */
export interface CleanupCallbacks {
  /**
   * Clear file read cache — optional.
   *
   * When compaction summarizes earlier file operations, the cached file
   * content may no longer be relevant. Callers should clear any
   * in-memory file read cache to avoid serving stale content.
   */
  clearFileReadCache?: () => void;

  /**
   * Reset microcompact state — optional.
   *
   * Microcompact folds long tool outputs. After full compaction, the
   * fold state should be reset so outputs are re-evaluated fresh.
   */
  resetMicrocompactState?: () => void;

  /**
   * Invalidate environment snapshot cache — optional.
   *
   * After compaction (which may follow file operations), git state
   * snapshots may be stale. Invalidate them so the next access
   * re-captures.
   */
  invalidateEnvSnapshot?: () => void;
}

// ---------------------------------------------------------------------------
// Cleanup State
// ---------------------------------------------------------------------------

let _callbacks: CleanupCallbacks = {};

/**
 * Register cleanup callbacks.
 *
 * Call once during initialization with references to the subsystems
 * that need to be cleaned up after compaction.
 */
export function registerCleanupCallbacks(callbacks: CleanupCallbacks): void {
  _callbacks = { ..._callbacks, ...callbacks };
}

// ---------------------------------------------------------------------------
// Core Cleanup
// ---------------------------------------------------------------------------

/**
 * Run all post-compaction cleanup operations.
 *
 * Call this after every successful compaction (auto, collapse, snip, or
 * force). It is safe to call multiple times — each operation is idempotent.
 *
 * @param reason — human-readable reason for cleanup (logged when debug enabled)
 */
export function runPostCompactCleanup(reason: string): void {
  debug.info("post-compact-cleanup", `Running cleanup: ${reason}`);

  // 1. Clear compact warning suppression
  //    After compaction, the token count has changed. We want the next
  //    token evaluation to show a fresh warning if needed.
  clearCompactWarningSuppression();

  // 2. Clear file read cache
  //    Compacted summaries may refer to files that were read before the
  //    compaction. Clearing the cache ensures the system re-reads if needed.
  if (_callbacks.clearFileReadCache) {
    try {
      _callbacks.clearFileReadCache();
    } catch (err) {
      debug.warn("post-compact-cleanup", "Failed to clear file read cache", err);
    }
  }

  // 3. Reset microcompact state
  //    Microcompact folds tool outputs. After full compaction, we want
  //    fresh evaluation of which outputs should be folded.
  if (_callbacks.resetMicrocompactState) {
    try {
      _callbacks.resetMicrocompactState();
    } catch (err) {
      debug.warn("post-compact-cleanup", "Failed to reset microcompact state", err);
    }
  }

  // 4. Invalidate env snapshot cache
  //    Git state may have changed between when the snapshot was taken and
  //    when compaction ran. Invalidate to force re-capture on next access.
  if (_callbacks.invalidateEnvSnapshot) {
    try {
      _callbacks.invalidateEnvSnapshot();
    } catch (err) {
      debug.warn("post-compact-cleanup", "Failed to invalidate env snapshot", err);
    }
  }

  // 5. Clear token estimation cache
  //    After compaction, token estimates for messages have changed.
  clearTokenCache();

  debug.info("post-compact-cleanup", `Cleanup complete: ${reason}`);
}

/**
 * Minimal cleanup — only clears warning suppression and token cache.
 *
 * Use this for lightweight operations that don't warrant full cleanup
 * (e.g., after a micro-compact that only folded tool outputs).
 */
export function runMinimalPostCompactCleanup(reason: string): void {
  clearCompactWarningSuppression();
  clearTokenCache();
  debug.info("post-compact-cleanup", `Minimal cleanup: ${reason}`);
}
