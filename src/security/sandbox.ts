import { ExecutionContext, ToolCall } from "../types/index.js";

export type SandboxMode = "off" | "readonly" | "workspace" | "full";

export interface SandboxOptions {
  mode: SandboxMode;
  workspaceDir?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

const DEFAULT_OPTIONS: SandboxOptions = {
  mode: "off",
  timeoutMs: 120000,
  maxOutputBytes: 1024 * 1024,
};

const BLOCKED_IN_READONLY = [
  /rm\s/i, /del\s/i, /erase\s/i,
  /mv\s/i, /move\s/i, /rename\s/i,
  />\s*\S/i, />>\s*\S/i,
  /tee\s/i, /dd\s/i,
  /npm\s+install/i, /yarn\s+add/i, /pnpm\s+add/i,
  /pip\s+install/i, /cargo\s+install/i, /go\s+get/i,
  /chmod\s/i, /chown\s/i, /attrib\s/i,
  /format\s/i, /mkfs/i, /diskpart/i,
];

const BLOCKED_IN_WORKSPACE = [
  /rm\s+-rf\s+\/[^a-z]/i,
  /del\s+\/f\s+\/[A-Z]:\\/i,
  /sudo\s/i, /su\s/i,
  /shutdown\s/i, /reboot\s/i, /restart\s/i,
  /docker\s/i, /systemctl\s/i, /service\s/i,
  /mount\s/i, /umount\s/i,
  /iptables\s/i, /netsh\s/i, /firewall/i,
  /crontab\s/i, /schtasks\s/i, /at\s/i,
  /adduser\s/i, /useradd\s/i, /usermod\s/i, /net\s+user/i,
];

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

    if (isQuickCommand(trimmed)) {
      return 10000;
    }

    if (isBuildCommand(trimmed)) {
      return 300000;
    }

    if (isInstallCommand(trimmed)) {
      return 180000;
    }

    if (isTestCommand(trimmed)) {
      return 300000;
    }

    return this.options.timeoutMs;
  }

  validateCommand(command: string, toolCall: ToolCall): { allowed: boolean; reason?: string } {
    if (this.options.mode === "off" || this.options.mode === "full") {
      return { allowed: true };
    }

    const trimmed = command.trim();
    if (!trimmed) return { allowed: true };

    if (this.options.mode === "readonly") {
      for (const pattern of BLOCKED_IN_READONLY) {
        if (pattern.test(trimmed)) {
          return {
            allowed: false,
            reason: `Read-only sandbox: blocked command matching "${pattern.source}"`,
          };
        }
      }
    }

    if (this.options.mode === "workspace") {
      for (const pattern of BLOCKED_IN_WORKSPACE) {
        if (pattern.test(trimmed)) {
          return {
            allowed: false,
            reason: `Workspace sandbox: blocked command matching "${pattern.source}"`,
          };
        }
      }

      for (const pattern of BLOCKED_IN_READONLY.slice(0, -4)) {
        if (pattern.test(trimmed)) {
          if (this.options.workspaceDir) {
            const includesWorkspace = trimmed.includes(this.options.workspaceDir);
            if (!includesWorkspace) {
              return {
                allowed: false,
                reason: `Workspace sandbox: destructive operation outside workspace`,
              };
            }
          }
        }
      }
    }

    return { allowed: true };
  }

  wrapCommand(command: string): string {
    if (this.options.mode === "off") return command;

    let wrapped = command;

    if (this.options.timeoutMs > 0) {
      if (process.platform === "win32") {
        wrapped = `powershell -Command "& { $job = Start-Job -ScriptBlock { ${wrapped} }; Wait-Job $job -Timeout ${Math.floor(this.options.timeoutMs / 1000)}; Stop-Job $job; Receive-Job $job; Remove-Job $job }"`;
      } else {
        wrapped = `timeout ${Math.floor(this.options.timeoutMs / 1000)} ${wrapped}`;
      }
    }

    return wrapped;
  }

  getOptions(): SandboxOptions {
    return { ...this.options };
  }
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