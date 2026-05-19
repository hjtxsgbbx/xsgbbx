/**
 * Hook System — PreToolUse / PostToolUse / Stop hooks.
 *
 * Based on Claude Code's hooks/ system (17 files, 5 types).
 * Simplified to 3 types (command/prompt/http) × 3 events.
 *
 * Configuration in ~/.xsgbbx/settings.json or xsgbbx.md frontmatter:
 * {
 *   "hooks": {
 *     "PreToolUse": [
 *       { "type": "command", "command": "echo 'about to use $TOOL_NAME'", "matcher": "BashTool" }
 *     ],
 *     "PostToolUse": [...],
 *     "Stop": [...]
 *   }
 * }
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { APP_NAME } from "../core/constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HookEvent = "PreToolUse" | "PostToolUse" | "Stop" | string;

/**
 * External hook handler signature.
 * Receives a context object and returns a HookResult-like outcome.
 */
export type HookHandler = (
  context: Record<string, unknown>,
) => Promise<{ allow: boolean; message?: string }>;

export interface HookCommand {
  type: "command";
  command: string;
  /** Shell to execute with (default: bash/cmd) */
  shell?: string;
  /** Optional matcher: tool name or wildcard */
  matcher?: string;
  /** Optional condition using $TOOL_NAME, $TOOL_INPUT */
  if?: string;
  /** Timeout in seconds */
  timeout?: number;
}

export interface HookPrompt {
  type: "prompt";
  prompt: string;
  matcher?: string;
  timeout?: number;
}

export interface HookHttp {
  type: "http";
  url: string;
  matcher?: string;
  timeout?: number;
}

export type HookConfig = HookCommand | HookPrompt | HookHttp;

export interface HooksSettings {
  PreToolUse?: HookConfig[];
  PostToolUse?: HookConfig[];
  Stop?: HookConfig[];
}

export interface HookResult {
  ok: boolean;
  event: HookEvent;
  output?: string;
  error?: string;
  /** If false, the tool execution should be blocked */
  allow: boolean;
  /** Message to show the user */
  message?: string;
}

// ---------------------------------------------------------------------------
// Hook execution
// ---------------------------------------------------------------------------

function matchTool(hook: HookConfig, toolName: string): boolean {
  if (!hook.matcher) return true;
  const pattern = hook.matcher;
  // Simple glob: * matches any sequence, ? matches single char
  const regex = new RegExp(
    "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
  );
  return regex.test(toolName);
}

function evaluateCondition(hook: HookConfig, context: Record<string, unknown>): boolean {
  const condition = (hook as HookCommand).if;
  if (!condition) return true;
  // Simple evaluation: checks if env-like variables exist
  const resolved = condition.replace(/\$(\w+)/g, (_, name) => {
    const val = context[name];
    if (val === undefined) return "";
    return typeof val === "string" ? val : JSON.stringify(val);
  });
  // Only support simple truthy checks
  return resolved.trim().length > 0 && resolved !== "false" && resolved !== "0";
}

async function execCommandHook(hook: HookCommand, context: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
  const shell = hook.shell || (process.platform === "win32" ? "cmd" : "bash");
  const timeout = (hook.timeout || 30) * 1000;

  // Substitute $VARS in command
  const resolvedCmd = hook.command.replace(/\$(\w+)/g, (_, name) => {
    const val = context[name];
    if (val === undefined) return "";
    return typeof val === "string" ? val : JSON.stringify(val);
  });

  try {
    const output = execSync(resolvedCmd, {
      shell,
      timeout,
      encoding: "utf-8",
      maxBuffer: 50 * 1024, // 50KB max
    });
    return { ok: true, output: output.trim() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, output: message };
  }
}

async function execHttpHook(hook: HookHttp, context: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
  const timeout = (hook.timeout || 10) * 1000;
  try {
    const response = await fetch(hook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context),
      signal: AbortSignal.timeout(timeout),
    });
    const text = await response.text();
    return { ok: response.ok, output: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, output: message };
  }
}

/**
 * Execute hooks for a given event.
 * Returns array of results. If any hook returns allow=false, the action should be blocked.
 */
export async function executeHooks(
  event: HookEvent,
  hooks: HookConfig[],
  context: Record<string, unknown>
): Promise<HookResult[]> {
  const results: HookResult[] = [];

  for (const hook of hooks) {
    const toolName = (context.TOOL_NAME as string) || "";
    if (!matchTool(hook, toolName)) continue;
    if (!evaluateCondition(hook, context)) continue;

    let hookResult: HookResult = {
      ok: true,
      event,
      allow: true,
    };

    try {
      switch (hook.type) {
        case "command": {
          const r = await execCommandHook(hook, context);
          hookResult.ok = r.ok;
          hookResult.output = r.output;
          // Non-zero exit = block (for PreToolUse)
          if (!r.ok && event === "PreToolUse") {
            hookResult.allow = false;
            hookResult.message = `Hook blocked: ${r.output}`;
          }
          break;
        }
        case "http": {
          const r = await execHttpHook(hook, context);
          hookResult.ok = r.ok;
          hookResult.output = r.output;
          if (!r.ok && event === "PreToolUse") {
            hookResult.allow = false;
            hookResult.message = `Hook blocked: HTTP ${r.output}`;
          }
          break;
        }
        case "prompt":
          // Prompt hooks are executed by the model (future: LLM-based evaluation)
          hookResult.message = `Prompt hook (evaluated by model): ${hook.prompt}`;
          break;
      }
    } catch (err) {
      hookResult.ok = false;
      hookResult.error = err instanceof Error ? err.message : String(err);
    }

    results.push(hookResult);
  }

  return results;
}

// ---------------------------------------------------------------------------
// External hook registry (populated by plugins)
// ---------------------------------------------------------------------------

interface ExternalHookEntry {
  event: string;
  handler: HookHandler;
}

let externalHooks: ExternalHookEntry[] = [];

/**
 * Register a hook handler from an external source (plugin).
 * Returns a new array — the original is never mutated.
 */
export function registerExternalHook(
  event: string,
  handler: HookHandler,
): ExternalHookEntry[] {
  externalHooks = [...externalHooks, { event, handler }];
  return externalHooks;
}

/**
 * Remove all external hooks registered for a given event.
 * Returns a new array — the original is never mutated.
 */
export function unregisterExternalHooks(event: string): ExternalHookEntry[] {
  externalHooks = externalHooks.filter((e) => e.event !== event);
  return externalHooks;
}

/**
 * Get all external hook handlers for a given event.
 */
export function getExternalHooks(event: string): HookHandler[] {
  return externalHooks
    .filter((e) => e.event === event)
    .map((e) => e.handler);
}

/**
 * Execute external (plugin-provided) hooks for an event.
 * External hooks run AFTER configured hooks but BEFORE the action proceeds.
 * If any external hook returns allow=false, the action is blocked.
 */
export async function executeExternalHooks(
  event: string,
  context: Record<string, unknown>,
): Promise<HookResult[]> {
  const handlers = getExternalHooks(event);
  const results: HookResult[] = [];

  for (const handler of handlers) {
    try {
      const outcome = await handler(context);
      results.push({
        ok: true,
        event: event as HookEvent,
        allow: outcome.allow,
        message: outcome.message,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        ok: false,
        event: event as HookEvent,
        allow: false,
        error: message,
        message: `External hook error: ${message}`,
      });
    }
  }

  return results;
}

/**
 * Clear all externally registered hooks.
 */
export function clearExternalHooks(): void {
  externalHooks = [];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getSettingsPath(): string {
  return join(homedir(), `.${APP_NAME}`, "settings.json");
}

/** Load hooks from settings.json */
export function loadHooksSettings(): HooksSettings {
  const path = getSettingsPath();
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed?.hooks || {};
  } catch {
    return {};
  }
}

/** Save hooks to settings.json */
export function saveHooksSettings(hooks: HooksSettings): void {
  const path = getSettingsPath();
  const dir = join(homedir(), `.${APP_NAME}`);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, "utf-8"));
    } catch { /* ignore */ }
  }
  existing.hooks = hooks;
  writeFileSync(path, JSON.stringify(existing, null, 2));
}

/**
 * Get all registered hooks for an event, merging settings.json + session hooks.
 */
export function getHooksForEvent(event: HookEvent, sessionHooks?: HooksSettings): HookConfig[] {
  const settings = loadHooksSettings();
  const fromSettings = settings[event] || [];
  const fromSession = sessionHooks?.[event] || [];
  return [...fromSettings, ...fromSession];
}

// ---------------------------------------------------------------------------
// Convenience executors
// ---------------------------------------------------------------------------

export async function executePreToolUseHooks(
  toolName: string,
  toolInput: Record<string, unknown>,
  sessionHooks?: HooksSettings
): Promise<HookResult[]> {
  const hooks = getHooksForEvent("PreToolUse", sessionHooks);
  return executeHooks("PreToolUse", hooks, {
    TOOL_NAME: toolName,
    TOOL_INPUT: JSON.stringify(toolInput),
  });
}

export async function executePostToolUseHooks(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResult: { success: boolean; output: string },
  sessionHooks?: HooksSettings
): Promise<HookResult[]> {
  const hooks = getHooksForEvent("PostToolUse", sessionHooks);
  return executeHooks("PostToolUse", hooks, {
    TOOL_NAME: toolName,
    TOOL_INPUT: JSON.stringify(toolInput),
    TOOL_RESULT: JSON.stringify(toolResult),
  });
}

export async function executeStopHooks(
  messages: unknown[],
  sessionHooks?: HooksSettings
): Promise<HookResult[]> {
  const hooks = getHooksForEvent("Stop", sessionHooks);
  return executeHooks("Stop", hooks, {
    MESSAGE_COUNT: String(messages.length),
  });
}
