import { formatEnvSnapshot } from "../src/core/env-snapshot.js";
import type { EnvSnapshot } from "../src/core/env-snapshot.js";

describe("EnvSnapshot", () => {
  describe("formatEnvSnapshot", () => {
    it("should return empty for non-git repo", () => {
      const snapshot: EnvSnapshot = {
        branch: "unknown",
        modifiedFiles: [],
        stagedFiles: [],
        untrackedFiles: [],
        recentCommits: [],
        conflicts: [],
        isGitRepo: false,
      };
      expect(formatEnvSnapshot(snapshot)).toBe("");
    });

    it("should format branch info", () => {
      const snapshot: EnvSnapshot = {
        branch: "main",
        modifiedFiles: [],
        stagedFiles: [],
        untrackedFiles: [],
        recentCommits: [],
        conflicts: [],
        isGitRepo: true,
      };
      const result = formatEnvSnapshot(snapshot);
      expect(result).toContain("Branch: main");
    });

    it("should format staged files", () => {
      const snapshot: EnvSnapshot = {
        branch: "main",
        modifiedFiles: [],
        stagedFiles: ["src/index.ts", "src/utils.ts"],
        untrackedFiles: [],
        recentCommits: [],
        conflicts: [],
        isGitRepo: true,
      };
      const result = formatEnvSnapshot(snapshot);
      expect(result).toContain("Staged (2)");
      expect(result).toContain("src/index.ts");
      expect(result).toContain("src/utils.ts");
    });

    it("should format modified files", () => {
      const snapshot: EnvSnapshot = {
        branch: "feature/x",
        modifiedFiles: ["README.md"],
        stagedFiles: [],
        untrackedFiles: [],
        recentCommits: [],
        conflicts: [],
        isGitRepo: true,
      };
      const result = formatEnvSnapshot(snapshot);
      expect(result).toContain("Modified (1)");
      expect(result).toContain("README.md");
    });

    it("should truncate long file lists", () => {
      const manyFiles = Array.from({ length: 50 }, (_, i) => `file${i}.ts`);
      const snapshot: EnvSnapshot = {
        branch: "main",
        modifiedFiles: manyFiles,
        stagedFiles: [],
        untrackedFiles: [],
        recentCommits: [],
        conflicts: [],
        isGitRepo: true,
      };
      const result = formatEnvSnapshot(snapshot, 10);
      expect(result).toContain("(+40 more)");
      expect(result.split("\n").length).toBeLessThan(manyFiles.length);
    });

    it("should format recent commits", () => {
      const snapshot: EnvSnapshot = {
        branch: "main",
        modifiedFiles: [],
        stagedFiles: [],
        untrackedFiles: [],
        recentCommits: [
          "abc123 fix: bug in parser (dev, 2h ago)",
          "def456 feat: add streaming",
        ],
        conflicts: [],
        isGitRepo: true,
      };
      const result = formatEnvSnapshot(snapshot);
      expect(result).toContain("Recent commits:");
      expect(result).toContain("abc123");
      expect(result).toContain("def456");
    });

    it("should flag conflicts", () => {
      const snapshot: EnvSnapshot = {
        branch: "main",
        modifiedFiles: [],
        stagedFiles: [],
        untrackedFiles: [],
        recentCommits: [],
        conflicts: ["src/index.ts"],
        isGitRepo: true,
      };
      const result = formatEnvSnapshot(snapshot);
      expect(result).toContain("CONFLICTS");
      expect(result).toContain("src/index.ts");
    });

    it("should format untracked files", () => {
      const snapshot: EnvSnapshot = {
        branch: "dev",
        modifiedFiles: [],
        stagedFiles: [],
        untrackedFiles: ["newfile.ts"],
        recentCommits: [],
        conflicts: [],
        isGitRepo: true,
      };
      const result = formatEnvSnapshot(snapshot);
      expect(result).toContain("Untracked (1)");
    });
  });
});