/**
 * Swarm / Agent-Team System — Index
 *
 * Minimal but production-ready agent-team system for agent_1.
 * Designed for DeepSeek-optimized in-process teammate execution.
 *
 * Architecture:
 *   types.ts                  — Core interfaces and type definitions
 *   in-process-backend.ts     — InProcessBackend (only backend for now)
 *   teammate-mailbox.ts       — File-based async messaging
 *   leader-permission-bridge.ts — Permission routing through leader
 *   agent-color-manager.ts    — Deterministic color assignment
 *   teammate-prompt.ts        — System prompt addendum builder
 *   team-helpers.ts           — Team directory and metadata management
 *   spawn-utils.ts            — Spawn convenience functions
 *
 * Usage:
 *   import { createSwarmSystem } from "./swarm/index.js";
 *   const swarm = createSwarmSystem();
 *
 *   // Register permission bridge
 *   registerLeaderToolUseConfirmQueue(myConfirmFn);
 *
 *   // Create a team
 *   createTeam("review-team", "leader-001");
 *
 *   // Spawn a teammate
 *   const result = swarm.backend.spawn({
 *     identity: { name: "reviewer", teamName: "review-team" },
 *     prompt: "Review the auth module for security issues.",
 *     cwd: "/path/to/project",
 *   });
 *
 *   // Run the query loop
 *   const output = await swarm.backend.runQueryLoop(
 *     result.agentId, config, myQueryRunner
 *   );
 */

// ---------------------------------------------------------------------------
// Types (re-export everything)
// ---------------------------------------------------------------------------

export type {
  TeammateIdentity,
  TeammateSpawnConfig,
  TeammatePermissions,
  TeammateSpawnResult,
  TeammateMessage,
  TeammateMessageType,
  PermissionRequest,
  PermissionResponse,
  TeammateStatus,
  TeammateState,
  TeammateExecutor,
  TeamMetadata,
  TeamMemberEntry,
  QueryRunner,
} from "./types.js";

// ---------------------------------------------------------------------------
// In-Process Backend
// ---------------------------------------------------------------------------

export {
  InProcessBackend,
  inProcessBackend,
  getCurrentTeammateContext,
  runInTeammateContext,
} from "./in-process-backend.js";

// ---------------------------------------------------------------------------
// Teammate Mailbox
// ---------------------------------------------------------------------------

export {
  writeToMailbox,
  readMailbox,
  readUnread,
  markRead,
  markAllRead,
  unreadCount,
  deleteMailbox,
  buildPermissionRequest,
  buildPermissionResponse,
  buildTaskAssignment,
  buildShutdownRequest,
  buildIdleNotification,
  buildStatusUpdate,
} from "./teammate-mailbox.js";

// ---------------------------------------------------------------------------
// Leader Permission Bridge
// ---------------------------------------------------------------------------

export {
  registerLeaderToolUseConfirmQueue,
  registerLeaderSetToolPermissionContext,
  isPermissionBridgeRegistered,
  requestPermission,
  setToolPermission,
  resetPermissionBridge,
} from "./leader-permission-bridge.js";

export type {
  ToolUseConfirmFn,
  SetPermissionContextFn,
} from "./leader-permission-bridge.js";

// ---------------------------------------------------------------------------
// Agent Color Manager
// ---------------------------------------------------------------------------

export {
  getAgentColor,
  setAgentColor,
  clearAgentColor,
  getAgentColorMap,
  colorize,
  getAgentAnsiCode,
  listAvailableColors,
  resetColorManager,
} from "./agent-color-manager.js";

// ---------------------------------------------------------------------------
// Teammate Prompt
// ---------------------------------------------------------------------------

export {
  buildTeammatePrompt,
  buildCompactTeammatePrompt,
} from "./teammate-prompt.js";

// ---------------------------------------------------------------------------
// Team Helpers
// ---------------------------------------------------------------------------

export {
  createTeam,
  readTeamFile,
  writeTeamFile,
  deleteTeam,
  teamExists,
  listTeams,
  listTeamMembers,
  listActiveMembers,
  addTeamMember,
  removeTeamMember,
  setMemberActive,
  getTeamMember,
  appendTeammateLog,
} from "./team-helpers.js";

// ---------------------------------------------------------------------------
// Spawn Utilities
// ---------------------------------------------------------------------------

export {
  spawnTeammate,
  spawnTeammates,
  waitForTeammates,
  collectTeammateResults,
  runTeammate,
} from "./spawn-utils.js";

export type {
  ParallelSpawnResult,
  TeammateResultSummary,
} from "./spawn-utils.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

import { InProcessBackend, inProcessBackend } from "./in-process-backend.js";
import type { TeammateExecutor } from "./types.js";

/**
 * A fully initialized swarm system.
 */
export interface SwarmSystem {
  /** The executor backend for spawning teammates. */
  backend: TeammateExecutor;
}

/**
 * Create a new swarm system with the default in-process backend.
 *
 * In the future, this factory will accept options to select different
 * backends (tmux, iTerm2, HTTP remote), but for now only in-process
 * is supported.
 */
export function createSwarmSystem(): SwarmSystem {
  return {
    backend: inProcessBackend,
  };
}
