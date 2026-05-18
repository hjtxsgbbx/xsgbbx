/**
 * Hook event types and lifecycle — adapted from Claude Code's hooks system.
 *
 * Hooks are user-defined callbacks that fire at specific points:
 *   PreToolUse  — before a tool executes (can block)
 *   PostToolUse — after a tool completes (for side effects)
 *   Stop        — when session ends (final cleanup)
 *   Notification — session lifecycle events
 */

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "Stop"
  | "Notification"
  | "SessionStart"
  | "SessionEnd"
  | "PreCompact"
  | "PostCompact"
  | "PreQuery"
  | "PostQuery";

export type NotificationType =
  | "startup"
  | "resume"
  | "prompt_submit"
  | "idle_prompt";

// ---------------------------------------------------------------------------
// Hook definitions
// ---------------------------------------------------------------------------

export interface HookCommand {
  type: "command";
  /** Shell command to execute */
  command: string;
  /** Shell interpreter (default: bash on unix, cmd on windows) */
  shell?: string;
  /** Tool name glob matcher (e.g. "Bash*", "Write|Edit") */
  matcher?: string;
  /** Timeout in seconds (default: 30) */
  timeout?: number;
}

export interface HookHttp {
  type: "http";
  url: string;
  matcher?: string;
  timeout?: number;
}

export interface HookPrompt {
  type: "prompt";
  /** Prompt evaluated by the model (for LLM-based hook decisions) */
  prompt: string;
  matcher?: string;
  timeout?: number;
}

export type HookConfig = HookCommand | HookHttp | HookPrompt;

// ---------------------------------------------------------------------------
// Hook execution context
// ---------------------------------------------------------------------------

export interface HookContext {
  TOOL_NAME: string;
  TOOL_INPUT: string;
  TOOL_RESULT?: string;
  MESSAGE_COUNT?: string;
  SESSION_ID?: string;
  PROJECT_PATH?: string;
  [key: string]: string | undefined;
}

// ---------------------------------------------------------------------------
// Hook result
// ---------------------------------------------------------------------------

export interface HookResult {
  ok: boolean;
  event: HookEvent;
  output?: string;
  error?: string;
  /** If false, the action should be blocked */
  allow: boolean;
  /** Message to show user */
  message?: string;
  /** Duration in ms */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Hooks settings shape (in settings.json)
// ---------------------------------------------------------------------------

export interface HooksSettings {
  PreToolUse?: HookConfig[];
  PostToolUse?: HookConfig[];
  Stop?: HookConfig[];
  Notification?: HookConfig[];
  SessionStart?: HookConfig[];
  SessionEnd?: HookConfig[];
  PreCompact?: HookConfig[];
  PostCompact?: HookConfig[];
  PreQuery?: HookConfig[];
  PostQuery?: HookConfig[];
}
