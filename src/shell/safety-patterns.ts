/**
 * Safety pattern definitions — all regex-based patterns and permission
 * rules used by the layered safety pipeline.
 *
 * Separated from the checker to keep file sizes within limits.
 */

// ---------------------------------------------------------------------------
// Severity & rule types
// ---------------------------------------------------------------------------

export type SafetySeverity = "safe" | "caution" | "dangerous" | "blocked";

export interface SafetyWarning {
  layer: number;
  severity: SafetySeverity;
  message: string;
  segment?: string;
}

export interface PermissionRule {
  pattern: string;
  action: "allow" | "deny" | "ask";
  description?: string;
}

// ---------------------------------------------------------------------------
// Layer 1: Blocked patterns — catastrophic commands always rejected
// ---------------------------------------------------------------------------

export interface BlockedPattern {
  pattern: RegExp;
  reason: string;
}

export const BLOCKED_PATTERNS: BlockedPattern[] = [
  { pattern: /rm\s+(-[rRf]+\s+)*\/\s*$/, reason: "rm -rf / (recursive delete of root)" },
  { pattern: /rm\s+-[rRf]+\s+--no-preserve-root\s+\//, reason: "rm --no-preserve-root /" },
  { pattern: />\s*\/dev\/sd[a-z]/, reason: "Writing directly to block device" },
  { pattern: />\s*\/dev\/nvme/, reason: "Writing directly to NVMe device" },
  { pattern: /mkfs\./, reason: "Creating filesystem (destroys existing data)" },
  { pattern: /dd\s+if=.*\s+of=\/dev\//, reason: "Writing raw data to disk via dd" },
  { pattern: /:\s*\(\)\s*\{/, reason: "Fork bomb pattern" },
  { pattern: />\s*\/etc\/(shadow|passwd|sudoers)/, reason: "Writing to critical auth files" },
  { pattern: /chmod\s+(-R\s+)?777\s+\//, reason: "Making root world-writable" },
  { pattern: />\s*\/boot\//, reason: "Writing to /boot (kernel/bootloader area)" },
  { pattern: /crontab\s+-r/, reason: "Removing all crontab entries" },
  // Pipe-to-shell — spans segments, always blocked at full-command level
  { pattern: /curl.*\|\s*(ba)?sh/, reason: "Piping curl into shell (RCE)" },
  { pattern: /wget.*\|\s*(ba)?sh/, reason: "Piping wget into shell (RCE)" },
  { pattern: /bash\s+-i\s*>&\s*\/dev\/tcp/, reason: "Interactive reverse shell" },
  { pattern: /nc\s+.*-[eL]\s/, reason: "Netcat with execute/listen flag (backdoor)" },
  { pattern: /source\s+\/dev\/tcp\//, reason: "Reverse shell via /dev/tcp" },
  { pattern: />\s*~\/\.ssh\//, reason: "Writing to SSH directory" },
];

// ---------------------------------------------------------------------------
// Layer 3: Dangerous patterns — applied per segment
// ---------------------------------------------------------------------------

export interface DangerousPattern {
  pattern: RegExp;
  reason: string;
  severity: SafetySeverity;
}

export const DANGEROUS_PATTERNS: DangerousPattern[] = [
  // ---- destructive filesystem ----
  {
    pattern: /rm\s+(-[rRf]+\s*)+/,
    reason: "Recursive/force delete (rm with -r/-f)",
    severity: "dangerous",
  },
  { pattern: /rmdir\s+/, reason: "Removing directories", severity: "caution" },

  // ---- destructive git ----
  {
    pattern: /git\s+(push\s+(-f|--force)|reset\s+--hard|checkout\s+--\s+|clean\s+-[fdx]|rebase\s+--abort)/,
    reason: "Destructive git operation (force push, hard reset, clean)",
    severity: "dangerous",
  },
  {
    pattern: /git\s+push\s+--delete\s+origin/,
    reason: "Deleting remote branch",
    severity: "dangerous",
  },
  {
    pattern: /git\s+push\s+--force-with-lease/,
    reason: "Force push (force-with-lease)",
    severity: "caution",
  },

  // ---- privilege escalation ----
  { pattern: /\bsudo\b/, reason: "Privilege escalation (sudo)", severity: "dangerous" },
  { pattern: /\bsu\s+-/, reason: "Switch user (su)", severity: "dangerous" },
  { pattern: /\bdoas\b/, reason: "Privilege escalation (doas)", severity: "dangerous" },

  // ---- permissions ----
  {
    pattern: /chmod\s+.*[0-7]*7[0-7]*[0-7]/,
    reason: "Setting world-accessible permissions",
    severity: "dangerous",
  },
  {
    pattern: /chown\s+-R\s*[^\s]+\s+\//,
    reason: "Recursive chown on root directory",
    severity: "dangerous",
  },

  // ---- eval / dynamic execution ----
  { pattern: /\beval\b/, reason: "eval with dynamic input", severity: "dangerous" },
  // Note: pipe-to-shell and reverse shell patterns are in BLOCKED_PATTERNS (Layer 1)

  // ---- destructive container/cloud ops ----
  {
    pattern: /docker\s+(rm|system\s+prune|volume\s+rm|container\s+rm)/,
    reason: "Destructive Docker operation",
    severity: "dangerous",
  },
  {
    pattern: /kubectl\s+delete\s+(ns|namespace|pvc|cluster)/,
    reason: "Deleting Kubernetes namespace/PVC/cluster",
    severity: "dangerous",
  },
  {
    pattern: /terraform\s+(destroy|apply\s+-destroy)/,
    reason: "Terraform destroy",
    severity: "dangerous",
  },
  {
    pattern: /aws\s+(s3\s+rb|ec2\s+terminate-instances|rds\s+delete)/,
    reason: "Destructive AWS operation",
    severity: "dangerous",
  },

  // ---- system state ----
  {
    pattern: /\b(shutdown|reboot|halt|poweroff)\b/,
    reason: "System shutdown/reboot",
    severity: "dangerous",
  },
  {
    pattern: /\b(killall|pkill)\b/,
    reason: "Terminating processes by name",
    severity: "caution",
  },

  // ---- package registries ----
  {
    pattern: /npm\s+unpublish/,
    reason: "Unpublishing npm package",
    severity: "dangerous",
  },
  {
    pattern: /git\s+push\s+--delete/,
    reason: "Deleting remote branch or tag",
    severity: "dangerous",
  },

  // ---- sensitive file writes ----
  {
    pattern: />\s*(\.env|credentials|secrets?\.(json|yml|yaml|toml)|\.gitconfig|\.npmrc)/,
    reason: "Writing to sensitive config file",
    severity: "caution",
  },
  {
    pattern: />\s*\/etc\/[^\s]+/,
    reason: "Writing to /etc directory",
    severity: "dangerous",
  },
];

// ---------------------------------------------------------------------------
// Layer 5: Dangerous paths for redirect targets
// ---------------------------------------------------------------------------

export interface DangerousPath {
  pattern: RegExp;
  reason: string;
}

export const DANGEROUS_REDIRECT_PATHS: DangerousPath[] = [
  { pattern: /^\/dev\/(sd|nvme|hd|vd|xd)/, reason: "Writing to block device" },
  {
    pattern: /^\/etc\/(shadow|passwd|sudoers|group|hosts)/,
    reason: "Writing to critical system file",
  },
  { pattern: /^\/boot\//, reason: "Writing to boot partition" },
  { pattern: /\/\.ssh\//, reason: "Writing to SSH config" },
  { pattern: /\/\.gnupg\//, reason: "Writing to GPG keyring" },
  { pattern: /\/\.aws\/(credentials|config)/, reason: "Writing to AWS credentials" },
  { pattern: /\/\.kube\/(config)/, reason: "Writing to Kubernetes config" },
];

// ---------------------------------------------------------------------------
// Layer 6: Default permission rules (wildcard-based)
// ---------------------------------------------------------------------------

export const DEFAULT_PERMISSION_RULES: PermissionRule[] = [
  // Safe read-only
  { pattern: "ls", action: "allow", description: "List directory" },
  { pattern: "pwd", action: "allow", description: "Print working directory" },
  { pattern: "cd", action: "allow", description: "Change directory" },
  { pattern: "echo", action: "allow", description: "Print text" },
  { pattern: "cat", action: "allow", description: "Concatenate files" },
  { pattern: "head", action: "allow", description: "Show file head" },
  { pattern: "tail", action: "allow", description: "Show file tail" },
  { pattern: "grep", action: "allow", description: "Search text" },
  { pattern: "find", action: "allow", description: "Find files" },
  { pattern: "wc", action: "allow", description: "Word count" },
  { pattern: "sort", action: "allow", description: "Sort lines" },
  { pattern: "uniq", action: "allow", description: "Unique lines" },
  { pattern: "cut", action: "allow", description: "Cut columns" },
  { pattern: "tr", action: "allow", description: "Translate characters" },
  { pattern: "date", action: "allow", description: "Show date" },
  { pattern: "which", action: "allow", description: "Locate command" },
  { pattern: "whoami", action: "allow", description: "Show user" },
  { pattern: "hostname", action: "allow", description: "Show hostname" },
  { pattern: "uname", action: "allow", description: "System info" },
  { pattern: "env", action: "allow", description: "Show environment" },
  { pattern: "file", action: "allow", description: "Detect file type" },
  { pattern: "stat", action: "allow", description: "File status" },
  { pattern: "man", action: "allow", description: "Manual pages" },

  // Git read — allowed
  { pattern: "git status", action: "allow", description: "Git status" },
  { pattern: "git diff", action: "allow", description: "Git diff" },
  { pattern: "git log", action: "allow", description: "Git log" },
  { pattern: "git branch", action: "allow", description: "Git branch list" },
  { pattern: "git show", action: "allow", description: "Git show" },
  { pattern: "git stash list", action: "allow", description: "Git stash list" },

  // Git write — confirm
  { pattern: "git commit", action: "ask", description: "Git commit" },
  { pattern: "git add *", action: "allow", description: "Git stage" },
  { pattern: "git checkout", action: "ask", description: "Git checkout" },
  { pattern: "git merge", action: "ask", description: "Git merge" },
  { pattern: "git rebase", action: "ask", description: "Git rebase" },
  { pattern: "git reset --soft", action: "ask", description: "Git soft reset" },

  // Package managers
  { pattern: "npm install *", action: "allow", description: "npm install" },
  { pattern: "npm test", action: "allow", description: "npm test" },
  { pattern: "npm run *", action: "allow", description: "npm run" },
  { pattern: "yarn add *", action: "allow", description: "yarn add" },
  { pattern: "pnpm install *", action: "allow", description: "pnpm install" },

  // Build tools
  { pattern: "make", action: "allow", description: "Make" },
  { pattern: "cargo build", action: "allow", description: "Cargo build" },
  { pattern: "cargo test", action: "allow", description: "Cargo test" },
  { pattern: "cargo check", action: "allow", description: "Cargo check" },
  { pattern: "go build", action: "allow", description: "Go build" },
  { pattern: "go test", action: "allow", description: "Go test" },
  { pattern: "tsc", action: "allow", description: "TypeScript compiler" },
  { pattern: "node", action: "allow", description: "Node.js runtime" },

  // Always denied
  { pattern: "rm -rf /", action: "deny", description: "Delete root" },
  { pattern: "dd if=* of=/dev/*", action: "deny", description: "Raw disk write" },
];

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Match a wildcard pattern (with * and ?) against a string.
 */
export function matchWildcard(pattern: string, input: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regexStr}$`, "i").test(input);
}
