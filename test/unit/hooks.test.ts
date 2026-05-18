/**
 * AsyncHookRegistry tests — hook lifecycle, matchers, types, settings.
 */
import { jest } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mock child_process.execSync for command-type hooks (ESM-compatible)
// ---------------------------------------------------------------------------
jest.unstable_mockModule("child_process", () => ({
  execSync: jest.fn((cmd: string, _opts: unknown) => {
    if (typeof cmd === "string" && cmd.includes("block-")) {
      throw new Error("Simulated hook failure");
    }
    return "hook-output";
  }),
}));

// Mock global fetch for http-type hooks
(globalThis as Record<string, unknown>).fetch = jest
  .fn()
  .mockResolvedValue({
    ok: true,
    text: async () => "http-hook-response",
  });

const { AsyncHookRegistry } = await import("../../src/hooks/async-hook-registry.js");
import type { HookConfig, HooksSettings } from "../../src/hooks/hook-events.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSettings(overrides: Partial<HooksSettings> = {}): HooksSettings {
  return {
    PreToolUse: [],
    PostToolUse: [],
    Stop: [],
    ...overrides,
  };
}

function commandHook(
  cmd: string,
  matcher?: string,
  timeout?: number,
): HookConfig & { type: "command" } {
  return { type: "command", command: cmd, matcher, timeout };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AsyncHookRegistry — PreToolUse blocking", () => {
  it("blocks tool when command hook fails in PreToolUse", async () => {
    const registry = new AsyncHookRegistry(
      makeSettings({
        PreToolUse: [commandHook("block-echo failing")],
      }),
    );
    const results = await registry.preToolUse("TestTool", { arg: 1 });
    expect(results.length).toBe(1);
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.allow).toBe(false);
  });

  it("does not block tool when command hook succeeds", async () => {
    const registry = new AsyncHookRegistry(
      makeSettings({
        PreToolUse: [commandHook("echo success")],
      }),
    );
    const results = await registry.preToolUse("TestTool", { arg: 1 });
    expect(results.length).toBe(1);
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.allow).toBe(true);
  });

  it("returns empty results when no hooks configured", async () => {
    const registry = new AsyncHookRegistry();
    const results = await registry.preToolUse("TestTool", {});
    expect(results).toEqual([]);
  });
});

describe("AsyncHookRegistry — PostToolUse side effects", () => {
  it("runs PostToolUse hooks regardless of tool outcome", async () => {
    const registry = new AsyncHookRegistry(
      makeSettings({
        PostToolUse: [commandHook("echo done")],
      }),
    );
    const results = await registry.postToolUse("TestTool", {}, {
      success: true,
      output: "result",
    });
    expect(results.length).toBe(1);
    expect(results[0]!.event).toBe("PostToolUse");
  });
});

describe("AsyncHookRegistry — hook matching", () => {
  it("matches via glob wildcard (*)", async () => {
    const registry = new AsyncHookRegistry(
      makeSettings({
        PreToolUse: [commandHook("echo match", "Bash*")],
      }),
    );
    const results = await registry.preToolUse("BashTool", {});
    expect(results.length).toBe(1);
  });

  it("skips hooks whose matcher does not match", async () => {
    const registry = new AsyncHookRegistry(
      makeSettings({
        PreToolUse: [commandHook("echo match", "Write*")],
      }),
    );
    const results = await registry.preToolUse("ReadFile", {});
    expect(results.length).toBe(0);
  });

  it("matches pipe-separated alternatives (Bash|Write)", async () => {
    const registry = new AsyncHookRegistry(
      makeSettings({
        PreToolUse: [commandHook("echo match", "Bash|Write")],
      }),
    );
    const results1 = await registry.preToolUse("Bash", {});
    const results2 = await registry.preToolUse("Write", {});
    const results3 = await registry.preToolUse("Read", {});
    expect(results1.length).toBe(1);
    expect(results2.length).toBe(1);
    expect(results3.length).toBe(0);
  });

  it("matches single-character wildcard (?)", async () => {
    const registry = new AsyncHookRegistry(
      makeSettings({
        PreToolUse: [commandHook("echo match", "???")],
      }),
    );
    const results = await registry.preToolUse("Cat", {});
    expect(results.length).toBe(1);
    const results2 = await registry.preToolUse("Bash", {});
    expect(results2.length).toBe(0);
  });

  it("matches without matcher (matches everything)", async () => {
    const registry = new AsyncHookRegistry(
      makeSettings({
        PreToolUse: [commandHook("echo match")],
      }),
    );
    const results = await registry.preToolUse("AnyTool", {});
    expect(results.length).toBe(1);
  });
});

describe("AsyncHookRegistry — hook types", () => {
  it("executes command type hooks", async () => {
    const registry = new AsyncHookRegistry(
      makeSettings({
        PreToolUse: [commandHook("echo hello")],
      }),
    );
    const results = await registry.preToolUse("TestTool", {});
    expect(results[0]!.ok).toBe(true);
  });

  it("handles prompt type hooks (no execution, stores message)", async () => {
    const registry = new AsyncHookRegistry(
      makeSettings({
        PostToolUse: [
          { type: "prompt", prompt: "Check if output is safe" },
        ],
      }),
    );
    const results = await registry.postToolUse("TestTool", {}, {
      success: true,
      output: "test",
    });
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.allow).toBe(true);
    expect(results[0]!.message).toContain("Prompt hook");
  });
});

describe("AsyncHookRegistry — convenience methods", () => {
  it("stop hooks receive messageCount and sessionId", async () => {
    const registry = new AsyncHookRegistry(
      makeSettings({
        Stop: [commandHook("echo stop")],
      }),
    );
    const results = await registry.stop(42, "session-123");
    expect(results.length).toBe(1);
    expect(results[0]!.event).toBe("Stop");
  });

  it("sessionStart hooks receive sessionId and projectPath", async () => {
    const registry = new AsyncHookRegistry(
      makeSettings({
        SessionStart: [commandHook("echo started")],
      }),
    );
    const results = await registry.sessionStart("session-123", "/project");
    expect(results.length).toBe(1);
    expect(results[0]!.event).toBe("SessionStart");
  });

  it("preCompact hooks receive messageCount and tokenUsage", async () => {
    const registry = new AsyncHookRegistry(
      makeSettings({
        PreCompact: [commandHook("echo pre-compact")],
      }),
    );
    const results = await registry.preCompact(100, "tokens:50000");
    expect(results.length).toBe(1);
    expect(results[0]!.event).toBe("PreCompact");
  });

  it("notification hooks receive notificationType", async () => {
    const registry = new AsyncHookRegistry(
      makeSettings({
        Notification: [commandHook("echo notified")],
      }),
    );
    const results = await registry.notification("startup");
    expect(results.length).toBe(1);
    expect(results[0]!.event).toBe("Notification");
  });
});

describe("AsyncHookRegistry — static helpers", () => {
  it("isBlocked detects blocked results", () => {
    const blocked = [
      { ok: true, event: "PreToolUse" as const, allow: true, durationMs: 10 },
      { ok: false, event: "PreToolUse" as const, allow: false, durationMs: 5 },
    ];
    expect(AsyncHookRegistry.isBlocked(blocked)).toBe(true);
  });

  it("isBlocked returns false when all allowed", () => {
    const allowed = [
      { ok: true, event: "PreToolUse" as const, allow: true, durationMs: 10 },
    ];
    expect(AsyncHookRegistry.isBlocked(allowed)).toBe(false);
  });

  it("getBlockMessage extracts blocking reason", () => {
    const results = [
      { ok: false, event: "PreToolUse" as const, allow: false, durationMs: 5, message: "Dangerous operation" },
    ];
    expect(AsyncHookRegistry.getBlockMessage(results)).toBe("Dangerous operation");
  });

  it("getBlockMessage returns default when no block found", () => {
    const results = [
      { ok: true, event: "PreToolUse" as const, allow: true, durationMs: 10 },
    ];
    expect(AsyncHookRegistry.getBlockMessage(results)).toBe("Blocked by hook");
  });

  it("formatResults formats hook results for display", () => {
    const results = [
      { ok: true, event: "PreToolUse" as const, allow: true, durationMs: 10, message: "OK" },
      { ok: false, event: "PostToolUse" as const, allow: true, durationMs: 5 },
    ];
    const formatted = AsyncHookRegistry.formatResults(results);
    expect(formatted).toContain("PreToolUse");
    expect(formatted).toContain("OK");
    expect(formatted).toContain("PostToolUse");
  });

  it("formatResults returns empty string for empty results", () => {
    expect(AsyncHookRegistry.formatResults([])).toBe("");
  });
});

describe("AsyncHookRegistry — HooksSettings", () => {
  it("returns stored settings", () => {
    const settings = makeSettings({
      PreToolUse: [commandHook("echo test")],
    });
    const registry = new AsyncHookRegistry(settings);
    expect(registry.getSettings()).toEqual(settings);
  });

  it("updates settings dynamically", () => {
    const registry = new AsyncHookRegistry();
    const newSettings = makeSettings({
      PostToolUse: [commandHook("echo updated")],
    });
    registry.updateSettings(newSettings);
    expect(registry.getSettings()).toEqual(newSettings);
  });

  it("accepts empty constructor (no settings)", () => {
    const registry = new AsyncHookRegistry();
    expect(registry.getSettings()).toEqual({});
  });
});
