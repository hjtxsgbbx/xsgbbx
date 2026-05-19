/**
 * Bash Command Classifier — wraps the bash-security validator chain into a
 * tiered permission result (deny / ask / allow) for use by the permission
 * pipeline and tool executor.
 *
 * All functions are pure: inputs are readonly and outputs are new objects.
 */

import {
  validateCommandSecurity,
} from '../security/bash-security/index.js';
import type {
  ValidatorResult,
} from '../security/bash-security/index.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ClassifierResult {
  /** The permission tier determined by the security validator chain */
  readonly tier: 'deny' | 'ask' | 'allow';
  /** Human-readable explanation of the decision */
  readonly reason: string;
  /** Optional check ID (1-23) from the validator that triggered the result */
  readonly checkId?: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a bash/shell command into a permission tier by running the full
 * 23-check security validator chain.
 *
 * Decision logic:
 * - If any validator returns 'deny' → tier is 'deny' (short-circuits)
 * - If any validator returns 'ask' (and none deny) → tier is 'ask'
 * - If all validators pass through → tier is 'allow'
 *
 * This is the primary entry point for bash command security classification.
 * It delegates to the bash-security module's validateCommandSecurity which
 * runs all 23 validators in priority order.
 *
 * @param command - The raw command string to classify
 * @returns A ClassifierResult indicating the security tier decision
 */
export function classifyBashCommand(command: string): ClassifierResult {
  const result: ValidatorResult = validateCommandSecurity(command);

  switch (result.kind) {
    case 'deny':
      return {
        tier: 'deny',
        reason: result.message,
        checkId: result.checkId,
      };

    case 'ask':
      return {
        tier: 'ask',
        reason: result.message,
        checkId: result.checkId,
      };

    case 'allow':
      return {
        tier: 'allow',
        reason: 'All 23 security checks passed',
      };

    case 'passthrough':
      // Should not reach here — validateCommandSecurity never returns passthrough
      return {
        tier: 'allow',
        reason: 'No security issues detected',
      };
  }
}

/**
 * Quick check: is this command classified as denied?
 */
export function isBashCommandDenied(command: string): boolean {
  return classifyBashCommand(command).tier === 'deny';
}

/**
 * Quick check: does this command need user confirmation?
 * Returns true for both 'deny' and 'ask' tiers.
 */
export function isBashCommandDangerous(command: string): boolean {
  const result = classifyBashCommand(command);
  return result.tier === 'deny' || result.tier === 'ask';
}

/**
 * Check if a command is explicitly allowed (all 23 checks passed).
 * Use this to short-circuit further permission checks for known-safe commands.
 */
export function isBashCommandAllowed(command: string): boolean {
  return classifyBashCommand(command).tier === 'allow';
}

/**
 * Check if the classifier can make a determination (always true).
 * Provided for API symmetry — returns false only for empty/whitespace commands
 * where classification is meaningless.
 */
export function canClassifyBashCommand(command: string): boolean {
  return command.trim().length > 0;
}
