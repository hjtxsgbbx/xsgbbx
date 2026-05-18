import { execSync } from "child_process";
import { debug } from "../observability/debug.js";

export interface ShadowCheckpoint {
  id: string;
  branch: string;
  baseBranch: string;
  description: string;
  timestamp: string;
  fileCount: number;
  additions: number;
  deletions: number;
}

export class GitShadow {
  private projectPath: string;
  private shadowBranch: string | null = null;
  private checkpoints: ShadowCheckpoint[] = [];
  private nextId = 1;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  init(sessionId: string): boolean {
    try {
      const currentBranch = this.exec("git rev-parse --abbrev-ref HEAD").trim();
      if (!currentBranch) return false;

      this.shadowBranch = `agent_1-shadow-${sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}`;
      this.checkpoints = [];

      try {
        this.execThrow(`git checkout -b ${this.shadowBranch}`);
      } catch {
        try {
          this.execThrow(`git checkout ${this.shadowBranch}`);
        } catch {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  saveCheckpoint(description: string): ShadowCheckpoint | null {
    if (!this.shadowBranch) return null;

    try {
      this.exec("git add -A");

      const diff = this.exec("git diff --cached --stat");
      if (!diff.trim()) return null;

      const fileCount = (diff.match(/\n/g) || []).length;
      const addMatch = diff.match(/(\d+)\s+insertions/);
      const delMatch = diff.match(/(\d+)\s+deletions/);
      const additions = addMatch ? parseInt(addMatch[1]) : 0;
      const deletions = delMatch ? parseInt(delMatch[1]) : 0;

      const id = `ckpt-${this.nextId++}`;
      const timestamp = new Date().toISOString();

      const safeDesc = description.replace(/["`$\\]/g, "").slice(0, 100);
      this.exec(`git commit -m "agent_1 checkpoint: ${safeDesc}" --allow-empty`);

      const checkpoint: ShadowCheckpoint = {
        id,
        branch: this.shadowBranch,
        baseBranch: this.exec("git rev-parse --abbrev-ref HEAD").trim(),
        description,
        timestamp,
        fileCount: fileCount > 0 ? fileCount : 1,
        additions,
        deletions,
      };

      this.checkpoints.push(checkpoint);
      return checkpoint;
    } catch {
      return null;
    }
  }

  rollbackToCheckpoint(checkpointId: string): boolean {
    if (!this.shadowBranch) return false;

    const idx = this.checkpoints.findIndex((c) => c.id === checkpointId);
    if (idx < 0) return false;

    try {
      const allCommits = this.exec(
        `git log --all --grep="agent_1 checkpoint" --format=%H`
      ).trim();

      if (!allCommits) return false;

      const commitLines = allCommits.split("\n").filter((l) => l.trim());
      const targetIdx = commitLines.length - idx - 1;
      if (targetIdx < 0 || targetIdx >= commitLines.length) return false;

      const commitHash = commitLines[targetIdx].trim();
      if (commitHash) {
        this.exec(`git reset --hard ${commitHash}`);
        this.checkpoints = this.checkpoints.slice(0, idx + 1);
        this.nextId = this.checkpoints.length + 1;
        return true;
      }
      return false;
    } catch (err) {
      debug.warn("git-shadow", "Checkpoint rollback failed", err);
      return false;
    }
  }

  rollbackToBaseline(): boolean {
    if (!this.shadowBranch) return false;

    try {
      if (this.checkpoints.length > 0) {
        const allCommits = this.exec(
          "git log --all --grep='agent_1 checkpoint' --format=%H --reverse"
        ).trim();

        if (allCommits) {
          const firstCommit = allCommits.split("\n")[0].trim();
          if (firstCommit) {
            this.exec(`git reset --hard ${firstCommit}^`);
          }
        }
      }
      this.checkpoints = [];
      this.nextId = 1;
      return true;
    } catch {
      return false;
    }
  }

  mergeToBase(branch: string): boolean {
    if (!this.shadowBranch) return false;

    try {
      this.exec(`git checkout ${branch}`);
      this.exec(`git merge ${this.shadowBranch} --no-ff -m "agent_1: merge shadow branch"`);
      this.exec(`git branch -D ${this.shadowBranch}`);
      this.shadowBranch = null;
      return true;
    } catch {
      try {
        this.exec(`git merge --abort`);
        this.exec(`git checkout ${this.shadowBranch}`);
      } catch {
        // best effort
      }
      return false;
    }
  }

  getCheckpoints(): ShadowCheckpoint[] {
    return [...this.checkpoints];
  }

  getLatestCheckpoint(): ShadowCheckpoint | null {
    return this.checkpoints.length > 0
      ? this.checkpoints[this.checkpoints.length - 1]
      : null;
  }

  cleanup(): void {
    if (this.shadowBranch) {
      try {
        const currentBranch = this.exec("git rev-parse --abbrev-ref HEAD").trim();
        if (currentBranch === this.shadowBranch) {
          this.exec("git checkout -");
        }
        this.exec(`git branch -D ${this.shadowBranch}`);
      } catch (err) {
        debug.info("git-shadow", "Shadow branch cleanup failed", err);
      }
    }
    this.shadowBranch = null;
    this.checkpoints = [];
  }

  private exec(command: string): string {
    try {
      return execSync(command, {
        cwd: this.projectPath,
        encoding: "utf-8",
        timeout: 30000,
      });
    } catch (err) {
      debug.warn("git-shadow", `Git command failed: ${command}`, err);
      return "";
    }
  }

  private execThrow(command: string): string {
    const result = execSync(command, {
      cwd: this.projectPath,
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result;
  }
}