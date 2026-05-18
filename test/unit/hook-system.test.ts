/**
 * Hook system tests
 */
import { executeHooks, loadHooksSettings } from "../../src/engine/hook-system";
import type { HookConfig, HooksSettings } from "../../src/engine/hook-system";

describe("Hook System", () => {
  const testHooks: HooksSettings = {
    PreToolUse: [
      { type: "command", command: "echo 'test pre-hook'", matcher: "BashTool" },
    ] as HookConfig[],
    PostToolUse: [
      { type: "command", command: "echo 'test post-hook'" },
    ] as HookConfig[],
  };

  it("executes PreToolUse hooks", async () => {
    const results = await executeHooks("PreToolUse", testHooks.PreToolUse!, {
      TOOL_NAME: "BashTool",
      TOOL_INPUT: JSON.stringify({ command: "ls" }),
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.event).toBe("PreToolUse");
  });

  it("matches tools via matcher wildcard", async () => {
    const hooks = [
      { type: "command" as const, command: "echo matched", matcher: "Bash*" },
    ];
    const results = await executeHooks("PreToolUse", hooks, {
      TOOL_NAME: "BashTool",
      TOOL_INPUT: "{}",
    });
    expect(results.length).toBe(1);
    expect(results[0]!.ok).toBe(true);
  });

  it("skips hooks that don't match matcher", async () => {
    const hooks = [
      { type: "command" as const, command: "echo matched", matcher: "Edit*" },
    ];
    const results = await executeHooks("PreToolUse", hooks, {
      TOOL_NAME: "ReadFileTool",
      TOOL_INPUT: "{}",
    });
    expect(results.length).toBe(0);
  });

  it("can load hooks settings (returns empty if no settings)", () => {
    const settings = loadHooksSettings();
    expect(settings).toBeDefined();
  });
});
