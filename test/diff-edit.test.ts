import { applyEdit, applyMultipleEdits } from "../src/tools/diff-edit.js";

describe("DiffEdit", () => {
  describe("applyEdit - Exact match", () => {
    it("should replace content with exact match", () => {
      const content = "line1\nline2\nline3";
      const result = applyEdit(content, "line2", "new_line2");
      expect(result.applied).toBe(true);
      expect(result.strategy).toBe("exact");
      expect(result.success).toBe(true);
    });

    it("should replace multi-line content", () => {
      const content = "first\nsecond\nthird\nfourth";
      const result = applyEdit(content, "second\nthird", "replaced");
      expect(result.applied).toBe(true);
      expect(result.strategy).toBe("exact");
    });

    it("should handle replacement with empty string", () => {
      const content = "keep\nremove\nkeep";
      const result = applyEdit(content, "remove", "");
      expect(result.applied).toBe(true);
    });
  });

  describe("applyEdit - Trimmed match", () => {
    it("should match when whitespace differs", () => {
      const content = "line1\n  line2  \nline3";
      const result = applyEdit(content, "line2", "new_line2");
      expect(result.applied).toBe(true);
      expect(result.strategy).toBe("trimmed");
    });

    it("should handle leading/trailing spaces", () => {
      const content = "  indented line  ";
      const result = applyEdit(content, "indented line", "replacement");
      expect(result.applied).toBe(true);
    });
  });

  describe("applyEdit - Fuzzy match", () => {
    it("should match similar content", () => {
      const content = "function hello_world() {\n  return 'hello';\n}";
      const search = "function helloWorld() {\n  return 'hello';\n}";
      const result = applyEdit(content, search, "function test() {}");
      expect(result.applied).toBe(true);
      expect(result.strategy).toBe("fuzzy");
    });

    it("should report confidence for fuzzy matches", () => {
      const content = "const config = {\n  port: 8080,\n  host: 'localhost'\n}";
      const search = "const cfg = {\n  port: 8080,\n  host: 'localhost'\n}";
      const result = applyEdit(content, search, "const cfg = {}");
      expect(result.applied).toBe(true);
      expect(result.output).toContain("confidence");
    });
  });

  describe("applyEdit - No match", () => {
    it("should fail when no match found", () => {
      const content = "completely\ndifferent\ncontent";
      const result = applyEdit(content, "nothing like this", "replacement");
      expect(result.applied).toBe(false);
      expect(result.strategy).toBe("none");
      expect(result.success).toBe(false);
    });

    it("should fail gracefully for empty file", () => {
      const result = applyEdit("", "search", "replace");
      expect(result.applied).toBe(false);
    });
  });

  describe("applyEdit - Line ending normalization", () => {
    it("should handle CRLF line endings", () => {
      const content = "line1\r\nline2\r\nline3";
      const result = applyEdit(content, "line2", "new_line2");
      expect(result.applied).toBe(true);
    });
  });

  describe("applyMultipleEdits", () => {
    it("should apply multiple edits", () => {
      const content = "line1\nline2\nline3\nline4";
      const results = applyMultipleEdits(content, [
        { search: "line1", replace: "first" },
        { search: "line4", replace: "last" },
      ]);
      expect(results.length).toBe(2);
      expect(results.every((r) => r.applied)).toBe(true);
    });

    it("should handle some edits failing", () => {
      const content = "hello\nworld";
      const results = applyMultipleEdits(content, [
        { search: "hello", replace: "hi" },
        { search: "nonexistent", replace: "nothing" },
      ]);
      const successCount = results.filter((r) => r.applied).length;
      expect(successCount).toBe(1);
    });
  });
});