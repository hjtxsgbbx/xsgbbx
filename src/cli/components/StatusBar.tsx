import React from "react";
import { Box, Text } from "ink";
import { type AppStatus, type TokenUsage } from "../../types/index.js";

interface StatusBarProps {
  status: AppStatus;
}

export const StatusBar: React.FC<StatusBarProps> = ({ status }) => {
  const timeAgo = status.lastSentTimestamp
    ? formatTimeAgo(status.lastSentTimestamp)
    : "never";

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text dimColor>
          Project: {status.projectPath}
        </Text>
        <Text dimColor>
          {status.provider || "none"} | {status.modelName || "no model"} | Last: {timeAgo}
        </Text>
      </Box>
      {status.tokenUsage && (
        <TokenUsageBar usage={status.tokenUsage} />
      )}
    </Box>
  );
};

const TokenUsageBar: React.FC<{ usage: TokenUsage }> = ({ usage }) => {
  const pct = usage.limit > 0 ? (usage.total / usage.limit) * 100 : 0;
  const barWidth = 20;
  const filled = Math.min(Math.round((pct / 100) * barWidth), barWidth);
  const empty = barWidth - filled;

  const barColor = pct > 90 ? "red" : pct > 70 ? "yellow" : "green";

  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Text dimColor>
        Tokens: {formatNumber(usage.input)}in/{formatNumber(usage.output)}out
        {" | "}
        <Text color={barColor}>
          {"["}{"=".repeat(filled)}{" ".repeat(empty)}{"]"}
        </Text>
        {" "}
        {pct.toFixed(0)}%
      </Text>
      <Text dimColor>
        Limit: {formatNumber(usage.limit)}
        {usage.cacheRead ? ` | Cache: ${formatNumber(usage.cacheRead)}` : ""}
      </Text>
    </Box>
  );
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
