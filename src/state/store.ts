// ============================================================================
// Store — Minimal Observable Store (Infrastructure Layer)
//
// Based on Claude Code's src/state/store.ts architecture:
//   - Immutable updates: setState always expects pure updater functions
//   - Listener dedup: if state reference doesn't change, listeners are NOT called
//   - Batch updates: multiple setState calls in the same microtask → one notify
//
// This is NOT React-dependent. It is a plain TypeScript observable store
// suitable for use in any JS/TS runtime (Node.js CLI, browser, tests).
// ============================================================================

/** A listener receives the new state and the previous state. */
export type Listener<T> = (state: T, prev: T) => void;

/** A pure function that receives the previous state and returns the next state. */
export type Updater<T> = (prev: T) => T;

/** Unsubscribe function — call to stop listening. */
export type Unsubscribe = () => void;

/** A minimal observable store contract. */
export interface Store<T> {
  /** Synchronously read the current state. */
  getState(): T;

  /**
   * Update state immutably.
   * The updater receives the previous state and MUST return a new object.
   * If the returned reference is Object.is identical to the previous state,
   * no listeners are notified (dedup).
   */
  setState(updater: Updater<T>): void;

  /**
   * Subscribe to state changes.
   * Returns an unsubscribe function.
   * The listener receives (newState, prevState) on every change.
   */
  subscribe(listener: Listener<T>): Unsubscribe;

  /**
   * Return a deep clone of the current state.
   * Safe for mutation — the original state is not affected.
   */
  snapshot(): T;
}

/**
 * Deep-clone a plain serializable value via JSON round-trip.
 * This is the simplest correct approach for state objects that are
 * JSON-serializable (which AppState is).
 *
 * WARNING: This silently drops functions, Maps, Sets, and undefined values.
 * If your state contains any of these, use a structuredClone-compatible clone
 * or implement a custom serializer.
 */
function deepClone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Create a minimal observable store with batch-notification support.
 *
 * Batch semantics:
 *   Multiple setState() calls within the same synchronous execution context
 *   are coalesced into a single listener notification via microtask scheduling.
 *   Only the latest state after all updaters have been applied is delivered.
 *
 * @param initialState - The initial state value.
 * @returns A Store<T> instance.
 */
export function createStore<T>(initialState: T): Store<T> {
  let state: T = initialState;
  const listeners = new Set<Listener<T>>();
  let batchPending = false;
  let prevForBatch: T | undefined;

  function notify() {
    if (!batchPending) return;
    batchPending = false;
    const current = state;
    const prev = prevForBatch!;
    prevForBatch = undefined;

    // Only notify if the reference actually changed.
    if (Object.is(current, prev)) return;

    for (const listener of listeners) {
      listener(current, prev);
    }
  }

  return {
    getState(): T {
      return state;
    },

    setState(updater: Updater<T>): void {
      const prev = state;
      const next = updater(prev);

      // Dedup: do nothing if the reference is unchanged.
      if (Object.is(next, prev)) return;

      state = next;

      if (!batchPending) {
        batchPending = true;
        prevForBatch = prev;
        // Schedule notification on the next microtask.
        // This coalesces all setState calls made synchronously after this one.
        queueMicrotask(notify);
      }
      // If a batch is already pending, we just update `state`.
      // `prevForBatch` stays as the state before the FIRST setState in the batch,
      // so listeners receive the correct (oldest, newest) pair.
    },

    subscribe(listener: Listener<T>): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    snapshot(): T {
      return deepClone(state);
    },
  };
}
