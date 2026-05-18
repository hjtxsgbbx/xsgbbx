import { APP_VERSION } from "../core/constants.js";
import type { QueryEngineImpl } from "../engine/query-engine.js";
import type { Config, Session } from "../types/index.js";
import type { SessionStore } from "../storage/index.js";
import type { BridgeConfig } from "./types.js";

// ============================================================================
// Slash Command Handler for AgentBridge
// ============================================================================

export type SlashResult = "handled" | "exit" | "pass";

export type SlashOutput = (text: string) => void;

export function tryHandleSlashCommand(
  text: string,
  engine: QueryEngineImpl,
  sessionStore: SessionStore,
  appConfig: Config,
  bridgeConfig: BridgeConfig,
  platform: { os: string; terminal: string },
  output: SlashOutput,
  getPendingResponse: () => boolean,
): SlashResult {
  if (!text.startsWith("/")) return "pass";

  const parts = text.slice(1).split(/\s+/);
  const command = parts[0]?.toLowerCase();
  const args = parts.slice(1).join(" ").trim();

  switch (command) {
    case "help":
      output([
        "Commands:",
        "  /help          Show this help",
        "  /exit          Exit agent_1",
        "  /status        Show current status",
        "  /mode [plan|default]  Toggle agent mode",
        "  /clear         Start a fresh session",
        "  /config        Show current configuration",
        "  <prompt>       Send a query to the AI",
        "  >><prompt>     Interrupt current task and send new prompt",
      ].join("\n"));
      return "handled";

    case "exit":
    case "quit":
      return "exit";

    case "status": {
      const status = {
        version: APP_VERSION,
        sessionId: bridgeConfig.sessionId,
        projectPath: bridgeConfig.projectPath,
        provider: appConfig.chosen_provider,
        model: appConfig.model,
        permissionMode: appConfig.permission_mode,
        transport: bridgeConfig.transport,
        running: getPendingResponse(),
      };
      output(`Status:\n${JSON.stringify(status, null, 2)}`);
      return "handled";
    }

    case "mode": {
      const newMode = args || (engine.getMode() === "plan" ? "default" : "plan");
      if (newMode === "plan" || newMode === "default") {
        engine.setMode(newMode);
        output(`Mode set to: ${newMode}`);
      }
      return "handled";
    }

    case "clear": {
      const fresh = sessionStore.create(
        bridgeConfig.projectPath,
        platform.os,
        platform.terminal,
        appConfig.chosen_provider,
        appConfig.model,
      );
      engine.setSession(fresh);
      output("Session cleared");
      return "handled";
    }

    case "config": {
      output(`Config:\n${JSON.stringify(appConfig, null, 2)}`);
      return "handled";
    }

    default:
      output(`Unknown command: /${command}. Type /help for commands.`);
      return "handled";
  }
}

export function buildWelcomeLines(bridgeConfig: BridgeConfig, appConfig: Config): string[] {
  return [
    `agent_1 v${APP_VERSION}  |  project: ${bridgeConfig.projectPath}`,
    `  provider: ${appConfig.chosen_provider || "not set"}  |  model: ${appConfig.model || "default"}`,
    `  transport: ${bridgeConfig.transport}`,
    `  session: ${bridgeConfig.sessionId}`,
    "",
    "  Type /help for commands, Ctrl+C to exit",
  ];
}
