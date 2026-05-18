import { type AIProvider, type ChatResponse, type StreamEvent, type ToolDefinition, type ChatMessage } from "./types.js";
import { type Config, type ToolCall } from "../types/index.js";
import { mapStopReason } from "./utils.js";
import { FALLBACK_MODEL, TIMEOUTS, LIMITS, PROVIDER_DEFAULTS, MODEL_CONTEXT_WINDOWS } from "../core/constants.js";
import { type OpenAIChatResponse, type OpenAIStreamEvent } from "./api-response-types.js";

export class OpenAIProvider implements AIProvider {
  name = "openai";

  async chatCompletion(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    config: Config,
    apiKey: string
  ): Promise<ChatResponse> {
    const toolDefs = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const allMessages = [
      { role: "system" as const, content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
    ];

    const model = config.model || FALLBACK_MODEL;
    const body = {
      model,
      max_tokens: LIMITS.DEFAULT_MAX_TOKENS,
      messages: allMessages,
      tools: toolDefs,
      tool_choice: "auto" as const,
    };

    const baseUrl = config.provider_configs?.openai?.base_url || PROVIDER_DEFAULTS.openai.baseUrl;
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUTS.API_REQUEST_MS),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as OpenAIChatResponse;
    const choice = data.choices?.[0];
    const message = choice?.message;
    const toolCalls: ToolCall[] = (message?.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function?.name || "",
      arguments: JSON.parse(tc.function?.arguments || "{}"),
    }));

    return {
      content: message?.content || "",
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: mapStopReason(choice?.finish_reason || "stop"),
      usage: {
        input: data.usage?.prompt_tokens || 0,
        output: data.usage?.completion_tokens || 0,
        total: data.usage?.total_tokens || 0,
        limit: MODEL_CONTEXT_WINDOWS[model] || 128000,
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
    const toolDefs = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const allMessages = [
      { role: "system" as const, content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
    ];

    const model = config.model || FALLBACK_MODEL;
    const body = {
      model,
      max_tokens: LIMITS.DEFAULT_MAX_TOKENS,
      stream: true,
      messages: allMessages,
      tools: toolDefs,
      tool_choice: "auto" as const,
    };

    const baseUrl = config.provider_configs?.openai?.base_url || PROVIDER_DEFAULTS.openai.baseUrl;
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUTS.API_STREAM_MS),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    const toolCallAccumulator = new Map<number, { id: string; name: string; args: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;
          const jsonStr = trimmed.slice(6);

          try {
            const event = JSON.parse(jsonStr) as OpenAIStreamEvent;
            const choice = event.choices?.[0];
            if (!choice) continue;

            if (choice.delta?.content) {
              yield { type: "text", text: choice.delta.content };
            }

            if (choice.delta?.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                const idx = tc.index || 0;
                if (!toolCallAccumulator.has(idx)) {
                  toolCallAccumulator.set(idx, {
                    id: tc.id || "",
                    name: tc.function?.name || "",
                    args: "",
                  });
                }
                const acc = toolCallAccumulator.get(idx);
                if (acc) {
                  if (tc.id) acc.id = tc.id;
                  if (tc.function?.name) acc.name = tc.function.name;
                  if (tc.function?.arguments) acc.args += tc.function.arguments;
                }
              }
            }

            if (choice.finish_reason) {
              for (const [, acc] of toolCallAccumulator) {
                if (acc.name && acc.args) {
                  try {
                    yield {
                      type: "tool_use",
                      toolCall: {
                        id: acc.id,
                        name: acc.name,
                        arguments: JSON.parse(acc.args),
                      },
                    };
                  } catch {
                    // skip unparseable tool args
                  }
                }
              }
              yield { type: "done" };
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
