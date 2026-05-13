import { SandboxExecutor, SandboxMode, sandbox } from "../src/security/sandbox.js";
import type { ToolCall } from "../src/types/index.js";

function makeToolCall(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: "test-call", name, arguments: args };
}

describe("SandboxExecutor", () => {
  describe("constructor", () => {
    it("should default to 'off' mode", () => {
      const sb = new SandboxExecutor();
      expect(sb.getMode()).toBe("off");
    });

    it("should accept custom mode", () => {
      const sb = new SandboxExecutor({ mode: "readonly" });
      expect(sb.getMode()).toBe("readonly");
    });

    it("should accept custom timeout", () => {
      const sb = new SandboxExecutor({ timeoutMs: 5000 });
      expect(sb.getOptions().timeoutMs).toBe(5000);
    });
  });

  describe("setMode/getMode", () => {
    it("should change mode", () => {
      const sb = new SandboxExecutor();
      sb.setMode("workspace");
      expect(sb.getMode()).toBe("workspace");
    });

    it("should support all modes", () => {
      const sb = new SandboxExecutor();
      const modes: SandboxMode[] = ["off", "readonly", "workspace", "full"];
      for (const mode of modes) {
        sb.setMode(mode);
        expect(sb.getMode()).toBe(mode);
      }
    });
  });

  describe("validateCommand in readonly mode", () => {
    const sb = new SandboxExecutor({ mode: "readonly" });

    it("should allow read commands", () => {
      const result = sb.validateCommand("ls -la", makeToolCall("shell_command"));
      expect(result.allowed).toBe(true);
    });

    it("should allow git status", () => {
      const result = sb.validateCommand(
        "git status",
        makeToolCall("shell_command")
      );
      expect(result.allowed).toBe(true);
    });

    it("should block rm command", () => {
      const result = sb.validateCommand(
        "rm -rf ./node_modules",
        makeToolCall("shell_command")
      );
      expect(result.allowed).toBe(false);
    });

    it("should block del command", () => {
      const result = sb.validateCommand(
        "del /f test.txt",
        makeToolCall("shell_command")
      );
      expect(result.allowed).toBe(false);
    });

    it("should block npm install in readonly mode", () => {
      const result = sb.validateCommand(
        "npm install express",
        makeToolCall("shell_command")
      );
      expect(result.allowed).toBe(false);
    });

    it("should block redirect operators", () => {
      const result = sb.validateCommand(
        "echo test > file.txt",
        makeToolCall("shell_command")
      );
      expect(result.allowed).toBe(false);
    });
  });

  describe("validateCommand in workspace mode", () => {
    const sb = new SandboxExecutor({
      mode: "workspace",
      workspaceDir: "/home/project",
    });

    it("should allow basic commands", () => {
      const result = sb.validateCommand("echo hello", makeToolCall("shell_command"));
      expect(result.allowed).toBe(true);
    });

    it("should block sudo", () => {
      const result = sb.validateCommand(
        "sudo rm -rf /",
        makeToolCall("shell_command")
      );
      expect(result.allowed).toBe(false);
    });

    it("should block docker", () => {
      const result = sb.validateCommand(
        "docker rm -f container",
        makeToolCall("shell_command")
      );
      expect(result.allowed).toBe(false);
    });

    it("should block shutdown", () => {
      const result = sb.validateCommand(
        "shutdown -h now",
        makeToolCall("shell_command")
      );
      expect(result.allowed).toBe(false);
    });

    it("should block iptables", () => {
      const result = sb.validateCommand(
        "iptables -L",
        makeToolCall("shell_command")
      );
      expect(result.allowed).toBe(false);
    });

    it("should block user management", () => {
      const result = sb.validateCommand(
        "useradd hacker",
        makeToolCall("shell_command")
      );
      expect(result.allowed).toBe(false);
    });
  });

  describe("validateCommand in off/full mode", () => {
    it("should allow all commands in off mode", () => {
      const sb = new SandboxExecutor({ mode: "off" });
      const result = sb.validateCommand(
        "rm -rf /",
        makeToolCall("shell_command")
      );
      expect(result.allowed).toBe(true);
    });

    it("should allow all commands in full mode", () => {
      const sb = new SandboxExecutor({ mode: "full" });
      const result = sb.validateCommand(
        "sudo rm -rf /",
        makeToolCall("shell_command")
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe("validateCommand empty command", () => {
    it("should allow empty command", () => {
      const sb = new SandboxExecutor({ mode: "readonly" });
      const result = sb.validateCommand("", makeToolCall("shell_command"));
      expect(result.allowed).toBe(true);
    });

    it("should allow whitespace command", () => {
      const sb = new SandboxExecutor({ mode: "readonly" });
      const result = sb.validateCommand("   ", makeToolCall("shell_command"));
      expect(result.allowed).toBe(true);
    });
  });

  describe("getTieredTimeout", () => {
    const sb = new SandboxExecutor();

    it("should give quick commands shorter timeout", () => {
      const timeout = sb.getTieredTimeout("ls -la");
      expect(timeout).toBe(10000);
    });

    it("should give build commands longer timeout", () => {
      const timeout = sb.getTieredTimeout("npm run build");
      expect(timeout).toBe(300000);
    });

    it("should give test commands longer timeout", () => {
      const timeout = sb.getTieredTimeout("npm test");
      expect(timeout).toBe(300000);
    });

    it("should give install commands medium timeout", () => {
      const timeout = sb.getTieredTimeout("npm install express");
      expect(timeout).toBe(180000);
    });

    it("should default to configured timeout", () => {
      const sbCustom = new SandboxExecutor({ timeoutMs: 60000 });
      const timeout = sbCustom.getTieredTimeout("unknown-command");
      expect(timeout).toBe(60000);
    });
  });

  describe("getOptions", () => {
    it("should return a copy of options", () => {
      const sb = new SandboxExecutor({ mode: "readonly", timeoutMs: 30000 });
      const opts = sb.getOptions();
      expect(opts.mode).toBe("readonly");
      expect(opts.timeoutMs).toBe(30000);
      expect(opts.maxOutputBytes).toBe(1024 * 1024);
    });
  });

  describe("wrapCommand", () => {
    it("should return original command in off mode", () => {
      const sb = new SandboxExecutor({ mode: "off" });
      expect(sb.wrapCommand("echo hello")).toBe("echo hello");
    });

    it("should wrap command in readonly mode", () => {
      const sb = new SandboxExecutor({ mode: "readonly", timeoutMs: 30000 });
      const wrapped = sb.wrapCommand("echo hello");
      if (process.platform === "win32") {
        expect(wrapped).toContain("Start-Job");
      } else {
        expect(wrapped).toContain("timeout");
      }
    });
  });

  describe("global sandbox instance", () => {
    it("should be a SandboxExecutor", () => {
      expect(sandbox).toBeInstanceOf(SandboxExecutor);
    });
  });
});