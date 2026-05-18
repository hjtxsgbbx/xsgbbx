/**
 * VimEngine tests — mode switching, motions, operators, paste buffer.
 */
import { VimEngine } from "../../src/vim/index.js";
import type { CursorState } from "../../src/vim/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cs(text: string, cursor: number): CursorState {
  return { text, cursor };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VimEngine — mode switching", () => {
  let engine: VimEngine;

  beforeEach(() => {
    engine = new VimEngine();
  });

  it("starts in insert mode by default", () => {
    expect(engine.getMode()).toBe("insert");
    expect(engine.isInsert()).toBe(true);
    expect(engine.isNormal()).toBe(false);
  });

  it("enters normal mode", () => {
    engine.enterNormalMode();
    expect(engine.isNormal()).toBe(true);
    expect(engine.isInsert()).toBe(false);
    expect(engine.getStatusLine()).toContain("NORMAL");
  });

  it("enters insert mode", () => {
    engine.enterNormalMode();
    engine.enterInsertMode();
    expect(engine.isInsert()).toBe(true);
    expect(engine.getStatusLine()).toContain("INSERT");
  });

  it("toggles between modes", () => {
    expect(engine.toggle()).toBe("normal");
    expect(engine.isNormal()).toBe(true);
    expect(engine.toggle()).toBe("insert");
    expect(engine.isInsert()).toBe(true);
  });

  it("reset returns to insert mode", () => {
    engine.enterNormalMode();
    engine.reset();
    expect(engine.isInsert()).toBe(true);
  });

  it("pressing i in normal mode enters insert mode", () => {
    engine.enterNormalMode();
    const { result } = engine.handleNormalMode("i", cs("hello", 0));
    expect(result.message).toContain("INSERT");
    expect(engine.getMode()).toBe("insert");
  });

  it("pressing Escape in normal mode clears pending state", () => {
    engine.enterNormalMode();
    const result = engine.handleNormalMode("Escape", cs("hello", 2));
    expect(result.cursorState).toEqual(cs("hello", 2));
    expect(engine.getStatusLine()).toBe("-- NORMAL --");
  });
});

describe("VimEngine — basic motions", () => {
  let engine: VimEngine;

  beforeEach(() => {
    engine = new VimEngine();
    engine.enterNormalMode();
  });

  it("h moves cursor left", () => {
    const { cursorState: result } = engine.handleNormalMode("h", cs("hello", 2));
    expect(result.cursor).toBe(1);
  });

  it("h stops at beginning of line", () => {
    const { cursorState: result } = engine.handleNormalMode("h", cs("hello", 0));
    expect(result.cursor).toBe(0);
  });

  it("l moves cursor right", () => {
    const { cursorState: result } = engine.handleNormalMode("l", cs("hello", 2));
    expect(result.cursor).toBe(3);
  });

  it("l stops at end of line", () => {
    const { cursorState: result } = engine.handleNormalMode("l", cs("hello", 5));
    expect(result.cursor).toBe(5);
  });

  it("j and k are no-ops on single-line input", () => {
    const state = cs("hello", 2);
    const resJ = engine.handleNormalMode("j", state);
    const resK = engine.handleNormalMode("k", state);
    expect(resJ.cursorState).toEqual(state);
    expect(resK.cursorState).toEqual(state);
  });

  it("w jumps to next word", () => {
    const { cursorState: result } = engine.handleNormalMode("w", cs("hello world test", 0));
    expect(result.cursor).toBe(6);
  });

  it("w stops at end of line", () => {
    const { cursorState: result } = engine.handleNormalMode("w", cs("hello", 0));
    expect(result.cursor).toBe(5);
  });

  it("b jumps to start of previous/current word", () => {
    // "hello world" at cursor 7 (the 'o' in "world"):
    // b moves to start of current word (position 6, the 'w' in "world")
    const { cursorState: result } = engine.handleNormalMode("b", cs("hello world", 7));
    expect(result.cursor).toBe(6);
    // b again moves to start of previous word (position 0, the 'h' in "hello")
    const afterSecond = engine.handleNormalMode("b", result);
    expect(afterSecond.cursorState.cursor).toBe(0);
  });

  it("b stops at beginning of line", () => {
    const { cursorState: result } = engine.handleNormalMode("b", cs("hello", 0));
    expect(result.cursor).toBe(0);
  });

  it("0 moves to absolute line start", () => {
    const { cursorState: result } = engine.handleNormalMode("0", cs("  hello", 4));
    expect(result.cursor).toBe(0);
  });

  it("^ moves to first non-whitespace character", () => {
    const { cursorState: result } = engine.handleNormalMode("^", cs("  hello", 4));
    expect(result.cursor).toBe(2);
  });

  it("$ moves to end of line", () => {
    const { cursorState: result } = engine.handleNormalMode("$", cs("hello", 2));
    expect(result.cursor).toBe(5);
  });
});

describe("VimEngine — operators", () => {
  it("dd deletes the current line", () => {
    const engine = new VimEngine();
    engine.enterNormalMode();

    // First 'd' enters pending state, second 'd' completes "dd"
    engine.handleNormalMode("d", cs("delete this line", 3));
    const final = engine.handleNormalMode("d", cs("delete this line", 3));
    expect(final.cursorState.text).toBe("");
    expect(final.result.changed).toBe(true);
    expect(final.result.message).toContain("deleted");
  });

  it("yy yanks (copies) the current line", () => {
    const engine = new VimEngine();
    engine.enterNormalMode();

    engine.handleNormalMode("y", cs("yank me", 0));
    const final = engine.handleNormalMode("y", cs("yank me", 0));
    expect(final.result.changed).toBe(false);
    expect(final.result.message).toContain("yanked");
  });

  it("dw deletes to next word boundary", () => {
    const engine = new VimEngine();
    engine.enterNormalMode();

    engine.handleNormalMode("d", cs("hello world", 0));
    const final = engine.handleNormalMode("w", cs("hello world", 0));
    expect(final.cursorState.text).toBe(" world");
    expect(final.result.changed).toBe(true);
  });

  it("x deletes character under cursor", () => {
    const engine = new VimEngine();
    engine.enterNormalMode();

    const { cursorState: result, result: action } = engine.handleNormalMode("x", cs("hello", 1));
    expect(result.text).toBe("hllo");
    expect(action.changed).toBe(true);
  });

  it("D deletes to end of line", () => {
    const engine = new VimEngine();
    engine.enterNormalMode();

    const { cursorState: result, result: action } = engine.handleNormalMode("D", cs("hello world", 6));
    expect(result.text).toBe("hello ");
    expect(action.changed).toBe(true);
  });
});

describe("VimEngine — paste", () => {
  let engine: VimEngine;

  beforeEach(() => {
    engine = new VimEngine();
    engine.enterNormalMode();
  });

  it("pastes yanked line after cursor", () => {
    // Yank a line first
    engine.handleNormalMode("y", cs("hello", 0));
    engine.handleNormalMode("y", cs("hello", 0));

    const { cursorState: result, result: action } = engine.handleNormalMode("p", cs("test", 0));
    expect(result.text).toContain("hello");
    expect(action.changed).toBe(true);
    expect(action.message).toContain("pasted");
  });

  it("paste is no-op with empty yank buffer", () => {
    const fresh = new VimEngine();
    fresh.enterNormalMode();
    const { cursorState: result, result: action } = fresh.handleNormalMode("p", cs("test", 0));
    expect(result.text).toBe("test");
    expect(action.changed).toBe(false);
  });

  it("paste after deleting a line", () => {
    engine.handleNormalMode("d", cs("old line", 0));
    engine.handleNormalMode("d", cs("old line", 0));

    const { cursorState: result } = engine.handleNormalMode("p", cs("new ", 4));
    expect(result.text).toContain("old line");
  });
});

describe("VimEngine — append and insert variants", () => {
  let engine: VimEngine;

  beforeEach(() => {
    engine = new VimEngine();
    engine.enterNormalMode();
  });

  it("a appends after cursor and enters insert mode", () => {
    const { cursorState: result } = engine.handleNormalMode("a", cs("abc", 1));
    expect(result.cursor).toBe(2);
    expect(engine.getMode()).toBe("insert");
  });

  it("A appends at end of line", () => {
    const { cursorState: result } = engine.handleNormalMode("A", cs("abc", 1));
    expect(result.cursor).toBe(3);
    expect(engine.getMode()).toBe("insert");
  });

  it("I inserts at first non-whitespace", () => {
    const { cursorState: result } = engine.handleNormalMode("I", cs("  abc", 4));
    expect(result.cursor).toBe(2);
    expect(engine.getMode()).toBe("insert");
  });

  it("C changes to end of line and enters insert mode", () => {
    const { cursorState: result } = engine.handleNormalMode("C", cs("hello world", 6));
    expect(result.text).toBe("hello ");
    expect(engine.getMode()).toBe("insert");
  });
});

describe("VimEngine — edge cases", () => {
  it("handles unknown keys gracefully in normal mode", () => {
    const engine = new VimEngine();
    engine.enterNormalMode();
    const { cursorState: result, result: action } = engine.handleNormalMode("z", cs("test", 0));
    expect(result).toEqual(cs("test", 0));
    expect(action.changed).toBe(false);
  });

  it("handles empty text", () => {
    const engine = new VimEngine();
    engine.enterNormalMode();
    const { cursorState: result } = engine.handleNormalMode("l", cs("", 0));
    expect(result.cursor).toBe(0);
  });

  it("clears multi-char pending state after unrecognized 2-char sequence", () => {
    const engine = new VimEngine();
    engine.enterNormalMode();

    // Press d (puts engine in pending state with "d")
    engine.handleNormalMode("d", cs("test", 0));
    // Press z — pendingChars becomes "dz", unrecognized, clears to ""
    // The mode stays "normal" since "dz" doesn't switch to insert
    engine.handleNormalMode("z", cs("test", 0));
    // Now engine should be free of pending state in normal mode
    expect(engine.getMode()).toBe("normal");
    expect(engine.getStatusLine()).toBe("-- NORMAL --");
  });

  it("can switch to normal mode from insert via toggle", () => {
    const engine = new VimEngine();
    // starts in insert
    engine.toggle(); // -> normal
    expect(engine.isNormal()).toBe(true);
  });
});

describe("VimEngine — status line", () => {
  it("shows insert status line", () => {
    const engine = new VimEngine();
    expect(engine.getStatusLine()).toBe("-- INSERT --");
  });

  it("shows normal status line", () => {
    const engine = new VimEngine();
    engine.enterNormalMode();
    expect(engine.getStatusLine()).toBe("-- NORMAL --");
  });
});
