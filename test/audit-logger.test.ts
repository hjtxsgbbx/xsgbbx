import { AuditLogger } from "../src/storage/index.js";
import type { AuditLogEntry } from "../src/types/index.js";
import * as fs from "fs";
import * as path from "path";

const TEST_DIR = path.join(process.cwd(), ".agent_1_test");

describe("AuditLogger", () => {
  let logger: AuditLogger;

  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
    logger = new AuditLogger(TEST_DIR);
    logger.purgeAll();
  });

  afterEach(() => {
    logger.purgeAll();
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  function makeEntry(
    overrides: Partial<AuditLogEntry> = {}
  ): AuditLogEntry {
    return {
      timestamp: new Date().toISOString(),
      session_id: "test-session",
      action: "tool_exec",
      tool_name: "write_file",
      command_summary: "write_file(path='test.txt')",
      decision: "allowed",
      ...overrides,
    };
  }

  describe("log", () => {
    it("should log an entry without throwing", () => {
      expect(() => {
        logger.log(makeEntry());
      }).not.toThrow();
    });

    it("should log multiple entries", () => {
      for (let i = 0; i < 5; i++) {
        logger.log(
          makeEntry({ tool_name: `tool_${i}` })
        );
      }
      const logs = logger.getSessionLogs("test-session");
      expect(logs).toHaveLength(5);
    });
  });

  describe("getSessionLogs", () => {
    it("should return empty array for non-existent session", () => {
      const logs = logger.getSessionLogs("nonexistent");
      expect(logs).toEqual([]);
    });

    it("should return logged entries for a session", () => {
      logger.log(makeEntry({ tool_name: "tool_a" }));
      logger.log(makeEntry({ tool_name: "tool_b" }));

      const logs = logger.getSessionLogs("test-session");
      expect(logs).toHaveLength(2);
      expect(logs[0].tool_name).toBe("tool_a");
      expect(logs[1].tool_name).toBe("tool_b");
    });

    it("should separate entries by session", () => {
      logger.log(makeEntry({ session_id: "session-a", tool_name: "a1" }));
      logger.log(makeEntry({ session_id: "session-a", tool_name: "a2" }));
      logger.log(makeEntry({ session_id: "session-b", tool_name: "b1" }));

      const logsA = logger.getSessionLogs("session-a");
      const logsB = logger.getSessionLogs("session-b");

      expect(logsA).toHaveLength(2);
      expect(logsB).toHaveLength(1);
      expect(logsB[0].tool_name).toBe("b1");
    });
  });

  describe("query", () => {
    beforeEach(() => {
      logger.log(
        makeEntry({
          session_id: "s1",
          action: "tool_exec",
          tool_name: "shell_command",
          decision: "allowed",
          timestamp: "2026-01-01T10:00:00.000Z",
        })
      );
      logger.log(
        makeEntry({
          session_id: "s1",
          action: "permission_denied",
          tool_name: "shell_command",
          decision: "denied",
          timestamp: "2026-01-01T11:00:00.000Z",
        })
      );
      logger.log(
        makeEntry({
          session_id: "s2",
          action: "config_change",
          tool_name: undefined,
          decision: "allowed",
          timestamp: "2026-01-01T12:00:00.000Z",
        })
      );
    });

    it("should query by session ID", () => {
      const results = logger.query({ sessionId: "s1" });
      expect(results).toHaveLength(2);
    });

    it("should query by action type", () => {
      const results = logger.query({ action: "tool_exec" });
      expect(results).toHaveLength(1);
      expect(results[0].session_id).toBe("s1");
    });

    it("should query by time range", () => {
      const results = logger.query({
        startTime: "2026-01-01T11:00:00.000Z",
        endTime: "2026-01-01T12:30:00.000Z",
      });
      expect(results).toHaveLength(2);
    });

    it("should limit results", () => {
      const results = logger.query({ limit: 1 });
      expect(results).toHaveLength(1);
    });

    it("should return results sorted by timestamp descending", () => {
      const results = logger.query({});
      expect(results).toHaveLength(3);
      expect(results[0].timestamp).toBe("2026-01-01T12:00:00.000Z");
      expect(results[2].timestamp).toBe("2026-01-01T10:00:00.000Z");
    });
  });

  describe("getStats", () => {
    it("should return empty stats when no logs", () => {
      const stats = logger.getStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.allowedCount).toBe(0);
      expect(stats.deniedCount).toBe(0);
    });

    it("should count entries by decision", () => {
      logger.log(makeEntry({ decision: "allowed" }));
      logger.log(makeEntry({ decision: "allowed" }));
      logger.log(makeEntry({ decision: "denied" }));
      logger.log(makeEntry({ decision: "overridden" }));

      const stats = logger.getStats();
      expect(stats.totalEntries).toBe(4);
      expect(stats.allowedCount).toBe(2);
      expect(stats.deniedCount).toBe(1);
      expect(stats.overriddenCount).toBe(1);
    });

    it("should count unique tools", () => {
      logger.log(makeEntry({ tool_name: "write_file" }));
      logger.log(makeEntry({ tool_name: "shell_command" }));
      logger.log(makeEntry({ tool_name: "write_file" }));
      logger.log(makeEntry({ tool_name: "git_commit" }));

      const stats = logger.getStats();
      expect(stats.uniqueTools).toBe(3);
    });

    it("should count by action type", () => {
      logger.log(makeEntry({ action: "tool_exec" }));
      logger.log(makeEntry({ action: "tool_exec" }));
      logger.log(makeEntry({ action: "config_change" }));

      const stats = logger.getStats();
      expect(stats.byAction["tool_exec"]).toBe(2);
      expect(stats.byAction["config_change"]).toBe(1);
    });

    it("should report first and last entry timestamps", () => {
      logger.log(
        makeEntry({ timestamp: "2026-01-01T08:00:00.000Z" })
      );
      logger.log(
        makeEntry({ timestamp: "2026-01-01T14:00:00.000Z" })
      );

      const stats = logger.getStats();
      expect(stats.firstEntry).toBe("2026-01-01T08:00:00.000Z");
      expect(stats.lastEntry).toBe("2026-01-01T14:00:00.000Z");
    });
  });

  describe("getRecentActivity", () => {
    it("should return entries within time window", () => {
      logger.log(makeEntry());
      const recent = logger.getRecentActivity(60);
      expect(recent.length).toBeGreaterThan(0);
    });

    it("should filter out old entries", () => {
      logger.log(
        makeEntry({
          timestamp: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
        })
      );
      const recent = logger.getRecentActivity(60);
      expect(recent).toHaveLength(0);
    });
  });

  describe("purgeSession", () => {
    it("should remove session logs", () => {
      logger.log(makeEntry({ session_id: "to-purge" }));
      const success = logger.purgeSession("to-purge");
      expect(success).toBe(true);
      const logs = logger.getSessionLogs("to-purge");
      expect(logs).toEqual([]);
    });

    it("should return false for non-existent session", () => {
      const success = logger.purgeSession("nonexistent");
      expect(success).toBe(false);
    });
  });

  describe("purgeAll", () => {
    it("should remove all audit logs", () => {
      logger.log(makeEntry({ session_id: "s1" }));
      logger.log(makeEntry({ session_id: "s2" }));

      const success = logger.purgeAll();
      expect(success).toBe(true);

      const allLogs = logger.query({});
      expect(allLogs).toHaveLength(0);
    });
  });
});