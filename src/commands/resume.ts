import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { CommandModule } from "./types.js";

const SESSIONS_DIR = join(homedir(), ".xsgbbx", "sessions");

const command: CommandModule = {
  name: "/resume",
  aliases: [],
  description: "Resume most recent session",
  argumentHint: "[session-id | last]",
  async execute(args, ctx) {
    const targetId = args.trim() || "last";

    if (targetId !== "last") {
      const filePath = join(SESSIONS_DIR, `${targetId}.json`);
      if (!existsSync(filePath)) {
        return { success: false, message: `Session not found: ${targetId}` };
      }
      try {
        const raw = readFileSync(filePath, "utf-8");
        const session = JSON.parse(raw);
        ctx.engine.setSession(session);
        return { success: true, message: `Resumed session: ${session.session_id.slice(0, 8)} (${session.messages?.length ?? 0} messages)` };
      } catch {
        return { success: false, message: `Failed to load session: ${targetId}` };
      }
    }

    // Find most recent active session
    if (!existsSync(SESSIONS_DIR)) {
      return { success: false, message: "No sessions directory found." };
    }

    const files = readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => join(SESSIONS_DIR, f))
      .sort((a, b) => {
        try { return statSync(b).mtimeMs - statSync(a).mtimeMs; } catch { return 0; }
      });

    for (const file of files) {
      try {
        const session = JSON.parse(readFileSync(file, "utf-8"));
        if (session.status === "active") {
          ctx.engine.setSession(session);
          return { success: true, message: `Resumed session: ${session.session_id.slice(0, 8)} (${session.messages?.length ?? 0} messages, from ${session.created_at})` };
        }
      } catch { continue; }
    }

    return { success: false, message: "No recent active sessions found." };
  },
};
export default command;
