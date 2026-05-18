import type { ToolCall, TokenUsage, SessionContext } from "../types/index.js";
import type { AIProvider } from "../api/index.js";
import { apiCircuitBreaker } from "../resilience/circuit-breaker.js";

export interface StreamResult {
  content: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  reasoningContent?: string;
  stopReason?: string;
}

export class ApiStreamer {
  private provider: AIProvider;

  constructor(provider: AIProvider) {
    this.provider = provider;
  }

  updateProvider(provider: AIProvider): void {
    this.provider = provider;
  }

  async streamApiCall(
    context: SessionContext,
    systemPrompt: string,
    currentModel: string,
    apiKey: string,
    tools: unknown[],
    onStreaming: (text: string) => void,
    onReasoning?: (text: string) => void
  ): Promise<StreamResult> {
    let fullContent = "";
    let reasoningContent = "";
    const rawToolCalls: ToolCall[] = [];
    let streamUsage: TokenUsage | undefined;
    let stopReason: string | undefined;

    const stream = await apiCircuitBreaker.call(async () => {
      return this.provider.streamChatCompletion(
        context.messages,
        systemPrompt,
        tools as Parameters<AIProvider["streamChatCompletion"]>[2],
        { ...context.config, model: currentModel },
        apiKey
      );
    });

    for await (const event of stream) {
      switch (event.type) {
        case "text":
          if (event.text) {
            fullContent += event.text;
            onStreaming(event.text);
          }
          break;
        case "thinking":
        case "reasoning":
          // DeepSeek reasoning_content — captured but not streamed to main output
          if (event.text) {
            reasoningContent += event.text;
            if (onReasoning) onReasoning(event.text);
          }
          break;
        case "tool_use":
          if (event.toolCall) {
            rawToolCalls.push(event.toolCall);
          }
          break;
        case "done":
          if (event.usage) streamUsage = event.usage;
          if (event.stopReason) stopReason = event.stopReason;
          break;
      }
    }

    return {
      content: fullContent,
      toolCalls: rawToolCalls,
      usage: streamUsage,
      reasoningContent,
      stopReason,
    };
  }
}
