import * as path from "path";
import * as fs from "fs";
import { promises as fsp } from "fs";
import { Session, Config, AuditLogEntry, TelemetryEntry } from "../types/index.js";
import { getAgentDir } from "../pal/index.js";
import { v4 as uuidv4 } from "uuid";

const DEFAULT_CONFIG: Config = {
  version: 3,
  permission_mode: "default",
  auto_create_pr: false,
  auto_commit: true,
  accept_terms: false,
  chosen_provider: "",
  session_retention_days: 30,
  telemetry_enabled: false,
  max_turns: 50,
  model: "claude-sonnet-4-20250514",
  api_key_ref: "",
  ui: {
    color_theme: "dark",
    compact_mode: false,
  },
  ai_safety_confidence_threshold: 0.7,
  thinking_effort: "medium",
};

export class ConfigStore {
  private configPath: string;

  constructor() {
    const agentDir = getAgentDir();
    this.configPath = path.join(agentDir, "config.json");
  }

  load(): Config {
    try {
      if (!fs.existsSync(this.configPath)) {
        return { ...DEFAULT_CONFIG };
      }

      const raw = fs.readFileSync(this.configPath, "utf-8");
      const stored = JSON.parse(raw) as Config;

      return { ...DEFAULT_CONFIG, ...stored };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  async save(config: Config): Promise<boolean> {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      config.version = DEFAULT_CONFIG.version;
      const data = JSON.stringify(config, null, 2);
      const tmpPath = this.configPath + ".tmp";
      await fsp.writeFile(tmpPath, data, "utf-8");
      await fsp.rename(tmpPath, this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  backup(): boolean {
    try {
      if (!fs.existsSync(this.configPath)) return false;
      const backupPath = this.configPath + ".bak";
      fs.copyFileSync(this.configPath, backupPath);
      return true;
    } catch {
      return false;
    }
  }

  restore(): boolean {
    try {
      const backupPath = this.configPath + ".bak";
      if (!fs.existsSync(backupPath)) return false;
      fs.copyFileSync(backupPath, this.configPath);
      fs.unlinkSync(backupPath);
      return true;
    } catch {
      return false;
    }
  }
}

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
    void this.saveSessionAsync(session).catch(() => {});
  }

  async saveSessionAsync(session: Session): Promise<void> {
    const dir = this.sessionsDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    session.updated_at = new Date().toISOString();
    const filePath = path.join(dir, `${session.session_id}.json`);
    const tmpPath = filePath + ".tmp";

    try {
      await fsp.writeFile(tmpPath, JSON.stringify(session, null, 2), "utf-8");
      await fsp.rename(tmpPath, filePath);
      this.sessionCache.set(session.session_id, { session, mtime: Date.now() });
    } catch {
      // best-effort save, degrade gracefully
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

export class AuditLogger {
  private auditDir: string;

  constructor(baseDir?: string) {
    const agentDir = baseDir || getAgentDir();
    this.auditDir = path.join(agentDir, "audit");
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.auditDir)) {
      fs.mkdirSync(this.auditDir, { recursive: true });
    }
  }

  log(entry: AuditLogEntry): void {
    this.ensureDir();

    const filePath = path.join(this.auditDir, `${entry.session_id}.log`);
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(filePath, line, "utf-8");
  }

  getSessionLogs(sessionId: string): AuditLogEntry[] {
    const filePath = path.join(this.auditDir, `${sessionId}.log`);
    if (!fs.existsSync(filePath)) return [];

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AuditLogEntry);
    } catch {
      return [];
    }
  }

  query(options: {
    sessionId?: string;
    action?: AuditLogEntry["action"];
    startTime?: string;
    endTime?: string;
    limit?: number;
  }): AuditLogEntry[] {
    const entries: AuditLogEntry[] = [];

    if (options.sessionId) {
      const sessionLogs = this.getSessionLogs(options.sessionId);
      entries.push(...sessionLogs);
    } else if (fs.existsSync(this.auditDir)) {
      const files = fs.readdirSync(this.auditDir).filter((f) => f.endsWith(".log"));
      for (const file of files) {
        const sessionId = file.replace(".log", "");
        const sessionLogs = this.getSessionLogs(sessionId);
        entries.push(...sessionLogs);
      }
    }

    let filtered = entries;

    if (options.action) {
      filtered = filtered.filter((e) => e.action === options.action);
    }

    if (options.startTime) {
      filtered = filtered.filter((e) => e.timestamp >= options.startTime!);
    }

    if (options.endTime) {
      filtered = filtered.filter((e) => e.timestamp <= options.endTime!);
    }

    filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (options.limit && options.limit > 0) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  getStats(sessionId?: string): AuditStats {
    const logs = sessionId
      ? this.getSessionLogs(sessionId)
      : this.query({});

    const stats: AuditStats = {
      totalEntries: logs.length,
      byAction: {} as Record<string, number>,
      allowedCount: 0,
      deniedCount: 0,
      overriddenCount: 0,
      uniqueTools: new Set<string>().size,
      firstEntry: logs.length > 0 ? logs[logs.length - 1].timestamp : null,
      lastEntry: logs.length > 0 ? logs[0].timestamp : null,
    };

    const tools = new Set<string>();

    for (const entry of logs) {
      stats.byAction[entry.action] = (stats.byAction[entry.action] || 0) + 1;
      if (entry.decision === "allowed") stats.allowedCount++;
      if (entry.decision === "denied") stats.deniedCount++;
      if (entry.decision === "overridden") stats.overriddenCount++;
      if (entry.tool_name) tools.add(entry.tool_name);
    }

    stats.uniqueTools = tools.size;

    return stats;
  }

  getRecentActivity(minutes: number = 60): AuditLogEntry[] {
    const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    return this.query({ startTime: since });
  }

  purgeSession(sessionId: string): boolean {
    const filePath = path.join(this.auditDir, `${sessionId}.log`);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  purgeAll(): boolean {
    if (fs.existsSync(this.auditDir)) {
      try {
        const files = fs.readdirSync(this.auditDir);
        for (const file of files) {
          fs.unlinkSync(path.join(this.auditDir, file));
        }
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export interface AuditStats {
  totalEntries: number;
  byAction: Record<string, number>;
  allowedCount: number;
  deniedCount: number;
  overriddenCount: number;
  uniqueTools: number;
  firstEntry: string | null;
  lastEntry: string | null;
}

export class TelemetryLogger {
  private logPath: string;

  constructor() {
    const agentDir = getAgentDir();
    this.logPath = path.join(agentDir, "logs", "agent_1.log");
  }

  log(entry: TelemetryEntry): void {
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const stat = fs.existsSync(this.logPath) ? fs.statSync(this.logPath) : { size: 0 };
    if (stat.size > 100 * 1024 * 1024) {
      this.rotate();
    }

    const sanitized = this.sanitize(entry);
    const line = JSON.stringify(sanitized) + "\n";
    fs.appendFileSync(this.logPath, line, "utf-8");
  }

  sanitize(entry: TelemetryEntry): TelemetryEntry {
    return {
      ...entry,
      message: sanitizeField(entry.message),
    };
  }

  private rotate(): void {
    const dir = path.dirname(this.logPath);
    const rotated = this.logPath + "." + Date.now();
    try {
      fs.renameSync(this.logPath, rotated);
    } catch {
      // ignore rotation errors
    }
  }
}

function sanitizeField(value: string): string {
  let sanitized = value;
  sanitized = sanitized.replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, "[REDACTED_IP]");
  sanitized = sanitized.replace(/(?:[a-zA-Z]:\\|~?\/)(?:[\w.-]+[\\\/])*[\w.-]+/g, (match) => {
    if (match.match(/[\\\/].*[\\\/]/)) {
      return "[REDACTED_PATH]";
    }
    return match;
  });
  return sanitized;
}

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