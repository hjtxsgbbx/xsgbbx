import type { TokenUsage } from "../types/index.js";

// ============================================================================
// Bridge Message Types
// ============================================================================

/**
 * Message flowing through the bridge transport layer.
 * All bridge communication is expressed as typed messages with
 * a session-scoped routing key and an ISO-8601 timestamp.
 */
export interface BridgeMessage {
  type: BridgeMessageType;
  sessionId: string;
  timestamp: string;
  payload: unknown;
}

export type BridgeMessageType =
  | "user-input"
  | "assistant-output"
  | "tool-execution"
  | "status-update"
  | "error"
  | "abort"
  | "control";

// --- Payload shapes (documentation-only, enforced at send sites) ---

export interface UserInputPayload {
  text: string;
  interrupt?: boolean;
}

export interface AssistantOutputPayload {
  content: string;
  model: string;
  usage?: TokenUsage;
  streaming?: boolean;
  done: boolean;
}

export interface ToolExecutionPayload {
  toolName: string;
  status: "executing" | "success" | "error";
  output: string;
  errorCode?: string;
}

export interface StatusUpdatePayload {
  state:
    | "thinking"
    | "compacting"
    | "max-turns"
    | "task-completed"
    | "permission-denied"
    | "provider-select";
  model?: string;
  attempt?: number;
  detail?: string;
  files?: string[];
  commitHash?: string;
}

export interface ErrorPayload {
  message: string;
  code?: string;
  recoverable: boolean;
}

export interface AbortPayload {
  reason: string;
}

export interface ControlPayload {
  command: "set-mode" | "refresh-provider" | "clear-session" | "shutdown";
  params?: Record<string, unknown>;
}

// ============================================================================
// Transport Abstraction
// ============================================================================

/**
 * A bidirectional message channel between the bridge and the outside world.
 * Implementations exist for CLI (readline/stdout), WebSocket, and SDK callers.
 *
 * - `send` pushes a message out (engine -> user).
 * - `onMessage` registers a handler for incoming messages (user -> engine).
 *   Returns an unsubscribe function.
 * - `close` shuts down the transport and releases resources.
 */
export interface BridgeTransport {
  send(message: BridgeMessage): void;
  onMessage(handler: (msg: BridgeMessage) => void): () => void;
  close(): void;
}

// ============================================================================
// Bridge Configuration
// ============================================================================

export type TransportKind = "cli" | "websocket" | "sdk";

export interface BridgeConfig {
  sessionId: string;
  projectPath: string;
  transport: TransportKind;
  websocketPort?: number;
  /** When true, output is structured JSON (one object per line). */
  structuredOutput?: boolean;
  /** When true, disable all ANSI color/styling in CLI output. */
  noColor?: boolean;
  /** When true, skip interactive prompts (headless mode). */
  noInteractive?: boolean;
  /** Optional initial prompt for headless mode. */
  initialPrompt?: string;
}
