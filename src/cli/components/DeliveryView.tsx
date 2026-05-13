import React from "react";
import { Box, Text } from "ink";

interface DeliveryViewProps {
  files?: string[];
  commitHash?: string;
}

export const DeliveryView: React.FC<DeliveryViewProps> = ({
  files,
  commitHash,
}) => {
  return (
    <Box flexDirection="column">
      <Text color="green">✔ Task completed.</Text>
      {files && files.length > 0 && (
        <Text dimColor>
          {files.map((f) => `   Generated: ${f}`).join("\n")}
        </Text>
      )}
      {commitHash && (
        <Text dimColor>   Commit: {commitHash}</Text>
      )}
    </Box>
  );
};