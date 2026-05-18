// ============================================================================
// State Index — Singleton AppStore + Public API Surface
//
// Usage:
//   import { appStore, setMode, getIsStreaming } from "../state/index.js";
//
//   // Read state
//   const mode = appStore.getState().mode;
//
//   // Update state
//   appStore.setState(setMode("plan"));
//
//   // Subscribe
//   const unsub = appStore.subscribe((state, prev) => {
//     console.log("mode:", state.mode);
//   });
//
//   // Testing
//   const testStore = createAppStore();
// ============================================================================

import { createStore, type Store, type Listener, type Updater, type Unsubscribe } from "./store.js";
import {
  type AppState,
  type AppAgentMode,
  type AppPermissionMode,
  getDefaultAppState,
} from "./app-state.js";

// ---------------------------------------------------------------------------
// Re-export types
// ---------------------------------------------------------------------------
export type { Store, Listener, Updater, Unsubscribe } from "./store.js";
export type { AppState, AppAgentMode, AppPermissionMode } from "./app-state.js";

// ---------------------------------------------------------------------------
// Re-export selectors
// ---------------------------------------------------------------------------
export {
  getIsStreaming,
  getMode,
  getStatusMessage,
  getTokenPercentage,
  getBudgetStatus,
  getActiveTools,
  getCompactionNeeded,
} from "./selectors.js";

// ---------------------------------------------------------------------------
// Re-export actions
// ---------------------------------------------------------------------------
export {
  setMode,
  startThinking,
  stopThinking,
  startStreaming,
  appendStream,
  stopStreaming,
  appendReasoning,
  clearReasoning,
  setStatus,
  setError,
  clearError,
  incrementTurn,
  recordFailure,
  resetFailures,
  recordCompaction,
  suppressCompactWarning,
  trackTokens,
  setTokenLimit,
  trackCost,
  setBudgetExceeded,
  setActiveTool,
  clearActiveTool,
  addToolResult,
  clearToolResults,
  loadConfig,
  setPermissionMode,
  setSessionId,
  setProjectPath,
  appendMessages,
  setUsingFallbackModel,
} from "./actions.js";

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

/**
 * Create a new AppState Store instance.
 *
 * Intended for:
 *   - Production: called once at app bootstrap (see `appStore` singleton below)
 *   - Testing: call `createAppStore()` in each test to get a fresh isolated store
 */
export function createAppStore(): Store<AppState> {
  return createStore<AppState>(getDefaultAppState());
}

/**
 * The application-wide singleton store.
 *
 * Modules that need to read or write state import this directly.
 * For test isolation, use `createAppStore()` instead of this singleton.
 */
export const appStore: Store<AppState> = createAppStore();
