import type { CommandModule } from "./types.js";
import { getAllSkills } from "../skills/index.js";

const command: CommandModule = {
  name: "/skills",
  aliases: ["/sk"],
  description: "List available skills",
  argumentHint: "[search]",
  async execute(args, _ctx) {
    const all = getAllSkills();
    const query = args.trim().toLowerCase();

    const filtered = query
      ? all.filter((s) => s.name.includes(query) || s.description.toLowerCase().includes(query))
      : all;

    if (filtered.length === 0) {
      return { success: true, message: `No skills found${query ? ` matching "${query}"` : ""}.` };
    }

    const lines: string[] = [`${filtered.length} skill(s)${query ? ` matching "${query}"` : ""}:`, ""];
    const maxName = Math.max(...filtered.map((s) => s.name.length));
    for (const s of filtered) {
      const name = s.name.padEnd(maxName + 2);
      const aliases = s.aliases?.length ? ` [${s.aliases.join(", ")}]` : "";
      const argHint = s.argumentHint ? ` ${s.argumentHint}` : "";
      const source = s.source === "disk" ? " (user)" : "";
      lines.push(`  ${name}${s.description}${aliases}${source}`);
    }
    return { success: true, message: lines.join("\n") };
  },
};
export default command;
