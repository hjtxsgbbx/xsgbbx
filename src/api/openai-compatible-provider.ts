import { type AIProvider, type ChatResponse, type StreamEvent, type ToolDefinition, type ChatMessage } from "./types.js";
import { type Config, type ToolCall } from "../types/index.js";
import { mapStopReason, safeParseJson } from "./utils.js";
import { FALLBACK_MODEL, TIMEOUTS, LIMITS, MODEL_CONTEXT_WINDOWS } from "../core/constants.js";
import { type OpenAIChatResponse, type OpenAIStreamEvent, type OpenAIModelsResponse } from "./api-response-types.js";

export interface ProviderEndpoint {
  providerName: string;
  baseUrl: string;
  apiKey: string;
}

// ---------------------------------------------------------------------------
// Message formatting — OpenAI-compatible format requires:
//   assistant + tool_calls → { role, content?, tool_calls[{id,type,function}] }
//   tool result             → { role: "tool", tool_call_id, content }
// ---------------------------------------------------------------------------

function formatOpenAIMessage(m: ChatMessage): Record<string, unknown> {
  // Assistant message with tool calls
  if (m.role === "assistant" && Array.isArray(m.content)) {
    const toolCalls = m.content.map((tc: ToolCall) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
    }));
    const msg: Record<string, unknown> = {
      role: "assistant",
      content: null,
      tool_calls: toolCalls,
    };
    // DeepSeek V4: reasoning_content MUST be round-tripped always — empty string included
    msg.reasoning_content = m.reasoning_content ?? "";
    return msg;
  }

  // Tool result message — MUST have tool_call_id in OpenAI format
  if (m.role === "tool") {
    return {
      role: "tool",
      tool_call_id: m.tool_id || "",
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    };
  }

  // Regular user/assistant text message
  const msg: Record<string, unknown> = {
    role: m.role,
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  };
  // DeepSeek V4: reasoning_content MUST be present on every assistant message
  if (m.role === "assistant") {
    msg.reasoning_content = m.reasoning_content ?? "";
  }
  return msg;
}

export class OpenAICompatibleProvider implements AIProvider {
  name: string;
  baseUrl: string;
  apiKey: string;

  constructor(endpoint: ProviderEndpoint) {
    this.name = endpoint.providerName;
    this.baseUrl = endpoint.baseUrl.replace(/\/$/, "");
    this.apiKey = endpoint.apiKey;
  }

  getChatEndpoint(): string {
    return `${this.baseUrl}/chat/completions`;
  }

  getModelsEndpoint(): string {
    return `${this.baseUrl}/models`;
  }

  async healthCheck(): Promise<{ ok: boolean; models: string[]; error?: string }> {
    try {
      const response = await fetch(this.getModelsEndpoint(), {
        method: "GET",
        headers: this.apiKey
          ? { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }
          : { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(TIMEOUTS.HEALTH_CHECK_MS),
      });
      if (!response.ok) {
        return { ok: false, models: [], error: `HTTP ${response.status}` };
      }
      const data = (await response.json()) as OpenAIModelsResponse;
      const rawModels = data.data || data.models || [];
      const models = rawModels.map((m) => m.id || m.name || m.model || "").filter(Boolean);
      return { ok: true, models };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, models: [], error: message };
    }
  }

  async chatCompletion(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    config: Config,
    _apiKey: string
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
      ...messages.map((m) => formatOpenAIMessage(m)),
    ];

    // Debug: log the last user message being sent
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
    if (lastUserMsg) {
      const content = typeof lastUserMsg.content === "string" ? lastUserMsg.content.slice(0, 80) : "(tool_calls)";
      console.error(`[xsgbbx] API call → ${messages.length} msgs, last user: "${content}"`);
    }

    const model = config.model || FALLBACK_MODEL;
    const body: Record<string, unknown> = {
      model,
      max_tokens: model.includes("deepseek") ? 8192 : LIMITS.DEFAULT_MAX_TOKENS,
      messages: allMessages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      temperature: 0.3,
    };
    if (model.includes("deepseek")) {
      body.thinking = { type: "disabled" };
    }

    const response = await fetch(this.getChatEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUTS.API_REQUEST_MS),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`${this.name} API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as OpenAIChatResponse;
    const choice = data.choices?.[0];
    const message = choice?.message;
    const toolCalls: ToolCall[] = (message?.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function?.name || "",
      arguments: safeParseJson(tc.function?.arguments || "{}"),
    }));
    const usage = data.usage;

    return {
      content: message?.content || "",
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: mapStopReason(choice?.finish_reason || "stop"),
      usage: usage
        ? {
            input: usage.prompt_tokens || 0,
            output: usage.completion_tokens || 0,
            total: usage.total_tokens || 0,
            limit: MODEL_CONTEXT_WINDOWS[model] || 1_000_000,
          }
        : undefined,
    };
  }

  async *streamChatCompletion(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    config: Config,
    _apiKey: string
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
      ...messages.map((m) => formatOpenAIMessage(m)),
    ];

    // Debug: log the last user message being sent
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
    if (lastUserMsg) {
      const content = typeof lastUserMsg.content === "string" ? lastUserMsg.content.slice(0, 80) : "(tool_calls)";
      console.error(`[xsgbbx] API stream → ${messages.length} msgs, last user: "${content}"`);
    }

    const model = config.model || FALLBACK_MODEL;
    const body: Record<string, unknown> = {
      model,
      max_tokens: model.includes("deepseek") ? 8192 : LIMITS.DEFAULT_MAX_TOKENS,
      stream: true,
      messages: allMessages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      temperature: 0.3,
    };

    const response = await fetch(this.getChatEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUTS.API_STREAM_MS),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`${this.name} API error (${response.status}): ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    const toolCallAccumulator = new Map<number, { id: string; name: string; args: string }>();
    let finalStopReason: string | undefined;
    let finalUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

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

            // DeepSeek reasoning_content — emit as reasoning event
            const reasoningContent =
              (choice.delta as Record<string, unknown> | undefined)
                ?.["reasoning_content"] as string | undefined;
            if (reasoningContent) {
              yield { type: "reasoning", text: reasoningContent };
            }

            // Regular text content
            if (choice.delta?.content) {
              yield { type: "text", text: choice.delta.content };
            }

            // Tool call accumulation
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
                const acc = toolCallAccumulator.get(idx)!;
                if (tc.id) acc.id = tc.id;
                if (tc.function?.name) acc.name = tc.function.name;
                if (tc.function?.arguments) acc.args += tc.function.arguments;
              }
            }

            // Capture usage from stream (DeepSeek includes usage in some chunks)
            if (event.usage) {
              finalUsage = event.usage;
            }

            if (choice.finish_reason) {
              finalStopReason = choice.finish_reason;
              // Emit accumulated tool calls
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
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
    } finally {
      reader.releaseLock();
      yield {
        type: "done",
        stopReason: finalStopReason,
        usage: finalUsage
          ? {
              input: finalUsage.prompt_tokens || 0,
              output: finalUsage.completion_tokens || 0,
              total: finalUsage.total_tokens || 0,
              limit: MODEL_CONTEXT_WINDOWS[config.model || FALLBACK_MODEL] || 1_000_000,
            }
          : undefined,
      };
    }
  }
}
