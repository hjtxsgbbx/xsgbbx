/**
 * Agent Color Manager
 *
 * Assigns consistent terminal-friendly ANSI colors to teammate agents.
 * Colors are used in log output, mailbox summaries, and UI to visually
 * distinguish teammates from each other and from the leader.
 *
 * Color Palette (8 named colors, chosen for readability on dark terminals):
 *   red, blue, green, yellow, purple, orange, pink, cyan
 *
 * Assignment strategy:
 *  - If a color was explicitly set via setAgentColor(), use it.
 *  - Otherwise, hash the agent name to pick a deterministic color.
 *  - The hash ensures the same agent name always gets the same color
 *    across restarts, which helps users build visual familiarity.
 */

// ---------------------------------------------------------------------------
// Color Definitions
// ---------------------------------------------------------------------------

/** ANSI escape code prefixes for 8 named colors. */
const ANSI_COLORS: Record<string, string> = {
  red: "\x1b[31m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  purple: "\x1b[35m",
  orange: "\x1b[38;5;208m",
  pink: "\x1b[38;5;205m",
  cyan: "\x1b[36m",
};

/** ANSI reset code. */
const ANSI_RESET = "\x1b[0m";

/** Ordered list of color names for hash-based assignment. */
const COLOR_NAMES = Object.keys(ANSI_COLORS);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Manual overrides: agentName → color name. */
const manualAssignments: Map<string, string> = new Map();

/** Cache of computed assignments: agentName → color name. */
const assignmentCache: Map<string, string> = new Map();

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * DJB2 hash — simple, fast, deterministic string hash.
 * Returns a non-negative integer.
 */
function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0; // Force unsigned 32-bit
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the color assigned to an agent.
 *
 * 1. Returns the manual override if one was set via setAgentColor().
 * 2. Otherwise returns a hash-based deterministic assignment.
 *
 * @param agentName - Agent display name.
 * @returns Color name (e.g. "blue", "red").
 */
export function getAgentColor(agentName: string): string {
  // Check manual override
  const manual = manualAssignments.get(agentName);
  if (manual) return manual;

  // Check cache
  const cached = assignmentCache.get(agentName);
  if (cached) return cached;

  // Compute deterministically
  const hash = djb2(agentName);
  const color = COLOR_NAMES[hash % COLOR_NAMES.length];
  assignmentCache.set(agentName, color);
  return color;
}

/**
 * Manually override the color for an agent.
 *
 * @param agentName - Agent display name.
 * @param color     - Color name (must be one of the 8 named colors).
 */
export function setAgentColor(agentName: string, color: string): void {
  if (!ANSI_COLORS[color]) {
    const valid = COLOR_NAMES.join(", ");
    throw new Error(
      `Unknown color "${color}". Valid colors: ${valid}`,
    );
  }
  manualAssignments.set(agentName, color);
  // Invalidate cache so next getAgentColor picks up the override
  assignmentCache.delete(agentName);
}

/**
 * Remove a manual color override, reverting to hash-based assignment.
 */
export function clearAgentColor(agentName: string): void {
  manualAssignments.delete(agentName);
  assignmentCache.delete(agentName);
}

/**
 * Get all current color assignments.
 *
 * @returns Map of agentName → color name.
 */
export function getAgentColorMap(): Record<string, string> {
  const result: Record<string, string> = {};

  // Collect all known agents (from both maps)
  const allAgents = new Set([
    ...manualAssignments.keys(),
    ...assignmentCache.keys(),
  ]);

  for (const name of allAgents) {
    result[name] = getAgentColor(name);
  }

  return result;
}

/**
 * Wrap text in ANSI color codes for terminal output.
 *
 * @param agentName - Agent name (used to look up color).
 * @param text      - Text to colorize.
 * @returns ANSI-wrapped string.
 */
export function colorize(agentName: string, text: string): string {
  const color = getAgentColor(agentName);
  const code = ANSI_COLORS[color];
  if (!code) return text;
  return `${code}${text}${ANSI_RESET}`;
}

/**
 * Get the raw ANSI escape code for an agent's color.
 *
 * @param agentName - Agent display name.
 * @returns ANSI escape code string, or empty string if unknown.
 */
export function getAgentAnsiCode(agentName: string): string {
  const color = getAgentColor(agentName);
  return ANSI_COLORS[color] ?? "";
}

/**
 * List all available color names.
 */
export function listAvailableColors(): string[] {
  return [...COLOR_NAMES];
}

/**
 * Reset all assignments and the cache.
 * Useful for testing.
 */
export function resetColorManager(): void {
  manualAssignments.clear();
  assignmentCache.clear();
}
