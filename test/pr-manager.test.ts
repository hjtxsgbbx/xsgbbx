import { PRManager } from "../src/core/pr-manager.js";

describe("PRManager", () => {
  let prManager: PRManager;

  beforeEach(() => {
    prManager = new PRManager("test-session-123", process.cwd());
  });

  describe("generatePRTitle", () => {
    it("should generate default title when no commits", () => {
      const title = prManager.generatePRTitle([]);
      expect(title).toBe("agent_1: Automated changes");
    });

    it("should use single commit message as title", () => {
      const commits = [
        {
          hash: "abc1234",
          message: "Fix: resolve null pointer in parser",
          author: "Agent",
          date: "2026-01-01T00:00:00Z",
        },
      ];
      const title = prManager.generatePRTitle(commits);
      expect(title).toBe("Fix: resolve null pointer in parser");
    });

    it("should truncate long single commit messages", () => {
      const commits = [
        {
          hash: "abc1234",
          message:
            "Fix: this is an extremely long commit message that exceeds seventy-two characters and should be truncated properly at the right limit",
          author: "Agent",
          date: "2026-01-01T00:00:00Z",
        },
      ];
      const title = prManager.generatePRTitle(commits);
      expect(title.length).toBeLessThanOrEqual(72);
      expect(title.endsWith("...")).toBe(true);
    });

    it("should generate category-based title for multiple commits", () => {
      const commits = [
        {
          hash: "abc1234",
          message: "feat: add new parser module",
          author: "Agent",
          date: "2026-01-01T00:00:00Z",
        },
        {
          hash: "def5678",
          message: "fix: handle edge case in lexer",
          author: "Agent",
          date: "2026-01-01T00:01:00Z",
        },
        {
          hash: "ghi9012",
          message: "test: add unit tests for parser",
          author: "Agent",
          date: "2026-01-01T00:02:00Z",
        },
      ];
      const title = prManager.generatePRTitle(commits);
      expect(title).toContain("feat/fix/test");
      expect(title).toContain("3 commits");
    });

    it("should strip agent_1 checkpoint prefix from commit messages", () => {
      const commits = [
        {
          hash: "abc1234",
          message: "agent_1 checkpoint: Added new feature",
          author: "Agent",
          date: "2026-01-01T00:00:00Z",
        },
      ];
      const title = prManager.generatePRTitle(commits);
      expect(title).toBe("Added new feature");
    });
  });

  describe("generatePRDescription", () => {
    it("should include session ID in summary", () => {
      const description = prManager.generatePRDescription([], [], {
        additions: 0,
        deletions: 0,
      });
      expect(description).toContain("agent_1");
      expect(description).toContain("test-ses");
    });

    it("should list modified files", () => {
      const description = prManager.generatePRDescription(
        [],
        ["src/index.ts", "src/utils.ts"],
        { additions: 10, deletions: 3 }
      );
      expect(description).toContain("src/index.ts");
      expect(description).toContain("src/utils.ts");
      expect(description).toContain("Files modified (2)");
    });

    it("should truncate file list at 20 items", () => {
      const files = Array.from({ length: 25 }, (_, i) => `src/file${i}.ts`);
      const description = prManager.generatePRDescription([], files, {
        additions: 100,
        deletions: 50,
      });
      expect(description).toContain("Files modified (25)");
      expect(description).toContain("and 5 more files");
    });

    it("should include stats section", () => {
      const description = prManager.generatePRDescription([], [], {
        additions: 42,
        deletions: 7,
      });
      expect(description).toContain("+42");
      expect(description).toContain("-7");
    });

    it("should include commit history table when commits exist", () => {
      const commits = [
        {
          hash: "abc1234567890",
          message: "Initial commit",
          author: "Agent",
          date: "2026-01-01T00:00:00Z",
        },
      ];
      const description = prManager.generatePRDescription(commits, [], {
        additions: 5,
        deletions: 0,
      });
      expect(description).toContain("abc1234");
      expect(description).toContain("Initial commit");
    });

    it("should include testing section by default", () => {
      const description = prManager.generatePRDescription([], [], {
        additions: 0,
        deletions: 0,
      });
      expect(description).toContain("Testing");
      expect(description).toContain("All existing tests pass");
    });

    it("should include checklist section by default", () => {
      const description = prManager.generatePRDescription([], [], {
        additions: 0,
        deletions: 0,
      });
      expect(description).toContain("Checklist");
      expect(description).toContain("Code follows project conventions");
    });

    it("should respect template config", () => {
      const description = prManager.generatePRDescription(
        [],
        [],
        { additions: 0, deletions: 0 },
        {
          includeChecklist: false,
          includeScreenshots: false,
          includeTesting: false,
          customSections: ["Performance Impact"],
        }
      );
      expect(description).not.toContain("Checklist");
      expect(description).not.toContain("Testing");
      expect(description).toContain("Performance Impact");
    });
  });

  describe("getCurrentBranch", () => {
    it("should return a string", () => {
      const branch = prManager.getCurrentBranch();
      expect(typeof branch).toBe("string");
      expect(branch.length).toBeGreaterThan(0);
    });
  });

  describe("getDefaultBaseBranch", () => {
    it("should return a string", () => {
      const branch = prManager.getDefaultBaseBranch();
      expect(typeof branch).toBe("string");
      expect(branch.length).toBeGreaterThan(0);
    });
  });

  describe("checkGHCliInstalled", () => {
    it("should return boolean", () => {
      const installed = prManager.checkGHCliInstalled();
      expect(typeof installed).toBe("boolean");
    });
  });

  describe("getPRTemplate", () => {
    it("should return default template config", () => {
      const template = prManager.getPRTemplate();
      expect(template.includeChecklist).toBe(true);
      expect(template.includeTesting).toBe(true);
      expect(template.includeScreenshots).toBe(false);
      expect(template.customSections).toEqual([]);
    });
  });

  describe("buildPRMetadata", () => {
    it("should return metadata with required fields", () => {
      const metadata = prManager.buildPRMetadata();
      expect(metadata).toHaveProperty("title");
      expect(metadata).toHaveProperty("description");
      expect(metadata).toHaveProperty("branch");
      expect(metadata).toHaveProperty("baseBranch");
      expect(metadata).toHaveProperty("files");
      expect(metadata).toHaveProperty("additions");
      expect(metadata).toHaveProperty("deletions");
      expect(metadata).toHaveProperty("commits");
      expect(Array.isArray(metadata.files)).toBe(true);
      expect(Array.isArray(metadata.commits)).toBe(true);
    });
  });
});