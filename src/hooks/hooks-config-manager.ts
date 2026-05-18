/**
 * HooksConfigManager — manages hook configurations in settings.json
 * and project-level .agent_1.md frontmatter.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import type { HooksSettings, HookConfig } from "./hook-events.js";

const APP_NAME = "agent_1";
const SETTINGS_DIR = join(homedir(), `.${APP_NAME}`);
const SETTINGS_PATH = join(SETTINGS_DIR, "settings.json");

// ---------------------------------------------------------------------------
// Settings file helpers
// ---------------------------------------------------------------------------

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function writeJsonFile(path: string, data: Record<string, unknown>): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Frontmatter hooks (from .agent_1.md / CLAUDE.md)
// ---------------------------------------------------------------------------

function parseFrontmatterHooks(
  filePath: string,
): HooksSettings | null {
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, "utf-8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    // Simple YAML: look for hooks: block
    const lines = match[1]!.split("\n");
    let inHooks = false;
    let inSubSection = "";
    let currentType = "";
    const hooks: HooksSettings = {};

    for (const line of lines) {
      if (line.match(/^hooks:/)) {
        inHooks = true;
        continue;
      }
      if (!inHooks) continue;

      const subMatch = line.match(/^\s{2}(\w+):/);
      if (subMatch) {
        inSubSection = subMatch[1]!;
        if (
          ["PreToolUse", "PostToolUse", "Stop", "Notification",
           "SessionStart", "SessionEnd", "PreCompact", "PostCompact",
           "PreQuery", "PostQuery"].includes(
            inSubSection,
          )
        ) {
          currentType = inSubSection as keyof HooksSettings;
          if (!hooks[currentType]) hooks[currentType] = [];
        }
        continue;
      }

      // Type: command | http | prompt
      const typeMatch = line.match(/^\s{4}type:\s*(\w+)/);
      if (typeMatch && currentType) {
        const hookType = typeMatch[1] as HookConfig["type"];
        const hook: Record<string, unknown> = { type: hookType };
        hooks[currentType]!.push(hook as unknown as HookConfig);
        continue;
      }
    }

    return Object.keys(hooks).length > 0 ? hooks : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class HooksConfigManager {
  /**
   * Load hooks from settings.json.
   */
  loadFromSettings(): HooksSettings {
    const data = readJsonFile(SETTINGS_PATH);
    return (data.hooks as HooksSettings) || {};
  }

  /**
   * Save hooks to settings.json.
   */
  saveToSettings(hooks: HooksSettings): void {
    const data = readJsonFile(SETTINGS_PATH);
    data.hooks = hooks;
    writeJsonFile(SETTINGS_PATH, data);
  }

  /**
   * Load hooks from project-level .agent_1.md frontmatter.
   */
  loadFromProject(projectPath: string): HooksSettings {
    const paths = [
      join(projectPath, ".agent_1.md"),
      join(projectPath, "CLAUDE.md"),
      join(projectPath, "AGENTS.md"),
    ];

    for (const p of paths) {
      const hooks = parseFrontmatterHooks(p);
      if (hooks) return hooks;
    }

    return {};
  }

  /**
   * Merge hooks from all sources.
   * Priority: project frontmatter > settings.json
   */
  loadAll(projectPath: string): HooksSettings {
    const settings = this.loadFromSettings();
    const project = this.loadFromProject(projectPath);

    const merged: HooksSettings = {};
    for (const key of [
      "PreToolUse",
      "PostToolUse",
      "Stop",
      "Notification",
      "SessionStart",
      "SessionEnd",
      "PreCompact",
      "PostCompact",
      "PreQuery",
      "PostQuery",
    ] as const) {
      merged[key] = [
        ...(settings[key] || []),
        ...(project[key] || []),
      ];
    }
    return merged;
  }

  /**
   * Add a hook to settings.json.
   */
  addHook(event: keyof HooksSettings, hook: HookConfig): void {
    const hooks = this.loadFromSettings();
    if (!hooks[event]) hooks[event] = [];
    hooks[event]!.push(hook);
    this.saveToSettings(hooks);
  }

  /**
   * Remove hooks matching a matcher.
   */
  removeHook(event: keyof HooksSettings, matcher: string): number {
    const hooks = this.loadFromSettings();
    const list = hooks[event] || [];
    const before = list.length;
    hooks[event] = list.filter((h) => h.matcher !== matcher);
    this.saveToSettings(hooks);
    return before - (hooks[event]?.length || 0);
  }
}
