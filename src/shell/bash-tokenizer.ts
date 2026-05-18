/**
 * Pure TypeScript bash tokenizer — produces a flat token stream from a
 * shell command string. Handles quoting, escaping, operators, redirects,
 * heredocs, and command substitutions.
 *
 * No NAPI dependency. Runs entirely in V8.
 */

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

export type TokenType =
  | "WORD"
  | "ASSIGNMENT_WORD"
  | "PIPE" // |
  | "PIPE_AMP" // |&
  | "AND_IF" // &&
  | "OR_IF" // ||
  | "SEMI" // ;
  | "AMP" // & (background)
  | "REDIR_IN" // <
  | "REDIR_OUT" // >
  | "REDIR_OUT_APPEND" // >>
  | "REDIR_OUT_ERR" // 2>
  | "REDIR_OUT_BOTH" // &>
  | "LPAREN" // (
  | "RPAREN" // )
  | "DOLLAR_LPAREN" // $(
  | "DOLLAR_DOUBLE_LPAREN" // $((
  | "BACKTICK" // `
  | "STRING_SINGLE" // '...'
  | "STRING_DOUBLE" // "..."
  | "HEREDOC_OP" // << or <<-
  | "HEREDOC_DELIM" // WORD after <<
  | "NEWLINE" // \n
  | "EOF";

export interface Token {
  type: TokenType;
  text: string;
  startIndex: number;
  endIndex: number; // exclusive
}

// ---------------------------------------------------------------------------
// AST node types & result (exported from here for parser use)
// ---------------------------------------------------------------------------

export type NodeType =
  | "program"
  | "pipeline"
  | "command"
  | "word"
  | "file_redirect"
  | "string"
  | "raw_string"
  | "concatenation"
  | "simple_expansion"
  | "command_substitution"
  | "subshell"
  | "heredoc_start"
  | "heredoc_body"
  | "heredoc_end"
  | "list"
  | "arithmetic_expansion";

export interface AstNode {
  type: NodeType;
  text: string;
  startIndex: number;
  endIndex: number;
  children: AstNode[];
}

export interface ParseResult {
  ast: AstNode | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Budget constants (shared with parser)
// ---------------------------------------------------------------------------

export const MAX_NODES = 50_000;
export const PARSE_TIMEOUT_MS = 50;
export const MAX_NESTING_DEPTH = 32;

export class BudgetExceeded extends Error {
  constructor(reason: string) {
    super(`too-complex: ${reason}`);
    this.name = "BudgetExceeded";
  }
}

// ---------------------------------------------------------------------------
// Character classifiers
// ---------------------------------------------------------------------------

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isMetachar(ch: string): boolean {
  return "|&;()<> \t\n'\"`$\\{}!".includes(ch);
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize a shell command string into a flat list of tokens.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    // Whitespace
    if (isWhitespace(ch)) {
      i++;
      continue;
    }

    // Newline
    if (ch === "\n") {
      tokens.push({ type: "NEWLINE", text: "\n", startIndex: i, endIndex: i + 1 });
      i++;
      continue;
    }

    // Comment — skip to end of line
    if (ch === "#") {
      while (i < len && input[i] !== "\n") i++;
      continue;
    }

    // Backslash + newline = line continuation
    if (ch === "\\" && i + 1 < len && input[i + 1] === "\n") {
      i += 2;
      continue;
    }

    // Pipe variants
    if (ch === "|") {
      if (i + 1 < len && input[i + 1] === "&") {
        tokens.push({ type: "PIPE_AMP", text: "|&", startIndex: i, endIndex: i + 2 });
        i += 2;
      } else if (i + 1 < len && input[i + 1] === "|") {
        tokens.push({ type: "OR_IF", text: "||", startIndex: i, endIndex: i + 2 });
        i += 2;
      } else {
        tokens.push({ type: "PIPE", text: "|", startIndex: i, endIndex: i + 1 });
        i++;
      }
      continue;
    }

    // Ampersand variants
    if (ch === "&") {
      if (i + 1 < len && input[i + 1] === "&") {
        tokens.push({ type: "AND_IF", text: "&&", startIndex: i, endIndex: i + 2 });
        i += 2;
      } else if (i + 1 < len && input[i + 1] === ">") {
        tokens.push({ type: "REDIR_OUT_BOTH", text: "&>", startIndex: i, endIndex: i + 2 });
        i += 2;
      } else {
        tokens.push({ type: "AMP", text: "&", startIndex: i, endIndex: i + 1 });
        i++;
      }
      continue;
    }

    // Semicolon
    if (ch === ";") {
      tokens.push({ type: "SEMI", text: ";", startIndex: i, endIndex: i + 1 });
      i++;
      continue;
    }

    // Redirect out / append
    if (ch === ">" && i + 1 < len && input[i + 1] === ">") {
      tokens.push({ type: "REDIR_OUT_APPEND", text: ">>", startIndex: i, endIndex: i + 2 });
      i += 2;
      continue;
    }
    if (ch === ">") {
      tokens.push({ type: "REDIR_OUT", text: ">", startIndex: i, endIndex: i + 1 });
      i++;
      continue;
    }

    // Redirect in / heredoc
    if (ch === "<") {
      if (i + 1 < len && input[i + 1] === "<") {
        // Heredoc — consume <<[-] then the delimiter word
        const heredocStart = i;
        i += 2;
        if (i < len && input[i] === "-") i++;
        while (i < len && isWhitespace(input[i])) i++;
        const delimStart = i;
        while (i < len && !isMetachar(input[i])) i++;
        const delimEnd = i;
        if (delimEnd > delimStart) {
          tokens.push({
            type: "HEREDOC_OP",
            text: input.slice(heredocStart, delimStart),
            startIndex: heredocStart,
            endIndex: delimStart,
          });
          tokens.push({
            type: "HEREDOC_DELIM",
            text: input.slice(delimStart, delimEnd),
            startIndex: delimStart,
            endIndex: delimEnd,
          });
          // Consume heredoc body until delimiter on its own line
          const delim = input.slice(delimStart, delimEnd);
          while (i < len) {
            if (input[i] === "\n") {
              i++;
              let j = i;
              while (j < len && input[j] === "\t") j++;
              if (input.slice(j).startsWith(delim)) {
                const after = j + delim.length;
                if (after >= len || input[after] === "\n") {
                  i = after;
                  break;
                }
              }
            } else {
              i++;
            }
          }
        }
        continue;
      }
      tokens.push({ type: "REDIR_IN", text: "<", startIndex: i, endIndex: i + 1 });
      i++;
      continue;
    }

    // Digit + > (e.g. 2>)
    if (isDigit(ch)) {
      const digitStart = i;
      while (i < len && isDigit(input[i])) i++;
      if (i < len && input[i] === ">") {
        tokens.push({
          type: "REDIR_OUT_ERR",
          text: input.slice(digitStart, i + 1),
          startIndex: digitStart,
          endIndex: i + 1,
        });
        i++;
        continue;
      }
      i = digitStart;
    }

    // Parentheses
    if (ch === "(") {
      tokens.push({ type: "LPAREN", text: "(", startIndex: i, endIndex: i + 1 });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "RPAREN", text: ")", startIndex: i, endIndex: i + 1 });
      i++;
      continue;
    }

    // Dollar variants: $(), $(()), ${VAR}
    if (ch === "$") {
      if (i + 1 < len && input[i + 1] === "(") {
        if (i + 2 < len && input[i + 2] === "(") {
          tokens.push({
            type: "DOLLAR_DOUBLE_LPAREN",
            text: "$((",
            startIndex: i,
            endIndex: i + 3,
          });
          i += 3;
        } else {
          tokens.push({
            type: "DOLLAR_LPAREN",
            text: "$(",
            startIndex: i,
            endIndex: i + 2,
          });
          i += 2;
        }
        continue;
      }
      if (i + 1 < len && input[i + 1] === "{") {
        const start = i;
        i += 2;
        let braceDepth = 1;
        while (i < len && braceDepth > 0) {
          if (input[i] === "{") braceDepth++;
          else if (input[i] === "}") braceDepth--;
          i++;
        }
        tokens.push({ type: "WORD", text: input.slice(start, i), startIndex: start, endIndex: i });
        continue;
      }
    }

    // Backtick
    if (ch === "`") {
      tokens.push({ type: "BACKTICK", text: "`", startIndex: i, endIndex: i + 1 });
      i++;
      continue;
    }

    // Single-quoted string
    if (ch === "'") {
      const start = i;
      i++;
      while (i < len) {
        if (input[i] === "'") { i++; break; }
        if (input[i] === "\\" && i + 1 < len) i++;
        i++;
      }
      tokens.push({
        type: "STRING_SINGLE",
        text: input.slice(start, i),
        startIndex: start,
        endIndex: i,
      });
      continue;
    }

    // Double-quoted string
    if (ch === '"') {
      const start = i;
      i++;
      while (i < len) {
        if (input[i] === '"') { i++; break; }
        if (input[i] === "\\" && i + 1 < len) i += 2;
        else i++;
      }
      tokens.push({
        type: "STRING_DOUBLE",
        text: input.slice(start, i),
        startIndex: start,
        endIndex: i,
      });
      continue;
    }

    // Catch-all: WORD
    {
      const start = i;
      while (i < len && !isWhitespace(input[i]) && !isMetachar(input[i])) {
        if (input[i] === "\\" && i + 1 < len) i += 2;
        else i++;
      }
      if (i > start) {
        const text = input.slice(start, i);
        const eqIdx = text.indexOf("=");
        const type: TokenType =
          eqIdx > 0 && !text.slice(0, eqIdx).includes(" ") ? "ASSIGNMENT_WORD" : "WORD";
        tokens.push({ type, text, startIndex: start, endIndex: i });
      }
      continue;
    }
  }

  tokens.push({ type: "EOF", text: "", startIndex: len, endIndex: len });
  return tokens;
}
