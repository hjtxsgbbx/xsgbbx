/**
 * Vim mode for the terminal input line — simplified from Claude Code's vim/.
 *
 * Modes:
 *   - insert (default): normal text input, like any terminal
 *   - normal: vim-like keybindings for navigation and editing
 *
 * DeepSeek adaptation: same keybindings as Claude Code but simpler
 * implementation. No operator-pending mode, no visual mode, no registers.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VimMode = "insert" | "normal";

export interface VimState {
  mode: VimMode;
  /** Pending operator (d, y) waiting for a motion */
  pendingOperator: string | null;
  /** Characters for multi-char commands (dd, yy) */
  pendingChars: string;
}

export interface VimActionResult {
  /** If true, the input line changed and should be re-rendered */
  changed: boolean;
  /** Optional message to show (e.g. "10 lines yanked") */
  message?: string;
}

// ---------------------------------------------------------------------------
// Motions (return [newCursor, newLine] or null for no-op)
// ---------------------------------------------------------------------------

export interface CursorState {
  cursor: number; // 0-indexed position in line
  text: string;   // current line text
}

function moveLeft(state: CursorState): CursorState {
  if (state.cursor <= 0) return state;
  return { ...state, cursor: state.cursor - 1 };
}

function moveRight(state: CursorState): CursorState {
  if (state.cursor >= state.text.length) return state;
  return { ...state, cursor: state.cursor + 1 };
}

function moveWordForward(state: CursorState): CursorState {
  const text = state.text;
  let pos = state.cursor;

  // Skip current word
  while (pos < text.length && /\w/.test(text[pos]!)) pos++;
  // Skip whitespace
  while (pos < text.length && /\s/.test(text[pos]!)) pos++;

  return { ...state, cursor: Math.min(pos, text.length) };
}

function moveWordBackward(state: CursorState): CursorState {
  const text = state.text;
  let pos = state.cursor;

  // Skip whitespace before current position
  while (pos > 0 && /\s/.test(text[pos - 1]!)) pos--;
  // Skip to start of previous word
  while (pos > 0 && /\w/.test(text[pos - 1]!)) pos--;

  return { ...state, cursor: pos };
}

function moveToLineStart(state: CursorState): CursorState {
  // Skip leading whitespace first (like ^), then 0 goes to absolute start
  return { ...state, cursor: 0 };
}

function moveToFirstNonWhitespace(state: CursorState): CursorState {
  const match = state.text.match(/^\s*/);
  const leading = match ? match[0].length : 0;
  return { ...state, cursor: leading };
}

function moveToLineEnd(state: CursorState): CursorState {
  return { ...state, cursor: state.text.length };
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

function deleteFromTo(text: string, from: number, to: number): string {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const deleted = text.slice(start, end + 1);
  return text.slice(0, start) + text.slice(end + 1);
}

// ---------------------------------------------------------------------------
// VimEngine
// ---------------------------------------------------------------------------

export class VimEngine {
  private mode: VimMode = "insert";
  private pendingOperator: string | null = null;
  private pendingChars = "";
  /** Yank buffer */
  private yankBuffer = "";

  getMode(): VimMode {
    return this.mode;
  }

  isInsert(): boolean {
    return this.mode === "insert";
  }

  isNormal(): boolean {
    return this.mode === "normal";
  }

  getStatusLine(): string {
    if (this.mode === "insert") return "-- INSERT --";
    if (this.pendingOperator) return `-- NORMAL (${this.pendingOperator}) --`;
    return "-- NORMAL --";
  }

  /**
   * Process a single keypress in normal mode.
   * Returns the new line text and an action result.
   */
  handleNormalMode(
    key: string,
    cursorState: CursorState,
  ): { cursorState: CursorState; result: VimActionResult } {
    const result: VimActionResult = { changed: false };

    // Handle multi-char commands (dd, yy)
    if (this.pendingChars.length > 0 || key === "d" || key === "y") {
      this.pendingChars += key;

      if (this.pendingChars === "dd") {
        this.pendingChars = "";
        this.yankBuffer = cursorState.text;
        return {
          cursorState: { cursor: 0, text: "" },
          result: { changed: true, message: "1 line deleted" },
        };
      }

      if (this.pendingChars === "yy") {
        this.pendingChars = "";
        this.yankBuffer = cursorState.text;
        return {
          cursorState,
          result: { changed: false, message: "1 line yanked" },
        };
      }

      if (this.pendingChars === "dw") {
        this.pendingChars = "";
        const end = cursorState.text.length;
        const wordEnd = cursorState.text
          .slice(cursorState.cursor)
          .search(/\s|$/);
        const deleteTo =
          wordEnd === -1
            ? end
            : cursorState.cursor + wordEnd;
        const deleted = cursorState.text.slice(
          cursorState.cursor,
          deleteTo,
        );
        this.yankBuffer = deleted;
        return {
          cursorState: {
            cursor: cursorState.cursor,
            text:
              cursorState.text.slice(0, cursorState.cursor) +
              cursorState.text.slice(deleteTo),
          },
          result: { changed: true, message: `"${deleted}" deleted` },
        };
      }

      // If we have 2 chars and it's not a recognized command, reset
      if (this.pendingChars.length >= 2) {
        this.pendingChars = "";
      }
      return { cursorState, result };
    }

    // Motion keys
    switch (key) {
      case "h":
        return { cursorState: moveLeft(cursorState), result };
      case "j":
      case "k":
        // No-op: single-line input, j/k don't navigate
        return { cursorState, result };
      case "l":
        return { cursorState: moveRight(cursorState), result };
      case "w":
        return { cursorState: moveWordForward(cursorState), result };
      case "b":
        return { cursorState: moveWordBackward(cursorState), result };
      case "0":
        return { cursorState: moveToLineStart(cursorState), result };
      case "^":
        return {
          cursorState: moveToFirstNonWhitespace(cursorState),
          result,
        };
      case "$":
        return { cursorState: moveToLineEnd(cursorState), result };
      case "x":
        // Delete character under cursor
        return {
          cursorState: {
            cursor: cursorState.cursor,
            text:
              cursorState.text.slice(0, cursorState.cursor) +
              cursorState.text.slice(cursorState.cursor + 1),
          },
          result: { changed: true },
        };
      case "D":
        // Delete to end of line
        this.yankBuffer = cursorState.text.slice(cursorState.cursor);
        return {
          cursorState: {
            cursor: cursorState.cursor,
            text: cursorState.text.slice(0, cursorState.cursor),
          },
          result: { changed: true, message: "deleted to EOL" },
        };
      case "C":
        // Change to end of line (delete rest, enter insert)
        this.yankBuffer = cursorState.text.slice(cursorState.cursor);
        this.mode = "insert";
        return {
          cursorState: {
            cursor: cursorState.cursor,
            text: cursorState.text.slice(0, cursorState.cursor),
          },
          result: { changed: true, message: "-- INSERT --" },
        };
      case "p":
        // Paste yank buffer after cursor
        if (this.yankBuffer) {
          const newText =
            cursorState.text.slice(0, cursorState.cursor + 1) +
            this.yankBuffer +
            cursorState.text.slice(cursorState.cursor + 1);
          return {
            cursorState: {
              cursor: cursorState.cursor + this.yankBuffer.length,
              text: newText,
            },
            result: { changed: true, message: "pasted" },
          };
        }
        return { cursorState, result };
      case "u":
        // Undo: not implemented for single-line (would need history stack)
        return {
          cursorState,
          result: { changed: false, message: "undo not available" },
        };
      case "i":
        this.mode = "insert";
        return {
          cursorState,
          result: { changed: false, message: "-- INSERT --" },
        };
      case "a":
        // Append (move right then insert)
        this.mode = "insert";
        return {
          cursorState: moveRight(cursorState),
          result: { changed: false, message: "-- INSERT --" },
        };
      case "A":
        // Append at end of line
        this.mode = "insert";
        return {
          cursorState: moveToLineEnd(cursorState),
          result: { changed: false, message: "-- INSERT --" },
        };
      case "I":
        // Insert at beginning of line (first non-whitespace)
        this.mode = "insert";
        return {
          cursorState: moveToFirstNonWhitespace(cursorState),
          result: { changed: false, message: "-- INSERT --" },
        };
      case "o":
      case "O":
        // Insert on new line
        this.mode = "insert";
        return {
          cursorState: { cursor: cursorState.text.length, text: cursorState.text },
          result: { changed: false, message: "-- INSERT --" },
        };
      case "Escape":
        // Already in normal mode, clear pending state
        this.pendingOperator = null;
        this.pendingChars = "";
        return { cursorState, result };
      default:
        return { cursorState, result };
    }
  }

  /**
   * Transition to normal mode.
   */
  enterNormalMode(): void {
    this.mode = "normal";
    this.pendingOperator = null;
    this.pendingChars = "";
  }

  /**
   * Transition to insert mode.
   */
  enterInsertMode(): void {
    this.mode = "insert";
    this.pendingOperator = null;
    this.pendingChars = "";
  }

  /**
   * Toggle between modes.
   */
  toggle(): VimMode {
    if (this.mode === "insert") {
      this.mode = "normal";
    } else {
      this.mode = "insert";
    }
    this.pendingOperator = null;
    this.pendingChars = "";
    return this.mode;
  }

  /**
   * Reset all state.
   */
  reset(): void {
    this.mode = "insert";
    this.pendingOperator = null;
    this.pendingChars = "";
  }
}
