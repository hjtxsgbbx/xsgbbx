import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { TokenUsage } from "../../types/index.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface ThinkingIndicatorProps {
  model: string;
  attempt: number;
  tokenUsage?: TokenUsage;
}

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
  model,
  attempt,
  tokenUsage,
}) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box flexDirection="column">
      <Text color="cyan">
        {SPINNER_FRAMES[frame]} agent_1 {"> "}Thinking...
      </Text>
      <Box marginLeft={3}>
        <Text dimColor>└─ Calling {model} (attempt {attempt})</Text>
      </Box>
      {tokenUsage && (
        <Box marginLeft={3}>
          <Text dimColor>
            └─ Token usage: {tokenUsage.total.toLocaleString()} /{" "}
            {tokenUsage.limit.toLocaleString()}
          </Text>
        </Box>
      )}
    </Box>
  );
};