import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface InputLineProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

export const InputLine: React.FC<InputLineProps> = ({
  value,
  onChange,
  onSubmit,
}) => {
  return (
    <Box flexDirection="row">
      <Text color="cyan">🤖 agent_1 </Text>
      <Text color="cyan">{"> "}</Text>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder="Enter your request..."
      />
    </Box>
  );
};