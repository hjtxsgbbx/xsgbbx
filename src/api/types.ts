import { type Config, type TokenUsage, type StopReason, type ToolCall, type JSONSchema } from "../types/index.js";

export type AgentMode = "default" | "plan" | "act";

export interface ChatMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string | ToolCall[];
  tool_id?: string;
  reasoning_content?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  stopReason: StopReason;
  usage?: TokenUsage;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_use"; toolCall: ToolCall }
  | { type: "done"; usage?: TokenUsage; stopReason?: string };

export interface AIProvider {
  name: string;
  chatCompletion(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    config: Config,
    apiKey: string
  ): Promise<ChatResponse>;
  streamChatCompletion(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    config: Config,
    apiKey: string
  ): AsyncGenerator<StreamEvent>;
}
