import type { CommandModule } from "./types.js";

const COMPACT_PROMPT = `Compact the current conversation context to free token budget.
1. Summarize early messages into a concise form
2. Preserve critical information: decisions, errors, key findings
3. Drop redundant or ephemeral content
4. Keep recent context verbatim

DeepSeek has 1M context, so only compact when truly needed (>85% usage).`;

const command: CommandModule = {
  name: "/compact",
  aliases: ["/cmp"],
  description: "Compact conversation context",
  argumentHint: "",
  async execute(_args, ctx) {
    const session = ctx.session;
    if (!session) {
      return { success: false, message: "No active session." };
    }
    const msgCount = session.messages.length;
    if (msgCount < 10) {
      return { success: true, message: `Session has only ${msgCount} messages. Compaction not needed.` };
    }
    // Trigger the AI to compact via prompt injection
    return {
      success: true,
      prompt: COMPACT_PROMPT,
      message: `Compact triggered on ${msgCount} messages.`,
    };
  },
};
export default command;
