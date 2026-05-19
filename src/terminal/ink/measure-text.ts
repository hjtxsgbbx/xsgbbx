/**
 * Text measurement utilities for the terminal UI framework.
 *
 * Uses the existing `stringWidth()` from `src/terminal/string-width.ts`
 * to accurately measure display width accounting for CJK characters,
 * emojis, and ANSI escape sequences.
 */

import { stringWidth } from '../string-width.js';
import stripAnsiRaw from '../../utils/strip-ansi.js';

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Measure the display width of a string in terminal columns.
 */
export function measureText(text: string): number {
  return stringWidth(text);
}

/**
 * Measure the display width of a string after stripping ANSI escapes.
 * Use when you have raw styled output and only need visible width.
 */
export function measurePlainText(text: string): number {
  return stringWidth(stripAnsi(text));
}

/**
 * Find the longest line width in a multi-line string.
 * Only counts visible characters (ANSI escapes excluded).
 */
export function measureWidestLine(text: string): number {
  let maxWidth = 0;
  let start = 0;

  while (start <= text.length) {
    const end = text.indexOf('\n', start);
    const line = end === -1 ? text.slice(start) : text.slice(start, end);

    maxWidth = Math.max(maxWidth, measurePlainText(line));

    if (end === -1) break;
    start = end + 1;
  }

  return maxWidth;
}

/**
 * Measure an array of lines and return their individual widths.
 */
export function measureLines(lines: readonly string[]): readonly number[] {
  return lines.map((l) => measurePlainText(l));
}

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

/**
 * Truncate a string to fit within `maxWidth` columns, appending "..." if
 * truncated.  ANSI escapes in the original string are stripped before
 * measurement but the truncated content is returned.
 */
export function truncateText(
  text: string,
  maxWidth: number,
  ellipsis = '…',
): string {
  const plain = stripAnsi(text);
  if (stringWidth(plain) <= maxWidth) return text;

  let visible = 0;
  let i = 0;

  // Walk through code units, summing display widths until we hit maxWidth
  for (const char of text) {
    const charWidth = stringWidth(char);
    if (visible + charWidth > maxWidth - stringWidth(ellipsis)) break;
    visible += charWidth;
    i += char.length;
  }

  return text.slice(0, i) + ellipsis;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple ANSI escape stripping — delegates to the project utility. */
function stripAnsi(str: string): string {
  return stripAnsiRaw(str);
}
