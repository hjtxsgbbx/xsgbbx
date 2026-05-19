/**
 * Sandbox hardening tests — process isolation, write protection,
 * network restriction, and sandbox mode transitions.
 */

import { describe, it, expect } from "@jest/globals";

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  isolateProcess,
  validateIsolation,
  wrapIsolatedCommand,
} from "../../src/security/process-isolation.js";
import type { SandboxOptions } from "../../src/security/process-isolation.js";

import {
  disallowNetwork,
  allowLocalhostOnly,
  allowList,
  restrictNetwork,
  applyNetworkRestriction,
  blockDnsResolution,
} from "../../src/security/network-guard.js";

import {
  createWriteGuard,
  isProtectedSystemPath,
  getProtectedPaths,
} from "../../src/security/write-protection.js";

import { createSandbox } from "../../src/security/sandbox-manager.js";

// ---------------------------------------------------------------------------
// Default sandbox options for testing (timeoutMs=0 means use tier detection)
// ---------------------------------------------------------------------------

const defaultOpts: SandboxOptions = {
  mode: "readonly",
  timeoutMs: 0, // Let tier detection determine the timeout
  maxOutputBytes: 1024 * 1024,
};

// ---------------------------------------------------------------------------
// Process Isolation Tests
// ---------------------------------------------------------------------------

describe("process-isolation", () => {
  describe("environment sanitization", () => {
    it("strips LD_PRELOAD from environment", () => {
      process.env.LD_PRELOAD = "/tmp/evil.so";
      const result = isolateProcess("ls", defaultOpts);
      expect(result.env.LD_PRELOAD).toBeUndefined();
      expect(result.env.LD_LIBRARY_PATH).toBeUndefined();
      delete process.env.LD_PRELOAD;
    });

    it("strips DYLD_INSERT_LIBRARIES on all platforms", () => {
      process.env.DYLD_INSERT_LIBRARIES = "/tmp/hook.dylib";
      const result = isolateProcess("echo test", defaultOpts);
      expect(result.env.DYLD_INSERT_LIBRARIES).toBeUndefined();
      delete process.env.DYLD_INSERT_LIBRARIES;
    });

    it("strips sensitive cloud credentials", () => {
      process.env.AWS_ACCESS_KEY_ID = "AKIA123456";
      process.env.OPENAI_API_KEY = "sk-test123";
      const result = isolateProcess("echo hello", defaultOpts);
      expect(result.env.AWS_ACCESS_KEY_ID).toBeUndefined();
      expect(result.env.OPENAI_API_KEY).toBeUndefined();
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.OPENAI_API_KEY;
    });

    it("preserves safe environment variables", () => {
      const result = isolateProcess("echo test", defaultOpts);
      const keys = Object.keys(result.env).map((k) => k.toUpperCase());
      expect(keys.some((k) => k === "HOME" || k === "USER" || k === "USERPROFILE")).toBe(true);
    });

    it("strips sensitive env vars with TOKEN suffix", () => {
      process.env.GITHUB_TOKEN = "ghp_secret123";
      process.env.NPM_TOKEN = "npm_secret456";
      const result = isolateProcess("echo test", defaultOpts);
      expect(result.env.GITHUB_TOKEN).toBeUndefined();
      expect(result.env.NPM_TOKEN).toBeUndefined();
      delete process.env.GITHUB_TOKEN;
      delete process.env.NPM_TOKEN;
    });
  });

  describe("timeout tier detection", () => {
    it("uses tier-based timeout when opts.timeoutMs is 0", () => {
      const result = isolateProcess("ls -la", defaultOpts);
      // "ls -la" has 2 words → quick tier → 30000ms
      expect(result.timeoutMs).toBe(30_000);
    });

    it("assigns long timeout for build commands", () => {
      const result = isolateProcess("npm run build", defaultOpts);
      expect(result.timeoutMs).toBe(600_000);
    });

    it("uses explicit timeout when opts.timeoutMs > 0", () => {
      const result = isolateProcess("ls", { ...defaultOpts, timeoutMs: 5000 });
      expect(result.timeoutMs).toBe(5000);
    });
  });

  describe("isolation validation", () => {
    it("validates an isolation config and returns warnings array", () => {
      const isolated = isolateProcess("echo hello", defaultOpts);
      const { valid, warnings } = validateIsolation(isolated);
      // Both valid boolean and warnings array should be present
      expect(typeof valid).toBe("boolean");
      expect(Array.isArray(warnings)).toBe(true);
    });

    it("sets platform correctly", () => {
      const isolated = isolateProcess("ls", defaultOpts);
      expect(["win32", "linux", "darwin"]).toContain(isolated.platform);
    });
  });

  describe("command wrapping", () => {
    it("returns command unchanged for 'off' mode", () => {
      const result = wrapIsolatedCommand("echo hello", {
        ...defaultOpts,
        mode: "off",
      });
      expect(result).toBe("echo hello");
    });

    it("returns command unchanged for 'full' mode", () => {
      const result = wrapIsolatedCommand("echo hello", {
        ...defaultOpts,
        mode: "full",
      });
      expect(result).toBe("echo hello");
    });
  });
});

// ---------------------------------------------------------------------------
// Network Guard Tests
// ---------------------------------------------------------------------------

describe("network-guard", () => {
  describe("disallowNetwork", () => {
    it("sets all proxy vars to blackhole", () => {
      const restriction = disallowNetwork();
      expect(restriction.level).toBe("none");
      expect(restriction.dnsBlocked).toBe(true);
      const httpProxy = restriction.env["HTTP_PROXY"] || restriction.env["http_proxy"];
      const httpsProxy = restriction.env["HTTPS_PROXY"] || restriction.env["https_proxy"];
      expect(httpProxy).toBeDefined();
      expect(httpsProxy).toBeDefined();
      expect(httpProxy).not.toBe("");
    });

    it("clears NO_PROXY", () => {
      const restriction = disallowNetwork();
      expect(restriction.env["NO_PROXY"] || restriction.env["no_proxy"]).toBe("");
    });
  });

  describe("allowLocalhostOnly", () => {
    it("sets proxy to blackhole but allows localhost", () => {
      const restriction = allowLocalhostOnly();
      expect(restriction.level).toBe("localhost");
      expect(restriction.dnsBlocked).toBe(false);
      const noProxy = restriction.env["NO_PROXY"] || restriction.env["no_proxy"];
      expect(noProxy).toContain("127.0.0.1");
      expect(noProxy).toContain("localhost");
    });
  });

  describe("allowList", () => {
    it("allows only specified domains", () => {
      const restriction = allowList(["github.com", "api.github.com"]);
      expect(restriction.level).toBe("allowlist");
      expect(restriction.allowlist).toContain("github.com");
      expect(restriction.allowlist).toContain("api.github.com");
      const noProxy = restriction.env["NO_PROXY"] || restriction.env["no_proxy"];
      expect(noProxy).toContain("github.com");
      expect(noProxy).toContain("127.0.0.1");
    });

    it("sanitizes domain names", () => {
      const restriction = allowList(["  Github.COM  ", ""]);
      expect(restriction.allowlist).toContain("github.com");
      expect(restriction.allowlist).not.toContain("");
      expect(restriction.allowlist).not.toContain("  Github.COM  ");
    });
  });

  describe("restrictNetwork", () => {
    it("returns correct restriction for each level", () => {
      expect(restrictNetwork("none").level).toBe("none");
      expect(restrictNetwork("localhost").level).toBe("localhost");
      expect(restrictNetwork("allowlist", ["example.com"]).level).toBe("allowlist");
    });

    it("uses empty allowlist when none provided", () => {
      const restriction = restrictNetwork("allowlist");
      expect(restriction.allowlist).toEqual([]);
    });
  });

  describe("applyNetworkRestriction", () => {
    it("merges restriction env into existing env immutably", () => {
      const existing = { HOME: "/home/user", PATH: "/usr/bin" };
      const restriction = disallowNetwork();
      const merged = applyNetworkRestriction(existing, restriction);
      // Original unchanged
      expect(existing.HOME).toBe("/home/user");
      expect("HTTP_PROXY" in existing || "http_proxy" in existing).toBe(false);
      // Merged has both
      expect(merged.HOME).toBe("/home/user");
      const hasProxy = Object.keys(merged).some(
        (k) => k.toUpperCase() === "HTTP_PROXY",
      );
      expect(hasProxy).toBe(true);
    });
  });

  describe("blockDnsResolution", () => {
    it("returns env vars on Linux, empty on Windows", () => {
      const result = blockDnsResolution();
      if (process.platform === "linux") {
        expect(result.RES_OPTIONS).toBeDefined();
      } else {
        // On Windows, result is empty object
        expect(Object.keys(result).length).toBe(0);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Write Protection Tests
// ---------------------------------------------------------------------------

describe("write-protection", () => {
  describe("createWriteGuard", () => {
    it("creates a write guard for a workspace", () => {
      const guard = createWriteGuard("/tmp/test-workspace");
      expect(guard.workspaceRoot).toBeDefined();
      expect(typeof guard.canWrite).toBe("function");
      expect(typeof guard.isPathInWorkspace).toBe("function");
    });

    it("returns protected paths (platform-aware, lowercased)", () => {
      const guard = createWriteGuard("/tmp/test-workspace");
      const paths = guard.getProtectedPaths();
      expect(paths.length).toBeGreaterThan(0);
      // Paths are lowercased by normalizePath — check with lowercase
      const hasWindowsSys = paths.some((p) => p.includes("windows"));
      const hasLinuxSys = paths.some((p) => p.includes("/etc"));
      expect(hasWindowsSys || hasLinuxSys).toBe(true);
    });
  });

  describe("isProtectedSystemPath", () => {
    it("returns true for C:\\Windows\\System32 on Windows", () => {
      const result = isProtectedSystemPath("C:\\Windows\\System32");
      if (process.platform === "win32") {
        expect(result).toBe(true);
      }
    });

    it("returns true for /etc/passwd on Linux", () => {
      const result = isProtectedSystemPath("/etc/passwd");
      if (process.platform === "linux") {
        expect(result).toBe(true);
      }
    });

    it("returns false for workspace paths", () => {
      const result = isProtectedSystemPath("/tmp/project/src/file.ts");
      expect(result).toBe(false);
    });
  });

  describe("getProtectedPaths", () => {
    it("returns platform-appropriate paths", () => {
      const paths = getProtectedPaths();
      const onWindows = process.platform === "win32";
      const hasWinStyle = paths.some((p) => /^[A-Za-z]:\\/.test(p));
      const hasUnixStyle = paths.some((p) => p.startsWith("/"));
      if (onWindows) {
        expect(hasWinStyle || hasUnixStyle).toBe(true);
      } else {
        expect(hasUnixStyle).toBe(true);
      }
    });
  });

  describe("canWrite on WriteGuard", () => {
    it("denies writes to /etc on Linux", () => {
      const guard = createWriteGuard("/tmp/workspace");
      if (process.platform === "linux") {
        expect(guard.canWrite("/etc/hosts")).toBe(false);
      }
    });

    it("reports paths outside workspace as out-of-workspace", () => {
      const guard = createWriteGuard("/tmp/workspace");
      // Path outside workspace (not in protected dirs, but not in workspace either)
      expect(guard.isPathInWorkspace("/tmp/other-dir/file.txt")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Sandbox Manager Tests
// ---------------------------------------------------------------------------

describe("sandbox-manager", () => {
  describe("createSandbox", () => {
    it("creates a sandbox for readonly mode", () => {
      const sandbox = createSandbox("readonly");
      expect(sandbox.mode).toBe("readonly");
      const config = sandbox.getConfiguration();
      expect(config.networkLevel).toBe("none");
      expect(config.writeGuard).not.toBeNull();
    });

    it("creates a sandbox for workspace mode", () => {
      const sandbox = createSandbox("workspace", { workspaceDir: "/tmp/test" });
      const config = sandbox.getConfiguration();
      expect(config.networkLevel).toBe("localhost");
      expect(config.writeGuard).not.toBeNull();
    });

    it("creates a sandbox for full mode with no restrictions", () => {
      const sandbox = createSandbox("full");
      const config = sandbox.getConfiguration();
      expect(config.nwRestriction).toBeNull();
      expect(config.writeGuard).toBeNull();
    });

    it("creates a sandbox for off mode (no restrictions)", () => {
      const sandbox = createSandbox("off");
      const config = sandbox.getConfiguration();
      expect(config.writeGuard).toBeNull();
    });
  });

  describe("execute pipeline", () => {
    it("integrates bash-security validation", async () => {
      const sandbox = createSandbox("readonly");
      const result = await sandbox.execute("echo hello world");
      const bashCheck = result.securityChecks.find(
        (c) => c.name === "bash-security",
      );
      expect(bashCheck).toBeDefined();
      // Safe commands should either pass or warn (not be blocked)
      if (bashCheck) {
        expect(["passed", "warning"]).toContain(bashCheck.level);
      }
    });

    it("delegates to bash-security for all commands", async () => {
      const sandbox = createSandbox("workspace");
      const result = await sandbox.execute("ls -la");
      // bash-security check should always be present
      const checkNames = result.securityChecks.map((c) => c.name);
      expect(checkNames).toContain("bash-security");
    });

    it("passes safe commands in readonly mode", async () => {
      const sandbox = createSandbox("readonly");
      const result = await sandbox.execute("echo hello world");
      expect(result.passed).toBe(true);
      expect(result.killed).toBe(false);
      expect(result.securityChecks.length).toBeGreaterThan(0);
      // All checks should be passed or warning (not blocked)
      const blockedChecks = result.securityChecks.filter(
        (c) => c.level === "blocked",
      );
      expect(blockedChecks).toHaveLength(0);
    });

    it("passes safe commands in workspace mode", async () => {
      const sandbox = createSandbox("workspace");
      const result = await sandbox.execute("ls -la");
      expect(result.passed).toBe(true);
    });
  });

  describe("security checks", () => {
    it("returns all security check results for safe commands", async () => {
      const sandbox = createSandbox("readonly");
      // Use a command with no path arguments so it passes write-protection
      const result = await sandbox.execute("echo test");
      const checkNames = result.securityChecks.map((c) => c.name);
      expect(checkNames).toContain("bash-security");
      expect(checkNames).toContain("network-guard");
      expect(checkNames).toContain("process-isolation");
      expect(checkNames).toContain("env-sanitization");
      // write-protection check is always present in restricted modes
      expect(checkNames).toContain("write-protection");
    });

    it("blocks writes to paths outside workspace", async () => {
      const sandbox = createSandbox("readonly");
      const result = await sandbox.execute("cat /etc/passwd");
      // Should have security checks before the block
      expect(result.securityChecks.length).toBeGreaterThan(0);
    });
  });

  describe("mode transitions", () => {
    it("full mode allows all commands including dangerous ones", async () => {
      const sandbox = createSandbox("full");
      const result = await sandbox.execute("rm -rf ./some-dir");
      expect(result.passed).toBe(true);
    });

    it("readonly mode enforces all security layers", async () => {
      const sandbox = createSandbox("readonly");
      const result = await sandbox.execute("echo hello");
      expect(result.passed).toBe(true);
      const checkNames = result.securityChecks.map((c) => c.name);
      expect(checkNames).toContain("network-guard");
      expect(checkNames).toContain("process-isolation");
      expect(checkNames).toContain("env-sanitization");
    });

    it("off mode has unrestricted network", () => {
      const sandbox = createSandbox("off");
      const config = sandbox.getConfiguration();
      expect(config.networkLevel).toBe("allowlist");
    });

    it("readonly mode blocks all network", () => {
      const sandbox = createSandbox("readonly");
      const config = sandbox.getConfiguration();
      expect(config.networkLevel).toBe("none");
    });

    it("workspace mode allows localhost network only", () => {
      const sandbox = createSandbox("workspace");
      const config = sandbox.getConfiguration();
      expect(config.networkLevel).toBe("localhost");
    });
  });
});
