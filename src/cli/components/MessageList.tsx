import React from "react";
import { Box, Text } from "ink";
import { type Message, type ToolCall } from "../../types/index.js";

interface MessageListProps {
  messages: Message[];
}

export const MessageList: React.FC<MessageListProps> = ({ messages }) => {
  return (
    <Box flexDirection="column">
      {messages.map((msg, idx) => (
        <Box key={idx} flexDirection="column" marginBottom={0}>
          {msg.role === "user" && (
            <Text color="cyan">
              ❯ {typeof msg.content === "string" ? msg.content : "[tool calls]"}
            </Text>
          )}
          {msg.role === "assistant" && (
            <RenderMarkdown
              content={
                typeof msg.content === "string"
                  ? msg.content
                  : formatToolCalls(msg.content)
              }
            />
          )}
          {msg.role === "tool" && (
            <Text dimColor>
              {typeof msg.content === "string"
                ? msg.content.slice(0, 500) +
                  (msg.content.length > 500 ? "..." : "")
                : ""}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  );
};

const RenderMarkdown: React.FC<{ content: string }> = ({ content }) => {
  const segments = parseMarkdown(content);

  return (
    <Box flexDirection="column">
      {segments.map((seg, i) => (
        <Text
          key={i}
          bold={seg.bold}
          italic={seg.italic}
          dimColor={seg.dim}
          color={seg.color}
          backgroundColor={seg.bgColor}
        >
          {seg.text}
        </Text>
      ))}
    </Box>
  );
};

type InkColor = "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white" | "gray" | "grey" | "blackBright" | "redBright" | "greenBright" | "yellowBright" | "blueBright" | "magentaBright" | "cyanBright" | "whiteBright";

interface MarkdownSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  dim?: boolean;
  color?: InkColor;
  bgColor?: InkColor;
}

function parseMarkdown(content: string): MarkdownSegment[] {
  const lines = content.split("\n");
  const result: MarkdownSegment[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      if (!inCodeBlock) continue;
    }

    if (inCodeBlock) {
      result.push({
        text: "  " + line,
        dim: true,
        color: "blue",
      });
      continue;
    }

    const segments = parseInlineMarkdown(line);
    result.push(...segments);
  }

  return result;
}

function parseInlineMarkdown(line: string): MarkdownSegment[] {
  if (line.startsWith("# ")) {
    return [{ text: line.slice(2), bold: true }];
  }
  if (line.startsWith("## ")) {
    return [{ text: line.slice(3), bold: true }];
  }
  if (line.startsWith("### ")) {
    return [{ text: line.slice(4), bold: true }];
  }

  if (line.startsWith("- ") || line.startsWith("* ")) {
    return [{ text: "  • " + line.slice(2), dim: false }];
  }

  if (/^\d+\.\s/.test(line)) {
    return [{ text: "  " + line, dim: false }];
  }

  const segments: MarkdownSegment[] = [];
  const _remaining = line;
  const pattern = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, match.index) });
    }

    if (match[1]) {
      segments.push({ text: match[2], bold: true });
    } else if (match[3]) {
      segments.push({ text: match[4], italic: true });
    } else if (match[5]) {
      segments.push({ text: match[6], dim: true, color: "green" });
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ text: line }];
}

function formatToolCalls(content: string | ToolCall[]): string {
  if (Array.isArray(content)) {
    return content
      .map((tc: ToolCall) => `[Tool: ${tc.name}(${JSON.stringify(tc.arguments)})]`)
      .join(", ");
  }
  return String(content);
}