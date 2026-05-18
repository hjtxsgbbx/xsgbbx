import { buildThinkingConfig } from "./system-prompt.js";
import { type AIProvider, type ChatResponse, type StreamEvent, type ToolDefinition, type ChatMessage } from "./types.js";
import { type Config, type ToolCall } from "../types/index.js";
import { mapStopReason } from "./utils.js";
import { DEFAULT_MODEL, ANTHROPIC_API_VERSION, TIMEOUTS, LIMITS, PROVIDER_DEFAULTS } from "../core/constants.js";
import { type AnthropicChatResponse, type AnthropicStreamEvent } from "./api-response-types.js";

export class AnthropicProvider implements AIProvider {
  name = "anthropic";

  async chatCompletion(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    config: Config,
    apiKey: string
  ): Promise<ChatResponse> {
    const toolDefs = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    const model = config.model || DEFAULT_MODEL;
    const isModernModel = model.includes("claude-sonnet-4") || model.includes("claude-opus-4");
    const thinkingConfig = buildThinkingConfig(config, isModernModel);

    const body: Record<string, unknown> = {
      model,
      max_tokens: LIMITS.DEFAULT_MAX_TOKENS,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
      tools: toolDefs,
    };

    if (thinkingConfig) {
      body.thinking = thinkingConfig;
    }
    if (config.response_format) {
      body.response_format = config.response_format;
    }

    const baseUrl = config.provider_configs?.anthropic?.base_url || PROVIDER_DEFAULTS.anthropic.baseUrl;
    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUTS.API_REQUEST_MS),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as AnthropicChatResponse;
    const content = data.content || [];
    const textParts = content
      .filter((c) => c.type === "text")
      .map((c) => c.text || "")
      .join("\n");
    const toolUseParts = content.filter((c) => c.type === "tool_use");
    const toolCalls: ToolCall[] = toolUseParts.map((c) => ({
      id: c.id || "",
      name: c.name || "",
      arguments: c.input || {},
    }));
    const stopReason = data.stop_reason || "end_turn";

    return {
      content: textParts,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: mapStopReason(stopReason),
      usage: {
        input: data.usage?.input_tokens || 0,
        output: data.usage?.output_tokens || 0,
        total: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        limit: 200000,
      },
    };
  }

  async *streamChatCompletion(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    config: Config,
    apiKey: string
  ): AsyncGenerator<StreamEvent> {
    const toolDefs = tools.map((t, i) => {
      const def: Record<string, unknown> = {
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      };
      if (i === tools.length - 1) {
        def.cache_control = { type: "ephemeral" };
      }
      return def;
    });

    const model = config.model || DEFAULT_MODEL;
    const isModernModel = model.includes("claude-sonnet-4") || model.includes("claude-opus-4");
    const thinkingConfig = buildThinkingConfig(config, isModernModel);

    const body: Record<string, unknown> = {
      model,
      max_tokens: LIMITS.DEFAULT_MAX_TOKENS,
      stream: true,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
      tools: toolDefs,
    };

    if (thinkingConfig) {
      body.thinking = thinkingConfig;
    }

    const baseUrl = config.provider_configs?.anthropic?.base_url || PROVIDER_DEFAULTS.anthropic.baseUrl;
    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUTS.API_STREAM_MS),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let currentToolUse: { id: string; name: string; input: string } | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const jsonStr = trimmed.slice(6);

          try {
            const event = JSON.parse(jsonStr) as AnthropicStreamEvent;

            switch (event.type) {
              case "content_block_delta": {
                const delta = event.delta;
                if (delta?.type === "text_delta" && delta.text) {
                  yield { type: "text", text: delta.text };
                } else if (delta?.type === "input_json_delta" && delta.partial_json) {
                  if (currentToolUse) {
                    currentToolUse.input += delta.partial_json;
                  }
                } else if (delta?.type === "thinking_delta" && delta.thinking) {
                  yield { type: "thinking", text: delta.thinking };
                }
                break;
              }
              case "content_block_start": {
                const block = event.content_block;
                if (block?.type === "tool_use") {
                  currentToolUse = {
                    id: block.id || "",
                    name: block.name || "",
                    input: "",
                  };
                }
                break;
              }
              case "content_block_stop": {
                if (currentToolUse && currentToolUse.input) {
                  try {
                    const parsed = JSON.parse(currentToolUse.input);
                    yield {
                      type: "tool_use",
                      toolCall: {
                        id: currentToolUse.id,
                        name: currentToolUse.name,
                        arguments: parsed,
                      },
                    };
                  } catch {
                    // incomplete JSON
                  }
                  currentToolUse = null;
                }
                break;
              }
              case "message_delta": {
                const usage = event.usage;
                if (usage) {
                  yield {
                    type: "done",
                    usage: {
                      input: usage.input_tokens || 0,
                      output: usage.output_tokens || 0,
                      total: (usage.input_tokens || 0) + (usage.output_tokens || 0),
                      limit: 200000,
                    },
                  };
                }
                break;
              }
              case "message_stop": {
                yield { type: "done" };
                break;
              }
              case "error": {
                throw new Error(`Stream error: ${event.error?.message || "Unknown"}`);
              }
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
    } finally {
      reader.releaseLock();
      yield { type: "done" };
    }
  }
}
