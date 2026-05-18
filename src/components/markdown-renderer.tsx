/**
 * Terminal markdown renderer — renders basic markdown in ink.
 * Supports: headings, bold, italic, code blocks, inline code, lists, links.
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
  | "bold"
  | "italic"
  | "code_inline"
  | "code_block"
  | "code_block_start"
  | "list_item"
  | "hr"
  | "blockquote";

interface Token {
  type: TokenType;
  content: string;
  level?: number; // for headings
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
          <Text bold>{token.content}</Text>
          {"\n"}
        </Text>
      );
    case "code_block":
      return (
        <Text key={key}>
          <Text dimColor>{token.content}</Text>
        </Text>
      );
    case "code_inline":
      return (
        <Text key={key}>
          <Text backgroundColor="gray">{token.content}</Text>
        </Text>
      );
    case "list_item":
      return (
        <Text key={key}>
          {"  "}
          <Text>{token.content}</Text>
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
          <Text dimColor>{token.content}</Text>
          {"\n"}
        </Text>
      );
    default:
      return (
        <Text key={key}>
          <Text>{formatInlineMarkdown(token.content)}</Text>
          {"\n"}
        </Text>
      );
  }
}

function tokenize(lines: string[]): Token[] {
  const tokens: Token[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeBlockLang = "";

  for (const line of lines) {
    // Code block boundaries
    if (line.trimStart().startsWith("```")) {
      if (inCodeBlock) {
        tokens.push({
          type: "code_block",
          content: codeBlockLines.join("\n"),
        });
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockLang = line.trimStart().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
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
    if (line.trim()) {
      tokens.push({ type: "text", content: line });
    } else {
      tokens.push({ type: "text", content: "" });
    }
  }

  // Unclosed code block
  if (inCodeBlock && codeBlockLines.length > 0) {
    tokens.push({
      type: "code_block",
      content: codeBlockLines.join("\n"),
    });
  }

  return tokens;
}

function formatInlineMarkdown(text: string): string {
  // Strip **, *, ` for now — ink doesn't support inline formatting well
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}
