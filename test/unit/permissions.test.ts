/**
 * PermissionPipeline tests — permission modes, RBAC rules, deny patterns.
 */
import { jest } from "@jest/globals";
import type { ToolCall, PlatformInfo, Session } from "../../src/types/index.js";

// ---------------------------------------------------------------------------
// We use unstable_mockModule for ESM compatibility.
// The AIGuard is mocked to avoid shelling out during tests.
// ---------------------------------------------------------------------------
jest.unstable_mockModule("../../src/permissions/ai-guard.js", () => ({
  AIGuard: jest.fn().mockImplementation(() => ({
    validateShellCommand: jest.fn().mockReturnValue({
      passed: true,
      confidence: 0.9,
      requireConfirmation: false,
    }),
  })),
}));

// Dynamic import AFTER mocking is set up
const { PermissionPipeline } = await import("../../src/permissions/pipeline.js");

// For clearing the shared cache
import { clearCache } from "../../src/permissions/rules.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlatform(overrides: Partial<PlatformInfo> = {}): PlatformInfo {
  return {
    os: "linux",
    terminal: "gnome_terminal",
    shell: "/bin/bash",
    isElevated: false,
    homeDir: "/home/testuser",
    tempDir: "/tmp",
    nodeVersion: "20.0.0",
    arch: "x64",
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    session_id: "test-session-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    client_type: "cli",
    status: "active",
    messages: [],
    meta: {
      project_path: "/home/testuser/project",
      model: "test-model",
      provider: "test-provider",
      cost_estimate: 0,
      platform: "linux",
      terminal: "gnome_terminal",
    },
    ...overrides,
  };
}

function execCtx(platform: PlatformInfo) {
  return {
    session: makeSession(),
    platform,
    permissionLevel: { allowed: true, layer: "whitelist" as const, canOverride: false },
  };
}

let callCounter = 0;

function shellToolCall(command: string): ToolCall {
  callCounter++;
  return {
    id: `call-${callCounter}`,
    name: "shell_command",
    arguments: { command },
  };
}

function writeToolCall(): ToolCall {
  callCounter++;
  return {
    id: `call-${callCounter}`,
    name: "write_file",
    arguments: { path: `/tmp/test-${callCounter}.txt`, content: "hello" },
  };
}

function readToolCall(): ToolCall {
  callCounter++;
  return {
    id: `call-${callCounter}`,
    name: "grep",
    arguments: { pattern: `test-${callCounter}` },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PermissionPipeline — default mode", () => {
  const pipeline = new PermissionPipeline("default");
  const platform = makePlatform();

  beforeEach(() => {
    pipeline.clearCache();
  });

  it("allows read-only tools", async () => {
    const tc = readToolCall();
    const decision = await pipeline.check(tc, execCtx(platform));
    expect(decision.allowed).toBe(true);
    expect(decision.layer).toBe("whitelist");
  });

  it("denies dangerous shell commands (rm -rf /)", async () => {
    const tc = shellToolCall("rm -rf /");
    const decision = await pipeline.check(tc, execCtx(platform));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("DENY");
  });

  it("denies fork bomb patterns", async () => {
    const tc = shellToolCall(":(){ :|:& };:");
    const decision = await pipeline.check(tc, execCtx(platform));
    expect(decision.allowed).toBe(false);
  });

  it("asks for confirmation on chmod 777", async () => {
    const tc = shellToolCall("chmod 777 /some/path");
    const decision = await pipeline.check(tc, execCtx(platform));
    expect(decision.allowed).toBe(false);
    expect(decision.confirmationRequired).toBe(true);
    expect(decision.reason).toContain("ASK");
  });

  it("allows safe known commands (git status)", async () => {
    const tc = shellToolCall("git status");
    const decision = await pipeline.check(tc, execCtx(platform));
    expect(decision.allowed).toBe(true);
  });
});

describe("PermissionPipeline — plan mode", () => {
  const pipeline = new PermissionPipeline("plan");
  const platform = makePlatform();

  beforeEach(() => {
    pipeline.clearCache();
  });

  it("blocks write tools in plan mode", async () => {
    const tc = writeToolCall();
    const decision = await pipeline.check(tc, execCtx(platform));
    expect(decision.allowed).toBe(false);
    expect(decision.reason!.toLowerCase()).toContain("plan mode");
  });

  it("blocks shell commands in plan mode", async () => {
    const tc = shellToolCall("echo hello");
    const decision = await pipeline.check(tc, execCtx(platform));
    expect(decision.allowed).toBe(false);
    expect(decision.reason!.toLowerCase()).toContain("plan mode");
  });

  it("allows read-only tools in plan mode", async () => {
    const tc = readToolCall();
    const decision = await pipeline.check(tc, execCtx(platform));
    expect(decision.allowed).toBe(true);
  });
});

describe("PermissionPipeline — autoApprove mode", () => {
  const platform = makePlatform();

  beforeEach(() => {
    clearCache();
  });

  it("auto-approves safe commands", async () => {
    const pipeline = new PermissionPipeline("autoApprove");
    const tc = shellToolCall("git status");
    const decision = await pipeline.check(tc, execCtx(platform));
    expect(decision.allowed).toBe(true);
  });

  it("still blocks deny-tier commands", async () => {
    const pipeline = new PermissionPipeline("autoApprove");
    // Use a command that matches a BUILTIN_RULES deny pattern (write to block device)
    const tc = shellToolCall("> /dev/sda1");
    const decision = await pipeline.check(tc, execCtx(platform));
    expect(decision.allowed).toBe(false);
  });
});

describe("PermissionPipeline — defaultDeny mode", () => {
  const platform = makePlatform();

  beforeEach(() => {
    clearCache();
  });

  it("allows read-only tools in defaultDeny mode", async () => {
    const pipeline = new PermissionPipeline("defaultDeny");
    const tc = readToolCall();
    const decision = await pipeline.check(tc, execCtx(platform));
    expect(decision.allowed).toBe(true);
  });

  it("denies write tools by default in defaultDeny mode", async () => {
    const pipeline = new PermissionPipeline("defaultDeny");
    const tc = writeToolCall();
    const decision = await pipeline.check(tc, execCtx(platform));
    expect(decision.allowed).toBe(false);
    expect(decision.canOverride).toBe(true);
    expect(decision.confirmationRequired).toBe(true);
  });

  it("still blocks deny-tier commands in defaultDeny mode", async () => {
    const pipeline = new PermissionPipeline("defaultDeny");
    const tc = shellToolCall("rm -rf /");
    const decision = await pipeline.check(tc, execCtx(platform));
    expect(decision.allowed).toBe(false);
    expect(decision.canOverride).toBe(false);
  });
});

describe("PermissionPipeline — sandbox mode", () => {
  const platform = makePlatform();

  beforeEach(() => {
    clearCache();
  });

  it("allows read-only tools in sandbox mode", async () => {
    const pipeline = new PermissionPipeline("sandbox");
    const tc = readToolCall();
    const decision = await pipeline.check(tc, execCtx(platform));
    expect(decision.allowed).toBe(true);
  });

  it("blocks destructive commands in sandbox mode", async () => {
    const pipeline = new PermissionPipeline("sandbox");
    const tc = shellToolCall("shutdown -h now");
    const decision = await pipeline.check(tc, execCtx(platform));
    // shutdown is in the sandbox dangerous patterns check
    expect(decision.allowed).toBe(false);
  });

  it("applies confirmation for non-readonly non-shell tools", async () => {
    const pipeline = new PermissionPipeline("sandbox");
    const tc = writeToolCall();
    const decision = await pipeline.check(tc, execCtx(platform));
    // For write tools with no command: sandbox mode allows with confirmationRequired
    expect(decision.allowed).toBe(true);
    expect(decision.confirmationRequired).toBe(true);
  });
});

describe("PermissionPipeline — RBAC rules", () => {
  const platform = makePlatform();

  beforeEach(() => {
    clearCache();
  });

  it("adds and retrieves custom deny rules", () => {
    const pipeline = new PermissionPipeline("default");
    const rule = pipeline.addRule("halt", "deny", "Block halt command");
    expect(rule.id).toContain("custom-");
    expect(rule.type).toBe("deny");
    expect(pipeline.getRules().length).toBeGreaterThan(0);
  });

  it("removes custom rules by id", () => {
    const pipeline = new PermissionPipeline("default");
    const rule = pipeline.addRule("halt", "deny", "Block halt command");
    const removed = pipeline.removeRule(rule.id);
    expect(removed).toBe(true);
    expect(pipeline.removeRule(rule.id)).toBe(false);
  });

  it("adds and removes deny patterns", () => {
    const pipeline = new PermissionPipeline("default");
    pipeline.addDenyPattern("shutdown");
    expect(pipeline.getDenyPatterns()).toContain("shutdown");
    const removed = pipeline.removeDenyPattern("shutdown");
    expect(removed).toBe(true);
    expect(pipeline.getDenyPatterns()).not.toContain("shutdown");
  });

  it("detects deny rules for forbidden commands", async () => {
    const pipeline = new PermissionPipeline("default");
    pipeline.addDenyPattern("halt-command-xyz");
    const tc = shellToolCall("halt-command-xyz");
    const decision = await pipeline.check(tc, execCtx(platform));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("DENY");
  });

  it("supports allow rules that bypass all checks", async () => {
    const pipeline = new PermissionPipeline("default");
    pipeline.addRule("unique-allowed-cmd-test", "allow", "Allow test cmd");
    const tc = shellToolCall("unique-allowed-cmd-test");
    const decision = await pipeline.check(tc, execCtx(platform));
    expect(decision.allowed).toBe(true);
  });
});

describe("PermissionPipeline — mode switching", () => {
  const platform = makePlatform();

  beforeEach(() => {
    clearCache();
  });

  it("switches from default to plan and back", async () => {
    const pipeline = new PermissionPipeline("default");
    // Use unique tool calls and clear cache between mode switches
    // because the permission cache is mode-agnostic
    const tc1 = writeToolCall();
    const decisionDefault = await pipeline.check(tc1, execCtx(platform));
    expect(decisionDefault.allowed).toBe(true);

    pipeline.setMode("plan");
    pipeline.clearCache();
    const tc2 = writeToolCall();
    const decisionPlan = await pipeline.check(tc2, execCtx(platform));
    expect(decisionPlan.allowed).toBe(false);

    pipeline.setMode("default");
    pipeline.clearCache();
    const tc3 = writeToolCall();
    const decisionBack = await pipeline.check(tc3, execCtx(platform));
    expect(decisionBack.allowed).toBe(true);
  });

  it("clears the decision cache", async () => {
    const pipeline = new PermissionPipeline("default");
    const tc = readToolCall();

    const d1 = await pipeline.check(tc, execCtx(platform));
    expect(d1.allowed).toBe(true);

    pipeline.clearCache();
    const d2 = await pipeline.check(tc, execCtx(platform));
    expect(d2.allowed).toBe(true);
  });
});
