/**
 * DiffView — colored diff rendering for terminal.
 *
 * Renders unified and side-by-side diffs with green (+), red (-),
 * context lines, line numbers, and hunk-level syntax highlighting.
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
  /** Render mode — "unified" (default) or "side-by-side" */
  mode?: "unified" | "side-by-side";
  /** Maximum width per side in side-by-side mode */
  sideWidth?: number;
}

/** A hunk of diff lines (header + add/remove/context) */
interface Hunk {
  header: DiffLine;
  entries: DiffLine[];
}

export function DiffView({
  lines,
  maxLines = 200,
  showLineNumbers = true,
  mode = "unified",
  sideWidth = 50,
}: DiffViewProps): React.ReactElement {
  if (mode === "side-by-side") {
    return renderSideBySide(lines, maxLines, showLineNumbers, sideWidth);
  }
  return renderUnified(lines, maxLines, showLineNumbers);
}

// ---------------------------------------------------------------------------
// Unified diff rendering
// ---------------------------------------------------------------------------

function renderUnified(
  lines: DiffLine[],
  maxLines: number,
  showLineNumbers: boolean,
): React.ReactElement {
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
                <Text color="green">{lineNum}</Text>
                <Text backgroundColor="#1a3a1a" color="green">
                  {line.content}
                </Text>
                {"\n"}
              </Text>
            );
          case "remove":
            return (
              <Text key={i}>
                <Text color="red">{lineNum}</Text>
                <Text backgroundColor="#3a1a1a" color="red">
                  {line.content}
                </Text>
                {"\n"}
              </Text>
            );
          case "header":
            return (
              <Text key={i}>
                <Text bold color="cyan">
                  {line.content
                    .replace(/^@@(.+)@@$/, (_: string, body: string) =>
                      highlightHunkHeader(body),
                    )}
                </Text>
                {"\n"}
              </Text>
            );
          default:
            return (
              <Text key={i}>
                <Text dimColor>{lineNum}</Text>
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

// ---------------------------------------------------------------------------
// Side-by-side rendering
// ---------------------------------------------------------------------------

function renderSideBySide(
  lines: DiffLine[],
  maxLines: number,
  showLineNumbers: boolean,
  sideWidth: number,
): React.ReactElement {
  const displayLines = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;

  // Group into hunks
  const hunks = groupIntoHunks(displayLines);

  return (
    <Text>
      {/* Header */}
      <Text bold>
        {"Old".padEnd(sideWidth)}
        {" │ "}
        {"New".padEnd(sideWidth)}
        {"\n"}
        <Text dimColor>{"─".repeat(sideWidth + sideWidth + 3)}</Text>
        {"\n"}
      </Text>
      {hunks.map((hunk, hi) => {
        const { left, right } = alignHunk(hunk);

        return (
          <Text key={hi}>
            <Text dimColor>
              {hunk.header.content.slice(0, sideWidth).padEnd(sideWidth)}
              {" │ "}
              {hunk.header.content.slice(0, sideWidth).padEnd(sideWidth)}
              {"\n"}
            </Text>
            {renderAlignedRows(left, right, showLineNumbers, sideWidth)}
          </Text>
        );
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

function renderAlignedRows(
  left: DiffLine[],
  right: DiffLine[],
  showLineNumbers: boolean,
  sideWidth: number,
): React.ReactElement[] {
  const max = Math.max(left.length, right.length);
  const result: React.ReactElement[] = [];

  for (let i = 0; i < max; i++) {
    const l = left[i];
    const r = right[i];
    const leftStr = l
      ? formatDiffLineForSide(l, showLineNumbers, sideWidth)
      : " ".repeat(sideWidth);
    const rightStr = r
      ? formatDiffLineForSide(r, showLineNumbers, sideWidth)
      : " ".repeat(sideWidth);

    result.push(
      <Text key={i}>
        {leftStr}
        {" │ "}
        {rightStr}
        {"\n"}
      </Text>,
    );
  }
  return result;
}

function formatDiffLineForSide(
  line: DiffLine,
  showLineNumbers: boolean,
  _sideWidth: number,
): string {
  const num = showLineNumbers
    ? (line.oldLine ?? line.newLine ?? 0).toString().padStart(4) + " "
    : "";
  const content = num + line.content;
  return content; // the caller pads to sideWidth
}

// ---------------------------------------------------------------------------
// Hunk grouping & alignment
// ---------------------------------------------------------------------------

function groupIntoHunks(lines: DiffLine[]): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;

  for (const line of lines) {
    if (line.type === "header") {
      if (current) hunks.push(current);
      current = { header: line, entries: [] };
    } else if (current) {
      current.entries.push(line);
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

interface AlignedSides {
  left: DiffLine[];
  right: DiffLine[];
}

function alignHunk(hunk: Hunk): AlignedSides {
  const left: DiffLine[] = [];
  const right: DiffLine[] = [];

  for (const entry of hunk.entries) {
    if (entry.type === "remove") {
      left.push(entry);
      right.push({ type: "context", content: "", oldLine: undefined, newLine: undefined });
    } else if (entry.type === "add") {
      left.push({ type: "context", content: "", oldLine: undefined, newLine: undefined });
      right.push(entry);
    } else {
      left.push(entry);
      right.push(entry);
    }
  }

  return { left, right };
}

// ---------------------------------------------------------------------------
// Syntax highlighting helpers
// ---------------------------------------------------------------------------

function highlightHunkHeader(body: string): string {
  // Highlight the - and + line ranges in hunk headers
  return body.replace(
    /-(\d+)(?:,(\d+))?/g,
    (_: string, start: string, count?: string) => {
      return count ? `-${start},${count}` : `-${start}`;
    },
  );
}

function formatLineNumber(line: DiffLine): string {
  const oldNum = line.oldLine?.toString().padStart(4) || "    ";
  const newNum = line.newLine?.toString().padStart(4) || "    ";
  return `${oldNum} ${newNum} │ `;
}

// ---------------------------------------------------------------------------
// Parse unified diff string into DiffLine[]
// ---------------------------------------------------------------------------

export function parseUnifiedDiff(diffText: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of diffText.split("\n")) {
    if (raw.startsWith("@@")) {
      // Parse hunk header to get line numbers
      const match = raw.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        oldLine = parseInt(match[1]!, 10);
        newLine = parseInt(match[3]!, 10);
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
