/**
 * Screen buffer for double-buffered terminal rendering.
 *
 * Maintains two string buffers (front and back).  On `swap()`, the back
 * buffer is diffed against the front and only changed regions are written
 * to stdout.  This avoids full-screen clears and reduces flicker.
 */

import { cursorTo, cursorUp, clearLines, HIDE_CURSOR, SHOW_CURSOR } from './output.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreenBuffer {
  /** Current frame content split into lines */
  lines: string[];
  /** Cursor column (0-indexed visible, ANSI stripped) */
  cursorX: number;
  /** Cursor row (0-indexed) */
  cursorY: number;
}

export interface Screen {
  /** The currently displayed buffer */
  front: ScreenBuffer;
  /** The buffer being drawn to */
  back: ScreenBuffer;
  /** Terminal width at last render */
  width: number;
  /** Terminal height at last render */
  height: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new double-buffered screen.
 */
export function createScreen(width?: number, height?: number): Screen {
  const w = width ?? process.stdout.columns ?? 80;
  const h = height ?? process.stdout.rows ?? 24;
  const empty: ScreenBuffer = { lines: [], cursorX: 0, cursorY: 0 };

  return {
    front: empty,
    back: empty,
    width: w,
    height: h,
  };
}

// ---------------------------------------------------------------------------
// Buffer manipulation
// ---------------------------------------------------------------------------

/**
 * Update the back buffer with a new rendered frame.
 */
export function updateBackBuffer(
  screen: Screen,
  text: string,
  cursorX: number,
  cursorY: number,
): Screen {
  const lines = text.split('\n');
  return {
    ...screen,
    back: { lines, cursorX, cursorY },
  };
}

/**
 * Swap buffers: compute the minimal diff between front and back, then
 * write only changed regions to stdout.  Returns the new screen state
 * (with front set to the old back).
 */
export function swap(screen: Screen): Screen {
  const { front, back } = screen;

  if (front.lines.length === 0) {
    // First frame — just write all lines
    process.stdout.write(HIDE_CURSOR);
    for (let i = 0; i < back.lines.length; i++) {
      process.stdout.write(back.lines[i]!);
      if (i < back.lines.length - 1) process.stdout.write('\n');
    }
    process.stdout.write(cursorTo(back.cursorX + 1, back.cursorY + 1));
    process.stdout.write(SHOW_CURSOR);
    return { ...screen, front: back };
  }

  // Diff and patch
  process.stdout.write(HIDE_CURSOR);
  const maxLines = Math.max(front.lines.length, back.lines.length);

  for (let i = 0; i < maxLines; i++) {
    const frontLine = front.lines[i] ?? '';
    const backLine = back.lines[i] ?? '';

    if (frontLine !== backLine) {
      // Move cursor to the changed line
      process.stdout.write(cursorTo(1, i + 1));
      process.stdout.write(backLine);
    }
  }

  // Clear trailing lines if back is shorter
  if (back.lines.length < front.lines.length) {
    process.stdout.write(cursorTo(1, back.lines.length + 1));
    process.stdout.write('\x1b[J');
  }

  // Position cursor
  process.stdout.write(cursorTo(back.cursorX + 1, back.cursorY + 1));
  process.stdout.write(SHOW_CURSOR);

  return { ...screen, front: back };
}

/**
 * Resize the screen to new dimensions.
 */
export function resizeScreen(
  screen: Screen,
  width: number,
  height: number,
): Screen {
  return { ...screen, width, height };
}

/**
 * Clear both buffers — initialize for a fresh render.
 */
export function clearScreen(screen: Screen): Screen {
  const empty: ScreenBuffer = { lines: [], cursorX: 0, cursorY: 0 };
  return { ...screen, front: empty, back: empty };
}
