/**
 * Terminal markdown renderer — renders basic markdown in ink.
 *
 * Supports: headings, bold, italic, code blocks (with syntax highlighting),
 * tables, inline code, lists, links, blockquotes, and horizontal rules.
 */

import React from "react";
import { Text } from "ink";

export interface MarkdownRendererProps {
  content: string;
  /** Max lines to render (0 = unlimited) */
  maxLines?: number;
}

type TokenType =
  | "text"
  | "heading"
  | "code_block"
  | "code_inline"
  | "list_item"
  | "hr"
  | "blockquote"
  | "table";

interface Token {
  type: TokenType;
  content: string;
  level?: number;
  lang?: string; // code block language hint
}

interface TableToken extends Token {
  type: "table";
  headers: string[];
  rows: string[][];
  align: ("left" | "center" | "right")[];
}

export function MarkdownRenderer({
  content,
  maxLines = 0,
}: MarkdownRendererProps): React.ReactElement {
  const lines = content.split("\n");
  const displayLines = maxLines > 0 ? lines.slice(0, maxLines) : lines;
  const tokens = tokenize(displayLines);

  return (
    <Text>
      {tokens.map((token, i) => renderToken(token, i))}
    </Text>
  );
}

function renderToken(token: Token, key: number): React.ReactElement {
  switch (token.type) {
    case "heading":
      return (
        <Text key={key}>
          <Text bold color="cyan">{token.content}</Text>
          {"\n"}
        </Text>
      );
    case "code_block":
      return (
        <Text key={key}>
          <Text dimColor>
            {highlightCode(token.content, token.lang)}
          </Text>
        </Text>
      );
    case "code_inline":
      return (
        <Text key={key}>
          <Text backgroundColor="#333333" color="ansi:yellowBright">
            {token.content}
          </Text>
        </Text>
      );
    case "list_item":
      return (
        <Text key={key}>
          {"  "}
          <Text color="ansi:cyan">{"•"}</Text>
          {" "}
          <Text>{formatInlineMarkdown(token.content)}</Text>
          {"\n"}
        </Text>
      );
    case "hr":
      return (
        <Text key={key}>
          <Text dimColor>{"─".repeat(process.stdout.columns || 40)}</Text>
          {"\n"}
        </Text>
      );
    case "blockquote":
      return (
        <Text key={key}>
          <Text dimColor>
            {"│ "}
            {token.content}
          </Text>
          {"\n"}
        </Text>
      );
    case "table":
      return renderTable(token as TableToken, key);
    default:
      return (
        <Text key={key}>
          <Text>{renderInlineRich(token.content)}</Text>
          {"\n"}
        </Text>
      );
  }
}

// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------

function renderTable(table: TableToken, key: number): React.ReactElement {
  const { headers, rows, align } = table;

  // Calculate column widths
  const colWidths = headers.map((h, ci) => {
    const cellWidths = rows.map((r) => stripMarkdown(r[ci] ?? "").length);
    return Math.max(h.length, ...cellWidths) + 2; // +2 padding
  });

  const separator = colWidths
    .map((w) => "─".repeat(w))
    .join("┼");

  return (
    <Text key={key}>
      {/* Header */}
      {renderTableRow(headers, colWidths, align, true)}
      {"\n"}
      {/* Separator */}
      <Text dimColor>{separator}</Text>
      {"\n"}
      {/* Data rows */}
      {rows.map((row, ri) => (
        <Text key={ri}>
          {renderTableRow(row, colWidths, align, false)}
          {"\n"}
        </Text>
      ))}
    </Text>
  );
}

function renderTableRow(
  cells: string[],
  widths: number[],
  align: ("left" | "center" | "right")[],
  bold: boolean,
): string {
  return cells
    .map((cell, ci) => {
      const content = stripMarkdown(cell);
      const w = widths[ci] ?? content.length;
      const a = align[ci] ?? "left";
      return padCell(content, w, a);
    })
    .join("");
}

function padCell(
  text: string,
  width: number,
  align: "left" | "center" | "right",
): string {
  const pad = width - text.length;
  const left = align === "right" ? pad : align === "center" ? Math.floor(pad / 2) : 0;
  const right = pad - left;
  return " ".repeat(left) + text + " ".repeat(right);
}

// ---------------------------------------------------------------------------
// Code syntax highlighting (ANSI terminal colors)
// ---------------------------------------------------------------------------

// Keywords per language
const KEYWORDS: Record<string, RegExp> = {
  js: /\b(?:const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|typeof|instanceof|void|delete|in|of|switch|case|default|break|continue|do|yield|extends|super|this|static|get|set)\b/g,
  ts: /\b(?:const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|typeof|instanceof|void|delete|in|of|switch|case|default|break|continue|do|yield|extends|super|this|static|get|set|interface|type|enum|namespace|declare|abstract|readonly|private|public|protected|implements)\b/g,
  py: /\b(?:def|return|if|elif|else|for|while|class|import|from|as|try|except|finally|with|yield|lambda|pass|break|continue|raise|assert|del|global|nonlocal|in|is|not|and|or|True|False|None|async|await)\b/g,
  go: /\b(?:func|return|if|else|for|range|switch|case|default|break|continue|go|defer|select|chan|map|struct|interface|type|package|import|var|const)\b/g,
  sh: /\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|local|export|source|echo|exit|set|unset|shift)\b/g,
  rs: /\b(?:fn|let|mut|return|if|else|for|while|loop|match|struct|enum|impl|trait|use|mod|pub|crate|self|super|where|as|in|ref|move|unsafe|async|await|dyn|type|const|static|extern)\b/g,
};

// Common patterns across languages
const STRING_RE = /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|`[^`\\]*(?:\\.[^`\\]*)*`/g;
const NUMBER_RE = /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;
const COMMENT_RE = /\/\/[^\n]*|#.*$/gm;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

function highlightCode(code: string, lang?: string): string {
  if (!code) return "";

  const langKey = mapLang(lang);
  const keywordRe = langKey ? KEYWORDS[langKey] : null;

  let result = code;

  // Need to apply highlights safely — we use placeholder tokens to
  // avoid clobbering other highlights.

  // Replace tokens in order: comments first, then strings, keywords, numbers
  const tokens: { placeholder: string; replacement: string }[] = [];
  let tIdx = 0;

  function steal(placeholder: string): string {
    const ph = `\x00${tIdx++}\x00`;
    tokens.push({ placeholder: ph, replacement: placeholder });
    return ph;
  }

  // Block comments
  result = result.replace(BLOCK_COMMENT_RE, (m) =>
    steal(`\x1b[2m${m}\x1b[22m`),
  );
  // Line comments
  result = result.replace(COMMENT_RE, (m) =>
    steal(`\x1b[2m${m}\x1b[22m`),
  );
  // Strings
  result = result.replace(STRING_RE, (m) =>
    steal(`\x1b[32m${m}\x1b[39m`),
  );
  // Numbers
  result = result.replace(NUMBER_RE, (m) =>
    steal(`\x1b[33m${m}\x1b[39m`),
  );
  // Keywords
  if (keywordRe) {
    result = result.replace(keywordRe, (m) =>
      steal(`\x1b[35m${m}\x1b[39m`),
    );
  }

  // Un-replace placeholders in reverse order
  for (let i = tokens.length - 1; i >= 0; i--) {
    result = result.replace(tokens[i]!.placeholder, tokens[i]!.replacement);
  }

  return result;
}

function mapLang(lang?: string): string | null {
  if (!lang) return null;
  const lc = lang.toLowerCase();
  if (lc === "javascript" || lc === "js") return "js";
  if (lc === "typescript" || lc === "ts") return "ts";
  if (lc === "python" || lc === "py") return "py";
  if (lc === "go" || lc === "golang") return "go";
  if (lc === "bash" || lc === "sh" || lc === "shell") return "sh";
  if (lc === "rust" || lc === "rs") return "rs";
  return null;
}

// ---------------------------------------------------------------------------
// Inline rich formatting
// ---------------------------------------------------------------------------

function renderInlineRich(text: string): string {
  let result = text;
  // Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, "\x1b[1m$1\x1b[22m");
  result = result.replace(/__(.+?)__/g, "\x1b[1m$1\x1b[22m");
  // Italic: *text* or _text_
  result = result.replace(/\*(.+?)\*/g, "\x1b[3m$1\x1b[23m");
  result = result.replace(/_(.+?)_/g, "\x1b[3m$1\x1b[23m");
  // Inline code: `text`
  result = result.replace(/`(?:``)?(.+?)`(?:``)?/g, "\x1b[48;5;236m\x1b[33m$1\x1b[39m\x1b[49m");
  // Links: [text](url) → just text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, "\x1b[4m$1\x1b[24m");

  return result;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function tokenize(lines: string[]): Token[] {
  const tokens: Token[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeBlockLang = "";
  let tableLines: string[] = [];
  let inTable = false;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    const trimmed = line.trimStart();

    // Code block boundaries
    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        tokens.push({
          type: "code_block",
          content: codeBlockLines.join("\n"),
          lang: codeBlockLang,
        });
        codeBlockLines = [];
        inCodeBlock = false;
        codeBlockLang = "";
      } else {
        // Flush any in-progress table before starting a code block
        if (inTable) {
          tokens.push(parseTable(tableLines));
          tableLines = [];
          inTable = false;
        }
        inCodeBlock = true;
        codeBlockLang = trimmed.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Table detection: pipe-separated row followed by separator line
    if (line.includes("|") && !trimmed.startsWith(">")) {
      const nextLine = lines[li + 1];
      if (nextLine && /^\|?[\s\-:|]+\|?$/.test(nextLine.trim())) {
        // Start of a table
        if (tableLines.length === 0) {
          tableLines.push(line);
          tableLines.push(nextLine);
          li++; // consume separator
          inTable = true;
          continue;
        }
      }
    }

    // Continue table rows
    if (inTable) {
      if (line.includes("|")) {
        tableLines.push(line);
        continue;
      }
      // Table ended
      tokens.push(parseTable(tableLines));
      tableLines = [];
      inTable = false;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      tokens.push({
        type: "heading",
        content: headingMatch[2]!,
        level: headingMatch[1]!.length,
      });
      continue;
    }

    // HR
    if (/^[-*_]{3,}\s*$/.test(line)) {
      tokens.push({ type: "hr", content: "" });
      continue;
    }

    // Blockquote
    if (/^>\s/.test(line)) {
      tokens.push({ type: "blockquote", content: line.replace(/^>\s?/, "") });
      continue;
    }

    // List item
    if (/^\s*[-*+]\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
      tokens.push({
        type: "list_item",
        content: line.replace(/^\s*[-*+]\s*/, "").replace(/^\s*\d+\.\s*/, ""),
      });
      continue;
    }

    // Regular text
    tokens.push({
      type: "text",
      content: line.trim() ? renderInlineRich(line) : "",
    });
  }

  // Flush remaining
  if (inCodeBlock && codeBlockLines.length > 0) {
    tokens.push({
      type: "code_block",
      content: codeBlockLines.join("\n"),
      lang: codeBlockLang,
    });
  }
  if (inTable && tableLines.length > 0) {
    tokens.push(parseTable(tableLines));
  }

  return tokens;
}

function parseTable(lines: string[]): TableToken {
  if (lines.length < 2) {
    return {
      type: "table",
      content: lines.join("\n"),
      headers: [],
      rows: [],
      align: [],
    };
  }

  const headers = splitRow(lines[0]!);
  const rows = lines.slice(2).map(splitRow);

  // Parse alignment from separator line
  const sep = splitRow(lines[1]!);
  const align = sep.map((s) => {
    if (s.startsWith(":") && s.endsWith(":")) return "center" as const;
    if (s.endsWith(":")) return "right" as const;
    return "left" as const;
  });

  return {
    type: "table",
    content: lines.join("\n"),
    headers,
    rows,
    align,
  };
}

function splitRow(line: string): string[] {
  // Trim leading/trailing pipes, then split by pipe
  let cleaned = line.trim();
  if (cleaned.startsWith("|")) cleaned = cleaned.slice(1);
  if (cleaned.endsWith("|")) cleaned = cleaned.slice(0, -1);
  return cleaned.split("|").map((c) => c.trim());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatInlineMarkdown(text: string): string {
  return renderInlineRich(text);
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}
