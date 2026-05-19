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
  /** Total input tokens used */
  inputTokens?: number;
  /** Total output tokens used */
  outputTokens?: number;
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
  /** Spinner frame index for animated spinner */
  spinnerFrame?: number;
  /** Show detailed token breakdown */
  showTokenBreakdown?: boolean;
  /** Custom status label override */
  statusLabel?: string;
}

// Spinner animation frames
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Progress bar characters
const PROGRESS_FILLED = "█";
const PROGRESS_EMPTY = "░";
const PROGRESS_PARTIAL = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

export function StatusBar(props: StatusBarProps): React.ReactElement {
  const {
    mode = "default",
    provider = "",
    model = "",
    inputTokens,
    outputTokens,
    cost,
    turn,
    maxTurns,
    progress,
    status = "idle",
    duration,
    spinnerFrame = 0,
    showTokenBreakdown = false,
    statusLabel,
  } = props;

  const totalTokens =
    inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined;

  const left = buildLeftSide(mode, provider, model, status, spinnerFrame, statusLabel);
  const right = buildRightSide(
    totalTokens,
    inputTokens,
    outputTokens,
    cost,
    turn,
    maxTurns,
    duration,
    showTokenBreakdown,
  );
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
          {"\n "}
          <Text dimColor>
            {progressBarDetailed(progress, termWidth - 2)}
          </Text>
        </Text>
      )}
      {showTokenBreakdown && inputTokens !== undefined && outputTokens !== undefined && (
        <Text>
          {"\n "}
          <Text dimColor>
            {`in: ${formatTokens(inputTokens)}  out: ${formatTokens(outputTokens)}`}
          </Text>
        </Text>
      )}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Left side — mode, provider, model, status
// ---------------------------------------------------------------------------

function buildLeftSide(
  mode: string,
  provider: string,
  model: string,
  status: string,
  spinnerFrame: number,
  statusLabel?: string,
): string {
  const spinner = getSpinner(status, spinnerFrame);
  const modeIcon = mode === "plan" ? "P" : mode === "act" ? "A" : "·";
  const statusIcon = getStatusIcon(status);
  const modelStr = model ? ` ${model}` : "";
  const providerStr = provider ? `${provider}/` : "";
  const label = statusLabel ? ` ${statusLabel}` : "";

  return `${spinner} ${modeIcon} ${statusIcon} ${providerStr}${modelStr}${label}`;
}

function getSpinner(
  status: string,
  frame: number,
): string {
  if (status === "thinking" || status === "executing" || status === "streaming") {
    return SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!;
  }
  return " ";
}

function getStatusIcon(status: string): string {
  switch (status) {
    case "thinking":
      return "…";
    case "executing":
      return "»";
    case "streaming":
      return "▸";
    case "error":
      return "!";
    default:
      return "·";
  }
}

// ---------------------------------------------------------------------------
// Right side — tokens, cost, turns, duration
// ---------------------------------------------------------------------------

function buildRightSide(
  totalTokens: number | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  cost: number | undefined,
  turn: number | undefined,
  maxTurns: number | undefined,
  duration: number | undefined,
  showBreakdown: boolean,
): string {
  const parts: string[] = [];

  if (showBreakdown && inputTokens !== undefined && outputTokens !== undefined) {
    parts.push(`i${formatTokens(inputTokens)} o${formatTokens(outputTokens)}`);
  } else if (totalTokens !== undefined) {
    parts.push(formatTokens(totalTokens));
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

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function progressBarDetailed(percent: number, width: number): string {
  if (width < 3) return "";

  const clamped = Math.max(0, Math.min(100, percent));
  const filledRatio = (clamped / 100) * width;
  const filled = Math.floor(filledRatio);
  const partialIdx = Math.round((filledRatio - filled) * (PROGRESS_PARTIAL.length - 1));
  const partial = PROGRESS_PARTIAL[partialIdx] ?? "";
  const empty = width - filled - (partial ? 1 : 0);

  let bar = PROGRESS_FILLED.repeat(filled);
  if (partial) bar += partial;
  bar += PROGRESS_EMPTY.repeat(Math.max(0, empty));

  // Add percentage label in the center if enough space
  const pctStr = ` ${clamped.toFixed(0)}% `;
  if (width > pctStr.length + 4) {
    const mid = Math.floor((width - pctStr.length) / 2);
    bar = bar.slice(0, mid) + pctStr + bar.slice(mid + pctStr.length);
  }

  return bar;
}

// ---------------------------------------------------------------------------
// ANSI strip helper
// ---------------------------------------------------------------------------

function stripAnsi(str: string): string {
  return str.replace(
    /[][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    "",
  );
}
