/**
 * Git-specific security checks for bash command security.
 *
 * Check ID 12 — Git commands can embed shell metacharacters in
 * parameters like commit messages, branch names, and config values.
 *
 * These checks align with Claude Code's bashSecurity.ts design:
 * 12. Git commands with shell injection ($() in commit messages, etc.)
 */

import type { ValidationContext, ValidatorResult } from './bash-security-validator.js';

// ---------------------------------------------------------------------------
// Check 12: Git commands with shell injection
// ---------------------------------------------------------------------------

const GIT_INJECTION_PATTERNS = [
  // Command substitution in commit messages
  /\bgit\s+commit\b.*\$\(/,
  // Command substitution in git branch names
  /\bgit\s+(?:checkout|branch|switch)\b.*\$\(/,
  // Command substitution in tag names
  /\bgit\s+tag\b.*\$\(/,
  // Command substitution in git notes
  /\bgit\s+notes\b/,
  // Backticks in any git command argument
  /\bgit\b.*`[^`]+`/,
  // Git config with command execution via ! prefix
  /\bgit\s+config\b.*\!/,
  // Git with ext:: protocol (used in older CVEs)
  /\bgit\b.*ext::/,
  // Git with --output flag pointing to sensitive path
  /\bgit\b.*--output\s*=\s*(?:\/etc\/|\/proc\/|~\/\.)/,
  // Git hooks installation pointing to suspicious script
  /\bgit\b.*hooks\//,
  // Git worktree add with arbitrary path
  /\bgit\s+worktree\s+add\b/,
  // Git submodule add with command injection in URL
  /\bgit\s+submodule\s+add\b.*[`$]/,
  // Git clone with --config that injects via core.fsmonitor or similar
  /\bgit\s+clone\b.*--config\s+core\./,
  // Git stash with shell injection in message
  /\bgit\s+stash\b.*\$\(/,
];

const GIT_CONFIG_DANGEROUS_PATTERNS = [
  // core.gitProxy — arbitrary command executed for git protocol
  /\bgit\s+config\b.*core\.gitProxy\b/,
  // core.fsmonitor — path to script executed on filesystem changes
  /\bgit\s+config\b.*core\.fsmonitor\b/,
  // core.sshCommand — arbitrary command replaces SSH
  /\bgit\s+config\b.*core\.sshCommand\b/,
  // core.hooksPath — redirects hooks to arbitrary directory
  /\bgit\s+config\b.*core\.hooksPath\b/,
  // credential.helper — arbitrary credential helper command
  /\bgit\s+config\b.*credential\.helper\b.*!/,
  // difftool/mergetool with command injection
  /\bgit\s+config\b.*(?:diff|merge)tool\..*cmd\b/,
  // filter driver with arbitrary command
  /\bgit\s+config\b.*filter\..*\.(?:clean|smudge)\b/,
  // protocol.allow with always — allows any protocol including ext::
  /\bgit\s+config\b.*protocol\..*\.allow\b.*always/,
];

/**
 * Git commands can embed shell metacharacters in commit messages,
 * branch names, tag names, and config values. These can be executed
 * by git hooks, CI pipelines, or during interactive operations.
 *
 * Git config with the ! prefix (e.g., `git config alias.x '!cmd'`)
 * is particularly dangerous — it creates a git alias that runs
 * arbitrary shell commands.
 */
export function checkGitShellInjection(ctx: ValidationContext): ValidatorResult {
  // Only check commands that actually contain git
  if (!/\bgit\b/.test(ctx.command)) {
    return { kind: 'passthrough' };
  }

  for (const pattern of GIT_INJECTION_PATTERNS) {
    if (pattern.test(ctx.command)) {
      return {
        kind: 'deny',
        checkId: 12,
        message: 'Git command with shell injection detected. ' +
          'Commit messages, branch/tag names, or git config with ! prefix ' +
          'can execute arbitrary shell commands.',
      };
    }
  }

  for (const pattern of GIT_CONFIG_DANGEROUS_PATTERNS) {
    if (pattern.test(ctx.command)) {
      return {
        kind: 'deny',
        checkId: 12,
        message: 'Dangerous git config setting detected. ' +
          'Git config entries like core.gitProxy, core.fsmonitor, ' +
          'or credential.helper can be used for arbitrary command execution.',
      };
    }
  }

  return { kind: 'passthrough' };
}
