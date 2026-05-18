/**
 * Pure TypeScript recursive-descent bash parser.
 *
 * Builds a tree-sitter-compatible AST from a tokenized shell command.
 * Runs WITHOUT native NAPI. Budgeted: 50ms timeout, 50K node limit,
 * 32 nesting depth.
 *
 * Falls back to 'too-complex' error rather than producing a wrong AST.
 */

import {
  tokenize,
  BudgetExceeded,
  MAX_NODES,
  PARSE_TIMEOUT_MS,
  MAX_NESTING_DEPTH,
  type Token,
  type TokenType,
  type NodeType,
  type AstNode,
  type ParseResult,
} from "./bash-tokenizer.js";

// Re-export types for consumers
export type { NodeType, AstNode, ParseResult, Token, TokenType } from "./bash-tokenizer.js";
export { tokenize } from "./bash-tokenizer.js";

// ---------------------------------------------------------------------------
// Recursive-descent parser
// ---------------------------------------------------------------------------

export class BashParser {
  private tokens: Token[] = [];
  private pos = 0;
  private nodeCount = 0;
  private startTime = 0;
  private depth = 0;

  constructor(private readonly input: string) {}

  // ---- public API ----

  parse(): ParseResult {
    this.startTime = Date.now();
    this.tokens = tokenize(this.input);
    this.pos = 0;
    this.nodeCount = 0;
    this.depth = 0;

    try {
      const ast = this.parseProgram();
      if (this.nodeCount > MAX_NODES) {
        return { ast: null, error: "too-complex: exceeded node budget" };
      }
      return { ast, error: null };
    } catch (e: unknown) {
      if (e instanceof BudgetExceeded) {
        return { ast: null, error: e.message };
      }
      const msg = e instanceof Error ? e.message : String(e);
      return { ast: null, error: `too-complex: ${msg}` };
    }
  }

  // ---- budget helpers ----

  private checkBudget(): void {
    this.nodeCount++;
    if (this.nodeCount > MAX_NODES) {
      throw new BudgetExceeded("exceeded node budget");
    }
    if (Date.now() - this.startTime > PARSE_TIMEOUT_MS) {
      throw new BudgetExceeded("parse timeout");
    }
  }

  private enter(): void {
    this.depth++;
    if (this.depth > MAX_NESTING_DEPTH) {
      throw new BudgetExceeded("max nesting depth exceeded");
    }
  }

  private leave(): void {
    this.depth--;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1];
  }

  private advance(): Token {
    const tok = this.peek();
    if (tok.type !== "EOF") this.pos++;
    return tok;
  }

  private isListOp(type: TokenType): boolean {
    return (
      type === "AND_IF" ||
      type === "OR_IF" ||
      type === "SEMI" ||
      type === "AMP" ||
      type === "NEWLINE"
    );
  }

  private makeNode(
    type: NodeType,
    text: string,
    start: number,
    end: number,
    children: AstNode[] = [],
  ): AstNode {
    this.checkBudget();
    return { type, text, startIndex: start, endIndex: end, children };
  }

  // ---- grammar methods ----

  private parseProgram(): AstNode {
    this.enter();
    const start = this.peek().startIndex;
    const children = this.parseList();
    const end = children.length > 0 ? children[children.length - 1].endIndex : start;
    this.leave();
    return this.makeNode("program", this.input.slice(start, end), start, end, children);
  }

  private parseList(): AstNode[] {
    const items: AstNode[] = [];
    items.push(this.parsePipeline());

    while (this.isListOp(this.peek().type)) {
      const opTok = this.advance();
      if (this.peek().type === "EOF") break;
      const next = this.parsePipeline();
      const listOpMap: Record<string, string> = {
        AND_IF: "&&", OR_IF: "||", SEMI: ";", AMP: "&", NEWLINE: "\n",
      };
      const op = listOpMap[opTok.type] ?? opTok.text;
      items.push(
        this.makeNode("list", op, opTok.startIndex, next.endIndex, [items.pop()!, next]),
      );
    }
    return items;
  }

  private parsePipeline(): AstNode {
    this.enter();
    const start = this.peek().startIndex;
    const commands: AstNode[] = [this.parseCommand()];

    while (this.peek().type === "PIPE" || this.peek().type === "PIPE_AMP") {
      this.advance();
      commands.push(this.parseCommand());
    }

    const end = commands[commands.length - 1].endIndex;
    this.leave();

    if (commands.length === 1) return commands[0];

    return this.makeNode(
      "pipeline",
      this.input.slice(start, end),
      start,
      end,
      commands,
    );
  }

  private parseCommand(): AstNode {
    this.enter();
    const children: AstNode[] = [];
    const start = this.peek().startIndex;

    while (true) {
      const tok = this.peek();

      switch (tok.type) {
        // ---- words and strings ----
        case "WORD":
        case "ASSIGNMENT_WORD":
        case "STRING_SINGLE":
        case "STRING_DOUBLE": {
          const t = this.advance();
          const nodeType: NodeType =
            t.type === "STRING_SINGLE" || t.type === "STRING_DOUBLE" ? "string" : "word";
          children.push(this.makeNode(nodeType, t.text, t.startIndex, t.endIndex, []));
          break;
        }

        // ---- redirects ----
        case "REDIR_OUT":
        case "REDIR_OUT_APPEND":
        case "REDIR_OUT_ERR":
        case "REDIR_OUT_BOTH":
        case "REDIR_IN": {
          const opTok = this.advance();
          const next = this.peek();
          const target: Token =
            next.type === "WORD" ||
            next.type === "STRING_SINGLE" ||
            next.type === "STRING_DOUBLE" ||
            next.type === "ASSIGNMENT_WORD"
              ? this.advance()
              : { type: "WORD", text: "", startIndex: opTok.endIndex, endIndex: opTok.endIndex };
          children.push(
            this.makeNode(
              "file_redirect",
              `${opTok.text} ${target.text}`,
              opTok.startIndex,
              target.endIndex,
              [
                this.makeNode("word", opTok.text, opTok.startIndex, opTok.endIndex, []),
                this.makeNode("word", target.text, target.startIndex, target.endIndex, []),
              ],
            ),
          );
          break;
        }

        // ---- command substitution $(...) ----
        case "DOLLAR_LPAREN": {
          const cs = this.chooseInnerBlock("LPAREN", "RPAREN", "command_substitution", "$(", ")");
          children.push(cs);
          break;
        }

        // ---- arithmetic expansion $((...)) ----
        case "DOLLAR_DOUBLE_LPAREN": {
          const ae = this.chooseInnerBlock("LPAREN", "RPAREN", "arithmetic_expansion", "$((", "))");
          // Override the wrappers: $(( passed 2 LPARENs
          // We already consumed $((" as a single token, inner paren count starts at 2
          // Re-handle: count LPAREN tokens within
          const ae2 = this.chooseInnerBlockWithBase("LPAREN", "RPAREN", "arithmetic_expansion", "$((", "))", 2);
          children.push(ae2);
          break;
        }

        // ---- backtick command substitution ----
        case "BACKTICK": {
          const btStart = this.advance().startIndex;
          let j = this.pos;
          while (j < this.tokens.length - 1 && this.tokens[j].type !== "BACKTICK") j++;
          const innerStart = this.tokens[this.pos]?.startIndex ?? btStart + 1;
          const innerEnd = this.tokens[j]?.startIndex ?? innerStart;
          const innerText = this.input.slice(innerStart, innerEnd);
          children.push(
            this.makeNode(
              "command_substitution",
              `\`${innerText}\``,
              btStart,
              (this.tokens[j]?.endIndex ?? innerEnd) + 1,
              [this.makeNode("raw_string", innerText, innerStart, innerEnd, [])],
            ),
          );
          this.pos = j + 1;
          break;
        }

        // ---- subshell (...) ----
        case "LPAREN": {
          const lparen = this.advance();
          let parenDepth = 1;
          let j = this.pos;
          while (j < this.tokens.length - 1 && parenDepth > 0) {
            if (this.tokens[j].type === "LPAREN") parenDepth++;
            else if (this.tokens[j].type === "RPAREN") parenDepth--;
            j++;
          }
          if (parenDepth !== 0) throw new BudgetExceeded("unclosed subshell");
          const innerStart = lparen.endIndex;
          const innerEnd = this.tokens[j - 1]?.startIndex ?? innerStart;
          const innerText = this.input.slice(innerStart, innerEnd);
          children.push(
            this.makeNode(
              "subshell",
              `(${innerText})`,
              lparen.startIndex,
              this.tokens[j - 1]?.endIndex ?? innerStart + innerText.length + 1,
              [this.makeNode("raw_string", innerText, innerStart, innerStart + innerText.length, [])],
            ),
          );
          this.pos = j;
          break;
        }

        // ---- heredoc start ----
        case "HEREDOC_OP": {
          const heredocOp = this.advance();
          const delimTok = this.peek().type === "HEREDOC_DELIM" ? this.advance() : null;
          children.push(
            this.makeNode(
              "heredoc_start",
              heredocOp.text + (delimTok ? " " + delimTok.text : ""),
              heredocOp.startIndex,
              delimTok?.endIndex ?? heredocOp.endIndex,
              [],
            ),
          );
          break;
        }

        // ---- end of command ----
        default: {
          this.leave();
          if (children.length === 0) {
            return this.makeNode("command", "", start, start, []);
          }
          return this.makeNode(
            "command",
            this.input.slice(start, children[children.length - 1].endIndex),
            start,
            children[children.length - 1].endIndex,
            children,
          );
        }
      }
    }

    // Unreachable — satisfies TypeScript
    this.leave();
    return this.makeNode("command", "", start, start, children);
  }

  // ---- inner-block extraction helpers ----

  /**
   * Consume tokens from current position until matching close token,
   * counting nested open/close pairs. Returns a node wrapping the inner text.
   */
  private chooseInnerBlock(
    openType: TokenType,
    closeType: TokenType,
    nodeType: NodeType,
    prefix: string,
    suffix: string,
  ): AstNode {
    return this.chooseInnerBlockWithBase(openType, closeType, nodeType, prefix, suffix, 1);
  }

  private chooseInnerBlockWithBase(
    openType: TokenType,
    closeType: TokenType,
    nodeType: NodeType,
    prefix: string,
    suffix: string,
    baseDepth: number,
  ): AstNode {
    const openTok = this.advance();
    let parenDepth = baseDepth;
    let j = this.pos;

    while (j < this.tokens.length - 1 && parenDepth > 0) {
      if (this.tokens[j].type === openType) parenDepth++;
      else if (this.tokens[j].type === closeType) parenDepth--;
      j++;
    }

    const innerStart = openTok.endIndex;
    const innerEnd = this.tokens[j - 1]?.startIndex ?? innerStart;
    const innerText = this.input.slice(innerStart, innerEnd);
    const endIdx = this.tokens[j - 1]?.endIndex ?? innerStart + innerText.length;

    const node = this.makeNode(
      nodeType,
      `${prefix}${innerText}${suffix}`,
      openTok.startIndex,
      endIdx + suffix.length,
      [this.makeNode("raw_string", innerText, innerStart, innerStart + innerText.length, [])],
    );
    this.pos = j;
    return node;
  }
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

/**
 * Parse a shell command string and return the AST or an error.
 */
export function parse(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {
      ast: { type: "program", text: "", startIndex: 0, endIndex: 0, children: [] },
      error: null,
    };
  }
  return new BashParser(input).parse();
}
