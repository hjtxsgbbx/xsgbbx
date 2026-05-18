export interface AnthropicContentBlock {
  type: "text" | "tool_use" | "thinking";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  thinking?: string;
}

export interface AnthropicChatResponse {
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface AnthropicStreamEvent {
  type: "content_block_delta" | "content_block_start" | "content_block_stop" | "message_delta" | "message_stop" | "error";
  delta?: {
    type: "text_delta" | "input_json_delta" | "thinking_delta";
    text?: string;
    partial_json?: string;
    thinking?: string;
  };
  content_block?: {
    type: "text" | "tool_use";
    id?: string;
    name?: string;
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  error?: {
    message: string;
  };
}

export interface OpenAIChatChoice {
  message: {
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: string;
}

export interface OpenAIToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIChatResponse {
  choices: OpenAIChatChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIStreamChoice {
  delta: {
    content?: string;
    tool_calls?: Array<{
      index: number;
      id?: string;
      function: {
        name?: string;
        arguments?: string;
      };
    }>;
  };
  finish_reason: string | null;
}

export interface OpenAIStreamEvent {
  choices: OpenAIStreamChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIModelsResponse {
  data?: Array<{ id?: string; name?: string; model?: string }>;
  models?: Array<{ id?: string; name?: string; model?: string }>;
}
