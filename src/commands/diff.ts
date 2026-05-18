import { execSync } from "child_process";
import type { CommandModule } from "./types.js";

const command: CommandModule = {
  name: "/diff",
  aliases: [],
  description: "Show git diff of current changes",
  argumentHint: "[--staged]",
  async execute(args, ctx) {
    const staged = args.includes("--staged");
    const cmd = staged ? "git diff --staged --stat" : "git diff --stat";

    try {
      const stat = execSync(cmd, {
        cwd: ctx.projectPath,
        encoding: "utf-8",
        timeout: 15000,
      }).trim();

      if (!stat) {
        return { success: true, message: "No changes." };
      }

      // Get detailed diff for changed files (limited output)
      const detailCmd = staged ? "git diff --staged" : "git diff";
      let detail = "";
      try {
        detail = execSync(detailCmd, {
          cwd: ctx.projectPath,
          encoding: "utf-8",
          timeout: 15000,
          maxBuffer: 100 * 1024,
        });
      } catch { /* detail may be too large */ }

      const MAX = 8000;
      const truncated = detail.length > MAX
        ? detail.slice(0, MAX) + `\n\n... truncated (${detail.length - MAX} more chars)`
        : detail;

      return { success: true, message: `## Changed files\n\n${stat}\n\n## Diff\n\n${truncated || "(no detailed diff)"}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/not a git repository/i.test(message)) {
        return { success: false, message: "Not a git repository." };
      }
      if (/command not found/i.test(message) || /ENOENT/i.test(message)) {
        return { success: false, message: "Git not found. Is git installed?" };
      }
      return { success: false, message: `Git error: ${message}` };
    }
  },
};
export default command;
