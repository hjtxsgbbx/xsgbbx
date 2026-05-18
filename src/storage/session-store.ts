import * as path from "path";
import * as fs from "fs";
import { promises as fsp } from "fs";
import { type Session } from "../types/index.js";
import { getAgentDir } from "../pal/index.js";
import { v4 as uuidv4 } from "uuid";

export class SessionStore {
  private sessionsDir: string;
  private sessionCache: Map<string, { session: Session; mtime: number }>;

  constructor() {
    const agentDir = getAgentDir();
    this.sessionsDir = path.join(agentDir, "sessions");
    this.sessionCache = new Map();
  }

  create(projectPath: string, platform: string, terminal: string, provider: string, model: string): Session {
    const dir = this.sessionsDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const session: Session = {
      session_id: uuidv4(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      client_type: "cli",
      status: "active",
      messages: [],
      meta: {
        project_path: projectPath,
        model,
        provider,
        cost_estimate: 0,
        platform,
        terminal,
      },
    };

    void this.saveSessionAsync(session);
    this.sessionCache.set(session.session_id, { session, mtime: Date.now() });
    return session;
  }

  saveSession(session: Session): void {
    void this.saveSessionAsync(session).catch(() => { /* best-effort */ });
  }

  async saveSessionAsync(session: Session): Promise<void> {
    const dir = this.sessionsDir;
    await fsp.mkdir(dir, { recursive: true });

    session.updated_at = new Date().toISOString();
    const filePath = path.join(dir, `${session.session_id}.json`);
    const tmpPath = filePath + ".tmp";

    try {
      await fsp.writeFile(tmpPath, JSON.stringify(session, null, 2), "utf-8");
      await fsp.rename(tmpPath, filePath);
      this.sessionCache.set(session.session_id, { session, mtime: Date.now() });
    } catch {
      /* best-effort save, degrade gracefully */
    }
  }

  loadSession(sessionId: string): Session | null {
    const cached = this.sessionCache.get(sessionId);
    if (cached) return cached.session;

    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const session = JSON.parse(raw) as Session;
      this.sessionCache.set(sessionId, { session, mtime: Date.now() });
      return session;
    } catch {
      return null;
    }
  }

  getLastSession(projectPath: string): Session | null {
    for (const [, cached] of this.sessionCache) {
      if (
        cached.session.meta.project_path === projectPath &&
        cached.session.status === "active"
      ) {
        const age = Date.now() - new Date(cached.session.updated_at).getTime();
        if (age < 24 * 60 * 60 * 1000) {
          return cached.session;
        }
      }
    }

    if (!fs.existsSync(this.sessionsDir)) return null;

    const files = fs.readdirSync(this.sessionsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(this.sessionsDir, f))
      .sort((a, b) => {
        const statA = fs.statSync(a);
        const statB = fs.statSync(b);
        return statB.mtimeMs - statA.mtimeMs;
      });

    for (const file of files) {
      try {
        const raw = fs.readFileSync(file, "utf-8");
        const session = JSON.parse(raw) as Session;
        this.sessionCache.set(session.session_id, { session, mtime: Date.now() });
        if (
          session.meta.project_path === projectPath &&
          session.status === "active"
        ) {
          const age = Date.now() - new Date(session.updated_at).getTime();
          if (age < 24 * 60 * 60 * 1000) {
            return session;
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  getLastSessionId(): string | null {
    for (const [id, cached] of this.sessionCache) {
      if (cached.session.status === "active") {
        const age = Date.now() - new Date(cached.session.updated_at).getTime();
        if (age < 24 * 60 * 60 * 1000) {
          return id;
        }
      }
    }

    if (!fs.existsSync(this.sessionsDir)) return null;

    const files = fs.readdirSync(this.sessionsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(this.sessionsDir, f))
      .sort((a, b) => {
        try {
          return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
        } catch {
          return 0;
        }
      });

    if (files.length === 0) return null;

    try {
      const raw = fs.readFileSync(files[0], "utf-8");
      const session = JSON.parse(raw) as Session;
      this.sessionCache.set(session.session_id, { session, mtime: Date.now() });
      if (session.status === "active") {
        const age = Date.now() - new Date(session.updated_at).getTime();
        if (age < 24 * 60 * 60 * 1000) {
          return session.session_id;
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  invalidateCache(sessionId: string): void {
    this.sessionCache.delete(sessionId);
  }

  cleanup(retentionDays: number): number {
    if (!fs.existsSync(this.sessionsDir)) return 0;

    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let cleaned = 0;

    const files = fs.readdirSync(this.sessionsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const filePath = path.join(this.sessionsDir, file);
      const sessionId = file.replace(".json", "");
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          this.sessionCache.delete(sessionId);
          cleaned++;
        }
      } catch {
        continue;
      }
    }

    for (const [id, cached] of this.sessionCache) {
      if (cached.mtime < cutoff) {
        this.sessionCache.delete(id);
      }
    }

    return cleaned;
  }
}