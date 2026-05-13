import React from "react";
import { Box, Text } from "ink";
import { AppStatus } from "../../types/index.js";

interface StatusBarProps {
  status: AppStatus;
}

export const StatusBar: React.FC<StatusBarProps> = ({ status }) => {
  const timeAgo = status.lastSentTimestamp
    ? formatTimeAgo(status.lastSentTimestamp)
    : "never";

  return (
    <Box flexDirection="row" justifyContent="space-between" marginBottom={0}>
      <Text dimColor>
        📁 Project: {status.projectPath}
      </Text>
      <Text dimColor>
        📡 发送至 {status.provider || "未选择"} | 上次: {timeAgo}
      </Text>
    </Box>
  );
};

function formatTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s 前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m 前`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h 前`;
}