import type { CommandModule } from "./types.js";
import type { HookConfig, HooksSettings, HookEvent } from "../hooks/hook-events.js";

const HOOK_EVENTS: HookEvent[] = [
  "PreToolUse", "PostToolUse", "Stop", "Notification",
  "SessionStart", "SessionEnd", "PreCompact", "PostCompact",
  "PreQuery", "PostQuery",
];

function formatHook(h: HookConfig, i: number): string {
  const matcher = "matcher" in h ? ` [${(h as { matcher?: string }).matcher ?? "*"}]` : "";
  let detail = "";
  if (h.type === "command") detail = (h as { command: string }).command.slice(0, 60);
  else if (h.type === "http") detail = (h as { url: string }).url.slice(0, 60);
  else if (h.type === "prompt") detail = (h as { prompt: string }).prompt.slice(0, 60);
  return `  ${i}. ${h.type}${matcher}: ${detail}`;
}

const command: CommandModule = {
  name: "/hooks",
  aliases: ["/hk"],
  description: "List, add, or remove hooks",
  argumentHint: "[list|add|remove <event> [matcher]]",
  async execute(args, ctx) {
    const mgr = ctx.engine.getHooksConfigManager();
    const parts = args.split(/\s+/).filter(Boolean);
    const sub = parts[0]?.toLowerCase();

    if (!sub || sub === "list") {
      const hooks = mgr.loadFromSettings();
      const lines: string[] = ["Configured hooks:", ""];
      let hasAny = false;
      for (const event of HOOK_EVENTS) {
        const list = hooks[event];
        if (list && list.length > 0) {
          hasAny = true;
          lines.push(`${event}:`);
          list.forEach((h, i) => lines.push(formatHook(h, i + 1)));
          lines.push("");
        }
      }
      if (!hasAny) lines.push("  No hooks configured.");
      return { success: true, message: lines.join("\n") };
    }

    if (sub === "add") {
      if (parts.length < 3) {
        return { success: false, message: "Usage: /hooks add <event> <type> <command|url|prompt> [matcher]" };
      }
      const [event, type, ...rest] = parts.slice(1);
      if (!HOOK_EVENTS.includes(event as HookEvent)) {
        return { success: false, message: `Invalid event: ${event}. Valid: ${HOOK_EVENTS.join(", ")}` };
      }
      if (!["command", "http", "prompt"].includes(type!)) {
        return { success: false, message: `Invalid type: ${type}. Valid: command, http, prompt` };
      }
      const hook: HookConfig = { type: type as HookConfig["type"] } as HookConfig;
      if (type === "command") (hook as { command: string }).command = rest[0] ?? "";
      else if (type === "http") (hook as { url: string }).url = rest[0] ?? "";
      else if (type === "prompt") (hook as { prompt: string }).prompt = rest.join(" ");
      if (rest.length > 1 && type !== "prompt") {
        (hook as { matcher?: string }).matcher = rest[1];
      }
      mgr.addHook(event as HookEvent, hook);
      return { success: true, message: `Hook added to ${event}: ${type}` };
    }

    if (sub === "remove") {
      if (parts.length < 3) {
        return { success: false, message: "Usage: /hooks remove <event> <matcher>" };
      }
      const [event, matcher] = parts.slice(1);
      if (!HOOK_EVENTS.includes(event as HookEvent)) {
        return { success: false, message: `Invalid event: ${event}` };
      }
      const removed = mgr.removeHook(event as HookEvent, matcher!);
      return { success: removed > 0, message: `Removed ${removed} hook(s) from ${event}.` };
    }

    return { success: false, message: `Unknown sub-command: ${sub}. Try: list, add, remove` };
  },
};
export default command;
