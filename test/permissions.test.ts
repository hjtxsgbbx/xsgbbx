import { PermissionPipeline } from "../src/permissions/index.js";
import { detectPlatform } from "../src/pal/index.js";
import { ToolCall, ExecutionContext, Session } from "../src/types/index.js";

describe("Permission Pipeline", () => {
  const platform = detectPlatform();
  const pipeline = new PermissionPipeline("default");
  const mockSession: Session = {
    session_id: "test",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    client_type: "cli",
    status: "active",
    messages: [],
    meta: {
      project_path: "/test",
      model: "test",
      provider: "test",
      cost_estimate: 0,
      platform: "test",
      terminal: "test",
    },
  };
  const context: ExecutionContext = {
    session: mockSession,
    platform,
    permissionLevel: {
      allowed: true,
      layer: "whitelist",
      canOverride: false,
    },
  };

  test("should allow read-only grep tool on whitelist", async () => {
    const toolCall: ToolCall = {
      id: "1",
      name: "grep",
      arguments: { pattern: "test" },
    };

    const decision = await pipeline.check(toolCall, context);
    expect(decision.allowed).toBe(true);
    expect(decision.layer).toBe("whitelist");
  });

  test("should deny dangerous rm -rf / command", async () => {
    const toolCall: ToolCall = {
      id: "2",
      name: "shell_command",
      arguments: { command: "rm -rf /" },
    };

    const decision = await pipeline.check(toolCall, context);
    expect(decision.allowed).toBe(false);
    expect(decision.canOverride).toBe(false);
  });

  test("should deny format C: on Windows", async () => {
    if (platform.os !== "windows") return;

    const toolCall: ToolCall = {
      id: "3",
      name: "shell_command",
      arguments: { command: "format C:" },
    };

    const decision = await pipeline.check(toolCall, context);
    expect(decision.allowed).toBe(false);
    expect(decision.canOverride).toBe(false);
  });

  test("should allow npm install on whitelist", async () => {
    const toolCall: ToolCall = {
      id: "4",
      name: "shell_command",
      arguments: { command: "npm install" },
    };

    const decision = await pipeline.check(toolCall, context);
    expect(decision.allowed).toBe(true);
  });

  test("should deny all writes in plan mode", async () => {
    const planPipeline = new PermissionPipeline("plan");
    const toolCall: ToolCall = {
      id: "5",
      name: "shell_command",
      arguments: { command: "rm -rf temp" },
    };

    const decision = await planPipeline.check(toolCall, context);
    expect(decision.allowed).toBe(false);
    expect(decision.canOverride).toBe(false);
  });

  test("should use cache for repeated calls", async () => {
    const toolCall: ToolCall = {
      id: "6",
      name: "grep",
      arguments: { pattern: "cache_test" },
    };

    const decision1 = await pipeline.check(toolCall, context);
    const decision2 = await pipeline.check(toolCall, context);
    expect(decision1.allowed).toBe(decision2.allowed);
    expect(decision1.layer).toBe(decision2.layer);
  });
});