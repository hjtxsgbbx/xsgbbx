/**
 * Keybindings system — custom keyboard shortcuts for the terminal UI.
 *
 * Adapted from Claude Code's keybindings/ system. Supports:
 *   - Default bindings shipped with the CLI
 *   - User custom bindings from ~/.agent_1/keybindings.json
 *   - Schema validation
 *   - Shortcut display formatting
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Keybinding {
  /** Human-readable shortcut like "Ctrl+D", "Alt+Enter", "Escape" */
  key: string;
  /** Action to perform */
  action: string;
  /** Optional description shown in help */
  description?: string;
  /** Context where this binding is active */
  context?: "global" | "input" | "select" | "vim-normal" | "vim-insert";
}

export interface KeybindingSet {
  version: number;
  bindings: Keybinding[];
}

// ---------------------------------------------------------------------------
// Default bindings
// ---------------------------------------------------------------------------

const DEFAULT_BINDINGS: Keybinding[] = [
  { key: "Ctrl+C", action: "interrupt", description: "Interrupt current task", context: "global" },
  { key: "Ctrl+D", action: "exit", description: "Exit agent_1 (on empty input)", context: "input" },
  { key: "Ctrl+L", action: "clear-screen", description: "Clear terminal screen", context: "global" },
  { key: "Ctrl+R", action: "search-history", description: "Search command history", context: "input" },
  { key: "Ctrl+U", action: "clear-line", description: "Clear current input line", context: "input" },
  { key: "Ctrl+W", action: "delete-word-backward", description: "Delete word before cursor", context: "input" },
  { key: "Ctrl+A", action: "beginning-of-line", description: "Move to line start", context: "input" },
  { key: "Ctrl+E", action: "end-of-line", description: "Move to line end", context: "input" },
  { key: "Ctrl+K", action: "kill-line", description: "Delete to end of line", context: "input" },
  { key: "Ctrl+N", action: "next-history", description: "Next history item", context: "input" },
  { key: "Ctrl+P", action: "previous-history", description: "Previous history item", context: "input" },
  { key: "Up", action: "previous-history", description: "Previous history item", context: "input" },
  { key: "Down", action: "next-history", description: "Next history item", context: "input" },
  { key: "Tab", action: "autocomplete", description: "Autocomplete path or command", context: "input" },
  { key: "Escape", action: "vim-normal-mode", description: "Enter vim normal mode", context: "vim-insert" },
  { key: "i", action: "vim-insert-mode", description: "Enter vim insert mode", context: "vim-normal" },
  { key: "h", action: "vim-cursor-left", description: "Move cursor left", context: "vim-normal" },
  { key: "j", action: "vim-cursor-down", description: "Move cursor down", context: "vim-normal" },
  { key: "k", action: "vim-cursor-up", description: "Move cursor up", context: "vim-normal" },
  { key: "l", action: "vim-cursor-right", description: "Move cursor right", context: "vim-normal" },
  { key: "w", action: "vim-next-word", description: "Jump to next word", context: "vim-normal" },
  { key: "b", action: "vim-prev-word", description: "Jump to previous word", context: "vim-normal" },
  { key: "0", action: "vim-beginning-of-line", description: "Move to line start", context: "vim-normal" },
  { key: "$", action: "vim-end-of-line", description: "Move to line end", context: "vim-normal" },
  { key: "dd", action: "vim-delete-line", description: "Delete current line", context: "vim-normal" },
  { key: "dw", action: "vim-delete-word", description: "Delete word", context: "vim-normal" },
  { key: "yy", action: "vim-yank-line", description: "Yank (copy) line", context: "vim-normal" },
  { key: "p", action: "vim-paste", description: "Paste after cursor", context: "vim-normal" },
  { key: "u", action: "vim-undo", description: "Undo", context: "vim-normal" },
  { key: "Ctrl+R", action: "vim-redo", description: "Redo", context: "vim-normal" },
];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_ACTIONS = new Set(
  DEFAULT_BINDINGS.map((b) => b.action),
);

const VALID_CONTEXTS = new Set([
  "global", "input", "select", "vim-normal", "vim-insert",
]);

export function validateBindings(bindings: Keybinding[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < bindings.length; i++) {
    const b = bindings[i]!;
    if (!b.key) {
      errors.push(`Binding ${i}: missing "key"`);
      continue;
    }
    if (!b.action) {
      errors.push(`Binding ${i} (${b.key}): missing "action"`);
      continue;
    }
    if (b.context && !VALID_CONTEXTS.has(b.context)) {
      errors.push(
        `Binding ${i} (${b.key}): invalid context "${b.context}". Valid: ${[...VALID_CONTEXTS].join(", ")}`,
      );
    }
    // Detect duplicates within same context
    const dupKey = `${b.context || "global"}:${b.key}`;
    if (seen.has(dupKey)) {
      errors.push(
        `Binding ${i} (${b.key}): duplicate in context "${b.context || "global"}"`,
      );
    }
    seen.add(dupKey);
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function getUserBindingsPath(): string {
  return join(homedir(), ".agent_1", "keybindings.json");
}

export function loadDefaultBindings(): Keybinding[] {
  return [...DEFAULT_BINDINGS];
}

export function loadUserBindings(): Keybinding[] {
  const path = getUserBindingsPath();
  if (!existsSync(path)) return [];

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed: KeybindingSet = JSON.parse(raw);
    if (!Array.isArray(parsed.bindings)) {
      return [];
    }
    const { valid, errors } = validateBindings(parsed.bindings);
    if (!valid) {
      // Log errors but don't crash — fall back to defaults
      const errorMsg = errors.join("; ");
      process.stderr.write(`[keybindings] Validation errors: ${errorMsg}\n`);
      return [];
    }
    return parsed.bindings;
  } catch {
    return [];
  }
}

/**
 * Merge user bindings with defaults.
 * User bindings override defaults for the same key+context combo.
 */
export function loadMergedBindings(): Keybinding[] {
  const defaults = loadDefaultBindings();
  const user = loadUserBindings();
  if (user.length === 0) return defaults;

  const merged = new Map<string, Keybinding>();

  // Load defaults first
  for (const b of defaults) {
    merged.set(`${b.context || "global"}:${b.key}`, b);
  }

  // Override with user bindings
  for (const b of user) {
    merged.set(`${b.context || "global"}:${b.key}`, b);
  }

  return [...merged.values()];
}

/**
 * Resolve a keypress to an action, given a context.
 */
export function resolveBinding(
  key: string,
  context: string = "global",
): { action: string; description?: string } | null {
  const bindings = loadMergedBindings();

  // Try exact context match first
  for (const b of bindings) {
    const ctx = b.context || "global";
    if (b.key === key && ctx === context) {
      return { action: b.action, description: b.description };
    }
  }

  // Fall back to global context
  if (context !== "global") {
    for (const b of bindings) {
      const ctx = b.context || "global";
      if (b.key === key && ctx === "global") {
        return { action: b.action, description: b.description };
      }
    }
  }

  return null;
}

/**
 * Format a keybinding for display.
 */
export function formatShortcut(key: string): string {
  return key
    .replace(/Ctrl\+/g, "^")
    .replace(/Alt\+/g, "M-")
    .replace(/Shift\+/g, "⇧");
}

/**
 * Get a human-readable list of bindings for a context.
 */
export function getBindingHelp(context?: string): string {
  const bindings = loadMergedBindings()
    .filter((b) => !context || (b.context || "global") === context);

  const lines: string[] = [];
  let currentCtx = "";

  for (const b of bindings) {
    const ctx = b.context || "global";
    if (ctx !== currentCtx) {
      currentCtx = ctx;
      lines.push(`\n[${ctx}]`);
    }
    const desc = b.description || b.action;
    lines.push(`  ${formatShortcut(b.key).padEnd(8)} ${desc}`);
  }

  return lines.join("\n");
}
