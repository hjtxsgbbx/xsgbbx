import React from "react";
import { Box, Text } from "ink";

interface ToolExecutionViewProps {
  tool: string;
  progress: number;
}

export const ToolExecutionView: React.FC<ToolExecutionViewProps> = ({
  tool,
  progress,
}) => {
  const barWidth = 20;
  const filled = Math.floor((progress / 100) * barWidth);
  const bar = "=".repeat(filled) + " ".repeat(barWidth - filled);

  return (
    <Box flexDirection="column">
      <Text color="cyan">🤖 agent_1 {"> "}Running: {tool}</Text>
      {progress > 0 && (
        <Box marginLeft={3}>
          <Text dimColor>└─ [{bar}] {progress}%</Text>
        </Box>
      )}
      {progress === 100 && (
        <Box marginLeft={3}>
          <Text color="green">└─ Exit code: 0 ✔</Text>
        </Box>
      )}
    </Box>
  );
};