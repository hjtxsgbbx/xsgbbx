import type { CommandModule } from "./types.js";
import type { Config } from "../types/index.js";

const SETTABLE_KEYS: Array<{ key: string; label: string; type: string }> = [
  { key: "permission_mode", label: "Permission mode", type: "default|plan|defaultDeny|autoApprove|sandbox" },
  { key: "model", label: "Model", type: "string" },
  { key: "chosen_provider", label: "Provider", type: "string" },
  { key: "max_turns", label: "Max turns", type: "number" },
  { key: "auto_commit", label: "Auto-commit", type: "boolean" },
  { key: "session_retention_days", label: "Session retention (days)", type: "number" },
  { key: "thinking_budget_tokens", label: "Thinking budget", type: "number" },
  { key: "thinking_effort", label: "Thinking effort", type: "low|medium|high" },
];

const command: CommandModule = {
  name: "/config",
  aliases: [],
  description: "Show or set configuration",
  argumentHint: "[key] [value]",
  async execute(args, ctx) {
    const parts = args.split(/\s+/).filter(Boolean);

    if (parts.length === 0) {
      // Show summary
      const lines = [
        `Provider: ${ctx.config.chosen_provider || "auto-detect"}`,
        `Model: ${ctx.config.model || "default"}`,
        `Permission: ${ctx.config.permission_mode}`,
        `Max turns: ${ctx.config.max_turns}`,
        `Auto-commit: ${ctx.config.auto_commit}`,
        `Auto-create PR: ${ctx.config.auto_create_pr}`,
        `Thinking effort: ${ctx.config.thinking_effort || "medium"}`,
        `Retention: ${ctx.config.session_retention_days} days`,
        "",
        "Settable keys:",
        ...SETTABLE_KEYS.map((k) => `  ${k.key.padEnd(26)} ${k.label} (${k.type})`),
      ];
      return { success: true, message: lines.join("\n") };
    }

    const key = parts[0]!;
    const entry = SETTABLE_KEYS.find((k) => k.key === key);
    if (!entry) {
      return { success: false, message: `Unknown config key: ${key}. Settable: ${SETTABLE_KEYS.map((k) => k.key).join(", ")}` };
    }

    if (parts.length === 1) {
      const val = (ctx.config as unknown as Record<string, unknown>)[key];
      return { success: true, message: `${key} = ${JSON.stringify(val)}` };
    }

    const raw = parts.slice(1).join(" ");
    let value: unknown = raw;
    if (entry.type === "number") value = Number(raw);
    else if (entry.type === "boolean") value = raw === "true" || raw === "yes" || raw === "1";
    else if (entry.type.includes("|")) {
      const allowed = entry.type.split("|");
      if (!allowed.includes(raw)) {
        return { success: false, message: `Invalid value: ${raw}. Allowed: ${allowed.join(", ")}` };
      }
    }

    const updated = { ...ctx.config, [key]: value };
    const { ConfigStore } = await import("../storage/config-store.js");
    const store = new ConfigStore();
    await store.save(updated);
    ctx.engine.refreshProvider(updated);
    return { success: true, message: `${key} = ${JSON.stringify(value)}` };
  },
};
export default command;
