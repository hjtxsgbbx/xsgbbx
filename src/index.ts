#!/usr/bin/env node

import { createInterface } from "readline";
import * as fs from "fs";
import * as path from "path";
import { startCLI } from "./cli/main.js";
import { detectPlatform } from "./pal/index.js";
import { ConfigStore, purgeAll, exportData } from "./storage/index.js";
import type { AuditLogEntry } from "./types/index.js";

export enum ExitCode {
  SUCCESS = 0,
  USER_ERROR = 1,
  APP_ERROR = 2,
  CONFIG_ERROR = 3,
  NETWORK_ERROR = 4,
  PERMISSION_DENIED = 5,
  TIMEOUT = 6,
}

const args = process.argv.slice(2);

function isFlag(arg: string): boolean {
  return arg.startsWith("-");
}

function hasFlag(flags: string[]): boolean {
  return flags.some(f => args.includes(f));
}

function getFlagValue(flags: string[]): string | undefined {
  for (const flag of flags) {
    const idx = args.indexOf(flag);
    if (idx >= 0 && idx + 1 < args.length && !isFlag(args[idx + 1])) {
      return args[idx + 1];
    }
  }
  return undefined;
}

const outputFormat = getFlagValue(["--output", "-o"]) || "text";
const noInteractive = hasFlag(["--no-interactive", "--no-prompt", "-y"]);
const outputFile = getFlagValue(["--output-file"]);

function jsonOutput(data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  if (outputFile) {
    fs.writeFileSync(outputFile, json, "utf-8");
  }
  console.log(json);
}

function textOutput(message: string): void {
  if (outputFile) {
    fs.writeFileSync(outputFile, message, "utf-8");
  }
  console.log(message);
}

function structuredExit(code: ExitCode, message?: string): never {
  if (outputFormat === "json") {
    jsonOutput({ exitCode: code, message: message || null });
  } else if (message) {
    console.log(message);
  }
  process.exit(code);
}

// --version
if (hasFlag(["--version", "-v"])) {
  if (outputFormat === "json") {
    jsonOutput({ name: "agent_1", version: "1.0.0", node: process.version, platform: process.platform, arch: process.arch });
  } else {
    console.log("agent_1 v1.0.0");
  }
  process.exit(ExitCode.SUCCESS);
}

// --help
if (hasFlag(["--help", "-h"])) {
  const helpText = `agent_1 - 跨平台 AI 编程助手 v1.0.0

Usage:
  agent_1                        Start interactive REPL
  agent_1 -p <prompt>            Headless mode (requires --accept-terms)
  agent_1 --version              Print version and exit
  agent_1 --help                 Print this help and exit
  agent_1 status                 Show system and session status

Options:
  --output, -o <format>          Output format: text (default) | json
  --output-file <path>           Write output to file instead of stdout
  --no-interactive, -y           Disable all interactive prompts
  --accept-terms                 Accept terms of service

Commands (in REPL):
  /help                          Show all commands
  /status                        Show current status
  /clear                         Clear session messages
  /mode                          Toggle plan/default mode
  /exit                          Exit agent_1
  /export                        Export session data
  /config                        Manage configuration
  >>text                         Interrupt current task

CLI Commands:
  agent_1 export --format json   Export all local data
  agent_1 purge --all            Delete all local data
  agent_1 status --json          Show status in JSON format
  agent_1 config show            Show current configuration
  agent_1 config set <k> <v>     Set configuration value
  agent_1 batch <task>           Execute task in background
  agent_1 audit stats            Show audit log statistics
  agent_1 audit recent [min]     Show recent audit activity
  agent_1 audit query [action]   Query audit log entries
  agent_1 audit purge            Delete all audit logs
  agent_1 pr preview             Preview PR without creating
  agent_1 pr create              Create PR from current changes
  agent_1 pr list                List open pull requests
  agent_1 pr status              Show PR workflow status

Environment Variables:
  AGENT_1_NO_COLOR=true          Disable ANSI color output
  AGENT_1_PORT=<port>            WebSocket server port (default: 3099)
  AGENT_1_HOST=<host>            WebSocket server host (default: 127.0.0.1)
  AGENT_1_PROJECT=<path>         Default project directory
  AGENT_1_SANDBOX_MODE=<mode>    Sandbox mode: off|readonly|workspace|full
`;
  if (outputFormat === "json") {
    jsonOutput({
      name: "agent_1",
      version: "1.0.0",
      usage: "See --help for text output",
    });
  } else {
    console.log(helpText);
  }
  process.exit(ExitCode.SUCCESS);
}

// status command
if (args[0] === "status") {
  const platform = detectPlatform();
  const configStore = new ConfigStore();
  const config = configStore.load();

  const status = {
    version: "1.0.0",
    platform: {
      os: platform.os,
      terminal: platform.terminal,
      shell: platform.shell,
      arch: platform.arch,
      nodeVersion: platform.nodeVersion,
    },
    config: {
      provider: config.chosen_provider || "not set",
      model: config.model || "default",
      permissionMode: config.permission_mode,
      autoCommit: config.auto_commit,
      maxTurns: config.max_turns,
      termsAccepted: config.accept_terms,
      sandboxMode: config.sandbox_mode || "off",
      mcpServers: config.mcp_servers?.length || 0,
    },
    session: {
      active: false,
    },
  };

  if (hasFlag(["--json"]) || outputFormat === "json") {
    jsonOutput(status);
  } else {
    textOutput(
      `agent_1 v1.0.0 Status\n` +
      `====================\n` +
      `Platform: ${status.platform.os} (${status.platform.terminal})\n` +
      `Shell: ${status.platform.shell}\n` +
      `Provider: ${status.config.provider}\n` +
      `Model: ${status.config.model}\n` +
      `Permission Mode: ${status.config.permissionMode}\n` +
      `Sandbox Mode: ${status.config.sandboxMode}\n` +
      `MCP Servers: ${status.config.mcpServers}\n` +
      `Terms Accepted: ${status.config.termsAccepted}\n`
    );
  }
  process.exit(ExitCode.SUCCESS);
}

// config command
if (args[0] === "config") {
  const configStore = new ConfigStore();
  const config = configStore.load();

  if (args[1] === "show" || args.length === 1) {
    if (outputFormat === "json") {
      jsonOutput(config);
    } else {
      textOutput(JSON.stringify(config, null, 2));
    }
    process.exit(ExitCode.SUCCESS);
  }

  if (args[1] === "set" && args.length >= 4) {
    const key = args[2];
    const value = args[3];
    const updated = { ...config };
    (updated as Record<string, unknown>)[key] = value;
    configStore.save(updated as typeof config);
    textOutput(`✔ Config updated: ${key} = ${value}`);
    process.exit(ExitCode.SUCCESS);
  }

  if (args[1] === "reset") {
    const defaultConfig = configStore.load();
    configStore.save(defaultConfig);
    textOutput("✔ Config reset to defaults");
    process.exit(ExitCode.SUCCESS);
  }

  textOutput("Usage: agent_1 config [show|set <key> <value>|reset]");
  process.exit(ExitCode.USER_ERROR);
}

// export command
if (args[0] === "export" && hasFlag(["--format"])) {
  const format = getFlagValue(["--format"]) || "json";
  const outputPath = outputFile || `agent_1_export_${Date.now()}.${format}`;
  const success = exportData(outputPath);
  if (success) {
    textOutput(`✔ Data exported to: ${outputPath}`);
    process.exit(ExitCode.SUCCESS);
  } else {
    textOutput("✖ Export failed. No data to export.");
    process.exit(ExitCode.APP_ERROR);
  }
}

// purge command
if (args[0] === "purge" && hasFlag(["--all"])) {
  if (noInteractive) {
    const success = purgeAll();
    if (success) {
      textOutput("✔ All local data has been purged.");
      process.exit(ExitCode.SUCCESS);
    } else {
      textOutput("✖ Purge failed.");
      process.exit(ExitCode.APP_ERROR);
    }
  }

  console.log("⚠ This will permanently delete all local agent_1 data.");
  console.log("Note: Data already sent to AI providers cannot be recovered.");
  console.log("Type 'DELETE' to confirm: ");

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question("", (answer: string) => {
    if (answer.trim() === "DELETE") {
      const success = purgeAll();
      if (success) {
        console.log("✔ All local data has been purged.");
      } else {
        console.log("✖ Purge failed.");
      }
    } else {
      console.log("Purge cancelled.");
    }
    rl.close();
    process.exit(0);
  });
}

// batch command
else if (args[0] === "batch") {
  const taskDescription = args.slice(1).join(" ");
  if (!taskDescription) {
    textOutput("Usage: agent_1 batch <task description> [--project <path>]");
    process.exit(ExitCode.USER_ERROR);
  }

  const projectPath = getFlagValue(["--project"]) || process.cwd();
  textOutput(`Starting batch task...`);
  textOutput(`Project: ${projectPath}`);
  textOutput(`Task: ${taskDescription}`);

  const runBatch = async () => {
    const { createBatchAgent } = await import("../src/core/batch-agent.js");

    const platform = detectPlatform();
    const batchAgent = createBatchAgent({
      platform,
      workingDir: projectPath,
      onProgress: (_task, turn, message) => {
        if (turn > 0) {
          textOutput(`[Turn ${turn}] ${message}`);
        } else {
          textOutput(`  ${message}`);
        }
      },
      onComplete: (task) => {
        if (outputFormat === "json") {
          jsonOutput(task);
        } else {
          textOutput(`\n✔ Batch task completed!`);
          textOutput(`  Turns: ${task.result?.turnsExecuted || 0}`);
          textOutput(`  Tokens: ${task.result?.tokensUsed || 0}`);
          textOutput(`  Cost: $${(task.result?.cost || 0).toFixed(4)}`);
          textOutput(`  Duration: ${((task.result?.durationMs || 0) / 1000).toFixed(1)}s`);
          textOutput(`  Summary: ${task.result?.summary || ""}`);
        }
        process.exit(ExitCode.SUCCESS);
      },
      onError: (_task, error) => {
        structuredExit(ExitCode.APP_ERROR, `Batch task failed: ${error}`);
      },
    });

    await batchAgent.executeTask(taskDescription, projectPath);
  };

  runBatch();
}

// audit command
else if (args[0] === "audit") {
  const { AuditLogger } = await import("../src/storage/index.js");
  const auditLogger = new AuditLogger();

  if (args[1] === "stats") {
    const stats = auditLogger.getStats();
    if (outputFormat === "json") {
      jsonOutput(stats);
    } else {
      textOutput(`Audit Statistics`);
      textOutput(`=================`);
      textOutput(`Total entries: ${stats.totalEntries}`);
      textOutput(`Allowed: ${stats.allowedCount}`);
      textOutput(`Denied: ${stats.deniedCount}`);
      textOutput(`Overridden: ${stats.overriddenCount}`);
      textOutput(`Unique tools: ${stats.uniqueTools}`);
      textOutput(`First entry: ${stats.firstEntry || "N/A"}`);
      textOutput(`Last entry: ${stats.lastEntry || "N/A"}`);
      textOutput(``);
      textOutput(`By action:`);
      for (const [action, count] of Object.entries(stats.byAction)) {
        textOutput(`  ${action}: ${count}`);
      }
    }
    process.exit(ExitCode.SUCCESS);
  }

  if (args[1] === "recent") {
    const minutes = parseInt(args[2]) || 60;
    const entries = auditLogger.getRecentActivity(minutes);
    if (outputFormat === "json") {
      jsonOutput(entries);
    } else {
      textOutput(`Recent audit activity (last ${minutes} min):`);
      textOutput(`${"=".repeat(40)}`);
      if (entries.length === 0) {
        textOutput("No recent activity.");
      } else {
        for (const entry of entries) {
          textOutput(`[${entry.timestamp.slice(11, 19)}] ${entry.action} | ${entry.tool_name || "-"} | ${entry.decision} | ${entry.command_summary?.slice(0, 80) || ""}`);
        }
      }
    }
    process.exit(ExitCode.SUCCESS);
  }

  if (args[1] === "query") {
    const action = args[2] as AuditLogEntry["action"] | undefined;
    const limit = parseInt(getFlagValue(["--limit"]) || "50");
    const entries = auditLogger.query({ action, limit });
    if (outputFormat === "json") {
      jsonOutput(entries);
    } else {
      textOutput(`Audit log (${entries.length} entries):`);
      textOutput(`${"=".repeat(60)}`);
      for (const entry of entries.slice(0, limit)) {
        textOutput(`[${entry.timestamp.slice(0, 19)}] ${entry.action.padEnd(20)} | ${entry.decision.padEnd(12)} | ${entry.tool_name || "-"}`);
      }
    }
    process.exit(ExitCode.SUCCESS);
  }

  if (args[1] === "purge") {
    const success = auditLogger.purgeAll();
    if (success) {
      textOutput("✔ All audit logs purged.");
    } else {
      textOutput("✖ Failed to purge audit logs.");
    }
    process.exit(success ? ExitCode.SUCCESS : ExitCode.APP_ERROR);
  }

  textOutput("Usage: agent_1 audit [stats|recent|query|purge]");
  process.exit(ExitCode.USER_ERROR);
}

// pr command
else if (args[0] === "pr") {
  const runPrCommand = async () => {
    const { PRManager } = await import("../src/core/pr-manager.js");
    const sessionId = getFlagValue(["--session"]) || `cli-${Date.now()}`;
    const projectPath = getFlagValue(["--project"]) || process.cwd();
    const prManager = new PRManager(sessionId, projectPath);

    if (args[1] === "create") {
      const baseBranch = getFlagValue(["--base"]);
      const draft = hasFlag(["--draft"]);
      const metadata = prManager.buildPRMetadata(baseBranch);
      const result = prManager.createPR(metadata, { draft });

      if (outputFormat === "json") {
        jsonOutput(result);
      } else if (result.success) {
        textOutput(`✔ PR created: ${result.url}`);
        textOutput(`  Branch: ${result.branch} → ${result.baseBranch}`);
        textOutput(`  PR #: ${result.number || "N/A"}`);
      } else {
        textOutput(`✖ PR creation failed: ${result.error}`);
      }
      process.exit(result.success ? ExitCode.SUCCESS : ExitCode.APP_ERROR);
    }

    if (args[1] === "preview") {
      const metadata = prManager.buildPRMetadata();
      if (outputFormat === "json") {
        jsonOutput(metadata);
      } else {
        textOutput(`PR Preview`);
        textOutput(`${"=".repeat(40)}`);
        textOutput(`Title: ${metadata.title}`);
        textOutput(`Branch: ${metadata.branch} → ${metadata.baseBranch}`);
        textOutput(`Files: ${metadata.files.length}`);
        textOutput(`Additions: +${metadata.additions}`);
        textOutput(`Deletions: -${metadata.deletions}`);
        textOutput(`Commits: ${metadata.commits.length}`);
        textOutput(``);
        textOutput(`Description:`);
        textOutput(`${"-".repeat(40)}`);
        textOutput(metadata.description);
      }
      process.exit(ExitCode.SUCCESS);
    }

    if (args[1] === "list") {
      const prList = prManager.listOpenPRs();
      if (outputFormat === "json") {
        jsonOutput(prList);
      } else if (prList.length === 0) {
        textOutput("No open PRs found.");
      } else {
        textOutput(`Open PRs (${prList.length}):`);
        for (const pr of prList) {
          textOutput(`  #${pr.number} - ${pr.title} [${pr.state}]`);
        }
      }
      process.exit(ExitCode.SUCCESS);
    }

    if (args[1] === "status") {
      const ghInstalled = prManager.checkGHCliInstalled();
      if (outputFormat === "json") {
        jsonOutput({ ghInstalled, branch: prManager.getCurrentBranch(), baseBranch: prManager.getDefaultBaseBranch() });
      } else {
        textOutput(`PR Status`);
        textOutput(`${"=".repeat(40)}`);
        textOutput(`GitHub CLI: ${ghInstalled ? "✔ installed" : "✖ not installed"}`);
        textOutput(`Current branch: ${prManager.getCurrentBranch()}`);
        textOutput(`Base branch: ${prManager.getDefaultBaseBranch()}`);
      }
      process.exit(ExitCode.SUCCESS);
    }

    textOutput("Usage: agent_1 pr [create|preview|list|status] [--session <id>] [--project <path>] [--base <branch>] [--draft]");
    process.exit(ExitCode.USER_ERROR);
  };

  runPrCommand();
}

else {
  startMain();
}

function startMain(): void {
  const isHeadless = hasFlag(["-p"]);
  const acceptTerms = hasFlag(["--accept-terms"]);
  const projectPath = process.cwd();

  if (isHeadless) {
    const prompt = getFlagValue(["-p"]);
    if (prompt) {
      if (acceptTerms) {
        const configStore = new ConfigStore();
        const config = configStore.load();
        config.accept_terms = true;
        configStore.save(config);
      }

      const runHeadless = async () => {
        try {
          await startCLI({
            projectPath,
            headless: true,
            prompt,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          structuredExit(ExitCode.APP_ERROR, `Error: ${message}`);
        }
      };
      runHeadless();
      return;
    }
  }

  startCLI({ projectPath, headless: false });
}