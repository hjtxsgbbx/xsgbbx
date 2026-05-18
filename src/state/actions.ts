// ============================================================================
// State Actions — Pure Updater Functions
//
// Every action returns Updater<AppState>. All updaters are PURE:
// receive prev, return new state, never mutate.  The store's batch-notify
// coalesces multiple setState calls within the same microtask.
// ============================================================================

import type { AppState, AppAgentMode, AppPermissionMode } from "./app-state.js";
import type { Updater } from "./store.js";
import type { Message, ToolResult, TokenUsage, Config } from "../types/index.js";

// ---- Mode ----

export function setMode(mode: AppAgentMode): Updater<AppState> {
  return (prev) => (prev.mode === mode ? prev : { ...prev, mode });
}

// ---- Thinking / Streaming ----

export function startThinking(): Updater<AppState> {
  return (prev) => (prev.isThinking ? prev : { ...prev, isThinking: true });
}

export function stopThinking(): Updater<AppState> {
  return (prev) => (!prev.isThinking ? prev : { ...prev, isThinking: false });
}

export function startStreaming(): Updater<AppState> {
  return (prev) =>
    prev.isStreaming && prev.streamingText === "" ? prev : { ...prev, isStreaming: true, streamingText: "" };
}

export function appendStream(text: string): Updater<AppState> {
  return (prev) => ({ ...prev, streamingText: prev.streamingText + text });
}

export function stopStreaming(): Updater<AppState> {
  return (prev) => (!prev.isStreaming ? prev : { ...prev, isStreaming: false });
}

// ---- Reasoning ----

export function appendReasoning(text: string): Updater<AppState> {
  return (prev) => ({ ...prev, reasoningText: prev.reasoningText + text });
}

export function clearReasoning(): Updater<AppState> {
  return (prev) => (prev.reasoningText === "" ? prev : { ...prev, reasoningText: "" });
}

// ---- Status / Error ----

export function setStatus(message: string): Updater<AppState> {
  return (prev) => (prev.statusMessage === message ? prev : { ...prev, statusMessage: message });
}

export function setError(message: string): Updater<AppState> {
  return (prev) => ({ ...prev, errorMessage: message, statusMessage: message });
}

export function clearError(): Updater<AppState> {
  return (prev) =>
    prev.errorMessage === null ? prev : { ...prev, errorMessage: null };
}

// ---- Turn tracking ----

export function incrementTurn(): Updater<AppState> {
  return (prev) => ({ ...prev, turnCount: prev.turnCount + 1 });
}

export function recordFailure(): Updater<AppState> {
  return (prev) => ({ ...prev, consecutiveFailures: prev.consecutiveFailures + 1 });
}

export function resetFailures(): Updater<AppState> {
  return (prev) => (prev.consecutiveFailures === 0 ? prev : { ...prev, consecutiveFailures: 0 });
}

// ---- Compaction ----

export function recordCompaction(): Updater<AppState> {
  return (prev) => ({
    ...prev,
    wasCompacted: true,
    compactionCount: prev.compactionCount + 1,
    compactWarningSuppressed: false,
  });
}

export function suppressCompactWarning(): Updater<AppState> {
  return (prev) => (prev.compactWarningSuppressed ? prev : { ...prev, compactWarningSuppressed: true });
}

// ---- Token / Cost tracking ----

export function trackTokens(input: number, output: number): Updater<AppState> {
  return (prev) => {
    const current = prev.tokenUsage;
    if (!current) {
      const total = input + output;
      return { ...prev, tokenUsage: { input, output, total, limit: 0 } };
    }
    return {
      ...prev,
      tokenUsage: {
        input: current.input + input,
        output: current.output + output,
        total: current.total + input + output,
        limit: current.limit,
        cacheRead: current.cacheRead,
        cacheCreation: current.cacheCreation,
      },
    };
  };
}

export function setTokenLimit(limit: number): Updater<AppState> {
  return (prev) =>
    !prev.tokenUsage ? prev : { ...prev, tokenUsage: { ...prev.tokenUsage, limit } };
}

export function trackCost(usd: number): Updater<AppState> {
  return (prev) => ({ ...prev, costUSD: prev.costUSD + usd });
}

export function setBudgetExceeded(): Updater<AppState> {
  return (prev) => (prev.budgetExceeded ? prev : { ...prev, budgetExceeded: true });
}

// ---- Tool execution ----

export function setActiveTool(name: string): Updater<AppState> {
  return (prev) => (prev.activeToolName === name ? prev : { ...prev, activeToolName: name });
}

export function clearActiveTool(): Updater<AppState> {
  return (prev) => (prev.activeToolName === null ? prev : { ...prev, activeToolName: null });
}

export function addToolResult(result: ToolResult): Updater<AppState> {
  return (prev) => ({ ...prev, toolResults: [...prev.toolResults, result] });
}

export function clearToolResults(): Updater<AppState> {
  return (prev) =>
    prev.toolResults.length === 0 && prev.activeToolName === null
      ? prev
      : { ...prev, toolResults: [], activeToolName: null };
}

// ---- Config / Session loading ----

export function loadConfig(config: Config): Updater<AppState> {
  return (prev) => ({
    ...prev,
    config,
    provider: config.chosen_provider || null,
    model: config.model || null,
    permissionMode: mapConfigPermission(config.permission_mode),
  });
}

export function setPermissionMode(mode: AppPermissionMode): Updater<AppState> {
  return (prev) => (prev.permissionMode === mode ? prev : { ...prev, permissionMode: mode });
}

export function setSessionId(sessionId: string): Updater<AppState> {
  return (prev) => (prev.sessionId === sessionId ? prev : { ...prev, sessionId });
}

export function setProjectPath(projectPath: string): Updater<AppState> {
  return (prev) => (prev.projectPath === projectPath ? prev : { ...prev, projectPath });
}

export function appendMessages(messages: Message[]): Updater<AppState> {
  if (messages.length === 0) return (prev) => prev;
  return (prev) => ({ ...prev, messages: [...prev.messages, ...messages] });
}

export function setUsingFallbackModel(using: boolean): Updater<AppState> {
  return (prev) => (prev.usingFallbackModel === using ? prev : { ...prev, usingFallbackModel: using });
}

// ---- Internal helpers ----

/** Map Config permission_mode to the AppState four-value canonical form. */
function mapConfigPermission(raw: string): AppPermissionMode {
  switch (raw) {
    case "plan":          return "plan";
    case "autoApprove":   return "acceptEdits";
    default:              return "default";
  }
}
