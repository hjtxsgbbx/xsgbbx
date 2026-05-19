/**
 * Element measurement — calculates intrinsic and constrained dimensions
 * for terminal UI elements accounting for borders, padding, and margin.
 */

import type { TerminalElement } from './dom.js';
import type { Size, Rect } from './layout/geometry.js';
import { size } from './layout/geometry.js';
import { measureText, measureWidestLine } from './measure-text.js';

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Calculate the preferred (intrinsic) size of an element.
 * This is the size the element "wants" to be before parent constraints.
 */
export function measureElement(
  el: TerminalElement,
  maxWidth: number,
  maxHeight: number,
): Rect {
  const preferred = measurePreferred(el, maxWidth);
  return {
    x: 0,
    y: 0,
    width: Math.min(preferred.width, maxWidth),
    height: Math.min(preferred.height, maxHeight),
  };
}

/**
 * Calculate only the preferred size (ignoring parent max constraints).
 */
export function measurePreferred(
  el: TerminalElement,
  maxWidth: number,
): Size {
  switch (el.tag) {
    case 'box':
      return measureBoxElement(el, maxWidth);
    case 'text':
      return measureTextElement(el, maxWidth);
    case 'input':
      return measureInputElement(el, maxWidth);
    case 'select':
      return measureSelectElement(el, maxWidth);
  }
}

// ---------------------------------------------------------------------------
// Per-element measurement
// ---------------------------------------------------------------------------

function measureBoxElement(el: TerminalElement & { tag: 'box' }, maxWidth: number): Size {
  const borderW = el.borderStyle === 'none' ? 0 : 1;
  const outerPad = el.padding * 2 + borderW * 2 + el.margin * 2;

  if (typeof el.width === 'number') {
    return { width: el.width, height: el.height as number };
  }

  // Auto size: defer to children
  return {
    width: Math.min(maxWidth, maxWidth - outerPad),
    height: typeof el.height === 'number' ? el.height : 1,
  };
}

function measureTextElement(
  el: TerminalElement & { tag: 'text' },
  _maxWidth: number,
): Size {
  if (!el.content) return { width: 0, height: 0 };

  const lines = el.content.split('\n');
  const widest = Math.max(...lines.map((l) => measureText(l)));
  return size(widest, lines.length);
}

function measureInputElement(
  _el: TerminalElement & { tag: 'input' },
  maxWidth: number,
): Size {
  // Input is single-line with cursor, min 10 cols wide
  const width = Math.min(maxWidth, Math.max(10, _el.maxLength));
  return size(width, 1);
}

function measureSelectElement(
  el: TerminalElement & { tag: 'select' },
  maxWidth: number,
): Size {
  const maxItemWidth = Math.max(
    ...el.items.map((item) => measureText(item)),
    measureText(el.placeholder),
  );
  // +4 for "  " prefix and " ▾ " suffix
  const width = Math.min(maxWidth, maxItemWidth + 4);
  const height = el.expanded ? Math.min(el.items.length + 1, 10) : 1;
  return size(width, height);
}

/**
 * Calculate the outer size of an element including margins.
 */
export function outerSize(el: TerminalElement, inner: Size): Size {
  if (el.tag === 'box') {
    const borderW = el.borderStyle === 'none' ? 0 : 1;
    return {
      width: inner.width + el.padding * 2 + borderW * 2 + el.margin * 2,
      height: inner.height + el.padding * 2 + borderW * 2 + el.margin * 2,
    };
  }
  return inner;
}
