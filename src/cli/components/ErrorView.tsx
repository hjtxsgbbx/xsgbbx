import React from "react";
import { Box, Text } from "ink";

interface ErrorViewProps {
  message: string;
}

function getSuggestion(message: string): string | null {
  const lower = message.toLowerCase();
  if (lower.includes("api_key") || lower.includes("api key") || lower.includes("unauthorized") || lower.includes("401") || lower.includes("authentication")) {
    return "Suggestion: Check your API key with /config or set ANTHROPIC_API_KEY / OPENAI_API_KEY environment variable.";
  }
  if (lower.includes("rate_limit") || lower.includes("rate limit") || lower.includes("429") || lower.includes("too many requests")) {
    return "Suggestion: Rate limit reached. Wait a moment or switch to a different model/provider.";
  }
  if (lower.includes("network") || lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("timeout")) {
    return "Suggestion: Check your network connection. If using a local provider, ensure it's running.";
  }
  if (lower.includes("context_length") || lower.includes("max_tokens") || lower.includes("too long") || lower.includes("token limit")) {
    return "Suggestion: Input too long. Try /clear to reset conversation or use a model with larger context.";
  }
  if (lower.includes("model") && (lower.includes("not found") || lower.includes("does not exist"))) {
    return "Suggestion: Model not available. Use /config to select a valid model for your provider.";
  }
  if (lower.includes("permission") || lower.includes("denied") || lower.includes("forbidden")) {
    return "Suggestion: Permission denied. Check file permissions or use /config to adjust permission mode.";
  }
  return null;
}

export const ErrorView: React.FC<ErrorViewProps> = ({ message }) => {
  const suggestion = getSuggestion(message);
  return (
    <Box flexDirection="column">
      <Text color="red">✖ Error: {message}</Text>
      {suggestion && (
        <Text color="yellow">  💡 {suggestion}</Text>
      )}
    </Box>
  );
};
