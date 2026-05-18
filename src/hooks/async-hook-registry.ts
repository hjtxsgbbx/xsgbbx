/**
 * AsyncHookRegistry — manages hook lifecycle with timeouts and concurrency.
 *
 * Adapted from Claude Code's utils/hooks/AsyncHookRegistry.ts.
 * Key differences for DeepSeek:
 *   - Simpler matcher (glob-based, not regex DSL)
 *   - No Anthropic-specific "sampling" hooks
 *   - Command/subprocess timeout via AbortController
 */

import { execSync } from "child_process";
import type {
  HookConfig,
  HookContext,
  HookEvent,
  HookResult,
  HooksSettings,
} from "./hook-events.js";

// ---------------------------------------------------------------------------
// Glob matcher
// ---------------------------------------------------------------------------

function matchGlob(pattern: string, value: string): boolean {
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$",
  );
  return regex.test(value);
}

function hookMatches(
  hook: HookConfig,
  toolName: string,
): boolean {
  if (!hook.matcher) return true;
  // Support pipe-separated alternatives: "Bash|Write|Edit"
  const patterns = hook.matcher.split("|").map((p) => p.trim());
  return patterns.some((p) => matchGlob(p, toolName));
}

// ---------------------------------------------------------------------------
// Variable substitution
// ---------------------------------------------------------------------------

function substituteVars(
  template: string,
  context: HookContext,
): string {
  return template.replace(/\$(\w+)/g, (_, name: string) => {
    return context[name] ?? "";
  });
}

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------

let nextHookId = 0;

async function execCommandHook(
  hook: HookConfig & { type: "command" },
  context: HookContext,
): Promise<{ ok: boolean; output: string }> {
  const shell =
    hook.shell || (process.platform === "win32" ? "cmd.exe" : "/bin/bash");
  const timeoutMs = (hook.timeout ?? 30) * 1000;
  const resolvedCmd = substituteVars(hook.command, context);

  try {
    const output = execSync(resolvedCmd, {
      shell,
      timeout: timeoutMs,
      encoding: "utf-8",
      maxBuffer: 100 * 1024, // 100KB
      windowsHide: true,
    });
    return { ok: true, output: output.trim() };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, output: msg };
  }
}

async function execHttpHook(
  hook: HookConfig & { type: "http" },
  context: HookContext,
): Promise<{ ok: boolean; output: string }> {
  const timeoutMs = (hook.timeout ?? 10) * 1000;

  try {
    const response = await fetch(hook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    return { ok: response.ok, output: text };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, output: msg };
  }
}

// ---------------------------------------------------------------------------
// AsyncHookRegistry
// ---------------------------------------------------------------------------

export class AsyncHookRegistry {
  private id = `hooks-${nextHookId++}`;
  private settings: HooksSettings = {};

  constructor(settings?: HooksSettings) {
    if (settings) this.settings = settings;
  }

  updateSettings(settings: HooksSettings): void {
    this.settings = settings;
  }

  getSettings(): HooksSettings {
    return this.settings;
  }

  /**
   * Execute all hooks for a given event.
   * For PreToolUse: if any hook returns allow=false, the tool is blocked.
   * For PostToolUse/Stop: hooks run for side effects, results are logged.
   */
  async executeHooks(
    event: HookEvent,
    context: HookContext,
    extraHooks?: HookConfig[],
  ): Promise<HookResult[]> {
    const hooks = [
      ...(this.settings[event as keyof HooksSettings] || []),
      ...(extraHooks || []),
    ];

    if (hooks.length === 0) return [];

    const results: HookResult[] = [];

    for (const hook of hooks) {
      const toolName = context.TOOL_NAME || "";
      if (!hookMatches(hook, toolName)) continue;

      const startedAt = Date.now();
      let result: HookResult = {
        ok: true,
        event,
        allow: true,
        durationMs: 0,
      };

      try {
        switch (hook.type) {
          case "command": {
            const r = await execCommandHook(hook, context);
            result.ok = r.ok;
            result.output = r.output;
            break;
          }
          case "http": {
            const r = await execHttpHook(hook, context);
            result.ok = r.ok;
            result.output = r.output;
            break;
          }
          case "prompt":
            // Prompt hooks: stored for model evaluation
            result.message = `[Prompt hook] ${hook.prompt}`;
            break;
        }
      } catch (err: unknown) {
        result.ok = false;
        result.error = err instanceof Error ? err.message : String(err);
      }

      result.durationMs = Date.now() - startedAt;

      // Block on PreToolUse failure
      if (!result.ok && event === "PreToolUse") {
        result.allow = false;
        result.message = result.error || result.output || "Hook failed";
      }

      results.push(result);
    }

    return results;
  }

  /**
   * Convenience: execute PreToolUse hooks for a specific tool.
   */
  async preToolUse(
    toolName: string,
    toolInput: Record<string, unknown>,
    extraHooks?: HookConfig[],
  ): Promise<HookResult[]> {
    return this.executeHooks(
      "PreToolUse",
      {
        TOOL_NAME: toolName,
        TOOL_INPUT: JSON.stringify(toolInput),
      },
      extraHooks,
    );
  }

  /**
   * Convenience: execute PostToolUse hooks for a specific tool.
   */
  async postToolUse(
    toolName: string,
    toolInput: Record<string, unknown>,
    toolResult: { success: boolean; output: string },
    extraHooks?: HookConfig[],
  ): Promise<HookResult[]> {
    return this.executeHooks(
      "PostToolUse",
      {
        TOOL_NAME: toolName,
        TOOL_INPUT: JSON.stringify(toolInput),
        TOOL_RESULT: JSON.stringify(toolResult),
      },
      extraHooks,
    );
  }

  /**
   * Convenience: execute Stop hooks.
   */
  async stop(
    messageCount: number,
    sessionId?: string,
    extraHooks?: HookConfig[],
  ): Promise<HookResult[]> {
    return this.executeHooks(
      "Stop",
      {
        TOOL_NAME: "",
        TOOL_INPUT: "",
        MESSAGE_COUNT: String(messageCount),
        SESSION_ID: sessionId,
      },
      extraHooks,
    );
  }

  /**
   * Convenience: execute SessionStart hooks.
   */
  async sessionStart(
    sessionId: string,
    projectPath: string,
    extraHooks?: HookConfig[],
  ): Promise<HookResult[]> {
    return this.executeHooks(
      "SessionStart",
      {
        TOOL_NAME: "",
        TOOL_INPUT: "",
        SESSION_ID: sessionId,
        PROJECT_PATH: projectPath,
      },
      extraHooks,
    );
  }

  /**
   * Convenience: execute SessionEnd hooks.
   */
  async sessionEnd(
    sessionId: string,
    messageCount: number,
    extraHooks?: HookConfig[],
  ): Promise<HookResult[]> {
    return this.executeHooks(
      "SessionEnd",
      {
        TOOL_NAME: "",
        TOOL_INPUT: "",
        SESSION_ID: sessionId,
        MESSAGE_COUNT: String(messageCount),
      },
      extraHooks,
    );
  }

  /**
   * Convenience: execute PreCompact hooks.
   */
  async preCompact(
    messageCount: number,
    tokenUsage: string,
    extraHooks?: HookConfig[],
  ): Promise<HookResult[]> {
    return this.executeHooks(
      "PreCompact",
      {
        TOOL_NAME: "",
        TOOL_INPUT: "",
        MESSAGE_COUNT: String(messageCount),
        TOKEN_USAGE: tokenUsage,
      },
      extraHooks,
    );
  }

  /**
   * Convenience: execute PostCompact hooks.
   */
  async postCompact(
    messageCountAfter: number,
    tokenSaved: string,
    extraHooks?: HookConfig[],
  ): Promise<HookResult[]> {
    return this.executeHooks(
      "PostCompact",
      {
        TOOL_NAME: "",
        TOOL_INPUT: "",
        MESSAGE_COUNT: String(messageCountAfter),
        TOKEN_USAGE: tokenSaved,
      },
      extraHooks,
    );
  }

  /**
   * Convenience: execute PreQuery hooks.
   */
  async preQuery(
    turnNumber: number,
    modelName: string,
    extraHooks?: HookConfig[],
  ): Promise<HookResult[]> {
    return this.executeHooks(
      "PreQuery",
      {
        TOOL_NAME: "",
        TOOL_INPUT: "",
        TURN_NUMBER: String(turnNumber),
        MODEL_NAME: modelName,
      },
      extraHooks,
    );
  }

  /**
   * Convenience: execute PostQuery hooks.
   */
  async postQuery(
    turnNumber: number,
    modelName: string,
    tokenUsage: string,
    extraHooks?: HookConfig[],
  ): Promise<HookResult[]> {
    return this.executeHooks(
      "PostQuery",
      {
        TOOL_NAME: "",
        TOOL_INPUT: "",
        TURN_NUMBER: String(turnNumber),
        MODEL_NAME: modelName,
        TOKEN_USAGE: tokenUsage,
      },
      extraHooks,
    );
  }

  /**
   * Convenience: execute Notification hooks.
   */
  async notification(
    notificationType: string,
    extraHooks?: HookConfig[],
  ): Promise<HookResult[]> {
    return this.executeHooks(
      "Notification",
      {
        TOOL_NAME: "",
        TOOL_INPUT: "",
        NOTIFICATION_TYPE: notificationType,
      },
      extraHooks,
    );
  }

  /**
   * Check if any results contain a block.
   */
  static isBlocked(results: HookResult[]): boolean {
    return results.some((r) => !r.allow);
  }

  /**
   * Get the blocking message from results.
   */
  static getBlockMessage(results: HookResult[]): string {
    const blocked = results.find((r) => !r.allow);
    return blocked?.message || "Blocked by hook";
  }

  /**
   * Format hook results for logging.
   */
  static formatResults(results: HookResult[]): string {
    if (results.length === 0) return "";
    return results
      .map(
        (r) =>
          `[${r.event}] ${r.ok ? "OK" : "FAIL"} ${r.durationMs}ms${
            r.message ? ` — ${r.message}` : ""
          }`,
      )
      .join("\n");
  }
}
