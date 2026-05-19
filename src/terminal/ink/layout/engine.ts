/**
 * Simple flexbox layout calculator for terminal UI.
 *
 * Takes a virtual node tree with element props and computes the
 * pixel-positioned layout — each node receives a `Rect` indicating
 * its screen-space bounding box.
 */

import type { TerminalElement } from '../dom.js';
import type { FlexDirection } from '../dom.js';
import type { VNode } from '../virtual-tree.js';
import { isFragment } from '../virtual-tree.js';
import type { Rect, Size } from './geometry.js';
import { size, zeroRect } from './geometry.js';
import { measurePreferred, outerSize } from '../measure-element.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LayoutResult {
  /** Root node with layout information attached */
  readonly root: LayoutNode;
  /** Total content height after layout */
  readonly totalHeight: number;
}

export interface LayoutNode {
  /** The original VNode */
  readonly node: VNode;
  /** Assigned bounding rect */
  readonly rect: Rect;
  /** Children with layout */
  readonly children: readonly LayoutNode[];
}

/**
 * Compute layout for a virtual tree.
 *
 * Performs a single-pass flexbox layout: each node is allocated a rect
 * within the parent's content area.
 */
export function computeLayout(
  root: VNode,
  maxWidth: number,
  maxHeight: number,
): LayoutResult {
  let currentY = 0;

  function layoutNode(
    node: VNode,
    parentWidth: number,
    availableHeight: number,
  ): LayoutNode {
    const el = node.props.element as TerminalElement | undefined;

    if (!el || node.type === 'ink-fragment') {
      // Fragment: lay out children inline (each gets full width)
      const children: LayoutNode[] = [];
      let yOffset = 0;
      for (const child of node.children) {
        const childLayout = layoutNode(
          child,
          parentWidth,
          availableHeight - yOffset,
        );
        children.push({
          ...childLayout,
          rect: {
            ...childLayout.rect,
            y: yOffset,
          },
        });
        yOffset += childLayout.rect.height;
      }
      return {
        node,
        rect: { x: 0, y: 0, width: parentWidth, height: yOffset },
        children,
      };
    }

    // Measure preferred size
    const preferred = measurePreferred(el, parentWidth);
    const assignedWidth = clampDimension(
      el.width ?? 'auto',
      preferred.width,
      parentWidth,
      el.minWidth,
      el.maxWidth,
    );
    const assignedHeight = clampDimension(
      el.height ?? 'auto',
      preferred.height,
      availableHeight,
      el.minHeight,
      el.maxHeight,
    );

    // Lay out children for box containers
    let children: LayoutNode[] = [];
    let childAreaHeight = 0;

    if (el.tag === 'box' && node.children.length > 0) {
      const innerWidth = contentWidth(el, assignedWidth);
      const innerHeight = Math.max(0, assignedHeight);
      const childLayouts = layoutFlexChildren(
        node.children,
        el.flexDirection ?? 'column',
        innerWidth,
        innerHeight,
      );
      children = childLayouts;
      childAreaHeight = innerHeight;
    }

    const totalH = el.tag === 'box'
      ? childAreaHeight
      : assignedHeight;

    const rect: Rect = {
      x: 0,
      y: currentY,
      width: assignedWidth,
      height: totalH,
    };
    currentY += totalH;

    return { node, rect, children };
  }

  function layoutFlexChildren(
    children: readonly VNode[],
    direction: FlexDirection,
    containerWidth: number,
    containerHeight: number,
  ): LayoutNode[] {
    if (direction === 'column') {
      return layoutColumn(children, containerWidth, containerHeight);
    }
    return layoutRow(children, containerWidth, containerHeight);
  }

  function layoutColumn(
    children: readonly VNode[],
    containerWidth: number,
    containerHeight: number,
  ): LayoutNode[] {
    const results: LayoutNode[] = [];
    let y = 0;

    for (const child of children) {
      if (isFragment(child)) {
        // Flatten fragments
        const flattened = layoutColumn(
          child.children,
          containerWidth,
          containerHeight - y,
        );
        for (const fc of flattened) {
          results.push({ ...fc, rect: { ...fc.rect, x: 0, y } });
          y += fc.rect.height;
        }
        continue;
      }

      const childEl = child.props.element as TerminalElement | undefined;
      if (!childEl) continue;

      const pref = measurePreferred(childEl, containerWidth);
      const childW = clampChildDimension(
        childEl.width ?? 'auto',
        pref.width,
        containerWidth,
        childEl.minWidth,
        childEl.maxWidth,
      );
      const childH = clampChildDimension(
        childEl.height ?? 'auto',
        pref.height,
        containerHeight - y,
        childEl.minHeight,
        childEl.maxHeight,
      );

      const childLayout = layoutNode(child, containerWidth, containerHeight - y);
      results.push({ ...childLayout, rect: { x: 0, y, width: childW, height: childH } });
      y += childH;
    }

    return results;
  }

  function layoutRow(
    children: readonly VNode[],
    containerWidth: number,
    _containerHeight: number,
  ): LayoutNode[] {
    const results: LayoutNode[] = [];
    let x = 0;
    let maxH = 0;

    const nonFragmentChildren = flattenFragments(children);

    // Measure all children first to compute widths
    interface ChildMeasured {
      vnode: VNode;
      el: TerminalElement;
      prefW: number;
      prefH: number;
    }
    const measured: ChildMeasured[] = [];

    for (const child of nonFragmentChildren) {
      const el = child.props.element as TerminalElement | undefined;
      if (!el) continue;
      const pref = measurePreferred(el, containerWidth);
      measured.push({ vnode: child, el, prefW: pref.width, prefH: pref.height });
    }

    // Flex-grow: distribute remaining space equally
    const totalPreferred = measured.reduce((s, m) => s + m.prefW, 0);
    const remaining = containerWidth - totalPreferred;
    const growCount = measured.filter(
      (m) => m.el.width === 'auto' || m.el.width === 'fill',
    ).length;
    const extraPerChild = growCount > 0 ? Math.floor(remaining / growCount) : 0;

    for (const m of measured) {
      const width = m.prefW + extraPerChild;
      const childLayout = layoutNode(m.vnode, width, Number.POSITIVE_INFINITY);
      results.push({ ...childLayout, rect: { x, y: 0, width, height: childLayout.rect.height } });
      x += width;
      maxH = Math.max(maxH, childLayout.rect.height);
    }

    // Normalize heights to the tallest child
    for (const r of results) {
      if (r.rect.height < maxH) {
        (r.rect as { height: number }).height = maxH;
      }
    }

    return results;
  }

  const layoutRoot = layoutNode(root, maxWidth, maxHeight);

  return {
    root: layoutRoot,
    totalHeight: layoutRoot.rect.height,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampDimension(
  declared: number | 'auto' | 'fill' | undefined,
  preferred: number,
  maxAvailable: number,
  min?: number,
  max?: number,
): number {
  let value = typeof declared === 'number' ? declared : preferred;
  value = Math.max(min ?? 0, value);
  value = Math.min(max ?? Number.POSITIVE_INFINITY, value);
  value = Math.min(maxAvailable, value);
  return value;
}

function clampChildDimension(
  declared: number | 'auto' | 'fill' | undefined,
  preferred: number,
  maxAvailable: number,
  min?: number,
  max?: number,
): number {
  let value = typeof declared === 'number' ? declared : preferred;
  if (declared === 'fill') value = maxAvailable;
  value = Math.max(min ?? 0, value);
  value = Math.min(max ?? Number.POSITIVE_INFINITY, value);
  value = Math.min(maxAvailable, value);
  return value;
}

function contentWidth(el: TerminalElement & { tag: 'box' }, assigned: number): number {
  const borderW = el.borderStyle === 'none' ? 0 : 1;
  return Math.max(0, assigned - 2 * el.padding - 2 * borderW - 2 * el.margin);
}

function flattenFragments(children: readonly VNode[]): VNode[] {
  const result: VNode[] = [];
  for (const child of children) {
    if (isFragment(child)) {
      result.push(...flattenFragments(child.children));
    } else {
      result.push(child);
    }
  }
  return result;
}
