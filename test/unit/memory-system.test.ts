/**
 * Memory system tests — xsgbbx memory manager & types
 */
import { parseMemoryType, MEMORY_TYPES, ENTRYPOINT_NAME } from "../../src/intelligence/memory/memory-types";

describe("Memory Types", () => {
  it("has four memory types", () => {
    expect(MEMORY_TYPES).toEqual(["user", "feedback", "project", "reference"]);
  });

  it("parses valid memory types", () => {
    expect(parseMemoryType("user")).toBe("user");
    expect(parseMemoryType("feedback")).toBe("feedback");
    expect(parseMemoryType("project")).toBe("project");
    expect(parseMemoryType("reference")).toBe("reference");
  });

  it("returns undefined for invalid types", () => {
    expect(parseMemoryType("invalid")).toBeUndefined();
    expect(parseMemoryType(null)).toBeUndefined();
    expect(parseMemoryType(123)).toBeUndefined();
    expect(parseMemoryType("")).toBeUndefined();
  });

  it("has correct entrypoint name", () => {
    expect(ENTRYPOINT_NAME).toBe("MEMORY.md");
  });
});

describe("Memory System", () => {
  it("memory dir path resolves correctly", async () => {
    const { getMemoryDir } = await import("../../src/intelligence/memory/memory-manager");
    const dir = getMemoryDir();
    expect(dir).toContain(".xsgbbx");
    expect(dir).toContain("memory");
  });

  it("ensureMemoryDir creates directory", async () => {
    const { ensureMemoryDir, getMemoryDir } = await import("../../src/intelligence/memory/memory-manager");
    const dir = ensureMemoryDir();
    expect(dir).toBe(getMemoryDir());
    const fs = await import("fs");
    expect(fs.existsSync(dir)).toBe(true);
  });
});
