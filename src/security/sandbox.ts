import type { ToolCall } from "../types/index.js";

export type SandboxMode = "off" | "readonly" | "workspace" | "full";

export interface SandboxOptions {
  mode: SandboxMode;
  workspaceDir?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

const DEFAULT_OPTIONS: SandboxOptions = {
  mode: "off",
  timeoutMs: 120_000,
  maxOutputBytes: 1024 * 1024,
};

const TIMEOUT_QUICK = 10_000;
const TIMEOUT_BUILD = 300_000;
const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_TEST = 300_000;

const BLOCKED_IN_READONLY: RegExp[] = [
  /\brm\s/i, /\bdel\s/i, /\berase\s/i,
  /\bmv\s/i, /\bmove\s/i, /\brename\s/i,
  />\s*\S/i, />>\s*\S/i,
  /\btee\s/i, /\bdd\s/i,
  /\bnpm\s+install/i, /\byarn\s+add/i, /\bpnpm\s+add/i,
  /\bpip\s+install/i, /\bcargo\s+install/i, /\bgo\s+get/i,
  /\bchmod\s/i, /\bchown\s/i, /\battrib\s/i,
  /\bformat\s/i, /\bmkfs/i, /\bdiskpart/i,
];

const BLOCKED_IN_WORKSPACE: RegExp[] = [
  /\brm\s+-rf\s+\/[^a-z]/i,
  /\bdel\s+\/f\s+\/[A-Z]:\\/i,
  /\bsudo\s/i, /\bsu\s/i,
  /\bshutdown\s/i, /\breboot\s/i, /\brestart\s/i,
  /\bdocker\s/i, /\bsystemctl\s/i, /\bservice\s/i,
  /\bmount\s/i, /\bumount\s/i,
  /\biptables\s/i, /\bnetsh\s/i, /\bfirewall/i,
  /\bcrontab\s/i, /\bschtasks\s/i, /\bat\s/i,
  /\badduser\s/i, /\buseradd\s/i, /\busermod\s/i, /\bnet\s+user/i,
];

const DESTRUCTIVE_READONLY_PATTERNS = BLOCKED_IN_READONLY.slice(0, -4);

export class SandboxExecutor {
  private options: SandboxOptions;

  constructor(options?: Partial<SandboxOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    const envMode = process.env.AGENT_1_SANDBOX_MODE as SandboxMode | undefined;
    if (envMode && ["off", "readonly", "workspace", "full"].includes(envMode)) {
      this.options.mode = envMode;
    }
  }

  setMode(mode: SandboxMode): void {
    this.options.mode = mode;
  }

  getMode(): SandboxMode {
    return this.options.mode;
  }

  getTieredTimeout(command: string): number {
    const trimmed = command.trim().toLowerCase();

    if (isQuickCommand(trimmed)) return TIMEOUT_QUICK;
    if (isBuildCommand(trimmed)) return TIMEOUT_BUILD;
    if (isInstallCommand(trimmed)) return TIMEOUT_INSTALL;
    if (isTestCommand(trimmed)) return TIMEOUT_TEST;

    return this.options.timeoutMs;
  }

  validateCommand(command: string, _toolCall: ToolCall): { allowed: boolean; reason?: string } {
    if (this.options.mode === "off" || this.options.mode === "full") {
      return { allowed: true };
    }

    const trimmed = command.trim();
    if (!trimmed) return { allowed: true };

    const normalized = normalizeCommand(trimmed);

    if (this.options.mode === "readonly") {
      return this.validateReadOnly(normalized);
    }

    if (this.options.mode === "workspace") {
      return this.validateWorkspace(normalized, trimmed);
    }

    return { allowed: true };
  }

  private validateReadOnly(normalized: string): { allowed: boolean; reason?: string } {
    for (const pattern of BLOCKED_IN_READONLY) {
      if (pattern.test(normalized)) {
        return {
          allowed: false,
          reason: `Read-only sandbox: blocked command matching "${pattern.source}"`,
        };
      }
    }
    return { allowed: true };
  }

  private validateWorkspace(normalized: string, original: string): { allowed: boolean; reason?: string } {
    for (const pattern of BLOCKED_IN_WORKSPACE) {
      if (pattern.test(normalized)) {
        return {
          allowed: false,
          reason: `Workspace sandbox: blocked command matching "${pattern.source}"`,
        };
      }
    }

    for (const pattern of DESTRUCTIVE_READONLY_PATTERNS) {
      if (pattern.test(normalized)) {
        if (this.options.workspaceDir) {
          const includesWorkspace = original.includes(this.options.workspaceDir);
          if (!includesWorkspace) {
            return {
              allowed: false,
              reason: `Workspace sandbox: destructive operation outside workspace`,
            };
          }
        }
      }
    }

    return { allowed: true };
  }

  wrapCommand(command: string): string {
    if (this.options.mode === "off") return command;

    if (this.options.timeoutMs > 0) {
      const timeoutSec = Math.floor(this.options.timeoutMs / 1000);
      if (process.platform === "win32") {
        const escaped = command.replace(/'/g, "''");
        return `powershell -NoProfile -NonInteractive -Command "& { $job = Start-Job -ScriptBlock { ${escaped} }; Wait-Job $job -Timeout ${timeoutSec}; Stop-Job $job; Receive-Job $job; Remove-Job $job }"`;
      } else {
        return `timeout ${timeoutSec} -- ${command}`;
      }
    }

    return command;
  }

  getOptions(): SandboxOptions {
    return { ...this.options };
  }
}

function normalizeCommand(command: string): string {
  return command
    .replace(/''/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\$/g, "$")
    .replace(/\s+/g, " ");
}

export const sandbox = new SandboxExecutor();

const QUICK_COMMANDS = new Set([
  "echo", "cat", "head", "tail", "ls", "dir", "pwd", "cd", "touch",
  "mkdir", "cp", "mv", "rm", "grep", "find", "wc", "sort", "uniq",
  "clear", "date", "whoami", "hostname", "uname", "env", "printenv",
  "which", "where", "type", "basename", "dirname", "realpath",
  "git status", "git log", "git diff", "git show", "git branch",
]);

function isQuickCommand(command: string): boolean {
  for (const qc of QUICK_COMMANDS) {
    if (command === qc || command.startsWith(qc + " ")) return true;
  }
  return /^(echo|cat|head|tail|ls|dir|pwd|cd|touch|mkdir|cp|mv|rm|grep|find|wc|sort|uniq|clear|date|whoami|hostname|uname|env|which|where)\b/.test(command);
}

function isBuildCommand(command: string): boolean {
  return /\b(npm run build|yarn build|pnpm build|tsc|webpack|vite build|cargo build|go build|make|cmake|gradle|mvn|dotnet build)\b/.test(command);
}

function isInstallCommand(command: string): boolean {
  return /\b(npm install|yarn add|pnpm add|pip install|cargo install|go get|apt-get|brew|apk add|pacman)\b/.test(command);
}

function isTestCommand(command: string): boolean {
  return /\b(npm test|yarn test|pnpm test|pytest|cargo test|go test|jest|vitest|mocha|rspec|phpunit)\b/.test(command);
}
