import type { CommandModule } from "./types.js";
import { loadMergedBindings, getBindingHelp, formatShortcut } from "../keybindings/index.js";

const command: CommandModule = {
  name: "/keybindings",
  aliases: [],
  description: "Show or manage keyboard shortcuts",
  argumentHint: "[list|context <name>]",
  async execute(args, _ctx) {
    const parts = args.split(/\s+/).filter(Boolean);
    const sub = parts[0]?.toLowerCase();

    if (!sub || sub === "list") {
      const bindings = loadMergedBindings();
      const byCtx = new Map<string, string[]>();
      for (const b of bindings) {
        const ctx = b.context || "global";
        if (!byCtx.has(ctx)) byCtx.set(ctx, []);
        byCtx.get(ctx)!.push(`  ${formatShortcut(b.key).padEnd(8)} ${b.description || b.action}`);
      }
      const lines = [`${bindings.length} keybindings:`, ""];
      for (const [ctx, entries] of byCtx) {
        lines.push(`[${ctx}]`);
        lines.push(...entries);
        lines.push("");
      }
      return { success: true, message: lines.join("\n") };
    }

    if (sub === "context") {
      const ctx = parts[1] || "global";
      const help = getBindingHelp(ctx);
      return { success: true, message: help };
    }

    return {
      success: true,
      message: `Keybindings are configured in ~/.agent_1/keybindings.json\n\n${getBindingHelp()}`,
    };
  },
};
export default command;
