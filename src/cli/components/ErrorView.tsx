import React from "react";
import { Box, Text } from "ink";

interface ErrorViewProps {
  message: string;
}

export const ErrorView: React.FC<ErrorViewProps> = ({ message }) => {
  return (
    <Box flexDirection="column">
      <Text color="red">✖ Error: {message}</Text>
      <Text dimColor>   Agent is investigating...</Text>
    </Box>
  );
};