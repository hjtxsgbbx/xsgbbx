// ============================================================================
// AppState — Single Unified State Shape
//
// Consolidates ALL currently scattered state from:
//   - query-engine.ts  (mode, thinking, turns, failures, fallback)
//   - session-store.ts (sessionId, projectPath, messages, tokenUsage)
//   - config-store.ts  (config, provider, model, permissionMode)
//   - UI concerns      (streaming, reasoning, status, errors)
//   - Tool execution   (active tool, results)
//   - Compaction       (wasCompacted, count, warning suppressed)
//   - Budget           (cost, exceeded)
//
// All fields are plain JSON-serializable values. No functions, Maps, or Sets.
// ============================================================================

import type { Message, ToolResult, TokenUsage, Config } from "../types/index.js";
import type { AgentMode } from "../api/types.js";

/** The agent's operational mode. */
export type AppAgentMode = AgentMode; // "default" | "plan" | "act"

/**
 * Permission mode reflects how the engine handles tool-execution permission
 * prompts. Mirrors the `PermissionMode` union from types/index.ts but uses
 * only the values actually routed through AppState.
 */
export type AppPermissionMode =
  | "default"
  | "plan"
  | "acceptEdits"
  | "bypassPermissions";

/**
 * The single source of truth for all reactive application state.
 *
 * Fields are organized by origin domain. Every value is a plain, serializable
 * primitive or array/object so that JSON round-trip cloning works correctly
 * in the Store.snapshot() implementation.
 */
export interface AppState {
  // ------------------------------------------------------------------
  // From query-engine
  // ------------------------------------------------------------------

  /** Current operational mode. */
  mode: AppAgentMode;

  /** True while the model is generating a response. */
  isThinking: boolean;

  /** Number of query turns executed so far in the current session. */
  turnCount: number;

  /** How many consecutive API calls have failed. */
  consecutiveFailures: number;

  /** True when the engine has fallen back to a secondary model. */
  usingFallbackModel: boolean;

  // ------------------------------------------------------------------
  // From session
  // ------------------------------------------------------------------

  /** Active session identifier; null before the first session is created. */
  sessionId: string | null;

  /** Absolute path to the current project directory. */
  projectPath: string;

  /** All messages in the current conversation. */
  messages: Message[];

  /** Cumulative token usage for the current session. */
  tokenUsage: TokenUsage | null;

  // ------------------------------------------------------------------
  // From config
  // ------------------------------------------------------------------

  /** Loaded configuration object; null before config is loaded. */
  config: Config | null;

  /** Currently selected provider key (e.g. "anthropic", "deepseek"). */
  provider: string | null;

  /** Currently selected model name. */
  model: string | null;

  /** Permission mode controlling tool-execution prompting. */
  permissionMode: AppPermissionMode;

  // ------------------------------------------------------------------
  // UI state
  // ------------------------------------------------------------------

  /** True while text chunks are being streamed to the UI. */
  isStreaming: boolean;

  /** Streaming text accumulated so far in the current turn. */
  streamingText: string;

  /** Reasoning/thinking text accumulated so far (for DeepSeek R1, etc.). */
  reasoningText: string;

  /** Short human-readable status shown in the CLI footer or UI bar. */
  statusMessage: string;

  /** Last error message; null when no error is active. */
  errorMessage: string | null;

  // ------------------------------------------------------------------
  // Tool execution
  // ------------------------------------------------------------------

  /** Name of the tool currently being executed, or null. */
  activeToolName: string | null;

  /** Results from tool executions in the current turn. */
  toolResults: ToolResult[];

  // ------------------------------------------------------------------
  // Compaction
  // ------------------------------------------------------------------

  /** True if compaction has been attempted at least once this session. */
  wasCompacted: boolean;

  /** Total number of compactions performed this session. */
  compactionCount: number;

  /**
   * True when the user has explicitly suppressed the "context is getting full"
   * warning. Resets when compaction is triggered.
   */
  compactWarningSuppressed: boolean;

  // ------------------------------------------------------------------
  // Budget
  // ------------------------------------------------------------------

  /** Cumulative cost in USD since session start. */
  costUSD: number;

  /** True when any budget limit (cost or tokens) has been exceeded. */
  budgetExceeded: boolean;
}

/**
 * Create the default AppState with safe initial values.
 *
 * This is intentionally decoupled from config/session loading — the store
 * starts with this snapshot, and `loadConfig` / session creation actions
 * update it afterward.
 */
export function getDefaultAppState(): AppState {
  return {
    // query-engine
    mode: "default",
    isThinking: false,
    turnCount: 0,
    consecutiveFailures: 0,
    usingFallbackModel: false,

    // session
    sessionId: null,
    projectPath: "",
    messages: [],
    tokenUsage: null,

    // config
    config: null,
    provider: null,
    model: null,
    permissionMode: "default",

    // UI state
    isStreaming: false,
    streamingText: "",
    reasoningText: "",
    statusMessage: "Ready",
    errorMessage: null,

    // tool execution
    activeToolName: null,
    toolResults: [],

    // compaction
    wasCompacted: false,
    compactionCount: 0,
    compactWarningSuppressed: false,

    // budget
    costUSD: 0,
    budgetExceeded: false,
  };
}
