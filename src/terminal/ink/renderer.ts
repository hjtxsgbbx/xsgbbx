/**
 * Main renderer — converts a virtual tree into an ANSI string for
 * terminal output.
 *
 * Traverses the virtual tree, computes layout, and produces styled
 * ANSI text via the existing `colorize.ts` pipeline.
 */

import type { VNode } from './virtual-tree.js';
import { isFragment } from './virtual-tree.js';
import type { TerminalElement } from './dom.js';
import { computeLayout, type LayoutNode } from './layout/engine.js';
import { applyStyles } from './styles.js';
import type { Style } from './styles.js';
import { measureText } from './measure-text.js';
import { stringWidth } from '../string-width.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RenderOptions {
  /** Maximum width in terminal columns */
  readonly maxWidth: number;
  /** Maximum height in rows (0 = unlimited) */
  readonly maxHeight: number;
  /** Starting cursor x position (for cursor positioning in inputs) */
  readonly cursorX?: number;
  /** Starting cursor y position */
  readonly cursorY?: number;
}

export interface RenderOutput {
  /** Rendered ANSI string */
  readonly text: string;
  /** Cursor x position after rendering (absolute) */
  readonly cursorX: number;
  /** Cursor y position after rendering (absolute) */
  readonly cursorY: number;
}

/**
 * Render a virtual tree to an ANSI string for terminal display.
 */
export function renderToString(
  tree: VNode,
  options: RenderOptions,
): RenderOutput {
  const layout = computeLayout(tree, options.maxWidth, options.maxHeight);
  let cursorX = options.cursorX ?? 0;
  let cursorY = options.cursorY ?? 0;

  const parts: string[] = [];

  function renderNode(ln: LayoutNode, offsetX: number, depth: number): void {
    const el = ln.node.props.element as TerminalElement | undefined;

    if (!el || isFragment(ln.node)) {
      // Fragment — render children with no wrapper
      for (const child of ln.children) {
        renderNode(child, offsetX, depth);
      }
      return;
    }

    const { rect } = ln;

    switch (el.tag) {
      case 'box':
        renderBox(ln, el, offsetX, parts);
        break;
      case 'text':
        renderText(el, rect.x + offsetX, parts);
        break;
      case 'input':
        renderInput(el, rect.x + offsetX, parts, { x: cursorX, y: cursorY });
        break;
      case 'select':
        renderSelect(el, rect.x + offsetX, parts);
        break;
    }

    cursorY += rect.height;
  }

  // Begin rendering
  for (const child of layout.root.children) {
    renderNode(child, 0, 0);
  }

  return {
    text: parts.join(''),
    cursorX,
    cursorY,
  };
}

// ---------------------------------------------------------------------------
// Per-element renderers
// ---------------------------------------------------------------------------

function renderBox(
  ln: LayoutNode,
  el: TerminalElement & { tag: 'box' },
  offsetX: number,
  out: string[],
): void {
  const { rect } = ln;
  const borderW = el.borderStyle === 'none' ? 0 : 1;

  // Top border
  if (el.borderStyle !== 'none') {
    out.push(' '.repeat(offsetX));
    out.push(applyStyles(renderBorderTop(el.borderStyle, rect.width), bgStyle(el)));
    out.push('\n');
  }

  // Content area
  for (const child of ln.children) {
    renderNodeWithPadding(child, offsetX + el.padding + el.margin + borderW, out, el);
  }

  // Bottom border
  if (el.borderStyle !== 'none') {
    out.push(' '.repeat(offsetX));
    out.push(applyStyles(renderBorderBottom(el.borderStyle, rect.width), bgStyle(el)));
    out.push('\n');
  }
}

function renderNodeWithPadding(
  ln: LayoutNode,
  offsetX: number,
  out: string[],
  _parent: TerminalElement & { tag: 'box' },
): void {
  const el = ln.node.props.element as TerminalElement | undefined;
  if (!el) return;

  const pad = _parent.padding;
  const leftPad = ' '.repeat(offsetX);

  switch (el.tag) {
    case 'text':
      out.push(leftPad);
      renderText(el, 0, out);
      out.push('\n');
      break;
    case 'input':
      out.push(leftPad);
      renderInput(el, 0, out, { x: 0, y: 0 });
      out.push('\n');
      break;
    case 'select':
      out.push(leftPad);
      renderSelect(el, 0, out);
      out.push('\n');
      break;
    default:
      // Nested box — recurse
      renderBox(ln, el as TerminalElement & { tag: 'box' }, offsetX, out);
      break;
  }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function renderText(
  el: TerminalElement & { tag: 'text' },
  offsetX: number,
  out: string[],
): void {
  const style: Style = {
    color: el.color,
    backgroundColor: el.backgroundColor,
    bold: el.bold,
    italic: el.italic,
    underline: el.underline,
    dim: el.dim,
    inverse: el.inverse,
  };

  const prefix = ' '.repeat(offsetX);
  if ((el.wrap === 'wrap') && el.content.length > 0) {
    // Simple word-wrap: split content by newlines; no further wrapping here
    const lines = el.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      out.push(prefix);
      out.push(applyStyles(lines[i]!, style));
      if (i < lines.length - 1) out.push('\n');
    }
    return;
  }

  if (el.wrap !== 'nowrap' && el.wrap.startsWith('truncate')) {
    out.push(prefix);
    out.push(applyStyles(el.content, style));
    return;
  }

  out.push(prefix);
  out.push(applyStyles(el.content, style));
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function renderInput(
  el: TerminalElement & { tag: 'input' },
  offsetX: number,
  out: string[],
  _cursor: { x: number; y: number },
): void {
  const prefix = ' '.repeat(offsetX);
  const val = el.value || el.placeholder;
  // Highlight active
  const text = el.focus ? `> ${val}_` : `  ${val}`;

  out.push(prefix);
  out.push(
    applyStyles(text, {
      color: el.invalid ? 'ansi:red' : el.color,
      underline: el.focus,
    }),
  );
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

function renderSelect(
  el: TerminalElement & { tag: 'select' },
  offsetX: number,
  out: string[],
): void {
  const prefix = ' '.repeat(offsetX);
  const arrow = el.expanded ? '▴' : '▾';
  const selected = el.selectedIndex >= 0 ? el.items[el.selectedIndex]! : el.placeholder;

  // Single-line display
  out.push(prefix);
  out.push(applyStyles(` ${arrow} ${selected} `, { inverse: el.focus }));

  // Expanded dropdown
  if (el.expanded) {
    for (let i = 0; i < el.items.length; i++) {
      out.push('\n');
      out.push(prefix);
      const marker = i === el.selectedIndex ? '●' : '○';
      const itemStyle: Style = i === el.selectedIndex
        ? { inverse: true }
        : {};
      out.push(applyStyles(`  ${marker} ${el.items[i]!}`, itemStyle));
    }
  }
}

// ---------------------------------------------------------------------------
// Border rendering
// ---------------------------------------------------------------------------

const BORDERS: Record<string, { tl: string; tr: string; bl: string; br: string; h: string; v: string }> = {
  single:  { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
  double:  { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' },
  rounded: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
};

function renderBorderTop(style: string, width: number): string {
  const b = BORDERS[style] ?? BORDERS.single;
  return b.tl + b.h.repeat(Math.max(0, width - 2)) + b.tr;
}

function renderBorderBottom(style: string, width: number): string {
  const b = BORDERS[style] ?? BORDERS.single;
  return b.bl + b.h.repeat(Math.max(0, width - 2)) + b.br;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bgStyle(el: TerminalElement & { tag: 'box' }): Style {
  return el.backgroundColor ? { backgroundColor: el.backgroundColor } : {};
}
