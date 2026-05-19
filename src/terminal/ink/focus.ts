/**
 * Focus management for interactive terminal components.
 *
 * Maintains a tabIndex-based navigation model.  Supports:
 * - Tab / Shift+Tab cycling through focusable elements
 * - Focus trapping within a container
 * - Focus id-based targeting
 */

import type { VNode } from './virtual-tree.js';
import { isFragment } from './virtual-tree.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FocusableElement {
  /** Unique id for this focusable element */
  readonly id: string;
  /** Tab index (0 = normal order, -1 = skip in tab order) */
  readonly tabIndex: number;
  /** Whether this element is currently focused */
  focused: boolean;
  /** Element type hint */
  readonly type: 'input' | 'select' | 'toggle';
}

export interface FocusState {
  /** All registered focusable elements in tab order */
  readonly elements: readonly FocusableElement[];
  /** Index of the currently focused element, or -1 if none */
  readonly activeIndex: number;
}

// ---------------------------------------------------------------------------
// Focus Manager
// ---------------------------------------------------------------------------

/**
 * Simple immutable focus manager.
 *
 * All mutation methods return a new FocusState.  No classes by design —
 * state is managed externally by the caller.
 */
export function createFocusManager(): FocusState {
  return { elements: [], activeIndex: -1 };
}

/**
 * Register a list of focusable elements.
 * Elements are sorted by tabIndex before being stored.
 */
export function registerElements(
  state: FocusState,
  elements: readonly FocusableElement[],
): FocusState {
  const sorted = [...elements].sort((a, b) => a.tabIndex - b.tabIndex);
  return { ...state, elements: sorted };
}

/**
 * Focus the next element (Tab).  Wraps around to the first.
 */
export function focusNext(state: FocusState): FocusState {
  if (state.elements.length === 0) return state;
  const next = (state.activeIndex + 1) % state.elements.length;
  return setActive(state, next);
}

/**
 * Focus the previous element (Shift+Tab).  Wraps around to the last.
 */
export function focusPrev(state: FocusState): FocusState {
  if (state.elements.length === 0) return state;
  const prev =
    state.activeIndex <= 0
      ? state.elements.length - 1
      : state.activeIndex - 1;
  return setActive(state, prev);
}

/**
 * Focus a specific element by id.
 */
export function focusById(state: FocusState, id: string): FocusState {
  const idx = state.elements.findIndex((el) => el.id === id);
  if (idx === -1) return state;
  return setActive(state, idx);
}

/**
 * Blur all elements (remove focus).
 */
export function blurAll(state: FocusState): FocusState {
  return createFocusManager();
}

// ---------------------------------------------------------------------------
// Collect focusable elements from a VNode tree
// ---------------------------------------------------------------------------

/**
 * Walk a VNode tree and collect all focusable elements (inputs, selects).
 */
export function collectFocusable(node: VNode): FocusableElement[] {
  const results: FocusableElement[] = [];

  function walk(n: VNode): void {
    if (isFragment(n)) {
      for (const child of n.children) walk(child);
      return;
    }

    const elType = n.type;
    if (elType === 'ink-input' || elType === 'ink-select') {
      const id = (n.props.id as string) ?? `focus-${results.length}`;
      const tabIndex = (n.props.tabIndex as number) ?? 0;
      results.push({
        id,
        tabIndex,
        focused: false,
        type: elType === 'ink-input' ? 'input' : 'select',
      });
    }

    for (const child of n.children) {
      walk(child);
    }
  }

  walk(node);
  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setActive(state: FocusState, index: number): FocusState {
  const newElements = state.elements.map((el, i) => ({
    ...el,
    focused: i === index,
  }));
  return { elements: newElements, activeIndex: index };
}
