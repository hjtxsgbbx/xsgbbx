import { execSync } from "child_process";

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
      this.shadowBranch = `agent_1-shadow-${sessionId.slice(0, 8)}`;
      this.checkpoints = [];

      this.exec(`git checkout -b ${this.shadowBranch} 2>/dev/null || git checkout ${this.shadowBranch}`);
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

      this.exec(`git commit -m "agent_1 checkpoint: ${description}" --allow-empty`);

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
      const commitHash = this.exec(
        `git log --all --grep="agent_1 checkpoint" --format=%H | head -${idx + 1} | tail -1`
      ).trim();

      if (commitHash) {
        this.exec(`git reset --hard ${commitHash}`);
        this.checkpoints = this.checkpoints.slice(0, idx + 1);
        this.nextId = this.checkpoints.length + 1;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  rollbackToBaseline(): boolean {
    if (!this.shadowBranch) return false;

    try {
      if (this.checkpoints.length > 0) {
        const firstCommit = this.exec(
          "git log --all --grep='agent_1 checkpoint' --format=%H --reverse | head -1"
        ).trim();
        if (firstCommit) {
          this.exec(`git reset --hard ${firstCommit}^`);
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
        this.exec(`git checkout ${this.shadowBranch}`);
      } catch {
        // branch may not exist
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
    } catch {
      return "";
    }
  }
}