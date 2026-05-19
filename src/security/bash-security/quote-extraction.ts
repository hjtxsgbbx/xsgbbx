/**
 * Quote-aware extraction utilities for bash command security analysis.
 *
 * These pure functions extract safely-quoted regions, strip harmless
 * redirects, and check for unescaped metacharacters. They are used by
 * the security validators to avoid false positives from safely-quoted
 * or redirected content.
 */

/**
 * Extracts the content of safely-quoted regions (single-quoted and
 * double-quoted) from a command string.
 *
 * Single-quoted content is always safe (no expansion possible in bash).
 * Double-quoted regions allow $VAR and $(cmd) expansion, but prevent
 * word-splitting and globbing.
 *
 * Returns an array of quoted content strings (without quotes).
 */
export function extractQuotedContent(cmd: string): string[] {
  const results: string[] = [];
  let i = 0;

  while (i < cmd.length) {
    // Check for backslash escape
    if (cmd[i] === '\\' && i + 1 < cmd.length) {
      i += 2;
      continue;
    }

    if (cmd[i] === "'") {
      // Single-quoted: no expansion, everything literal until closing '
      const start = i + 1;
      i++;
      while (i < cmd.length && cmd[i] !== "'") {
        i++;
      }
      if (i < cmd.length) {
        results.push(cmd.slice(start, i));
        i++;
      } else {
        results.push(cmd.slice(start));
      }
    } else if (cmd[i] === '"') {
      // Double-quoted: $ and ` still expand, but word-splitting is disabled
      const start = i + 1;
      i++;
      while (i < cmd.length) {
        if (cmd[i] === '\\' && i + 1 < cmd.length) {
          // Inside double quotes, backslash only escapes: $ ` " \ newline
          const next = cmd[i + 1];
          if (next === '$' || next === '`' || next === '"' || next === '\\' || next === '\n') {
            i += 2;
          } else {
            i++;
          }
        } else if (cmd[i] === '"') {
          break;
        } else {
          i++;
        }
      }
      if (i < cmd.length) {
        results.push(cmd.slice(start, i));
        i++;
      } else {
        results.push(cmd.slice(start));
      }
    } else {
      i++;
    }
  }

  return results;
}

/**
 * Strip safe (non-dangerous) file redirects from a command string.
 *
 * "Safe" redirects write to regular files in user-space directories
 * (current directory, /tmp, /home), not to system paths or devices.
 * This reduces false positives when commands like `echo foo > ./bar`
 * are checked for dangerous redirects.
 *
 * Returns the command string with safe redirects replaced by spaces.
 */
export function stripSafeRedirections(cmd: string): string {
  // Match output redirects (>, >>, &>, &>>) to non-sensitive paths
  // Keep the command but blank out safe redirects
  const safeRedirectRe =
    /[12&]?>>?\s*(\.\/|~\/|[a-zA-Z0-9_\-.]+\/|[a-zA-Z0-9_\-.]+\.[a-z]{1,10})(\S*)/g;

  return cmd.replace(safeRedirectRe, (match, _prefix, _path) => {
    // Check if this path contains sensitive patterns
    const sensitivePatterns = [
      /\/(etc|proc|sys|dev|boot)(\/|$)/,
      /\.ssh\//,
      /\.gnupg\//,
      /\.aws\//,
      /\.kube\//,
      /\.env$/,
      /credentials/,
      /\.gitconfig$/,
    ];

    for (const pattern of sensitivePatterns) {
      if (pattern.test(match)) {
        // Keep sensitive redirects in the command
        return match;
      }
    }

    // Replace safe redirect with spaces to preserve string length
    return ' '.repeat(match.length);
  });
}

/**
 * Check if a character appears unescaped in a command string.
 *
 * An "unescaped" character is one not preceded by a backslash and
 * not inside single-quotes or escaped double-quotes. This is critical
 * for detecting shell metacharacters that bash would actually interpret.
 *
 * @param cmd - The full command string
 * @param char - The single character to search for
 * @returns true if the character appears unescaped anywhere in the string
 */
export function hasUnescapedChar(cmd: string, char: string): boolean {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;

    // Handle backslash escape (always skips next char)
    if (c === '\\' && i + 1 < cmd.length) {
      i++;
      continue;
    }

    // Track quote state
    if (c === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (c === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    // Skip characters inside quotes
    if (inSingleQuote) continue;

    if (c === char) {
      return true;
    }
  }

  return false;
}

/**
 * Check if multiple characters appear unescaped in a command string.
 * More efficient than calling hasUnescapedChar multiple times.
 *
 * @param cmd - The full command string
 * @param chars - Set of characters to search for
 * @returns Set of characters that appear unescaped
 */
export function findUnescapedChars(cmd: string, chars: ReadonlySet<string>): Set<string> {
  const found = new Set<string>();
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;

    if (c === '\\' && i + 1 < cmd.length) {
      i++;
      continue;
    }

    if (c === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (c === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote) continue;

    if (chars.has(c)) {
      found.add(c);
    }
  }

  return found;
}

/**
 * Returns true if the string contains only safely-quoted (single-quoted)
 * metacharacters — i.e., all dangerous chars are inside single quotes.
 *
 * Used to skip certain checks when a command's dangerous chars are
 * all safely quoted.
 */
export function isSafelyQuoted(cmd: string): boolean {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let hasDangerOutside = false;

  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;

    if (c === '\\' && i + 1 < cmd.length) {
      i++;
      continue;
    }

    if (c === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (c === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote && (c === '$' || c === '`' || c === ';' || c === '|' || c === '&')) {
      hasDangerOutside = true;
    }
  }

  return !hasDangerOutside;
}
