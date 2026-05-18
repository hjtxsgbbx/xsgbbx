/**
 * StatusBar — session status line with cost, tokens, mode, and progress.
 * Renders a single-line bar at the bottom of the terminal.
 */

import React from "react";
import { Text } from "ink";

export interface StatusBarProps {
  /** Current agent mode */
  mode?: "default" | "plan" | "act";
  /** Provider name */
  provider?: string;
  /** Model name */
  model?: string;
  /** Total tokens used */
  tokens?: number;
  /** Estimated cost in USD */
  cost?: number;
  /** Turn count */
  turn?: number;
  /** Max turns */
  maxTurns?: number;
  /** Progress 0-100 or undefined if idle */
  progress?: number;
  /** Status message */
  status?: "idle" | "thinking" | "executing" | "streaming" | "error";
  /** Session duration in seconds */
  duration?: number;
}

export function StatusBar(props: StatusBarProps): React.ReactElement {
  const {
    mode = "default",
    provider = "",
    model = "",
    tokens,
    cost,
    turn,
    maxTurns,
    progress,
    status = "idle",
    duration,
  } = props;

  const left = buildLeftSide(mode, provider, model, status);
  const right = buildRightSide(tokens, cost, turn, maxTurns, duration);
  const termWidth = process.stdout.columns || 80;

  const barWidth = termWidth - 2;
  const leftLen = stripAnsi(left).length;
  const rightLen = stripAnsi(right).length;
  const spacerLen = Math.max(1, barWidth - leftLen - rightLen);
  const spacer = "─".repeat(spacerLen);

  return (
    <Text>
      <Text inverse>
        {" "}
        <Text>{left}</Text>
        <Text dimColor>{spacer}</Text>
        <Text>{right}</Text>
        {" "}
      </Text>
      {progress !== undefined && status !== "idle" && (
        <Text>
          {"\n"}
          <Text dimColor>{progressBar(progress, termWidth - 2)}</Text>
        </Text>
      )}
    </Text>
  );
}

function buildLeftSide(
  mode: string,
  provider: string,
  model: string,
  status: string,
): string {
  const modeIcon = mode === "plan" ? "◉" : mode === "act" ? "▶" : "○";
  const statusIcon =
    status === "thinking"
      ? "🧠"
      : status === "executing"
        ? "⚡"
        : status === "streaming"
          ? "▸"
          : status === "error"
            ? "✖"
            : "✓";
  return `${statusIcon} ${modeIcon} ${provider}/${model}`;
}

function buildRightSide(
  tokens?: number,
  cost?: number,
  turn?: number,
  maxTurns?: number,
  duration?: number,
): string {
  const parts: string[] = [];
  if (tokens !== undefined) {
    parts.push(formatTokens(tokens));
  }
  if (cost !== undefined) {
    parts.push(`$${cost.toFixed(4)}`);
  }
  if (turn !== undefined) {
    const max = maxTurns ? `/${maxTurns}` : "";
    parts.push(`T${turn}${max}`);
  }
  if (duration !== undefined) {
    const mins = Math.floor(duration / 60);
    const secs = Math.floor(duration % 60);
    parts.push(`${mins}:${secs.toString().padStart(2, "0")}`);
  }
  return parts.join(" │ ");
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function progressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

// Simple ANSI strip for length calculation
function stripAnsi(str: string): string {
  return str.replace(
    /[][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    "",
  );
}
