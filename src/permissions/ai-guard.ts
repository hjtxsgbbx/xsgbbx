import { execSync, type ExecSyncOptions } from "child_process";
import type { PlatformInfo } from "../types/index.js";

const CONFIDENCE_THRESHOLD = 0.7;

const KNOWN_DANGEROUS_FLAGS: Record<string, string[]> = {
  rm: ["-rf", "-r", "-f", "--recursive", "--force"],
  del: ["/F", "/S", "/Q"],
  chmod: ["777", "7777"],
  npm: [],
  git: ["push --force", "--force"],
};

export interface AIGuardResult {
  passed: boolean;
  confidence: number;
  reason?: string;
  requireConfirmation: boolean;
}

export class AIGuard {
  private platform: PlatformInfo;

  constructor(platform: PlatformInfo) {
    this.platform = platform;
  }

  validateShellCommand(command: string): AIGuardResult {
    if (!command || command.trim().length === 0) {
      return { passed: true, confidence: 1.0, requireConfirmation: false };
    }

    const mainCmd = extractMainCommand(command);
    const args = extractArgs(command);
    let confidence = 0.85;

    const exists = this.commandExists(mainCmd);
    if (!exists) {
      confidence -= 0.4;
    }

    const dangerFlags = this.checkDangerousFlags(mainCmd, args);
    if (dangerFlags) {
      confidence -= 0.3;
    }

    const hasUnsafeFlags = this.hasUnsafeCombinations(mainCmd, args);
    if (hasUnsafeFlags) {
      confidence -= 0.25;
    }

    if (command.includes("..") && (command.includes("/") || command.includes("\\"))) {
      confidence -= 0.15;
    }

    if (command.includes("sudo") || command.includes("runas")) {
      confidence -= 0.2;
    }

    confidence = Math.max(0, Math.min(1, confidence));

    const reasons: string[] = [];
    if (!exists) reasons.push(`Unknown command: "${mainCmd}"`);
    if (dangerFlags) reasons.push(`Dangerous flags: ${dangerFlags}`);
    if (hasUnsafeFlags) reasons.push(`Unsafe flag combination for "${mainCmd}"`);

    return {
      passed: confidence >= CONFIDENCE_THRESHOLD,
      confidence,
      reason: reasons.length > 0 ? reasons.join("; ") : undefined,
      requireConfirmation: confidence < CONFIDENCE_THRESHOLD,
    };
  }

  commandExists(command: string): boolean {
    if (!command || command.trim().length === 0) return false;

    const safeCommand = /^[a-zA-Z0-9._-]+$/.test(command) ? command : "";
    if (!safeCommand) return false;

    try {
      const opts: ExecSyncOptions = {
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 3000,
      };

      if (this.platform.os === "windows") {
        const shell = this.platform.terminal || "";
        if (shell.toLowerCase().includes("powershell") || shell.toLowerCase().includes("pwsh")) {
          execSync(`cmd /c "where ${safeCommand} 2>nul"`, opts);
        } else {
          execSync(`where ${safeCommand} 2>nul`, opts);
        }
      } else {
        execSync(`which ${safeCommand} 2>/dev/null`, opts);
      }
      return true;
    } catch {
      return false;
    }
  }

  private checkDangerousFlags(command: string, args: string[]): string | null {
    const knownFlags = KNOWN_DANGEROUS_FLAGS[command];
    if (!knownFlags || knownFlags.length === 0) return null;

    const fullArgs = args.join(" ");
    for (const flag of knownFlags) {
      if (fullArgs.includes(flag)) {
        return flag;
      }
    }

    return null;
  }

  private hasUnsafeCombinations(command: string, args: string[]): boolean {
    if (command === "rm" || command === "rmdir" || command === "del") {
      const fullArgs = args.join(" ");
      if (
        fullArgs.includes("*") ||
        fullArgs.includes("/s") ||
        fullArgs.includes("/S") ||
        fullArgs.includes("/q") ||
        fullArgs.includes("/Q")
      ) {
        return true;
      }
    }

    if (command === "mv" || command === "move") {
      const destPaths = args.filter(
        (a) =>
          a.startsWith("/") ||
          a.startsWith("C:\\") ||
          a.startsWith("\\") ||
          a.includes("..")
      );
      if (destPaths.length > 0) return true;
    }

    return false;
  }

  detectFrustration(output: string): boolean {
    const frustrationPatterns = [
      /I('m| am) (sorry|frustrated|stuck|confused|giving up)/i,
      /I can('t|not) (continue|proceed|do this|help)/i,
      /This (task|request) (is|seems) (impossible|too complex|beyond)/i,
      /I('ve| have) (tried|attempted) (everything|multiple times)/i,
      /Perhaps (you|we) should/i,
      /It (might|may) be (better|easier) (to|for)/i,
      /I don('t| not) (think|believe|feel)/i,
    ];

    const matches = frustrationPatterns.filter((p) => p.test(output));
    return matches.length >= 2;
  }
}

function extractMainCommand(command: string): string {
  const trimmed = command.trim();

  if (!trimmed) return "";

  const parts = trimmed
    .split(" ")
    .filter((p) => !p.startsWith("-") && !p.startsWith("--"));

  if (parts.length === 0) return "";

  const cmd = parts[0];

  const isWindows = process.platform === "win32";
  if (isWindows) {
    const lastSlash = cmd.lastIndexOf("\\");
    const lastFwdSlash = cmd.lastIndexOf("/");
    const lastSep = Math.max(lastSlash, lastFwdSlash);
    if (lastSep >= 0) {
      return cmd.slice(lastSep + 1).replace(/\.(exe|bat|cmd|ps1)$/i, "");
    }
    return cmd.replace(/\.(exe|bat|cmd|ps1)$/i, "");
  }

  const lastSlash = cmd.lastIndexOf("/");
  if (lastSlash >= 0) {
    return cmd.slice(lastSlash + 1);
  }

  return cmd;
}

function extractArgs(command: string): string[] {
  const trimmed = command.trim();
  if (!trimmed) return [];

  const parts = trimmed.split(" ");
  if (parts.length <= 1) return [];

  return parts.slice(1);
}
