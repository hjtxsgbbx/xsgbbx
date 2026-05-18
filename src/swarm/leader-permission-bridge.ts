/**
 * Leader Permission Bridge — Module-Level Singleton
 *
 * When teammates run in-process, they share the same permission system as
 * the leader. However, each teammate should route its permission requests
 * through the leader's confirmation queue so the user sees a unified prompt.
 *
 * This bridge:
 *  1. Lets the leader register its ToolUseConfirm queue.
 *  2. Lets the leader register a SetToolPermissionContext callback.
 *  3. Provides a fallback auto-deny if the bridge is not registered.
 *
 * Usage:
 *   // In leader's initialization:
 *   registerLeaderToolUseConfirmQueue(myConfirmQueue);
 *   registerLeaderSetToolPermissionContext(mySetPermFn);
 *
 *   // In teammate code:
 *   const granted = await requestPermission("bash", { command: "ls" }, "read dir");
 */

import type { PermissionRequest, PermissionResponse } from "./types.js";

// ---------------------------------------------------------------------------
// Types for the leader's callbacks
// ---------------------------------------------------------------------------

/**
 * Signature of the leader's tool-use confirmation function.
 * Returns true if the user approved, false otherwise.
 */
export type ToolUseConfirmFn = (
  toolName: string,
  toolArgs: Record<string, unknown>,
  reason: string,
  agentId?: string,
) => Promise<boolean>;

/**
 * Signature of the leader's set-permission-context function.
 * Updates the permission state for a given tool.
 */
export type SetPermissionContextFn = (
  toolName: string,
  permission: "allow" | "deny" | "ask",
  scope?: "once" | "session" | "always",
) => Promise<void>;

// ---------------------------------------------------------------------------
// Singleton State
// ---------------------------------------------------------------------------

let toolUseConfirmQueue: ToolUseConfirmFn | null = null;
let setPermissionContext: SetPermissionContextFn | null = null;

// ---------------------------------------------------------------------------
// Registration (called by leader on startup)
// ---------------------------------------------------------------------------

/**
 * Register the leader's tool-use confirmation queue function.
 * Called once by the leader agent during initialization.
 */
export function registerLeaderToolUseConfirmQueue(fn: ToolUseConfirmFn): void {
  toolUseConfirmQueue = fn;
}

/**
 * Register the leader's set-tool-permission-context function.
 * Called once by the leader agent during initialization.
 */
export function registerLeaderSetToolPermissionContext(
  fn: SetPermissionContextFn,
): void {
  setPermissionContext = fn;
}

/**
 * Check if the permission bridge has been registered.
 */
export function isPermissionBridgeRegistered(): boolean {
  return toolUseConfirmQueue !== null;
}

// ---------------------------------------------------------------------------
// Requesting Permission (called by teammates)
// ---------------------------------------------------------------------------

/**
 * Request permission from the leader for a tool invocation.
 *
 * If the bridge is not registered (leader not initialized), the request
 * is auto-denied with a clear diagnostic message.
 *
 * @param toolName - Name of the tool to invoke.
 * @param toolArgs - Arguments for the tool.
 * @param reason   - Human-readable reason for the request.
 * @param agentId  - ID of the requesting teammate.
 * @returns PermissionResponse indicating granted/denied.
 */
export async function requestPermission(
  toolName: string,
  toolArgs: Record<string, unknown>,
  reason: string,
  agentId?: string,
): Promise<PermissionResponse> {
  const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (!toolUseConfirmQueue) {
    return {
      requestId,
      granted: false,
      reason: [
        "Permission bridge is not registered.",
        "The leader agent must call registerLeaderToolUseConfirmQueue()",
        "before teammates can request permissions.",
        agentId ? `(Requested by teammate: ${agentId})` : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  try {
    const granted = await toolUseConfirmQueue(
      toolName,
      toolArgs,
      reason,
      agentId,
    );

    return {
      requestId,
      granted,
      reason: granted
        ? "Approved by leader."
        : "Denied by leader (user declined or policy blocked).",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      requestId,
      granted: false,
      reason: `Permission check failed: ${msg}`,
    };
  }
}

/**
 * Update a tool's permission context through the leader.
 *
 * Safe to call even if the bridge is not registered (it becomes a no-op).
 */
export async function setToolPermission(
  toolName: string,
  permission: "allow" | "deny" | "ask",
  scope?: "once" | "session" | "always",
): Promise<void> {
  if (!setPermissionContext) {
    // No leader registered — silently ignore.
    // This prevents teammate crashes when the leader hasn't wired up yet.
    return;
  }

  try {
    await setPermissionContext(toolName, permission, scope);
  } catch {
    // Silently ignore permission update failures.
    // The permission system is advisory within teammates; the leader
    // always has final say.
  }
}

// ---------------------------------------------------------------------------
// Reset (for testing)
// ---------------------------------------------------------------------------

/**
 * Reset the bridge to its unregistered state.
 * Only intended for testing. Never call in production.
 */
export function resetPermissionBridge(): void {
  toolUseConfirmQueue = null;
  setPermissionContext = null;
}
