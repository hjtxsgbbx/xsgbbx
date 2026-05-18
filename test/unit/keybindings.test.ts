/**
 * Keybindings system tests — default bindings, user merges,
 * binding resolution by context, validation, formatting.
 */
import { jest } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mock fs module so user keybindings file is never read from disk (ESM)
// ---------------------------------------------------------------------------
jest.unstable_mockModule("fs", () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn().mockReturnValue("{}"),
}));

const {
  loadDefaultBindings,
  validateBindings,
  resolveBinding,
  formatShortcut,
  getBindingHelp,
} = await import("../../src/keybindings/index.js");
import type { Keybinding } from "../../src/keybindings/index.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("keybindings — default bindings", () => {
  it("loads default bindings", () => {
    const defaults = loadDefaultBindings();
    expect(Array.isArray(defaults)).toBe(true);
    expect(defaults.length).toBeGreaterThan(0);
  });

  it("includes Ctrl+C interrupt binding", () => {
    const defaults = loadDefaultBindings();
    const ctrlC = defaults.find(
      (b) => b.key === "Ctrl+C" && b.action === "interrupt",
    );
    expect(ctrlC).toBeDefined();
    expect(ctrlC!.context).toBe("global");
  });

  it("includes vim navigation bindings", () => {
    const defaults = loadDefaultBindings();
    const vimBindings = defaults.filter(
      (b) => b.context === "vim-normal" || b.context === "vim-insert",
    );
    expect(vimBindings.length).toBeGreaterThan(0);

    const vimLeft = defaults.find((b) => b.action === "vim-cursor-left");
    expect(vimLeft).toBeDefined();
    expect(vimLeft!.key).toBe("h");
  });

  it("includes vim operator bindings (dd, yy, dw)", () => {
    const defaults = loadDefaultBindings();
    const actions = defaults.map((b) => b.action);
    expect(actions).toContain("vim-delete-line");
    expect(actions).toContain("vim-yank-line");
    expect(actions).toContain("vim-delete-word");
  });

  it("includes input navigation bindings", () => {
    const defaults = loadDefaultBindings();
    const inputBindings = defaults.filter((b) => b.context === "input");
    expect(inputBindings.length).toBeGreaterThan(0);

    const beginningOfLine = inputBindings.find((b) => b.action === "beginning-of-line");
    expect(beginningOfLine).toBeDefined();
    expect(beginningOfLine!.key).toBe("Ctrl+A");
  });

  it("all default bindings have required fields", () => {
    const defaults = loadDefaultBindings();
    for (const b of defaults) {
      expect(b.key).toBeTruthy();
      expect(b.action).toBeTruthy();
    }
  });

  it("default bindings are immutable copy", () => {
    const d1 = loadDefaultBindings();
    const d2 = loadDefaultBindings();
    expect(d1).toEqual(d2);
    d1.push({ key: "X", action: "test" });
    expect(loadDefaultBindings().length).toBe(d2.length);
  });
});

describe("keybindings — validation", () => {
  it("reports valid bindings as valid", () => {
    const bindings: Keybinding[] = [
      { key: "Ctrl+X", action: "interrupt" },
      { key: "Ctrl+S", action: "search-history", context: "input" },
    ];
    const result = validateBindings(bindings);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("detects missing key field", () => {
    const bindings: Keybinding[] = [{ key: "", action: "test" }];
    const result = validateBindings(bindings);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("missing");
  });

  it("detects missing action field", () => {
    const bindings: Keybinding[] = [{ key: "Ctrl+X", action: "" }];
    const result = validateBindings(bindings);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("missing");
  });

  it("detects invalid context", () => {
    const bindings: Keybinding[] = [
      { key: "Ctrl+X", action: "exit", context: "invalid-context" },
    ];
    const result = validateBindings(bindings);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("invalid context");
  });

  it("detects duplicate bindings in same context", () => {
    const bindings: Keybinding[] = [
      { key: "Ctrl+X", action: "interrupt", context: "global" },
      { key: "Ctrl+X", action: "exit", context: "global" },
    ];
    const result = validateBindings(bindings);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("allows same key in different contexts", () => {
    const bindings: Keybinding[] = [
      { key: "Ctrl+R", action: "search-history", context: "input" },
      { key: "Ctrl+R", action: "vim-redo", context: "vim-normal" },
    ];
    const result = validateBindings(bindings);
    expect(result.valid).toBe(true);
  });
});

describe("keybindings — resolution by context", () => {
  it("resolves known binding in global context", () => {
    const resolved = resolveBinding("Ctrl+C", "global");
    expect(resolved).not.toBeNull();
    expect(resolved!.action).toBe("interrupt");
  });

  it("resolves known binding in input context", () => {
    const resolved = resolveBinding("Ctrl+U", "input");
    expect(resolved).not.toBeNull();
    expect(resolved!.action).toBe("clear-line");
  });

  it("returns null for unknown key", () => {
    const resolved = resolveBinding("F12", "global");
    expect(resolved).toBeNull();
  });

  it("falls back to global context when context-specific not found", () => {
    const resolved = resolveBinding("Ctrl+L", "input");
    // Ctrl+L has context "global", so input falls back to global
    expect(resolved).not.toBeNull();
    expect(resolved!.action).toBe("clear-screen");
  });

  it("prefers exact context match over global fallback", () => {
    // Ctrl+R in "input" context should match search-history (not vim-redo)
    const resolved = resolveBinding("Ctrl+R", "input");
    expect(resolved).not.toBeNull();
    expect(resolved!.action).toBe("search-history");
  });
});

describe("keybindings — formatting", () => {
  it("formats Ctrl+ shortcuts with ^", () => {
    expect(formatShortcut("Ctrl+C")).toBe("^C");
  });

  it("formats Alt+ shortcuts with M-", () => {
    expect(formatShortcut("Alt+X")).toBe("M-X");
  });

  it("formats Shift+ shortcuts with arrow symbol", () => {
    expect(formatShortcut("Shift+Tab")).toBe("⇧Tab");
  });

  it("returns plain keys unchanged", () => {
    expect(formatShortcut("Escape")).toBe("Escape");
    expect(formatShortcut("Tab")).toBe("Tab");
  });
});

describe("keybindings — help text", () => {
  it("generates help text with context headers", () => {
    const help = getBindingHelp();
    expect(help).toContain("[global]");
    expect(help).toContain("[input]");
    expect(help).toContain("[vim-normal]");
  });

  it("can filter help to a specific context", () => {
    const help = getBindingHelp("vim-normal");
    expect(help).not.toContain("[global]");
    expect(help).not.toContain("[input]");
  });
});
