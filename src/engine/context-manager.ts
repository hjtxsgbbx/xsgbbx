import type { Message, Config } from "../types/index.js";
import type { AIProvider } from "../api/index.js";
import { LIMITS } from "../core/constants.js";

/**
 * Context Manager — simplified for DeepSeek 1M context.
 *
 * Claude Code has a 5-layer compaction pipeline because 200K is tight.
 * DeepSeek has 1M context, so 85% of sessions never need compaction.
 * We keep one core function: llmSummarize() for when compaction IS needed.
 */
export class ContextManager {
  private provider: AIProvider;

  constructor(provider: AIProvider) {
    this.provider = provider;
  }

  updateProvider(provider: AIProvider): void {
    this.provider = provider;
  }

  /**
   * Use the provider (or a cheaper model) to summarize messages.
   * Claude Code uses Haiku for this; DeepSeek version uses the same model
   * since it's cheap enough and the summary quality matters.
   */
  async llmSummarize(
    messages: Message[],
    config: Config,
    _provider?: AIProvider
  ): Promise<string> {
    if (messages.length === 0) return "";

    const compactPrompt = `Your task is to create a detailed summary of the conversation so far.
Pay close attention to the user's explicit requests and your previous actions.
This summary should capture technical details, code patterns, and architectural decisions.

Your summary MUST include:
1. Primary Request and Intent: All of the user's explicit requests
2. Key Technical Concepts: Technologies, frameworks, patterns discussed
3. Files and Code Sections: Specific files examined, modified, or created
4. Errors and Fixes: All errors encountered and how they were fixed
5. Problem Solving: Problems solved and ongoing troubleshooting
6. All User Messages: All non-tool-result user messages
7. Pending Tasks: Tasks explicitly asked to work on
8. Current Work: What was being worked on immediately before this summary

Format your response as structured sections under each heading above.
Be specific with file names, code snippets, and error messages.`;

    const messagesToSummarize: Array<{ role: "user" | "assistant" | "tool" | "system"; content: string }> = [
      { role: "system", content: compactPrompt },
    ];

    for (const msg of messages) {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      // Truncate very long messages to avoid the summarizer itself hitting limits
      const truncated = content.length > LIMITS.MAX_COMPACTION_OUTPUT
        ? content.slice(0, LIMITS.MAX_COMPACTION_OUTPUT / 2) +
          "\n...(truncated)...\n" +
          content.slice(-LIMITS.MAX_COMPACTION_OUTPUT / 2)
        : content;
      messagesToSummarize.push({ role: "user", content: truncated });
    }

    try {
      const summaryModel = config.model || "deepseek-chat";
      const response = await this.provider.chatCompletion(
        messagesToSummarize,
        "",
        [], // no tools for summarization
        { ...config, model: summaryModel },
        config.api_key_ref
      );
      return response.content;
    } catch {
      // Fallback: concatenate truncated message content
      return messages
        .slice(0, 20)
        .map((m) => {
          const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
          return `[${m.role}]: ${content.slice(0, 500)}`;
        })
        .join("\n");
    }
  }
}
