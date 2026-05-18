// ---------------------------------------------------------------------------
// core-types.ts — SDK public surface for agent construction and lifecycle
// ---------------------------------------------------------------------------

import type { QueryEngine } from "../types/index.js";
import type { Config } from "../types/index.js";
import type { Session } from "../types/index.js";
import type { SessionStore } from "../storage/session-store.js";
import type { AuditLogger } from "../storage/audit-logger.js";
import type { QueryDeps } from "../query/deps.js";
import type { TaskManager } from "../tasks/task-manager.js";

// ---------------------------------------------------------------------------
// AgentSDK — the top-level SDK instance
// ---------------------------------------------------------------------------

/**
 * AgentSDK is the public API surface consumed by application code.
 * It owns the lifecycle of the engine, session, and supporting services.
 */
export interface AgentSDK {
  /** Create a fully-wired query engine from the agent config. */
  createEngine(config: Config): QueryEngine;

  /** Create a new session for the given project path. */
  createSession(projectPath: string): Session;

  /** Execute a query within an active session. Returns the query result. */
  executeQuery(input: string, session: Session): Promise<{
    content: string;
    model: string;
  }>;

  /** Tear down all resources: sessions, audit logs, cost trackers. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// AgentConfig — configuration that SDK consumers provide
// ---------------------------------------------------------------------------

/**
 * AgentConfig is the minimal, well-documented subset of the internal Config
 * type that SDK consumers interact with. Internal fields are omitted.
 */
export interface AgentConfig {
  /** The model name to use (e.g. "deepseek-chat", "gpt-4o"). */
  model: string;

  /** Fallback model if the primary model fails repeatedly. */
  fallbackModel?: string;

  /** Permission mode governing auto-approval behaviour. */
  permissionMode: "default" | "plan" | "defaultDeny" | "autoApprove" | "sandbox";

  /** Maximum query turns before forced stop. */
  maxTurns: number;

  /** API key identifier or path (provider-specific). */
  apiKey: string;

  /** Working directory for the session. */
  workingDir: string;

  /** Whether to auto-commit changes via git. */
  autoCommit: boolean;

  /** Whether to auto-create pull requests after changes. */
  autoCreatePR: boolean;

  /** Budget cap in USD (optional). */
  budgetMaxCostUSD?: number;

  /** Budget cap in tokens (optional). */
  budgetMaxTokens?: number;
}

// ---------------------------------------------------------------------------
// Default agent config
// ---------------------------------------------------------------------------

import { DEFAULT_MODEL, FALLBACK_MODEL, LIMITS } from "../core/constants.js";

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  model: DEFAULT_MODEL,
  fallbackModel: FALLBACK_MODEL,
  permissionMode: "default",
  maxTurns: LIMITS.MAX_TURNS,
  apiKey: "",
  workingDir: process.cwd(),
  autoCommit: false,
  autoCreatePR: false,
};

// ---------------------------------------------------------------------------
// Re-export commonly-used core types for SDK consumers
// ---------------------------------------------------------------------------

// Session
export type { Session, SessionStore };

// Audit
export type { AuditLogger };

// Dependencies
export type { QueryDeps };

// Tasks
export type { TaskManager };
