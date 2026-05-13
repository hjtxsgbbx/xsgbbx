import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface ProviderSelectProps {
  onSelect: (provider: string) => void;
}

export const ProviderSelect: React.FC<ProviderSelectProps> = ({ onSelect }) => {
  return (
    <Box flexDirection="column">
      <Box
        borderStyle="classic"
        borderColor="yellow"
        paddingX={2}
        paddingY={1}
        flexDirection="column"
      >
        <Text bold color="yellow">
          ================================================
        </Text>
        <Text bold>
          agent_1 需要将您的部分代码发送至 AI 提供商
        </Text>
        <Text>  以获得智能回复。详情请阅读隐私政策。</Text>
        <Text bold color="yellow">
          ================================================
        </Text>
      </Box>
      <Box marginY={1}>
        <Text>  提供商选择: [1] Anthropic  [2] OpenAI</Text>
      </Box>
      <Box>
        <Text>  输入数字选择并确认 (或 'q' 退出): </Text>
        <ProviderInput onSelect={onSelect} />
      </Box>
    </Box>
  );
};

const ProviderInput: React.FC<{ onSelect: (p: string) => void }> = ({
  onSelect,
}) => {
  const [value, setValue] = useState("");

  const handleSubmit = (val: string) => {
    const trimmed = val.trim();
    if (trimmed === "1") {
      onSelect("anthropic");
    } else if (trimmed === "2") {
      onSelect("openai");
    } else if (trimmed.toLowerCase() === "q") {
      process.exit(0);
    }
    setValue("");
  };

  return (
    <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
  );
};