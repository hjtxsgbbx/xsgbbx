import { APP_VERSION } from "../core/constants.js";
import type { CommandModule } from "./types.js";

const command: CommandModule = {
  name: "/status",
  aliases: ["/s"],
  description: "Show session status",
  argumentHint: "",
  async execute(_args, ctx) {
    const session = ctx.session;
    const mode = ctx.engine.getMode();
    const tracker = ctx.engine.getCostTracker();
    const metrics = tracker?.getMetrics();

    const lines = [
      `agent_1 v${APP_VERSION}`,
      `Session: ${session?.session_id.slice(0, 8) ?? "none"}`,
      `Status: ${session?.status ?? "no session"}`,
      `Provider: ${ctx.config.chosen_provider || "auto-detect"}`,
      `Model: ${ctx.config.model || "default"}`,
      `Mode: ${mode}`,
      `Permission: ${ctx.config.permission_mode}`,
      `Project: ${ctx.projectPath}`,
      `Running: ${ctx.getPendingResponse() ? "yes" : "idle"}`,
    ];

    if (metrics) {
      lines.push(
        `Turns: ${metrics.totalTurns}/${metrics.maxTurns}`,
        `Tools: ${metrics.totalToolCalls} (${metrics.successfulToolCalls} ok)`,
        `Tokens: ${metrics.totalInputTokens.toLocaleString()} in / ${metrics.totalOutputTokens.toLocaleString()} out`,
        `Cost: ~$${metrics.estimatedCostUSD.toFixed(4)}`,
      );
    }

    if (session?.messages?.length) {
      lines.push(`Messages: ${session.messages.length}`);
    }

    return { success: true, message: lines.join("\n") };
  },
};
export default command;
