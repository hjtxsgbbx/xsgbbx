/**
 * Command structure validation for bash command security.
 *
 * Check IDs 1, 7-10 — validates that commands are well-formed, complete,
 * and do not have structural issues that could mask malicious intent.
 *
 * These checks align with Claude Code's bashSecurity.ts design:
 *  1. Empty or whitespace-only commands
 *  7. Incomplete pipe chains (trailing |)
 *  8. Incomplete boolean chains (trailing && or ||)
 *  9. Heredoc without closing delimiter
 * 10. Unmatched quotes or parentheses
 */

import type { TsNode } from '../../utils/bash/bash-tokenizer.js';
import type { ValidationContext, ValidatorResult } from './bash-security-validator.js';

// ---------------------------------------------------------------------------
// Check 1: Empty or whitespace-only commands
// ---------------------------------------------------------------------------

/**
 * Rejects empty or whitespace-only commands. These produce no effect but
 * may indicate an injection attempt that was truncated or a bug.
 */
export function checkEmptyCommand(ctx: ValidationContext): ValidatorResult {
  if (ctx.command.trim().length === 0) {
    return {
      kind: 'deny',
      checkId: 1,
      message: 'Empty or whitespace-only command.',
    };
  }
  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// Check 7: Incomplete pipe chains (trailing |)
// ---------------------------------------------------------------------------

/**
 * A trailing pipe operator indicates an incomplete command. bash's behavior
 * varies across versions (some wait for input, others error). Regardless,
 * it's suspicious and could mask a truncated injection.
 *
 * Examples:
 *   "ls |"              — dangling pipe
 *   "ls | grep foo |"   — trailing pipe after valid pipeline
 *   "cat file.txt|"     — trailing pipe without space
 */
export function checkIncompletePipe(ctx: ValidationContext): ValidatorResult {
  const trimmed = ctx.command.trimEnd();

  // Check for trailing pipe characters (including |&)
  if (/[|]$/.test(trimmed) || /\|[ \t]*$/.test(trimmed)) {
    return {
      kind: 'deny',
      checkId: 7,
      message: 'Incomplete pipe chain: trailing pipe operator. ' +
        'This suggests a truncated or malformed command.',
    };
  }

  // AST-based check: pipeline with no command after |
  if (ctx.ast) {
    const pipelineNodes = collectNodesOfType(ctx.ast, 'pipeline');
    for (const node of pipelineNodes) {
      const lastChild = node.children[node.children.length - 1];
      if (lastChild && lastChild.type === '|') {
        return {
          kind: 'deny',
          checkId: 7,
          message: 'Incomplete pipe chain detected in AST: no command after pipe.',
        };
      }
    }
  }

  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// Check 8: Incomplete boolean chains (trailing && or ||)
// ---------------------------------------------------------------------------

/**
 * A trailing && or || operator is malformed. bash may wait for input
 * (in interactive mode) or error. Either way, it is suspicious.
 *
 * Examples:
 *   "make build &&"     — dangling &&, what follows?
 *   "test ||"           — dangling ||, missing fallback
 */
export function checkIncompleteBoolean(ctx: ValidationContext): ValidatorResult {
  const trimmed = ctx.command.trimEnd();

  if (/(&&|\|\|)[ \t]*$/.test(trimmed)) {
    return {
      kind: 'deny',
      checkId: 8,
      message: 'Incomplete boolean chain: trailing && or || operator. ' +
        'This suggests a truncated command.',
    };
  }

  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// Check 9: Heredoc without closing delimiter
// ---------------------------------------------------------------------------

/**
 * A heredoc (<<DELIM ... DELIM) without a proper closing delimiter is
 * malformed and can cause the shell to read arbitrary stdin indefinitely,
 * or mask content that bash would pass to the command.
 *
 * Checks for:
 * - << operator without a delimiter word following it
 * - <<DELIM at end of string with no matching closing delimiter
 */
export function checkIncompleteHeredoc(ctx: ValidationContext): ValidatorResult {
  // Look for << operator
  const heredocStartRe = /<<-?\s*(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = heredocStartRe.exec(ctx.command)) !== null) {
    const delimiter = match[1];

    if (!delimiter) {
      return {
        kind: 'deny',
        checkId: 9,
        message: 'Incomplete heredoc: missing delimiter after << operator.',
      };
    }

    // Skip escaped delimiters (e.g., <<'EOF') — strip quotes
    const cleanDelim = delimiter.replace(/^['"]/, '').replace(/['"]$/, '');

    // Check if the delimiter appears on its own line after the heredoc start
    const afterHeredoc = ctx.command.slice(match.index + match[0].length);

    // Build a regex for the closing delimiter on its own line (with optional indent for <<-)
    const delimPattern = new RegExp(
      `(?:^|\\n)[ \\t]*${escapeRegex(cleanDelim)}(?:\\s|;|\\n|$)`,
      'm'
    );

    if (!delimPattern.test(afterHeredoc)) {
      return {
        kind: 'deny',
        checkId: 9,
        message: `Incomplete heredoc: no closing delimiter "${cleanDelim}" found. ` +
          'The shell would consume arbitrary stdin.',
      };
    }
  }

  // AST-based check
  if (ctx.ast) {
    const heredocNodes = collectNodesOfType(ctx.ast, 'heredoc_redirect');

    // Check that heredoc bodies are present
    for (const node of heredocNodes) {
      const body = node.children.find(c => c.type === 'heredoc_body');
      if (!body || body.text.length === 0) {
        return {
          kind: 'deny',
          checkId: 9,
          message: 'Incomplete heredoc detected in AST: missing heredoc body.',
        };
      }
    }
  }

  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// Check 10: Unmatched quotes or parentheses
// ---------------------------------------------------------------------------

/**
 * Unmatched quotes or parentheses produce syntax errors in bash, but can
 * also be exploited:
 * - Unmatched quotes can consume subsequent lines as literal text
 * - Unmatched parentheses can mask commands as subshell content
 * - These are classic injection primitives (e.g., SQL-style comment injection)
 *
 * Also checks unmatched:
 * - Curly braces { } (brace group)
 * - Backticks ` `
 */
export function checkUnmatchedDelimiters(ctx: ValidationContext): ValidatorResult {
  const issues: string[] = [];

  // Quote balance: walk the string and detect if we end inside a quote
  const quoteResult = checkQuoteBalance(ctx.command);
  if (quoteResult.endsInSingleQuote) {
    issues.push('unmatched single quotes');
  }
  if (quoteResult.endsInDoubleQuote) {
    issues.push('unmatched double quotes');
  }

  // Parentheses balance (outside of single/double quotes, ignoring ${...})
  const parenBalance = countParenBalance(ctx.command);
  if (parenBalance !== 0) {
    issues.push('unmatched parentheses');
  }

  // Backtick balance
  const backtickBalance = countBacktickBalance(ctx.command);
  if (backtickBalance !== 0) {
    issues.push('unmatched backticks');
  }

  // Curly brace balance (excluding ${} expansions)
  const braceBalance = countUnescapedBraceBalance(ctx.command);
  if (braceBalance !== 0) {
    issues.push('unmatched curly braces');
  }

  if (issues.length > 0) {
    return {
      kind: 'deny',
      checkId: 10,
      message: `Unmatched delimiters: ${issues.join(', ')}. ` +
        'Unmatched quotes or parentheses can mask injected commands or cause unexpected shell behavior.',
    };
  }

  return { kind: 'passthrough' };
}

/**
 * Check if we end inside a single or double quote.
 * Walks the string tracking quote state (with backslash handling).
 */
function checkQuoteBalance(str: string): { endsInSingleQuote: boolean; endsInDoubleQuote: boolean } {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < str.length; i++) {
    const c = str[i]!;

    // Backslash escapes next character
    if (c === '\\' && i + 1 < str.length) {
      i++;
      continue;
    }

    // Single quote toggles state (unless inside double quotes)
    if (c === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    // Double quote toggles state (unless inside single quotes)
    if (c === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
  }

  return { endsInSingleQuote: inSingleQuote, endsInDoubleQuote: inDoubleQuote };
}

/**
 * Count parenthesis balance ignoring parens inside quotes and ${...}.
 */
function countParenBalance(str: string): number {
  let balance = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < str.length; i++) {
    const c = str[i]!;

    if (c === '\\' && i + 1 < str.length) {
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

    if (inSingleQuote || inDoubleQuote) continue;

    // Skip ${ } (parameter expansion)
    if (c === '$' && i + 1 < str.length && str[i + 1] === '{') {
      i += 2;
      let depth = 1;
      while (i < str.length && depth > 0) {
        if (str[i] === '{') depth++;
        else if (str[i] === '}') depth--;
        if (depth > 0) i++;
      }
      continue;
    }

    if (c === '(') {
      balance++;
    } else if (c === ')') {
      balance--;
    }
  }

  return balance;
}

/**
 * Count backtick balance ignoring those inside single quotes.
 */
function countBacktickBalance(str: string): number {
  let balance = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < str.length; i++) {
    const c = str[i]!;

    if (c === '\\' && i + 1 < str.length) {
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

    if (c === '`') {
      balance = balance === 0 ? 1 : 0;
    }
  }

  return balance;
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

/**
 * Collect all nodes in the tree matching the given type, recursively.
 */
function collectNodesOfType(node: TsNode, typeName: string): TsNode[] {
  const result: TsNode[] = [];

  function walk(current: TsNode): void {
    if (current.type === typeName) {
      result.push(current);
    }
    for (const child of current.children) {
      walk(child);
    }
  }

  walk(node);
  return result;
}

/**
 * Count brace balance excluding ${...} expansion braces.
 * Positive = more { than }, negative = more } than {.
 */
function countUnescapedBraceBalance(str: string): number {
  let balance = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < str.length; i++) {
    const c = str[i]!;

    if (c === '\\' && i + 1 < str.length) {
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

    if (inSingleQuote || inDoubleQuote) continue;

    // Skip ${ } (parameter expansion)
    if (c === '$' && i + 1 < str.length && str[i + 1] === '{') {
      i += 2;
      let depth = 1;
      while (i < str.length && depth > 0) {
        if (str[i] === '{') depth++;
        else if (str[i] === '}') depth--;
        if (depth > 0) i++;
      }
      continue;
    }

    if (c === '{') {
      balance++;
    } else if (c === '}') {
      balance--;
    }
  }

  return balance;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
