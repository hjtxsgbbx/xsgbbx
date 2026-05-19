/**
 * External tools registry — populated by plugins at load time.
 *
 * Separated from the main tools/index.ts to avoid circular imports
 * when getAllTools() in write-tools.ts needs to include external tools.
 */

import type { Tool } from "../types/index.js";

// ---------------------------------------------------------------------------
// Module-level registry
// ---------------------------------------------------------------------------

/** External tools registered by plugins (keyed by tool name). */
let externalTools = new Map<string, Tool>();

/**
 * Register a tool from an external source (plugin).
 * Returns a new Map — the original is never mutated.
 */
export function registerExternalTool(name: string, tool: Tool): Map<string, Tool> {
  const next = new Map(externalTools);
  next.set(name, tool);
  externalTools = next;
  return externalTools;
}

/**
 * Unregister a tool by name.
 * Returns a new Map — the original is never mutated.
 */
export function unregisterExternalTool(name: string): Map<string, Tool> {
  const next = new Map(externalTools);
  next.delete(name);
  externalTools = next;
  return externalTools;
}

/**
 * Get all currently registered external tools as a read-only array.
 */
export function getExternalTools(): Tool[] {
  return [...externalTools.values()];
}

/**
 * Clear all external tool registrations.
 */
export function clearExternalTools(): void {
  externalTools = new Map();
}
