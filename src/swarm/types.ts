/**
 * Swarm / Agent-Team System — Core Types
 *
 * Defines the interfaces for teammate identity, spawn configuration,
 * messaging, and the TeammateExecutor contract.
 *
 * DeepSeek-optimized: teammates share the same provider config;
 * in-process execution only (no tmux/iTerm2).
 */

// ---------------------------------------------------------------------------
// Teammate Identity & Spawn Configuration
// ---------------------------------------------------------------------------

/** Unique identity for a teammate agent within a team. */
export interface TeammateIdentity {
  /** Display name for this teammate (e.g. "explorer", "reviewer"). */
  name: string;
  /** The team this agent belongs to. */
  teamName: string;
  /** Optional ANSI/terminal color for logs and UI. */
  color?: string;
  /** If true, the leader must be in plan mode to spawn this teammate. */
  planModeRequired?: boolean;
}

/** Full configuration for spawning a new teammate. */
export interface TeammateSpawnConfig {
  /** Identity of the teammate to spawn. */
  identity: TeammateIdentity;
  /** The task prompt the teammate should work on. */
  prompt: string;
  /** Working directory for the teammate. */
  cwd: string;
  /** Optional model override (defaults to leader's model). */
  model?: string;
  /** Custom system prompt addendum (appended to default). */
  systemPrompt?: string;
  /**
   * How to merge system prompts:
   * - "append": add custom after default (default)
   * - "replace": use only the custom prompt
   * - "merge": interleave default and custom sections
   */
  systemPromptMode?: "append" | "replace" | "merge";
  /** Path to an existing git worktree for context isolation. */
  worktreePath?: string;
  /** Session ID of the parent/leader agent. */
  parentSessionId?: string;
  /** Permission rules for the teammate. */
  permissions?: TeammatePermissions;
  /** Whether the teammate can prompt the leader for permission. */
  allowPermissionPrompts?: boolean;
}

/** Permission boundaries for a spawned teammate. */
export interface TeammatePermissions {
  /** Allowed tool names (empty = inherit from leader). */
  allowedTools?: string[];
  /** Denied tool names (takes precedence over allowed). */
  deniedTools?: string[];
  /** Allowed filesystem paths for read operations. */
  readPaths?: string[];
  /** Allowed filesystem paths for write operations. */
  writePaths?: string[];
  /** Maximum number of query turns before auto-termination. */
  maxTurns?: number;
  /** Maximum wall-clock time in milliseconds. */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Spawn Result
// ---------------------------------------------------------------------------

/** Result returned when spawning a teammate. */
export interface TeammateSpawnResult {
  /** Whether the spawn succeeded. */
  success: boolean;
  /** Unique identifier for the spawned agent. */
  agentId: string;
  /** Error message if spawn failed. */
  error?: string;
  /** AbortController to cancel or terminate the teammate. */
  abortController?: AbortController;
  /** Optional task ID for tracking within the team. */
  taskId?: string;
}

// ---------------------------------------------------------------------------
// Teammate Messaging
// ---------------------------------------------------------------------------

/** Message types exchanged between teammates and leader. */
export type TeammateMessageType =
  | "permission_request"
  | "permission_response"
  | "task_assignment"
  | "task_result"
  | "idle_notification"
  | "shutdown_request"
  | "status_update"
  | "handoff";

/** A message sent between teammates or to/from the leader. */
export interface TeammateMessage {
  /** Message body text. */
  text: string;
  /** Sender agent name. */
  from: string;
  /** Receiver agent name (or "leader" for the lead agent). */
  to: string;
  /** Message type for routing and handling. */
  type: TeammateMessageType;
  /** ANSI color for display. */
  color?: string;
  /** ISO 8601 timestamp. */
  timestamp?: string;
  /** Brief summary for logs and preview. */
  summary?: string;
  /** Whether this message has been read. */
  read?: boolean;
  /** Arbitrary metadata payload. */
  metadata?: Record<string, unknown>;
}

/** Structured permission request sent by a teammate. */
export interface PermissionRequest {
  /** Unique request identifier. */
  requestId: string;
  /** The teammate requesting permission. */
  agentId: string;
  /** The tool or action needing approval. */
  toolName: string;
  /** Arguments for the tool invocation. */
  toolArgs: Record<string, unknown>;
  /** Human-readable reason for the request. */
  reason: string;
}

/** Response to a permission request. */
export interface PermissionResponse {
  /** Matching request identifier. */
  requestId: string;
  /** Whether permission is granted. */
  granted: boolean;
  /** Optional reason for denial. */
  reason?: string;
  /** Modified arguments if the leader adjusted them. */
  modifiedArgs?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Teammate Status
// ---------------------------------------------------------------------------

/** Lifecycle status of a teammate. */
export type TeammateStatus = "spawning" | "running" | "idle" | "completed" | "failed" | "terminated";

/** Runtime status for a teammate tracked by the executor. */
export interface TeammateState {
  agentId: string;
  identity: TeammateIdentity;
  status: TeammateStatus;
  startTime: number;
  endTime?: number;
  controller: AbortController;
  turnCount: number;
  lastMessage?: TeammateMessage;
}

// ---------------------------------------------------------------------------
// Teammate Executor Interface
// ---------------------------------------------------------------------------

/**
 * Contract for a teammate execution backend.
 *
 * Implementations handle the lifecycle of spawned teammate agents:
 * process-level (in-process), terminal-level (tmux/iTerm2), or
 * remote (HTTP/WebSocket).
 *
 * Currently only in-process is implemented (see InProcessBackend).
 */
export interface TeammateExecutor {
  /** Whether this executor backend is available in the current environment. */
  isAvailable(): boolean;

  /**
   * Spawn a new teammate agent.
   *
   * Creates an AbortController, registers the task in internal state,
   * and optionally begins the query loop if a query function is provided.
   */
  spawn(config: TeammateSpawnConfig): TeammateSpawnResult;

  /**
   * Send a message to a teammate's mailbox.
   * The message is delivered asynchronously; the teammate picks it up
   * on its next poll or via an event-driven notification.
   */
  sendMessage(agentId: string, message: TeammateMessage): Promise<void>;

  /**
   * Gracefully terminate a teammate.
   * Sends a shutdown request and waits for the teammate to finish
   * its current turn before stopping.
   */
  terminate(agentId: string): Promise<void>;

  /**
   * Forcefully kill a teammate immediately.
   * Aborts the AbortController, which cancels any in-flight operations.
   */
  kill(agentId: string): void;

  /**
   * Check whether a teammate is still active (running or spawning).
   */
  isActive(agentId: string): boolean;

  /**
   * Get the current state of a teammate.
   */
  getState(agentId: string): TeammateState | undefined;

  /**
   * List all tracked teammates.
   */
  listTeammates(): TeammateState[];
}

// ---------------------------------------------------------------------------
// Team Metadata
// ---------------------------------------------------------------------------

/** Metadata persisted for a team. */
export interface TeamMetadata {
  /** Unique team name. */
  teamName: string;
  /** Agent ID of the team leader. */
  leadAgentId: string;
  /** When the team was created (ISO 8601). */
  createdAt: string;
  /** When the team was last modified (ISO 8601). */
  updatedAt: string;
  /** Active members. */
  members: TeamMemberEntry[];
}

/** Entry for a single team member in metadata. */
export interface TeamMemberEntry {
  agentId: string;
  name: string;
  active: boolean;
  joinedAt: string;
  color?: string;
}

// ---------------------------------------------------------------------------
// Query Runner
// ---------------------------------------------------------------------------

/**
 * Function signature for running a query on behalf of a teammate.
 * The executor calls this to send prompts to the LLM and receive responses.
 *
 * @param input - The full prompt/message to send to the LLM.
 * @param signal - AbortSignal to cancel the query mid-flight.
 * @returns The LLM's text response.
 */
export type QueryRunner = (input: string, signal: AbortSignal) => Promise<string>;
