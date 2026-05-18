import React from "react";
import { Box, Text } from "ink";

interface PermissionDeniedViewProps {
  message: string;
}

export const PermissionDeniedView: React.FC<PermissionDeniedViewProps> = ({
  message,
}) => {
  const isOverrideable = message.includes("overrideable");

  return (
    <Box flexDirection="column">
      <Text color="red">✖ {message}</Text>
      {isOverrideable && (
        <Text dimColor>
          [?] Type "y" or "yes" to override: _
        </Text>
      )}
    </Box>
  );
};