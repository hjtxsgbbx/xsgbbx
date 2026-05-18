import type { CommandModule } from "./types.js";

const command: CommandModule = {
  name: "/cost",
  aliases: ["/$"],
  description: "Show token usage and cost",
  argumentHint: "",
  async execute(_args, ctx) {
    const tracker = ctx.engine.getCostTracker();
    if (!tracker) {
      return { success: false, message: "Cost tracker not available." };
    }

    const metrics = tracker.getMetrics();
    const budget = tracker.getBudgetStatus();
    const burnRate = tracker.getTokenBurnRate();

    const lines = [
      `Session: ${metrics.sessionId.slice(0, 8)}`,
      `Turns: ${metrics.totalTurns}/${metrics.maxTurns}`,
      `Tools: ${metrics.totalToolCalls} total (${metrics.successfulToolCalls} ok, ${metrics.failedToolCalls} fail)`,
      `Tokens: ${metrics.totalInputTokens.toLocaleString()} in / ${metrics.totalOutputTokens.toLocaleString()} out`,
      `  Total: ${(metrics.totalInputTokens + metrics.totalOutputTokens).toLocaleString()}`,
      `Cost: ~$${metrics.estimatedCostUSD.toFixed(4)}`,
      `Burn rate: ~${burnRate.toLocaleString()} tokens/min`,
      "",
    ];

    if (budget.costPercentUsed >= 0) {
      lines.push(`Cost budget: ${budget.costPercentUsed.toFixed(1)}%${budget.costWarning ? " WARNING" : ""}`);
    }
    if (budget.tokensPercentUsed >= 0) {
      lines.push(`Token budget: ${budget.tokensPercentUsed.toFixed(1)}%${budget.tokensWarning ? " WARNING" : ""}`);
    }

    if (metrics.errorsEncountered > 0) {
      lines.push(`Errors: ${metrics.errorsEncountered}`);
    }

    return { success: true, message: lines.join("\n") };
  },
};
export default command;
