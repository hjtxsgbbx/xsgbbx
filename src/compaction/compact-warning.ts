/**
 * Compact Warning State
 *
 * Simple boolean store that suppresses compact warnings after compaction
 * has occurred, so we don't show stale "you're at 92% context" messages.
 *
 * Also used by post-compact-cleanup to reset warning state after a fresh
 * compaction pass.
 */

let _warningSuppressed = false;

/** Suppress compact warnings — call after successful compaction */
export function suppressCompactWarning(): void {
  _warningSuppressed = true;
}

/** Clear suppression — call after fresh compaction or new turn */
export function clearCompactWarningSuppression(): void {
  _warningSuppressed = false;
}

/** Check whether compact warnings are currently suppressed */
export function isCompactWarningSuppressed(): boolean {
  return _warningSuppressed;
}
