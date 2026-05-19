/**
 * jq-specific security checks for bash command security.
 *
 * Check IDs 2-3 — jq is a powerful JSON processor with features that can
 * be abused for command execution or arbitrary file reading.
 *
 * These checks align with Claude Code's bashSecurity.ts design:
 *  2. jq with system() function call
 *  3. jq with file argument bypass
 */

import type { ValidationContext, ValidatorResult } from './bash-security-validator.js';

// ---------------------------------------------------------------------------
// Check 2: jq with system() function call
// ---------------------------------------------------------------------------

const JQ_SYSTEM_PATTERNS = [
  // jq with explicit env.system() or system() calls
  /\bjq\b.*\b(system|env\.stdout|env\.stderr)\s*\(/,
  // jq -n (null input) with system() — no stdin needed
  /\bjq\s+-n\b.*\bsystem\s*\(/,
  // jq -R (raw string input) with system()
  /\bjq\s+-R\b.*\bsystem\s*\(/,
  // jq --rawfile or --argfile (read arbitrary files)
  /\bjq\b.*--(?:rawfile|argfile|slurpfile)\s/,
];

/**
 * jq 1.6+ includes a `system()` function that executes shell commands
 * and returns stdout. This is equivalent to eval() — any jq filter
 * containing system("cmd") will run that command.
 *
 * Note: system() requires the -n or -R flag (null input or raw string)
 * to work without an existing JSON input stream. Commands without -n/-R
 * that still include system() are suspicious but may just be filter text.
 */
export function checkJqSystemCall(ctx: ValidationContext): ValidatorResult {
  for (const pattern of JQ_SYSTEM_PATTERNS) {
    if (pattern.test(ctx.command)) {
      return {
        kind: 'deny',
        checkId: 2,
        message: 'jq with system() call or file-reading flag detected. ' +
          'jq\'s system() function executes arbitrary shell commands. ' +
          '--rawfile/--argfile can read arbitrary files.',
      };
    }
  }

  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// Check 3: jq with file argument bypass
// ---------------------------------------------------------------------------

const JQ_FILE_BYPASS_PATTERNS = [
  // Using input() to read file contents — can access any readable file
  /\bjq\b.*(?:'|\b)input\b/,
  // Using $ENV to access environment variables (credential leakage)
  /\bjq\b.*\$ENV\[/,
  // Using env object
  /\bjq\b.*\benv\b/,
  // Using --from-file to load filter from file (less common, but exists)
  /\bjq\s+(-f|--from-file)\s+\/(etc|proc|tmp|dev)\//,
  // jq with explicit exit status manipulation affecting shell
  /\bjq\s+-e\b/,
];

/**
 * jq's input() function reads files from the filesystem, which can be
 * used to extract secrets. $ENV access exposes environment variables.
 *
 * The -f flag loads the jq filter from a file — if the path is
 * user-controlled or points to a sensitive location, it's dangerous.
 */
export function checkJqFileBypass(ctx: ValidationContext): ValidatorResult {
  for (const pattern of JQ_FILE_BYPASS_PATTERNS) {
    const match = pattern.exec(ctx.command);
    if (match) {
      return {
        kind: 'ask',
        checkId: 3,
        message: `jq with file/environment access: ${match[0]}. ` +
          'jq can read files via input() or access environment variables via $ENV.',
      };
    }
  }

  return { kind: 'passthrough' };
}
