import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

export type ProgressPhase = "initializing" | "thinking" | "tool_exec" | "streaming" | "compacting" | "complete" | "error";

interface ProgressIndicatorProps {
  phase: ProgressPhase;
  message?: string;
  progress?: number;
  toolName?: string;
  tokenUsage?: { input: number; output: number; total: number; limit: number };
  cost?: { current: number; limit: number; currency: string };
}

const PHASE_CONFIG: Record<ProgressPhase, { icon: string; color: string; label: string }> = {
  initializing: { icon: "⚙", color: "gray", label: "Initializing" },
  thinking: { icon: "✦", color: "magenta", label: "Thinking" },
  tool_exec: { icon: "⚡", color: "yellow", label: "Executing" },
  streaming: { icon: "▸", color: "cyan", label: "Streaming" },
  compacting: { icon: "◈", color: "blue", label: "Compacting" },
  complete: { icon: "✓", color: "green", label: "Complete" },
  error: { icon: "✗", color: "red", label: "Error" },
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  phase,
  message,
  progress,
  toolName,
  tokenUsage,
  cost,
}) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (phase === "complete" || phase === "error") return;
    const interval = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(interval);
  }, [phase]);

  const config = PHASE_CONFIG[phase];
  const isAnimated = phase !== "complete" && phase !== "error";

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={config.color}>
          {isAnimated ? SPINNER_FRAMES[frame] : config.icon}
        </Text>
        <Text color={config.color} bold>
          {config.label}
        </Text>
        {toolName && (
          <Text dimColor>
            [{toolName}]
          </Text>
        )}
        {message && (
          <Text dimColor>
            {message}
          </Text>
        )}
      </Box>

      {progress !== undefined && (
        <ProgressBar value={progress} color={config.color} />
      )}

      {(tokenUsage || cost) && (
        <Box flexDirection="row" gap={2}>
          {tokenUsage && (
            <TokenUsageDisplay usage={tokenUsage} />
          )}
          {cost && (
            <CostDisplay cost={cost} />
          )}
        </Box>
      )}
    </Box>
  );
};

const ProgressBar: React.FC<{ value: number; color: string }> = ({ value, color }) => {
  const width = 30;
  const filled = Math.min(Math.round((value / 100) * width), width);
  const empty = width - filled;

  return (
    <Box flexDirection="row">
      <Text dimColor>{"  "}</Text>
      <Text color={color}>
        {"["}{"█".repeat(filled)}{"░".repeat(empty)}{"]"}
      </Text>
      <Text dimColor>{" "}{value.toFixed(0)}%</Text>
    </Box>
  );
};

const TokenUsageDisplay: React.FC<{ usage: { input: number; output: number; total: number; limit: number } }> = ({ usage }) => {
  const pct = usage.limit > 0 ? (usage.total / usage.limit) * 100 : 0;
  const color = pct > 90 ? "red" : pct > 70 ? "yellow" : "green";

  return (
    <Text dimColor>
      Tokens: <Text color={color}>{formatTokens(usage.total)}</Text>/{formatTokens(usage.limit)}
      {" "}({pct.toFixed(0)}%)
    </Text>
  );
};

const CostDisplay: React.FC<{ cost: { current: number; limit: number; currency: string } }> = ({ cost }) => {
  const pct = cost.limit > 0 ? (cost.current / cost.limit) * 100 : 0;
  const color = pct > 90 ? "red" : pct > 70 ? "yellow" : "green";

  return (
    <Text dimColor>
      Cost: <Text color={color}>{cost.currency}{cost.current.toFixed(4)}</Text>/{cost.currency}{cost.limit.toFixed(2)}
    </Text>
  );
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export const ThinkingDots: React.FC = () => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCount((prev) => (prev + 1) % 4);
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <Text color="magenta">
      {"✦ Thinking"}{"·".repeat(count)}{" ".repeat(3 - count)}
    </Text>
  );
};
