import type { CommandModule } from "./types.js";

const command: CommandModule = {
  name: "/help",
  aliases: ["/h"],
  description: "Show command help",
  argumentHint: "",
  async execute(_args, _ctx) {
    // Lazy import to avoid circular dependency
    const { getRegistry } = await import("./register.js");
    const registry = await getRegistry();
    const modules = registry.listModules();

    const lines: string[] = ["Commands:", ""];
    const maxName = Math.max(...modules.map((m) => {
      const aliasStr = m.aliases.length > 0 ? ` (${m.aliases.join(", ")})` : "";
      return (m.name + aliasStr).length;
    }));

    for (const m of modules) {
      const aliasStr = m.aliases.length > 0 ? ` (${m.aliases.join(", ")})` : "";
      const name = (m.name + aliasStr).padEnd(maxName + 2);
      const hint = m.argumentHint ? ` ${m.argumentHint}` : "";
      lines.push(`  ${name}${m.description}${hint}`);
    }

    lines.push("", "Shortcuts:", "  >> <prompt>    Interrupt and send new prompt", "  Ctrl+C         Interrupt current task", "  Ctrl+D         Exit (on empty input)");

    return { success: true, message: lines.join("\n") };
  },
};
export default command;
