import { shellExecSync } from "../pal/index.js";
import type { PlatformInfo } from "../types/index.js";

export interface EnvSnapshot {
  branch: string;
  modifiedFiles: string[];
  stagedFiles: string[];
  untrackedFiles: string[];
  recentCommits: string[];
  conflicts: string[];
  isGitRepo: boolean;
}

const EMPTY_SNAPSHOT: EnvSnapshot = {
  branch: "unknown",
  modifiedFiles: [],
  stagedFiles: [],
  untrackedFiles: [],
  recentCommits: [],
  conflicts: [],
  isGitRepo: false,
};

export function captureEnvSnapshot(
  projectPath: string,
  platform: PlatformInfo
): EnvSnapshot {
  try {
    const result = shellExecSync("git rev-parse --is-inside-work-tree 2>nul", platform, {
      cwd: projectPath,
    });
    if (result.exitCode !== 0 || !result.stdout.includes("true")) {
      return EMPTY_SNAPSHOT;
    }
  } catch {
    return EMPTY_SNAPSHOT;
  }

  const snapshot: EnvSnapshot = {
    ...EMPTY_SNAPSHOT,
    isGitRepo: true,
  };

  try {
    const branchResult = shellExecSync("git branch --show-current", platform, {
      cwd: projectPath,
    });
    snapshot.branch = branchResult.stdout.trim() || "unknown";
  } catch {
    // keep default
  }

  try {
    const modifiedResult = shellExecSync("git diff --name-only", platform, {
      cwd: projectPath,
    });
    snapshot.modifiedFiles = modifiedResult.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 30);
  } catch {
    // keep default
  }

  try {
    const stagedResult = shellExecSync("git diff --staged --name-only", platform, {
      cwd: projectPath,
    });
    snapshot.stagedFiles = stagedResult.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 30);
  } catch {
    // keep default
  }

  try {
    const untrackedResult = shellExecSync(
      "git ls-files --others --exclude-standard",
      platform,
      { cwd: projectPath }
    );
    snapshot.untrackedFiles = untrackedResult.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 20);
  } catch {
    // keep default
  }

  try {
    const logResult = shellExecSync(
      'git log --oneline -5 --format="%h %s (%an, %ar)"',
      platform,
      { cwd: projectPath }
    );
    snapshot.recentCommits = logResult.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    // keep default
  }

  try {
    const conflictResult = shellExecSync("git diff --name-only --diff-filter=U", platform, {
      cwd: projectPath,
    });
    snapshot.conflicts = conflictResult.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    // keep default
  }

  return snapshot;
}

export function formatEnvSnapshot(snapshot: EnvSnapshot, maxFiles = 15): string {
  if (!snapshot.isGitRepo) return "";

  const lines: string[] = [];

  lines.push(`Branch: ${snapshot.branch}`);

  if (snapshot.stagedFiles.length > 0) {
    const files = snapshot.stagedFiles.slice(0, maxFiles);
    const suffix = snapshot.stagedFiles.length > maxFiles
      ? ` (+${snapshot.stagedFiles.length - maxFiles} more)`
      : "";
    lines.push(`Staged (${snapshot.stagedFiles.length}): ${files.join(", ")}${suffix}`);
  }

  if (snapshot.modifiedFiles.length > 0) {
    const files = snapshot.modifiedFiles.slice(0, maxFiles);
    const suffix = snapshot.modifiedFiles.length > maxFiles
      ? ` (+${snapshot.modifiedFiles.length - maxFiles} more)`
      : "";
    lines.push(`Modified (${snapshot.modifiedFiles.length}): ${files.join(", ")}${suffix}`);
  }

  if (snapshot.untrackedFiles.length > 0) {
    const files = snapshot.untrackedFiles.slice(0, maxFiles);
    const suffix = snapshot.untrackedFiles.length > maxFiles
      ? ` (+${snapshot.untrackedFiles.length - maxFiles} more)`
      : "";
    lines.push(`Untracked (${snapshot.untrackedFiles.length}): ${files.join(", ")}${suffix}`);
  }

  if (snapshot.conflicts.length > 0) {
    lines.push(`CONFLICTS: ${snapshot.conflicts.join(", ")}`);
  }

  if (snapshot.recentCommits.length > 0) {
    lines.push(`Recent commits:\n  ${snapshot.recentCommits.join("\n  ")}`);
  }

  return lines.join("\n");
}