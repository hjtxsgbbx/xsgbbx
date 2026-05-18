import * as path from "path";
import * as fs from "fs";
import { getAgentDir } from "../pal/index.js";

export { ConfigStore, DEFAULT_CONFIG, PROVIDER_PRESETS, resolveProviderConfig } from "./config-store.js";
export { SessionStore } from "./session-store.js";
export { AuditLogger, TelemetryLogger } from "./audit-logger.js";
export type { AuditStats } from "./audit-logger.js";

export function purgeAll(): boolean {
  try {
    const agentDir = getAgentDir();
    if (fs.existsSync(agentDir)) {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
    return true;
  } catch {
    return false;
  }
}

export function exportData(outputPath: string): boolean {
  try {
    const agentDir = getAgentDir();
    if (!fs.existsSync(agentDir)) return false;

    const data: Record<string, unknown> = {};

    const sessionsDir = path.join(agentDir, "sessions");
    if (fs.existsSync(sessionsDir)) {
      const sessions: Record<string, unknown> = {};
      const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(sessionsDir, file), "utf-8");
          sessions[file.replace(".json", "")] = JSON.parse(raw);
        } catch {
          continue;
        }
      }
      data.sessions = sessions;
    }

    const configPath = path.join(agentDir, "config.json");
    if (fs.existsSync(configPath)) {
      data.config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }

    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}