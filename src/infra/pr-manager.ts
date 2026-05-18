import { execSync } from "child_process";
import { GitShadow } from "./git-shadow.js";
import { AuditLogger } from "../storage/index.js";
import type { AuditLogEntry } from "../types/index.js";

export interface PRMetadata {
  title: string;
  description: string;
  branch: string;
  baseBranch: string;
  files: string[];
  additions: number;
  deletions: number;
  commits: PRCommitInfo[];
}

export interface PRCommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface PRResult {
  success: boolean;
  url?: string;
  number?: number;
  branch: string;
  baseBranch: string;
  error?: string;
}

export interface PRTemplateConfig {
  includeChecklist: boolean;
  includeScreenshots: boolean;
  includeTesting: boolean;
  customSections: string[];
}

const DEFAULT_PR_TEMPLATE: PRTemplateConfig = {
  includeChecklist: true,
  includeScreenshots: false,
  includeTesting: true,
  customSections: [],
};

export class PRManager {
  private projectPath: string;
  private gitShadow: GitShadow;
  private auditLogger: AuditLogger;
  private sessionId: string;

  constructor(sessionId: string, projectPath: string) {
    this.sessionId = sessionId;
    this.projectPath = projectPath;
    this.gitShadow = new GitShadow(projectPath);
    this.auditLogger = new AuditLogger();
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

  getCurrentBranch(): string {
    const branch = this.exec("git rev-parse --abbrev-ref HEAD").trim();
    return branch || "main";
  }

  getDefaultBaseBranch(): string {
    const remote = this.exec("git remote show origin 2>/dev/null | grep 'HEAD branch' | cut -d: -f2").trim();
    if (remote) return remote.trim();
    const local = this.exec("git branch --list main master | head -1").trim().replace("*", "").trim();
    return local || "main";
  }

  getChangedFiles(baseBranch?: string): string[] {
    const base = baseBranch || this.getDefaultBaseBranch();
    const diff = this.exec(`git diff ${base} --name-only`).trim();
    if (!diff) return [];
    return diff.split("\n").filter(Boolean);
  }

  getDiffStats(baseBranch?: string): { additions: number; deletions: number } {
    const base = baseBranch || this.getDefaultBaseBranch();
    const stats = this.exec(`git diff ${base} --shortstat`).trim();
    const addMatch = stats.match(/(\d+)\s+insertion/);
    const delMatch = stats.match(/(\d+)\s+deletion/);
    return {
      additions: addMatch ? parseInt(addMatch[1]) : 0,
      deletions: delMatch ? parseInt(delMatch[1]) : 0,
    };
  }

  getCommitsSince(baseBranch?: string): PRCommitInfo[] {
    const base = baseBranch || this.getDefaultBaseBranch();
    const log = this.exec(
      `git log ${base}..HEAD --format="%H||%s||%an||%aI" --no-merges`
    ).trim();
    if (!log) return [];
    return log.split("\n").map((line) => {
      const [hash, message, author, date] = line.split("||");
      return { hash, message, author, date };
    });
  }

  generatePRTitle(commits: PRCommitInfo[]): string {
    if (commits.length === 0) {
      return "agent_1: Automated changes";
    }
    if (commits.length === 1) {
      const msg = commits[0].message.replace(/^agent_1 checkpoint: /, "").replace(/^agent_1: /, "");
      if (msg.length <= 72) return msg;
      return msg.substring(0, 69) + "...";
    }
    const categories = new Set<string>();
    for (const c of commits) {
      const msg = c.message.toLowerCase();
      if (/^(fix|bug)(\s*\(|:)/.test(msg) || msg.includes("fix:") || msg.includes("bug:")) categories.add("fix");
      else if (/^(feat|feature)(\s*\(|:)/.test(msg) || msg.includes("feat:")) categories.add("feat");
      else if (/^(refactor|perf)(\s*\(|:)/.test(msg) || msg.includes("refactor:")) categories.add("refactor");
      else if (/^(test|tests)(\s*\(|:)/.test(msg) || msg.includes("test:")) categories.add("test");
      else if (/^(docs|doc)(\s*\(|:)/.test(msg) || msg.includes("docs:")) categories.add("docs");
      else if (/^(chore|ci|build)(\s*\(|:)/.test(msg) || msg.includes("chore:")) categories.add("chore");
      else if (msg.includes("fix") || msg.includes("bug")) categories.add("fix");
      else if (msg.includes("feat") || msg.includes("implement")) categories.add("feat");
      else if (msg.includes("refactor")) categories.add("refactor");
      else if (msg.includes("test")) categories.add("test");
      else if (msg.includes("doc")) categories.add("docs");
      else if (msg.includes("chore")) categories.add("chore");
      else categories.add("update");
    }
    const scope = Array.from(categories).join("/");
    return `${scope}: agent_1 automated changes (${commits.length} commits)`;
  }

  generatePRDescription(
    commits: PRCommitInfo[],
    files: string[],
    stats: { additions: number; deletions: number },
    template: PRTemplateConfig = DEFAULT_PR_TEMPLATE
  ): string {
    const lines: string[] = [];

    lines.push("## Summary");
    lines.push("");
    lines.push(
      `Automated changes generated by agent_1 (Session: \`${this.sessionId.slice(0, 8)}\`)`
    );
    lines.push("");

    lines.push("## Changes");
    lines.push("");
    if (files.length > 0) {
      lines.push(`**Files modified (${files.length}):**`);
      lines.push("");
      for (const f of files.slice(0, 20)) {
        lines.push(`- \`${f}\``);
      }
      if (files.length > 20) {
        lines.push(`- ... and ${files.length - 20} more files`);
      }
    } else {
      lines.push("No file changes detected.");
    }
    lines.push("");

    lines.push("## Stats");
    lines.push("");
    lines.push(`- **Additions**: +${stats.additions}`);
    lines.push(`- **Deletions**: -${stats.deletions}`);
    lines.push(`- **Commits**: ${commits.length}`);
    lines.push("");

    lines.push("## Commit History");
    lines.push("");
    if (commits.length > 0) {
      lines.push("| Hash | Message | Author | Date |");
      lines.push("|------|---------|--------|------|");
      for (const c of commits) {
        const shortHash = c.hash.slice(0, 7);
        const msg = c.message.replace(/\|/g, "\\|").slice(0, 60);
        lines.push(`| ${shortHash} | ${msg} | ${c.author} | ${c.date.slice(0, 10)} |`);
      }
    } else {
      lines.push("No commits recorded.");
    }
    lines.push("");

    if (template.includeTesting) {
      lines.push("## Testing");
      lines.push("");
      lines.push("- [ ] All existing tests pass");
      lines.push("- [ ] New functionality has been verified");
      lines.push("- [ ] No regressions introduced");
      lines.push("");
    }

    if (template.includeChecklist) {
      lines.push("## Checklist");
      lines.push("");
      lines.push("- [ ] Code follows project conventions");
      lines.push("- [ ] Changes are self-contained and focused");
      lines.push("- [ ] No sensitive data exposed");
      lines.push("");
    }

    for (const section of template.customSections) {
      lines.push(`## ${section}`);
      lines.push("");
      lines.push("<!-- Add details here -->");
      lines.push("");
    }

    lines.push("---");
    lines.push(`*Generated by agent_1 on ${new Date().toISOString()}*`);

    return lines.join("\n");
  }

  buildPRMetadata(baseBranch?: string): PRMetadata {
    const branch = this.getCurrentBranch();
    const base = baseBranch || this.getDefaultBaseBranch();
    const commits = this.getCommitsSince(base);
    const files = this.getChangedFiles(base);
    const stats = this.getDiffStats(base);
    const title = this.generatePRTitle(commits);
    const description = this.generatePRDescription(commits, files, stats);

    return {
      title,
      description,
      branch,
      baseBranch: base,
      files,
      additions: stats.additions,
      deletions: stats.deletions,
      commits,
    };
  }

  createPR(
    metadata: PRMetadata,
    options?: {
      draft?: boolean;
      labels?: string[];
      reviewers?: string[];
      remote?: string;
    }
  ): PRResult {
    try {
      const remote = options?.remote || "origin";

      const hasRemote = this.exec(`git remote get-url ${remote} 2>/dev/null`).trim();
      if (!hasRemote) {
        return {
          success: false,
          branch: metadata.branch,
          baseBranch: metadata.baseBranch,
          error: `No remote '${remote}' configured. Set up a git remote first.`,
        };
      }

      this.exec(`git push ${remote} ${metadata.branch} 2>/dev/null`);

      const titleEscaped = metadata.title.replace(/"/g, '\\"');
      const bodyEscaped = metadata.description.replace(/"/g, '\\"').replace(/\n/g, "\\n");

      const draftFlag = options?.draft ? " --draft" : "";
      const labelFlags = options?.labels?.length
        ? options.labels.map((l) => ` --label "${l}"`).join("")
        : "";
      const reviewerFlags = options?.reviewers?.length
        ? options.reviewers.map((r) => ` --reviewer "${r}"`).join("")
        : "";

      const ghCommand = `gh pr create --base "${metadata.baseBranch}" --head "${metadata.branch}" --title "${titleEscaped}" --body "${bodyEscaped}"${draftFlag}${labelFlags}${reviewerFlags} 2>/dev/null`;

      const result = this.exec(ghCommand).trim();

      if (result) {
        const prNumber = this.extractPRNumber(result);
        const auditEntry: AuditLogEntry = {
          timestamp: new Date().toISOString(),
          session_id: this.sessionId,
          action: "config_change" as const,
          tool_name: "pr_create",
          command_summary: `Created PR #${prNumber} from ${metadata.branch} to ${metadata.baseBranch}`,
          decision: "allowed",
        };
        this.auditLogger.log(auditEntry);

        return {
          success: true,
          url: result,
          number: prNumber,
          branch: metadata.branch,
          baseBranch: metadata.baseBranch,
        };
      }

      return {
        success: false,
        branch: metadata.branch,
        baseBranch: metadata.baseBranch,
        error: "PR creation failed. Ensure GitHub CLI (gh) is installed and authenticated.",
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        branch: metadata.branch,
        baseBranch: metadata.baseBranch,
        error: message,
      };
    }
  }

  private extractPRNumber(url: string): number | undefined {
    const match = url.match(/pull\/(\d+)/);
    return match ? parseInt(match[1]) : undefined;
  }

  async createPRFromShadow(): Promise<PRResult> {
    const checkpoints = this.gitShadow.getCheckpoints();
    if (checkpoints.length === 0) {
      return {
        success: false,
        branch: this.getCurrentBranch(),
        baseBranch: this.getDefaultBaseBranch(),
        error: "No checkpoints found. No changes to create a PR from.",
      };
    }

    const metadata = this.buildPRMetadata();
    return this.createPR(metadata);
  }

  checkGHCliInstalled(): boolean {
    const result = this.exec("gh --version 2>/dev/null");
    return result.length > 0;
  }

  listOpenPRs(): Record<string, unknown>[] {
    const result = this.exec("gh pr list --json number,title,headRefName,baseRefName,state 2>/dev/null");
    if (!result) return [];
    try {
      const parsed = JSON.parse(result);
      return Array.isArray(parsed) ? parsed as Record<string, unknown>[] : [];
    } catch {
      return [];
    }
  }

  getPRTemplate(): PRTemplateConfig {
    return { ...DEFAULT_PR_TEMPLATE };
  }
}

export function createPRManager(sessionId: string, projectPath: string): PRManager {
  return new PRManager(sessionId, projectPath);
}