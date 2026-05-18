import { execSync } from "child_process";
import { existsSync } from "fs";
import { homedir, totalmem, freemem, cpus, platform, arch, version } from "os";
import { join } from "path";
import type { CommandModule, CommandContext } from "./types.js";

function check(name: string, ok: boolean, detail: string): string {
  const icon = ok ? "PASS" : "FAIL";
  return `  [${icon}] ${name.padEnd(20)} ${detail}`;
}

async function runChecks(ctx: CommandContext): Promise<string> {
  const lines: string[] = ["System Diagnostic Report", "======================", ""];

  // 1. Node.js
  lines.push("1. Node.js Environment");
  lines.push(check("Node version", true, version()));
  lines.push(check("Platform", true, `${platform()} ${arch()}`));

  // 2. Git
  let gitOk = false, gitVer = "not found";
  try {
    gitVer = execSync("git --version", { encoding: "utf-8", timeout: 5000 }).trim();
    gitOk = true;
  } catch { /* git not available */ }
  lines.push("");
  lines.push("2. Git");
  lines.push(check("Git available", gitOk, gitVer));

  // 3. API Key
  const provider = ctx.config.chosen_provider || "not set";
  const pc = ctx.config.provider_configs?.[provider];
  const hasKey = !!(pc?.api_key && pc.api_key !== "");
  const envMapped = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "GOOGLE_API_KEY"]
    .some((k) => process.env[k]);
  lines.push("");
  lines.push("3. API Key Configuration");
  lines.push(check("Provider set", !!ctx.config.chosen_provider, provider));
  lines.push(check("API key present", hasKey || envMapped, hasKey ? "configured" : envMapped ? "from env" : "missing"));

  // 4. MCP
  const mcpServers = ctx.config.mcp_servers || [];
  const mcpOk = mcpServers.every((s) => s.enabled !== false);
  lines.push("");
  lines.push("4. MCP Servers");
  lines.push(check("MCP servers", mcpOk, `${mcpServers.length} configured`));

  // 5. Disk
  const agentDir = join(homedir(), ".xsgbbx");
  lines.push("");
  lines.push("5. Disk & Memory");
  lines.push(check("Agent dir exists", existsSync(agentDir), agentDir));
  lines.push(check("Free memory", true, `${Math.round(freemem() / 1024 / 1024)}MB / ${Math.round(totalmem() / 1024 / 1024)}MB`));
  lines.push(check("CPU cores", true, `${cpus().length} logical`));

  // 6. Project
  const projectFiles = [".agent_1.md", "CLAUDE.md", "package.json", "tsconfig.json"]
    .filter((f) => existsSync(join(ctx.projectPath, f)));
  lines.push("");
  lines.push("6. Project Detection");
  lines.push(check("Project path", existsSync(ctx.projectPath), ctx.projectPath));
  lines.push(check("Config files", projectFiles.length > 0, projectFiles.join(", ") || "none"));

  return lines.join("\n");
}

const command: CommandModule = {
  name: "/doctor",
  aliases: ["/d"],
  description: "System diagnostic and health check",
  argumentHint: "",
  async execute(_args, ctx) {
    try {
      const report = await runChecks(ctx);
      return { success: true, message: report };
    } catch (err) {
      return { success: false, message: `Diagnostic failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
export default command;
