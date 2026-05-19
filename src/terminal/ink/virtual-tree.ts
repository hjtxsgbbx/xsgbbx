/**
 * Virtual node tree for terminal UI rendering.
 * A lightweight Virtual DOM for terminal output — defines VNode types
 * and factory functions (`createElement` / `h`).
 */

import type { Rect } from './layout/geometry.js';

// ---------------------------------------------------------------------------
// VNode Type
// ---------------------------------------------------------------------------

/** Discriminated union of all supported virtual element types */
export type VNodeType =
  | 'ink-box'
  | 'ink-text'
  | 'ink-input'
  | 'ink-select'
  | 'ink-permission-prompt'
  | 'ink-scroll-area';

/** Props object — each element type has its own shape; this is the base */
export interface VNodeProps {
  readonly key?: string | number;
  readonly [key: string]: unknown;
}

/** Virtual DOM node */
export interface VNode {
  readonly type: VNodeType | 'ink-fragment';
  readonly props: VNodeProps;
  readonly children: readonly VNode[];
  readonly key?: string | number;
}

// ---------------------------------------------------------------------------
// Layout metadata attached after layout computation
// ---------------------------------------------------------------------------

export interface VNodeWithLayout extends VNode {
  readonly layout: Rect;
  readonly children: readonly VNodeWithLayout[];
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Create a virtual DOM element.  Analogous to React.createElement /
 * Preact's h().
 */
export function createElement(
  type: VNodeType,
  props: VNodeProps | null,
  ...children: VNode[]
): VNode {
  return {
    type,
    props: props ?? {},
    children: flatChildren(children),
    key: props?.key as string | number | undefined,
  };
}

/**
 * Shorthand alias for createElement.  Matches the Preact / hyperscript
 * convention so existing code patterns are familiar.
 */
export function h(
  type: VNodeType,
  props: VNodeProps | null,
  ...children: VNode[]
): VNode {
  return createElement(type, props, ...children);
}

/** Create a fragment node (renders children inline, no wrapper). */
export function fragment(children: VNode[]): VNode {
  return {
    type: 'ink-fragment',
    props: {},
    children,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flatten nested children arrays one level (standard VDOM conv). */
function flatChildren(children: VNode[]): VNode[] {
  const result: VNode[] = [];
  for (const child of children) {
    if (Array.isArray(child)) {
      result.push(...flatChildren(child));
    } else if (child != null) {
      result.push(child);
    }
  }
  return result;
}

/** Type guard: is this a fragment node? */
export function isFragment(node: VNode): boolean {
  return node.type === 'ink-fragment';
}

/** Type guard: does this node have layout computed? */
export function hasLayout(node: VNode): node is VNodeWithLayout {
  return 'layout' in node;
}

/** Walk the VNode tree depth-first, calling visitor on each node. */
export function walkTree(
  node: VNode,
  visitor: (node: VNode, depth: number) => void,
  depth = 0,
): void {
  visitor(node, depth);
  for (const child of node.children) {
    walkTree(child, visitor, depth + 1);
  }
}
