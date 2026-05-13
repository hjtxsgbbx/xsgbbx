import {
  SessionContext,
  QueryResult,
  TokenUsage,
  StopReason,
  ToolCall,
  AssistantResponse,
} from "../types/index.js";
import { Tool, getToolSignatures } from "../tools/index.js";
import { Config } from "../types/index.js";

export interface StreamEvent {
  type: "text" | "tool_use" | "tool_result" | "done" | "thinking";
  text?: string;
  toolCall?: ToolCall;
  usage?: TokenUsage;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface OpenAIToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIMessage {
  content: string;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIChoice {
  message: OpenAIMessage;
  finish_reason: string;
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface AIProvider {
  name: string;
  chatCompletion(
    messages: Array<{ role: string; content: string | ToolCall[] }>,
    systemPrompt: string,
    tools: Tool[],
    config: Config,
    apiKey: string
  ): Promise<{
    content: string;
    toolCalls?: ToolCall[];
    stopReason: StopReason;
    usage?: TokenUsage;
  }>;
  streamChatCompletion(
    messages: Array<{ role: string; content: string | ToolCall[] }>,
    systemPrompt: string,
    tools: Tool[],
    config: Config,
    apiKey: string
  ): AsyncGenerator<StreamEvent>;
}

export type AgentMode = "plan" | "act" | "default";

export function createSystemPrompt(
  platform: string,
  permissionMode: string,
  projectSummary: string,
  mode: AgentMode = "default",
  repoMapText?: string,
  projectMemory?: string,
  envSnapshot?: string
): string {
  if (mode === "plan") {
    return createPlanPrompt(platform, permissionMode, projectSummary, repoMapText, projectMemory, envSnapshot);
  }
  if (mode === "act") {
    return createActPrompt(platform, permissionMode, projectSummary, repoMapText, projectMemory, envSnapshot);
  }
  return createDefaultPrompt(platform, permissionMode, projectSummary, repoMapText, projectMemory, envSnapshot);
}

function createPlanPrompt(
  platform: string,
  permissionMode: string,
  projectSummary: string,
  repoMapText?: string,
  projectMemory?: string,
  envSnapshot?: string
): string {
  let prompt = `You are agent_1 in **PLAN MODE**. You are a strategic software architect.
Your SOLE purpose is to analyze requirements and create a detailed execution plan.
DO NOT execute any tools. DO NOT write or modify files. DO NOT run any commands.

=== SYSTEM INFO ===
Platform: ${platform}
Permission mode: ${permissionMode}
Mode: PLAN — analysis and design only

`;

  if (projectMemory) {
    prompt += `=== PROJECT MEMORY ===
${projectMemory}

`;
  }

  if (repoMapText) {
    prompt += `=== CODEBASE STRUCTURE ===
${repoMapText}

`;
  } else if (projectSummary) {
    prompt += `=== PROJECT CONTEXT ===
${projectSummary}

`;
  }

  if (envSnapshot) {
    prompt += `=== ENVIRONMENT ===
${envSnapshot}

`;
  }

  prompt += `=== PLAN MODE INSTRUCTIONS ===
1. Analyze the user's request thoroughly.
2. Identify ALL files that need to be created, modified, or deleted.
3. List the exact sequence of actions in order of execution.
4. Identify potential risks, conflicts, and edge cases.
5. Consider platform-specific requirements (${platform}).
6. Output ONLY a structured plan — no code changes, no commands.

Your response format:
## Analysis
[Brief analysis of the task]

## Files to Create/Modify
- path/to/file1.ts: [description of changes]
- path/to/file2.ts: [description of changes]

## Execution Sequence
1. [Step 1]
2. [Step 2]
...

## Risks & Considerations
- [Risk 1]
- [Risk 2]

DO NOT write any actual code. DO NOT execute any commands.
`;

  return prompt;
}

function createActPrompt(
  platform: string,
  permissionMode: string,
  projectSummary: string,
  repoMapText?: string,
  projectMemory?: string,
  envSnapshot?: string
): string {
  let prompt = `You are agent_1 in **ACT MODE**. You are an expert software engineer executing a plan.
Execute the plan step-by-step using available tools. Be efficient, accurate, and thorough.

=== SYSTEM INFO ===
Platform: ${platform}
Permission mode: ${permissionMode}
Mode: ACT — execute the plan

`;

  if (projectMemory) {
    prompt += `=== PROJECT MEMORY ===
${projectMemory}

`;
  }

  if (repoMapText) {
    prompt += `=== CODEBASE STRUCTURE ===
${repoMapText}

`;
  } else if (projectSummary) {
    prompt += `=== PROJECT CONTEXT ===
${projectSummary}

`;
  }

  if (envSnapshot) {
    prompt += `=== ENVIRONMENT ===
${envSnapshot}

`;
  }

  prompt += `=== ACT MODE INSTRUCTIONS ===
1. Follow the execution plan precisely.
2. Use tools to create/modify files and execute commands.
3. Verify each step before moving to the next.
4. If you encounter errors, diagnose and fix them — NEVER give up.
5. Adapt commands to the target platform: ${platform}.
6. Use absolute paths for all file operations.
7. After completing all steps, SUMMARIZE what was done.
8. Generate conventional commit messages when committing.
9. If a command fails, read the error, understand it, and fix the issue.
10. ALWAYS verify your work — run linters, tests, and builds after changes.
`;

  return prompt;
}

function createDefaultPrompt(
  platform: string,
  permissionMode: string,
  projectSummary: string,
  repoMapText?: string,
  projectMemory?: string,
  envSnapshot?: string
): string {
  let prompt = `You are agent_1, a cross-platform AI programming assistant. 
You help developers complete programming tasks by reading/writing files, executing commands, and managing git.

=== SYSTEM INFO ===
Platform: ${platform}
Permission mode: ${permissionMode}

`;

  if (projectMemory) {
    prompt += `=== PROJECT MEMORY ===
${projectMemory}

`;
  }

  if (repoMapText) {
    prompt += `=== CODEBASE STRUCTURE ===
${repoMapText}

`;
  } else if (projectSummary) {
    prompt += `=== PROJECT CONTEXT ===
${projectSummary}

`;
  }

  if (envSnapshot) {
    prompt += `=== ENVIRONMENT ===
${envSnapshot}

`;
  }

  prompt += `=== INSTRUCTIONS ===
1. Use tools to complete tasks. Be efficient and accurate.
2. Only modify files that are necessary for the task.
3. When executing shell commands, ensure they are safe and platform-appropriate.
4. After completing a task, summarize what was done.
5. If you encounter errors, try to diagnose and fix them.
6. Always use absolute paths when reading/writing files.
7. Generate conventional commit messages when committing code.
8. Use the repository map to navigate the codebase efficiently.
`;

  return prompt;
}

function buildThinkingConfig(
  config: Config,
  isModernModel: boolean
): Record<string, unknown> | undefined {
  const effort = config.thinking_effort;

  if (isModernModel && effort) {
    return {
      type: "enabled",
      effort,
    };
  }

  if (!isModernModel && config.thinking_budget_tokens && config.thinking_budget_tokens > 0) {
    return {
      type: "enabled",
      budget_tokens: config.thinking_budget_tokens,
    };
  }

  return undefined;
}

class AnthropicProvider implements AIProvider {
  name = "anthropic";

  async chatCompletion(
    messages: Array<{ role: string; content: string | ToolCall[] }>,
    systemPrompt: string,
    tools: Tool[],
    config: Config,
    apiKey: string
  ): Promise<{
    content: string;
    toolCalls?: ToolCall[];
    stopReason: StopReason;
    usage?: TokenUsage;
  }> {
    const toolDefs = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    const model = config.model || "claude-sonnet-4-20250514";
    const isModernModel = model.includes("claude-sonnet-4") || model.includes("claude-opus-4");
    const thinkingConfig = buildThinkingConfig(config, isModernModel);

    const body: Record<string, unknown> = {
      model,
      max_tokens: 4096,
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

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    const content = data.content || [];
    const textParts = content
      .filter((c: AnthropicContentBlock) => c.type === "text")
      .map((c: AnthropicContentBlock) => c.text || "")
      .join("\n");

    const toolUseParts = content.filter((c: AnthropicContentBlock) => c.type === "tool_use");
    const toolCalls: ToolCall[] = toolUseParts.map((c: AnthropicContentBlock) => ({
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
    messages: Array<{ role: string; content: string | ToolCall[] }>,
    systemPrompt: string,
    tools: Tool[],
    config: Config,
    apiKey: string
  ): AsyncGenerator<StreamEvent> {
    const toolDefs: Array<Record<string, unknown>> = tools.map((t, i) => {
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

    const model = config.model || "claude-sonnet-4-20250514";
    const isModernModel = model.includes("claude-sonnet-4") || model.includes("claude-opus-4");
    const thinkingConfig = buildThinkingConfig(config, isModernModel);

    const body: Record<string, unknown> = {
      model,
      max_tokens: 4096,
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

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
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
            const event = JSON.parse(jsonStr);

            switch (event.type) {
              case "content_block_delta": {
                const delta = event.delta;
                if (delta.type === "text_delta") {
                  yield { type: "text", text: delta.text };
                } else if (delta.type === "input_json_delta") {
                  if (currentToolUse) {
                    currentToolUse.input += delta.partial_json;
                  }
                } else if (delta.type === "thinking_delta") {
                  yield { type: "thinking", text: delta.thinking };
                }
                break;
              }
              case "content_block_start": {
                const block = event.content_block;
                if (block.type === "tool_use") {
                  currentToolUse = { id: block.id, name: block.name, input: "" };
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
                    // incomplete JSON, skip
                  }
                  currentToolUse = null;
                }
                break;
              }
              case "message_delta": {
                if (event.usage) {
                  yield {
                    type: "done",
                    usage: {
                      input: event.usage.input_tokens || 0,
                      output: event.usage.output_tokens || 0,
                      total: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
                      limit: 200000,
                    },
                  };
                }
                if (event.usage?.cache_read_input_tokens) {
                  yield {
                    type: "done",
                    usage: {
                      input: event.usage.input_tokens || 0,
                      output: event.usage.output_tokens || 0,
                      total: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
                      limit: 200000,
                      cacheRead: event.usage.cache_read_input_tokens,
                      cacheCreation: event.usage.cache_creation_input_tokens || 0,
                    } as TokenUsage,
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

class OpenAIProvider implements AIProvider {
  name = "openai";

  async chatCompletion(
    messages: Array<{ role: string; content: string | ToolCall[] }>,
    systemPrompt: string,
    tools: Tool[],
    config: Config,
    apiKey: string
  ): Promise<{
    content: string;
    toolCalls?: ToolCall[];
    stopReason: StopReason;
    usage?: TokenUsage;
  }> {
    const toolDefs = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const allMessages = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
    ];

    const body: Record<string, unknown> = {
      model: config.model || "gpt-4o",
      max_tokens: 4096,
      messages: allMessages,
      tools: toolDefs,
      tool_choice: "auto",
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    const choice = data.choices?.[0];
    const message = choice?.message;

    const toolCalls: ToolCall[] = (message?.tool_calls || []).map((tc: OpenAIToolCall) => ({
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
        limit: 128000,
      },
    };
  }

  async *streamChatCompletion(
    messages: Array<{ role: string; content: string | ToolCall[] }>,
    systemPrompt: string,
    tools: Tool[],
    config: Config,
    apiKey: string
  ): AsyncGenerator<StreamEvent> {
    const toolDefs = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const allMessages = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
    ];

    const body: Record<string, unknown> = {
      model: config.model || "gpt-4o",
      max_tokens: 4096,
      stream: true,
      messages: allMessages,
      tools: toolDefs,
      tool_choice: "auto",
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    const toolCallAccumulator: Map<number, { id: string; name: string; args: string }> = new Map();

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
            const event = JSON.parse(jsonStr);
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
                const acc = toolCallAccumulator.get(idx)!;
                if (tc.id) acc.id = tc.id;
                if (tc.function?.name) acc.name = tc.function.name;
                if (tc.function?.arguments) acc.args += tc.function.arguments;
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

function mapStopReason(raw: string): StopReason {
  switch (raw) {
    case "end_turn":
    case "stop":
    case "stop_sequence":
      return "end_turn";
    case "tool_use":
    case "tool_calls":
      return "tool_use";
    case "max_tokens":
    case "length":
      return "max_tokens";
    default:
      return "stop_sequence";
  }
}

export function createProvider(providerName: string): AIProvider {
  if (providerName === "openai") {
    return new OpenAIProvider();
  }
  return new AnthropicProvider();
}