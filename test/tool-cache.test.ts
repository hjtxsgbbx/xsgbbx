import { ToolResultCache, toolCache } from "../src/core/tool-cache.js";
import type { ToolCall, ToolResult } from "../src/types/index.js";

describe("ToolResultCache", () => {
  let cache: ToolResultCache;
  const readTool: ToolCall = { id: "1", name: "read_file", arguments: { path: "/test.txt" } };
  const writeTool: ToolCall = { id: "2", name: "write_file", arguments: { path: "/out.txt", content: "data" } };
  const shellTool: ToolCall = { id: "3", name: "shell_command", arguments: { command: "ls" } };
  const successResult: ToolResult = { success: true, output: "done" };

  beforeEach(() => {
    cache = new ToolResultCache();
  });

  describe("Basic caching", () => {
    it("should return null for uncached result", () => {
      expect(cache.get(readTool)).toBeNull();
    });

    it("should return cached result", () => {
      cache.set(readTool, successResult);
      const cached = cache.get(readTool);
      expect(cached).not.toBeNull();
      expect(cached!.output).toContain("[CACHED]");
      expect(cached!.success).toBe(true);
    });

    it("should distinguish by arguments", () => {
      cache.set(readTool, successResult);
      const tool2: ToolCall = { id: "1b", name: "read_file", arguments: { path: "/other.txt" } };
      expect(cache.get(tool2)).toBeNull();
    });

    it("should distinguish by tool name", () => {
      cache.set(readTool, successResult);
      const tool2: ToolCall = { id: "2b", name: "glob", arguments: { path: "/test.txt" } };
      expect(cache.get(tool2)).toBeNull();
    });
  });

  describe("Write tool invalidation", () => {
    it("should clear cache when write_file is executed", () => {
      cache.set(readTool, successResult);
      cache.set(writeTool, successResult);
      expect(cache.size).toBe(0);
    });

    it("should clear cache when shell_command is executed", () => {
      cache.set(readTool, successResult);
      cache.set(shellTool, successResult);
      expect(cache.size).toBe(0);
    });

    it("should keep read-only results when no writes", () => {
      cache.set(readTool, successResult);
      expect(cache.size).toBe(1);
    });
  });

  describe("Turn management", () => {
    it("should clear cache on nextTurn", () => {
      cache.set(readTool, successResult);
      cache.nextTurn();
      expect(cache.size).toBe(0);
    });

    it("should increment turn number", () => {
      expect(cache.currentTurn).toBe(0);
      cache.nextTurn();
      expect(cache.currentTurn).toBe(1);
    });
  });

  describe("Cache operations", () => {
    it("should track cache size", () => {
      expect(cache.size).toBe(0);
      cache.set(readTool, successResult);
      expect(cache.size).toBe(1);
    });

    it("should clear all entries", () => {
      cache.set(readTool, successResult);
      const tool2: ToolCall = { id: "4", name: "glob", arguments: { pattern: "*.ts" } };
      cache.set(tool2, successResult);
      cache.clear();
      expect(cache.size).toBe(0);
    });

    it("should return deep copy of cached result", () => {
      cache.set(readTool, successResult);
      const cached = cache.get(readTool)!;
      cached.success = false;
      const cached2 = cache.get(readTool)!;
      expect(cached2.success).toBe(true);
    });
  });

  describe("Singleton", () => {
    it("should export a singleton instance", () => {
      expect(toolCache).toBeInstanceOf(ToolResultCache);
    });
  });
});