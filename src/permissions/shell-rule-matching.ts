/**
 * Shell Rule Matching — glob-style wildcard pattern matching and rule
 * lookup for shell commands.
 *
 * Provides pattern-to-command matching used by the permission pipeline
 * to match deny/ask/allow rules against raw command strings.
 *
 * All functions are pure: inputs are readonly and outputs are new objects.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShellCommandRule {
  readonly pattern: string;
  readonly action: string;
}

// ---------------------------------------------------------------------------
// Wildcard (glob) pattern matching
// ---------------------------------------------------------------------------

/**
 * Match a command string against a glob-style wildcard pattern.
 *
 * Supported wildcards:
 * - `*` matches zero or more of any character (non-greedy within segments)
 * - `?` matches exactly one character
 * - `**` matches zero or more path segments (not used for commands,
 *   but supported for path-based rules)
 *
 * The pattern is automatically anchored: ^ at the start, $ at the end.
 *
 * Examples:
 *   matchWildcardPattern("git *", "git push")           → true
 *   matchWildcardPattern("sudo *", "sudo apt-get")      → true
 *   matchWildcardPattern("rm -rf /*", "rm -rf /etc")    → true
 *   matchWildcardPattern("git *", "npm test")           → false
 *
 * @param pattern - Glob-style pattern (with * and ? wildcards)
 * @param command - The command string to match against
 * @returns true if the command matches the pattern
 */
export function matchWildcardPattern(pattern: string, command: string): boolean {
  if (pattern.length === 0 && command.length === 0) {
    return true;
  }

  // Anchor: pattern must match from start to end
  const regex = globToRegex(pattern);
  return regex.test(command);
}

/**
 * Convert a glob-style pattern to a RegExp.
 * Handles: * → .*, ? → ., ** → .* (same as * for simple command matching)
 */
function globToRegex(pattern: string): RegExp {
  let regexStr = '^';

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;

    switch (ch) {
      case '*': {
        // ** is treated the same as * for shell command patterns
        if (i + 1 < pattern.length && pattern[i + 1] === '*') {
          i++; // skip second *
        }
        regexStr += '.*';
        break;
      }
      case '?':
        regexStr += '.';
        break;
      // Escape regex metacharacters
      case '.':
      case '+':
      case '^':
      case '$':
      case '{':
      case '}':
      case '(':
      case ')':
      case '|':
      case '[':
      case ']':
      case '\\':
        regexStr += '\\' + ch;
        break;
      default:
        regexStr += ch;
        break;
    }
  }

  regexStr += '$';
  return new RegExp(regexStr, 'i');
}

// ---------------------------------------------------------------------------
// Command prefix extraction
// ---------------------------------------------------------------------------

/**
 * Extract the base command (first token) from a command string,
 * before any flags, arguments, operators, or subcommands.
 *
 * Handles:
 * - Simple commands: "git push" → "git"
 * - Qualified paths: "/usr/bin/git" → "git" (basename only)
 * - Windows paths: "C:\\Program Files\\Git\\bin\\git.exe" → "git"
 * - Commands with env vars: "FOO=bar cmd" → "cmd"
 *
 * @param command - The raw command string
 * @returns The base command name (lowercased), or empty string if unparseable
 */
export function extractCommandPrefix(command: string): string {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return '';
  }

  // Strip leading environment variable assignments (VAR=value cmd)
  let working = trimmed;
  const envVarRe = /^[A-Za-z_][A-Za-z0-9_]*=/;
  while (envVarRe.test(working)) {
    const spaceIdx = working.indexOf(' ');
    if (spaceIdx === -1) {
      return ''; // only env vars, no actual command
    }
    working = working.slice(spaceIdx + 1).trimStart();
  }

  // Extract first whitespace-delimited token
  const firstSpace = working.search(/\s/);
  const rawCmd = firstSpace === -1 ? working : working.slice(0, firstSpace);

  if (rawCmd.length === 0) {
    return '';
  }

  // Extract basename from path
  const lastSlash = Math.max(rawCmd.lastIndexOf('/'), rawCmd.lastIndexOf('\\'));
  const basename = lastSlash >= 0 ? rawCmd.slice(lastSlash + 1) : rawCmd;

  // Strip file extensions
  const stripped = basename.replace(/\.(exe|bat|cmd|ps1|sh|bash|zsh|ksh)$/i, '');

  return stripped.toLowerCase();
}

// ---------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------

/**
 * Find the first matching rule from a list of shell command rules.
 *
 * Rules are tested in order. The first rule whose pattern matches the
 * command wins. This allows rules to be ordered by priority.
 *
 * @param command - The command string to match
 * @param rules - Array of rules with glob-style patterns
 * @returns The first matching rule, or null if no rule matches
 */
export function findMatchingRule(
  command: string,
  rules: ReadonlyArray<ShellCommandRule>,
): ShellCommandRule | null {
  for (const rule of rules) {
    if (matchWildcardPattern(rule.pattern, command)) {
      return rule;
    }
  }
  return null;
}

/**
 * Find ALL matching rules from a list of shell command rules.
 * Unlike findMatchingRule, this does not stop at the first match.
 *
 * Use this for auditing or debugging to see which rules would match.
 *
 * @param command - The command string to match
 * @param rules - Array of rules with glob-style patterns
 * @returns All matching rules, in order of first match
 */
export function findAllMatchingRules(
  command: string,
  rules: ReadonlyArray<ShellCommandRule>,
): ShellCommandRule[] {
  const matches: ShellCommandRule[] = [];
  for (const rule of rules) {
    if (matchWildcardPattern(rule.pattern, command)) {
      matches.push(rule);
    }
  }
  return matches;
}
