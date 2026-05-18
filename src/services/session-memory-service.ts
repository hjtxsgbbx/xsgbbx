/**
 * SessionMemoryService — persistent session memory as MEMORY.md files
 * under ~/.agent_1/sessions/{sessionId}/MEMORY.md.
 *
 * Format: ### 2024-01-15 10:30:00\\nSummary text...\\n
 * Compatible with session-memory-compact.ts parsing.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { promises as fsp } from "node:fs";
import type { Message } from "../types/index.js";
import { debug } from "../observability/debug.js";

export interface SessionMemoryEntry {
  timestamp: string;
  summary: string;
}

export interface SessionMemoryServiceConfig {
  dataDir?: string;
}

const DEFAULT_SESSIONS_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || "~", ".agent_1", "sessions",
);

export class SessionMemoryService {
  private sessionsDir: string;

  constructor(config: SessionMemoryServiceConfig = {}) {
    this.sessionsDir = config.dataDir
      ? path.join(config.dataDir, "sessions")
      : DEFAULT_SESSIONS_DIR;
  }

  private memoryPath(sessionId: string): string {
    return path.join(this.sessionsDir, sessionId, "MEMORY.md");
  }

  readMemory(sessionId: string): string {
    const filePath = this.memoryPath(sessionId);
    try {
      if (!fs.existsSync(filePath)) {
        return "";
      }
      return fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      debug.warn("session-memory-service", `Failed to read memory for ${sessionId}`, err);
      return "";
    }
  }

  readMemoryEntries(sessionId: string): SessionMemoryEntry[] {
    const content = this.readMemory(sessionId);
    if (!content) return [];

    return this.parseEntries(content);
  }

  async writeMemory(sessionId: string, content: string): Promise<boolean> {
    const filePath = this.memoryPath(sessionId);
    try {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, content, "utf-8");
      return true;
    } catch (err) {
      debug.warn("session-memory-service", `Failed to write memory for ${sessionId}`, err);
      return false;
    }
  }

  async appendEntry(sessionId: string, summary: string): Promise<boolean> {
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const entry = `### ${now}\n${summary.trim()}\n\n`;
    const existing = this.readMemory(sessionId);
    const content = existing ? `${existing.trimEnd()}\n\n${entry}` : entry;
    return this.writeMemory(sessionId, content);
  }

  async writeEntries(sessionId: string, entries: SessionMemoryEntry[]): Promise<boolean> {
    const content = entries
      .map((e) => `### ${e.timestamp}\n${e.summary.trim()}\n`)
      .join("\n");
    return this.writeMemory(sessionId, content);
  }

  /** Extract memories from messages (heuristic, pair with LLM summarizer). */
  extractMemories(messages: Message[]): SessionMemoryEntry[] {
    const entries: SessionMemoryEntry[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== "user") continue;

      const content = typeof msg.content === "string" ? msg.content : "";
      if (!content.trim() || content.startsWith("[System")) continue;

      const snippet = content.slice(0, 200).replace(/\n/g, " ");

      // Look ahead for tool/assistant responses
      const responses: string[] = [];
      for (let j = i + 1; j < Math.min(i + 4, messages.length); j++) {
        const next = messages[j];
        if (next.role === "tool" && typeof next.content === "string") {
          const short = next.content.slice(0, 80).replace(/\n/g, " ");
          if (short.includes("success")) {
            responses.push("completed successfully");
          } else if (short.includes("error") || short.includes("Error")) {
            responses.push("encountered an error");
          }
        }
      }

      const outcome = responses.length > 0 ? ` → ${responses.join(", ")}` : "";
      entries.push({
        timestamp: msg.timestamp,
        summary: `User: ${snippet}${outcome}`,
      });
    }

    return entries;
  }

  exists(sessionId: string): boolean {
    return fs.existsSync(this.memoryPath(sessionId));
  }

  async deleteMemory(sessionId: string): Promise<boolean> {
    const filePath = this.memoryPath(sessionId);
    try {
      if (!fs.existsSync(filePath)) return false;
      await fsp.unlink(filePath);
      return true;
    } catch (err) {
      debug.warn("session-memory-service", `Failed to delete memory for ${sessionId}`, err);
      return false;
    }
  }

  private parseEntries(content: string): SessionMemoryEntry[] {
    const entries: SessionMemoryEntry[] = [];
    const lines = content.split("\n");
    let currentTs = "";
    let currentSummary = "";

    for (const line of lines) {
      const tsMatch = line.match(/^#{2,3}\s+(\d{4}-\d{2}-\d{2}[T\s].*)$/);
      if (tsMatch) {
        if (currentTs && currentSummary.trim()) {
          entries.push({ timestamp: currentTs, summary: currentSummary.trim() });
        }
        currentTs = tsMatch[1].trim();
        currentSummary = "";
        continue;
      }
      if (line.match(/^#+\s/)) continue;
      if (currentTs) currentSummary += line + "\n";
    }

    if (currentTs && currentSummary.trim()) {
      entries.push({ timestamp: currentTs, summary: currentSummary.trim() });
    }
    return entries;
  }
}
