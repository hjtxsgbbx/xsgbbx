import {
  resolveSafePath,
  isInWorkspace,
  sanitizeFilePath,
  enumerateDangerousPaths,
} from "../src/security/path-guard.js";
import * as path from "path";

describe("resolveSafePath", () => {
  const workspace = process.cwd();

  it("should reject empty path", () => {
    const result = resolveSafePath("", workspace);
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("Empty");
  });

  it("should reject null byte in path", () => {
    const result = resolveSafePath("foo\0bar.ts", workspace);
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("Null byte");
  });

  it("should resolve relative path within workspace", () => {
    const result = resolveSafePath("src/index.ts", workspace);
    expect(result.safe).toBe(true);
    expect(result.resolvedPath).toContain("src");
  });

  it("should resolve absolute path within workspace", () => {
    const absPath = path.resolve(workspace, "package.json");
    const result = resolveSafePath(absPath, workspace);
    expect(result.safe).toBe(true);
    expect(result.resolvedPath).toBe(absPath);
  });

  it("should block path traversal with ../", () => {
    const result = resolveSafePath("../../../etc/passwd", workspace);
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("dangerous segment");
  });

  it("should block dangerous windows system path", () => {
    const result = resolveSafePath("C:\\Windows\\System32\\config", workspace);
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("dangerous segment");
  });

  it("should block path traversing outside workspace on absolute path", () => {
    const outsideAbs = path.resolve("/outside/workspace/file.txt");
    const result = resolveSafePath(outsideAbs, workspace);
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("outside workspace");
  });

  it("should accept safe deep nested paths", () => {
    const deep = path.join("src", "core", "utils", "helper", "index.ts");
    const result = resolveSafePath(deep, workspace);
    expect(result.safe).toBe(true);
    expect(result.resolvedPath).toContain("helper");
  });

  it("should handle whitespace-only path", () => {
    const result = resolveSafePath("   ", workspace);
    expect(result.safe).toBe(false);
  });
});

describe("isInWorkspace", () => {
  const workspace = process.cwd();

  it("should return true for file in workspace", () => {
    expect(isInWorkspace("src/index.ts", workspace)).toBe(true);
  });

  it("should return false for file outside workspace", () => {
    expect(isInWorkspace("/etc/passwd", workspace)).toBe(false);
  });

  it("should handle empty path", () => {
    const result = isInWorkspace("", workspace);
    expect(typeof result).toBe("boolean");
  });
});

describe("sanitizeFilePath", () => {
  it("should replace illegal characters", () => {
    expect(sanitizeFilePath("file<name>.ts")).not.toContain("<");
    expect(sanitizeFilePath("file>name.ts")).not.toContain(">");
    expect(sanitizeFilePath('file"name.ts')).not.toContain('"');
    expect(sanitizeFilePath("file|name.ts")).not.toContain("|");
  });

  it("should strip control characters", () => {
    const sanitized = sanitizeFilePath("test\x00\x01file.ts");
    expect(sanitized).not.toContain("\x00");
    expect(sanitized).not.toContain("\x01");
  });

  it("should preserve valid filename", () => {
    expect(sanitizeFilePath("normal-file.ts")).toBe(
      path.normalize("normal-file.ts")
    );
  });

  it("should handle question mark", () => {
    const result = sanitizeFilePath("test?.ts");
    expect(result).not.toContain("?");
  });
});

describe("enumerateDangerousPaths", () => {
  it("should return array of dangerous paths", () => {
    const paths = enumerateDangerousPaths("/workspace");
    expect(Array.isArray(paths)).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
  });

  it("should include system paths", () => {
    const paths = enumerateDangerousPaths("/workspace");
    const hasSystemPath = paths.some(
      (p) => p.includes("Windows") || p.includes("System32")
    );
    expect(hasSystemPath).toBe(true);
  });

  it("should include resolved dangerous paths", () => {
    const paths = enumerateDangerousPaths("/workspace");
    expect(paths.length).toBeGreaterThan(0);
    const hasResolved = paths.some(
      (p) => p.includes("etc") || p.includes(".ssh") || p.includes(".env")
    );
    expect(hasResolved).toBe(true);
  });
});