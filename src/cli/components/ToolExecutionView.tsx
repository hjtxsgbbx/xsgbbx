import React from "react";
import { Box, Text } from "ink";

interface ToolExecutionViewProps {
  tool: string;
  progress: number;
  success?: boolean;
}

export const ToolExecutionView: React.FC<ToolExecutionViewProps> = ({
  tool,
  progress,
  success,
}) => {
  const barWidth = 20;
  const filled = Math.floor((progress / 100) * barWidth);
  const bar = "=".repeat(filled) + " ".repeat(barWidth - filled);

  return (
    <Box flexDirection="column">
      <Text color="cyan">🤖 agent_1 {"> "}Running: {tool}</Text>
      {progress > 0 && progress < 100 && (
        <Box marginLeft={3}>
          <Text dimColor>└─ [{bar}] {progress}%</Text>
        </Box>
      )}
      {progress === 100 && (
        <Box marginLeft={3}>
          {success === false ? (
            <Text color="red">└─ Failed ✗</Text>
          ) : (
            <Text color="green">└─ Completed ✔</Text>
          )}
        </Box>
      )}
    </Box>
  );
};
