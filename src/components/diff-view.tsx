/**
 * DiffView — colored diff rendering for terminal.
 * Renders unified diff with green (+), red (-), and context lines.
 */

import React from "react";
import { Text } from "ink";

export interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffViewProps {
  lines: DiffLine[];
  maxLines?: number;
  showLineNumbers?: boolean;
}

export function DiffView({
  lines,
  maxLines = 200,
  showLineNumbers = true,
}: DiffViewProps): React.ReactElement {
  const displayLines = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;

  return (
    <Text>
      {displayLines.map((line, i) => {
        const lineNum = showLineNumbers
          ? formatLineNumber(line)
          : "";

        switch (line.type) {
          case "add":
            return (
              <Text key={i}>
                {lineNum}
                <Text color="green">{line.content}</Text>
                {"\n"}
              </Text>
            );
          case "remove":
            return (
              <Text key={i}>
                {lineNum}
                <Text color="red">{line.content}</Text>
                {"\n"}
              </Text>
            );
          case "header":
            return (
              <Text key={i}>
                <Text bold color="cyan">{line.content}</Text>
                {"\n"}
              </Text>
            );
          default:
            return (
              <Text key={i}>
                {lineNum}
                <Text dimColor>{line.content || " "}</Text>
                {"\n"}
              </Text>
            );
        }
      })}
      {truncated && (
        <Text dimColor>
          ... {lines.length - maxLines} more lines truncated
          {"\n"}
        </Text>
      )}
    </Text>
  );
}

function formatLineNumber(line: DiffLine): string {
  const oldNum = line.oldLine?.toString().padStart(4) || "    ";
  const newNum = line.newLine?.toString().padStart(4) || "    ";
  return `${oldNum} ${newNum} │ `;
}

/**
 * Parse a unified diff string into DiffLine[].
 */
export function parseUnifiedDiff(diffText: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of diffText.split("\n")) {
    if (raw.startsWith("@@")) {
      // Parse hunk header to get line numbers
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1]!, 10);
        newLine = parseInt(match[2]!, 10);
      }
      lines.push({ type: "header", content: raw });
    } else if (raw.startsWith("+")) {
      lines.push({ type: "add", content: raw, newLine: newLine++ });
    } else if (raw.startsWith("-")) {
      lines.push({ type: "remove", content: raw, oldLine: oldLine++ });
    } else if (
      raw.startsWith("diff ") ||
      raw.startsWith("---") ||
      raw.startsWith("+++") ||
      raw.startsWith("index ")
    ) {
      lines.push({ type: "header", content: raw });
    } else {
      lines.push({
        type: "context",
        content: raw,
        oldLine: oldLine++,
        newLine: newLine++,
      });
    }
  }

  return lines;
}
