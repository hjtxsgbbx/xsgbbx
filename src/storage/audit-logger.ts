import * as path from "path";
import * as fs from "fs";
import { promises as fsp } from "fs";
import { type AuditLogEntry, type TelemetryEntry } from "../types/index.js";
import { getAgentDir } from "../pal/index.js";
import { debug } from "../observability/debug.js";
import { LIMITS, TIMEOUTS } from "../core/constants.js";

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

import * as crypto from "crypto";

export class AuditLogger {
  private auditDir: string;
  private readonly MAX_LOG_SIZE = 50 * 1024 * 1024;
  private readonly MAX_LOG_AGE_MS = 90 * 24 * 60 * 60 * 1000;
  private buffer: Map<string, string[]> = new Map();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly FLUSH_INTERVAL_MS = 2000;
  private dirEnsured = false;

  constructor(baseDir?: string) {
    const agentDir = baseDir || getAgentDir();
    this.auditDir = path.join(agentDir, "audit");
  }

  private ensureDir(): void {
    if (this.dirEnsured) return;
    if (!fs.existsSync(this.auditDir)) {
      fs.mkdirSync(this.auditDir, { recursive: true });
    }
    this.dirEnsured = true;
  }

  log(entry: AuditLogEntry): void {
    this.ensureDir();

    const entryWithHash = this.addIntegrityHash(entry);
    const line = JSON.stringify(entryWithHash) + "\n";
    const sessionId = entry.session_id;

    const existing = this.buffer.get(sessionId);
    if (existing) {
      existing.push(line);
    } else {
      this.buffer.set(sessionId, [line]);
    }

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.FLUSH_INTERVAL_MS);
      if (this.flushTimer && typeof this.flushTimer === "object" && "unref" in this.flushTimer) {
        (this.flushTimer as NodeJS.Timeout).unref();
      }
    }
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.buffer.size === 0) return;

    const entries = new Map(this.buffer);
    this.buffer.clear();

    for (const [sessionId, lines] of entries) {
      const filePath = path.join(this.auditDir, `${sessionId}.log`);
      this.rotateIfNeeded(filePath);
      try {
        fsp.appendFile(filePath, lines.join(""), "utf-8").catch((err) => {
          debug.warn("audit-logger", "Async flush failed", err);
        });
      } catch (err) {
        debug.warn("audit-logger", "Buffered flush failed", err);
      }
    }
  }

  async flushSync(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.buffer.size === 0) return;

    const entries = new Map(this.buffer);
    this.buffer.clear();

    for (const [sessionId, lines] of entries) {
      const filePath = path.join(this.auditDir, `${sessionId}.log`);
      this.rotateIfNeeded(filePath);
      try {
        await fsp.appendFile(filePath, lines.join(""), "utf-8");
      } catch (err) {
        debug.warn("audit-logger", "Async flush failed", err);
      }
    }
  }

  dispose(): void {
    this.flush();
  }

  private addIntegrityHash(entry: AuditLogEntry): AuditLogEntry & { _hash: string } {
    const data = JSON.stringify(entry);
    const hash = crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
    return { ...entry, _hash: hash };
  }

  verifyIntegrity(sessionId: string): { valid: boolean; corruptedLines: number; totalLines: number } {
    this.flush();
    const filePath = path.join(this.auditDir, `${sessionId}.log`);
    if (!fs.existsSync(filePath)) return { valid: true, corruptedLines: 0, totalLines: 0 };

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter(Boolean);
      let corruptedLines = 0;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          const { _hash, ...rest } = entry;
          if (_hash) {
            const expectedHash = crypto.createHash("sha256").update(JSON.stringify(rest)).digest("hex").slice(0, 16);
            if (_hash !== expectedHash) {
              corruptedLines++;
            }
          }
        } catch {
          corruptedLines++;
        }
      }

      return {
        valid: corruptedLines === 0,
        corruptedLines,
        totalLines: lines.length,
      };
    } catch {
      return { valid: false, corruptedLines: 1, totalLines: 1 };
    }
  }

  private rotateIfNeeded(filePath: string): void {
    if (!fs.existsSync(filePath)) return;

    try {
      const stat = fs.statSync(filePath);
      if (stat.size >= this.MAX_LOG_SIZE) {
        const rotated = filePath + "." + Date.now() + ".archived";
        fs.renameSync(filePath, rotated);
      }
    } catch {
      // rotation failure should not block logging
    }
  }

  cleanup(retentionDays: number = 90): number {
    this.flush();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    if (!fs.existsSync(this.auditDir)) return 0;

    const files = fs.readdirSync(this.auditDir);
    for (const file of files) {
      const filePath = path.join(this.auditDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          removed++;
        }
      } catch {
        // skip inaccessible files
      }
    }

    return removed;
  }

  getSessionLogs(sessionId: string): AuditLogEntry[] {
    this.flush();
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
    this.flush();
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
      const start = options.startTime;
      filtered = filtered.filter((e) => e.timestamp >= start);
    }

    if (options.endTime) {
      const end = options.endTime;
      filtered = filtered.filter((e) => e.timestamp <= end);
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
    this.flush();
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
    this.flush();
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

export class TelemetryLogger {
  private logPath: string;
  private buffer: string[] = [];
  private maxBufferSize = 50;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const agentDir = getAgentDir();
    this.logPath = path.join(agentDir, "logs", "agent_1.log");
  }

  log(entry: TelemetryEntry): void {
    const sanitized = this.sanitize(entry);
    const line = JSON.stringify(sanitized) + "\n";
    this.buffer.push(line);

    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), TIMEOUTS.LOG_FLUSH_MS);
    }
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.buffer.length === 0) return;

    const lines = this.buffer.splice(0);

    const dir = path.dirname(this.logPath);
    fsp.mkdir(dir, { recursive: true }).then(() => {
      return fsp.stat(this.logPath).catch(() => ({ size: 0 }));
    }).then((stat) => {
      if (stat.size > LIMITS.MAX_TELEMETRY_LOG_SIZE) {
        this.rotate();
      }
      return fsp.appendFile(this.logPath, lines.join(""), "utf-8");
    }).catch((err) => {
      debug.warn("telemetry", "Buffered flush failed", err);
    });
  }

  sanitize(entry: TelemetryEntry): TelemetryEntry {
    return {
      ...entry,
      message: sanitizeField(entry.message),
    };
  }

  private rotate(): void {
    const _dir = path.dirname(this.logPath);
    const rotated = this.logPath + "." + Date.now();
    try {
      fs.renameSync(this.logPath, rotated);
    } catch (err) {
      debug.warn("audit-logger", "Log rotation failed", err);
    }
  }
}

function sanitizeField(value: string): string {
  let sanitized = value;
  sanitized = sanitized.replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, "[REDACTED_IP]");
  sanitized = sanitized.replace(/(?:[a-zA-Z]:\\|~?\/)(?:[\w.-]+[\\/])*[\w.-]+/g, (match) => {
    if (match.match(/[\\/].*[\\/]/)) {
      return "[REDACTED_PATH]";
    }
    return match;
  });
  return sanitized;
}