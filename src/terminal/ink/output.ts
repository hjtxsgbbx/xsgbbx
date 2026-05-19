/**
 * Output buffer management for terminal rendering.
 *
 * Provides primitives for writing to stdout, clearing the screen,
 * and positioning the cursor.  Designed for use with double-buffering.
 */

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write text to process.stdout.  Simple wrapper that returns whether
 * the write succeeded (back-pressure not exhausted).
 */
export function writeToTerminal(text: string): boolean {
  return process.stdout.write(text);
}

/**
 * Write a single line to the terminal.
 */
export function writeLine(text: string): boolean {
  return process.stdout.write(text + '\n');
}

// ---------------------------------------------------------------------------
// Cursor control (ANSI escapes)
// ---------------------------------------------------------------------------

/** Move the cursor to a specific (x, y) position (1-indexed). */
export function cursorTo(x: number, y: number): string {
  return `\x1b[${y};${x}H`;
}

/** Move the cursor up `n` rows. */
export function cursorUp(n: number): string {
  return n > 0 ? `\x1b[${n}A` : '';
}

/** Move the cursor down `n` rows. */
export function cursorDown(n: number): string {
  return n > 0 ? `\x1b[${n}B` : '';
}

/** Move the cursor forward `n` columns. */
export function cursorForward(n: number): string {
  return n > 0 ? `\x1b[${n}C` : '';
}

/** Move the cursor backward `n` columns. */
export function cursorBack(n: number): string {
  return n > 0 ? `\x1b[${n}D` : '';
}

/** Hide the cursor (typically before a re-render). */
export const HIDE_CURSOR = '\x1b[?25l';

/** Show the cursor (restore after a re-render). */
export const SHOW_CURSOR = '\x1b[?25h';

/** Save cursor position. */
export const SAVE_CURSOR = '\x1b7';

/** Restore cursor position. */
export const RESTORE_CURSOR = '\x1b8';

// ---------------------------------------------------------------------------
// Screen control
// ---------------------------------------------------------------------------

/** Clear the entire screen and reset cursor to (1,1). */
export const CLEAR_SCREEN = '\x1b[2J\x1b[H';

/** Clear from cursor to end of screen. */
export const CLEAR_TO_END = '\x1b[J';

/** Clear the current line from cursor to end. */
export const CLEAR_LINE_TO_END = '\x1b[K';

/** Clear the entire current line. */
export const CLEAR_LINE = '\x1b[2K';

/**
 * Build a sequence that clears `n` rows starting from current line,
 * moving the cursor back to the first cleared row.
 */
export function clearLines(n: number): string {
  if (n <= 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(CLEAR_LINE);
    if (i < n - 1) parts.push(cursorUp(1) + CLEAR_LINE);
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Terminal dimensions
// ---------------------------------------------------------------------------

/** Get current terminal column count. */
export function terminalWidth(): number {
  return process.stdout.columns ?? 80;
}

/** Get current terminal row count. */
export function terminalHeight(): number {
  return process.stdout.rows ?? 24;
}
