/**
 * Style system for the terminal UI framework.
 *
 * Provides a `Style` type and `applyStyles()` that uses the existing
 * `colorize.ts` and `applyTextStyles()` utilities to convert structured
 * style objects into ANSI-escaped strings.
 */

import { applyTextStyles } from '../colorize.js';
import type { TextStyles } from '../styles.js';

// ---------------------------------------------------------------------------
// Style type
// ---------------------------------------------------------------------------

/** Terminal text style descriptor. Mirrors CSS-like properties. */
export interface Style {
  readonly color?: string;
  readonly backgroundColor?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly dim?: boolean;
  readonly inverse?: boolean;
  readonly strikethrough?: boolean;
}

/** Default (no-op) style */
export const defaultStyle: Style = {
  bold: false,
  italic: false,
  underline: false,
  dim: false,
  inverse: false,
  strikethrough: false,
};

// ---------------------------------------------------------------------------
// Apply styles
// ---------------------------------------------------------------------------

/**
 * Apply a Style to a plain text string, returning it wrapped in
 * the appropriate ANSI escape sequences via the existing colorize pipeline.
 */
export function applyStyles(text: string, style: Style): string {
  const textStyles: TextStyles = {
    bold: style.bold ?? undefined,
    italic: style.italic ?? undefined,
    underline: style.underline ?? undefined,
    dim: style.dim ?? undefined,
    inverse: style.inverse ?? undefined,
    strikethrough: style.strikethrough ?? undefined,
    color: style.color,
    backgroundColor: style.backgroundColor,
  };

  return applyTextStyles(text, textStyles);
}

// ---------------------------------------------------------------------------
// Merge / derive
// ---------------------------------------------------------------------------

/**
 * Merge two styles.  Properties from `overrides` take precedence.
 * Returns a new object — never mutates inputs.
 */
export function mergeStyles(base: Style, overrides: Partial<Style>): Style {
  return {
    color: overrides.color ?? base.color,
    backgroundColor: overrides.backgroundColor ?? base.backgroundColor,
    bold: overrides.bold ?? base.bold,
    italic: overrides.italic ?? base.italic,
    underline: overrides.underline ?? base.underline,
    dim: overrides.dim ?? base.dim,
    inverse: overrides.inverse ?? base.inverse,
    strikethrough: overrides.strikethrough ?? base.strikethrough,
  };
}

/** Derive a text-only style (no background) from a full style. */
export function textOnly(style: Style): Style {
  return { ...style, backgroundColor: undefined };
}
