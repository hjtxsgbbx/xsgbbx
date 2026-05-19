/**
 * Main orchestrator for bash command security validation.
 *
 * Inspired by Claude Code's bashSecurity.ts, this module chains 23 security
 * checks in order, running each as a pure function. Checks are organized by
 * category and run in priority order:
 *
 *   Structure checks (1, 7-10) — malformed commands
 *   jq checks         (2-3)     — JSON processor abuse
 *   Shell injection   (4-6, 11) — metacharacters, subs, expansions
 *   Git checks        (12)      — git-specific injection
 *   Safety detection  (13, 17-19, 22-23) — dangerous patterns
 *   Redirect checks   (14-16)   — sensitive file/process I/O
 *   ZSH checks        (20)      — ZSH-specific threats
 *   Unicode checks    (21)      — homoglyph attacks
 *
 * The validator short-circuits on the first 'deny' result.
 * 'ask' results are accumulated and returned if no 'deny' is found.
 * 'passthrough' means the check had nothing to report.
 *
 * All functions are pure: ValidationContext is readonly and results are
 * new objects every time.
 */

import type { TsNode } from '../../utils/bash/bash-tokenizer.js';

// Import all check modules
import { checkEmptyCommand } from './command-structure-checks.js';
import { checkIncompletePipe } from './command-structure-checks.js';
import { checkIncompleteBoolean } from './command-structure-checks.js';
import { checkIncompleteHeredoc } from './command-structure-checks.js';
import { checkUnmatchedDelimiters } from './command-structure-checks.js';

import { checkJqSystemCall } from './jq-security-checks.js';
import { checkJqFileBypass } from './jq-security-checks.js';

import { checkUnescapedMetacharacters } from './shell-injection-checks.js';
import { checkCommandSubstitution } from './shell-injection-checks.js';
import { checkParameterExpansion } from './shell-injection-checks.js';
import { checkIFSManipulation } from './shell-injection-checks.js';
import { checkSensitiveOutputRedirect } from './shell-injection-checks.js';
import { checkSensitiveInputRedirect } from './shell-injection-checks.js';
import { checkProcessSubstitution } from './shell-injection-checks.js';
import { checkUnicodeHomoglyphs } from './shell-injection-checks.js';

import { checkGitShellInjection } from './git-security-checks.js';

import { checkProcAccess } from './safety-detection.js';
import { checkControlCharacters } from './safety-detection.js';
import { checkBase64Payload } from './safety-detection.js';
import { checkPipeToShell } from './safety-detection.js';
import { checkSudoWithoutCommand } from './safety-detection.js';
import { checkChmodSuspicious } from './safety-detection.js';

import { checkZshDangerousBuiltins } from './zsh-security-checks.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The context passed to every validator function. All fields are readonly
 * so validators must not mutate.
 */
export type ValidationContext = {
  readonly command: string;
  readonly ast: TsNode | null;
  readonly platform: string;
  readonly cwd: string;
};

/**
 * Result of a single validator check.
 *
 * - 'allow': Explicitly permitted (reserved for future use)
 * - 'ask': Suspicious — should prompt the user for confirmation
 * - 'deny': Dangerous — must not execute
 * - 'passthrough': The check had nothing to report
 */
export type ValidatorResult =
  | { readonly kind: 'allow' }
  | { readonly kind: 'ask'; readonly message: string; readonly checkId: number }
  | { readonly kind: 'deny'; readonly message: string; readonly checkId: number }
  | { readonly kind: 'passthrough' };

/**
 * A pure function that validates a command against one security check.
 */
export type ValidatorFn = (ctx: ValidationContext) => ValidatorResult;

// ---------------------------------------------------------------------------
// The validator chain (23 checks in order)
// ---------------------------------------------------------------------------

/**
 * The ordered array of all 23 security validators.
 *
 * Check IDs are assigned as follows:
 *   1  — Empty command
 *   2  — jq system() call
 *   3  — jq file bypass
 *   4  — Unescaped shell metacharacters
 *   5  — Command substitution
 *   6  — Parameter expansion (dangerous)
 *   7  — Incomplete pipe chain
 *   8  — Incomplete boolean chain
 *   9  — Incomplete heredoc
 *  10  — Unmatched delimiters
 *  11  — IFS manipulation
 *  12  — Git shell injection
 *  13  — /proc access
 *  14  — Sensitive output redirect
 *  15  — Sensitive input redirect
 *  16  — Process substitution
 *  17  — Control characters
 *  18  — Base64-encoded payload
 *  19  — curl/wget pipe to shell
 *  20  — ZSH dangerous builtins
 *  21  — Unicode homoglyphs
 *  22  — sudo/doas risks
 *  23  — chmod +x on suspicious files
 */
export const VALIDATORS: readonly ValidatorFn[] = [
  // --- Structure checks (1, 7-10) ---
  checkEmptyCommand,              // Check 1
  // --- jq checks (2-3) ---
  checkJqSystemCall,              // Check 2
  checkJqFileBypass,              // Check 3
  // --- Shell injection (4-6) ---
  checkUnescapedMetacharacters,   // Check 4
  checkCommandSubstitution,       // Check 5
  checkParameterExpansion,        // Check 6
  // --- More structure (7-10) ---
  checkIncompletePipe,            // Check 7
  checkIncompleteBoolean,         // Check 8
  checkIncompleteHeredoc,         // Check 9
  checkUnmatchedDelimiters,       // Check 10
  // --- IFS (11) ---
  checkIFSManipulation,           // Check 11
  // --- Git (12) ---
  checkGitShellInjection,         // Check 12
  // --- Safety detection (13, 17-19) ---
  checkProcAccess,                // Check 13
  checkSensitiveOutputRedirect,   // Check 14
  checkSensitiveInputRedirect,    // Check 15
  checkProcessSubstitution,       // Check 16
  checkControlCharacters,         // Check 17
  checkBase64Payload,             // Check 18
  checkPipeToShell,               // Check 19
  // --- ZSH (20) ---
  checkZshDangerousBuiltins,      // Check 20
  // --- Unicode (21) ---
  checkUnicodeHomoglyphs,         // Check 21
  // --- More safety (22-23) ---
  checkSudoWithoutCommand,        // Check 22
  checkChmodSuspicious,           // Check 23
];

// ---------------------------------------------------------------------------
// Validation result aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregated result from running all validators.
 * Only exposed for debugging and reporting — most callers should
 * use validateCommandSecurity().
 */
export type ValidationReport = {
  /** Final decision after all validators ran */
  readonly result: ValidatorResult;
  /** All non-passthrough results from each validator, in order */
  readonly hits: ReadonlyArray<ValidatorResult & { readonly kind: 'ask' | 'deny' }>;
  /** Total number of validators that ran */
  readonly checksRun: number;
  /** Per-check timing in milliseconds (for performance analysis) */
  readonly timings: ReadonlyMap<number, number>;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run ALL validators and return a detailed report.
 * Use this for debugging, testing, or auditing.
 */
export function validateWithReport(ctx: ValidationContext): ValidationReport {
  const hits: (ValidatorResult & { readonly kind: 'ask' | 'deny' })[] = [];
  const timings = new Map<number, number>();
  let finalResult: ValidatorResult = { kind: 'passthrough' };

  for (const validator of VALIDATORS) {
    const startNs = process.hrtime.bigint();
    const result = validator(ctx);
    const endNs = process.hrtime.bigint();
    const elapsedMs = Number(endNs - startNs) / 1_000_000;

    if (result.kind === 'ask' || result.kind === 'deny') {
      timings.set(result.checkId, elapsedMs);
      hits.push(result);

      // First deny is the final result, but continue running all
      if (result.kind === 'deny' && finalResult.kind !== 'deny') {
        finalResult = result;
      } else if (result.kind === 'ask' && finalResult.kind === 'passthrough') {
        finalResult = result;
      }
    }
  }

  return {
    result: finalResult,
    hits,
    checksRun: VALIDATORS.length,
    timings,
  };
}

/**
 * Run security validators and return the first blocking result.
 *
 * Short-circuits on the first 'deny'. Continues through 'ask' results
 * in case a later check upgrades to 'deny'. Returns 'allow' only if
 * ALL checks pass through.
 *
 * This is the primary entry point for command security validation.
 *
 * @param command - The raw command string to validate
 * @param ast - Optional pre-parsed AST (parsed if not provided)
 * @returns A ValidatorResult indicating the security decision
 */
export function validateCommandSecurity(
  command: string,
  ast?: TsNode | null,
): ValidatorResult {
  const ctx: ValidationContext = {
    command,
    ast: ast ?? null,
    platform: process.platform,
    cwd: process.cwd(),
  };

  let askResult: ValidatorResult | null = null;

  for (const validator of VALIDATORS) {
    const result = validator(ctx);

    if (result.kind === 'deny') {
      return result;
    }

    if (result.kind === 'ask' && askResult === null) {
      askResult = result;
    }
  }

  if (askResult !== null) {
    return askResult;
  }

  return { kind: 'allow' as const };
}

/**
 * Quick check: is this command safe to run without confirmation?
 */
export function isCommandSafe(command: string, ast?: TsNode | null): boolean {
  const result = validateCommandSecurity(command, ast);
  return result.kind === 'allow';
}

/**
 * Quick check: should this command be denied entirely?
 */
export function isCommandDenied(command: string, ast?: TsNode | null): boolean {
  const result = validateCommandSecurity(command, ast);
  return result.kind === 'deny';
}

/**
 * Quick check: does this command need user confirmation?
 */
export function requiresConfirmation(command: string, ast?: TsNode | null): boolean {
  const result = validateCommandSecurity(command, ast);
  return result.kind === 'ask' || result.kind === 'deny';
}

/**
 * Create a default ValidationContext for quick usage.
 * Uses current process platform and cwd.
 */
export function createContext(command: string, ast?: TsNode | null): ValidationContext {
  return {
    command,
    ast: ast ?? null,
    platform: process.platform,
    cwd: process.cwd(),
  };
}
