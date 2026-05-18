import type { CommandModule } from "./types.js";
import type { AgentMode } from "../api/types.js";

const MODES: AgentMode[] = ["default", "plan", "act"];

const command: CommandModule = {
  name: "/mode",
  aliases: ["/m"],
  description: "Switch agent mode: plan, act, default",
  argumentHint: "[plan|act|default]",
  async execute(args, ctx) {
    const current = ctx.engine.getMode();
    const requested = (args.trim().toLowerCase() || "") as AgentMode;

    if (!requested) {
      // Cycle: default -> plan -> act -> default
      const idx = MODES.indexOf(current);
      const next = MODES[(idx + 1) % MODES.length]!;
      ctx.engine.setMode(next);
      return { success: true, message: `Mode: ${current} -> ${next}` };
    }

    if (!MODES.includes(requested)) {
      return { success: false, message: `Invalid mode: ${requested}. Valid: ${MODES.join(", ")}` };
    }

    if (requested === current) {
      return { success: true, message: `Already in ${current} mode.` };
    }

    ctx.engine.setMode(requested);
    return { success: true, message: `Mode set to: ${requested}` };
  },
};
export default command;
