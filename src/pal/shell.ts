import { execSync, spawn } from "child_process";
import type { PlatformInfo, CommandAdapterResult } from "../types/index.js";

const TIMEOUT_DEFAULT = 300_000;
const TIMEOUT_COMMAND_EXISTS = 5_000;
const TIMEOUT_COMMAND_EXISTS_UNIX = 3_000;
const MAX_BUFFER = 10 * 1024 * 1024;
const OUTPUT_TRUNCATE_THRESHOLD = 8_000;
const OUTPUT_SLICE_SIZE = 4_000;
const COMMAND_LENGTH_LIMIT = 4_096;
const ARG_LENGTH_LIMIT = 256;
const SUB_COMMAND_LIMIT = 50;

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function adaptCommand(
  command: string,
  platform: PlatformInfo
): CommandAdapterResult {
  const isWindows = platform.os === "windows";
  const isCmd = platform.terminal === "cmd";
  const isPowerShell =
    platform.terminal === "powershell_5" ||
    platform.terminal === "powershell_7";

  let adaptedCommand = command;
  let shell = platform.shell;
  let args: string[] = [];
  let safe = true;
  const subCommandCount = countSubCommands(command);

  if (isWindows && isCmd) {
    adaptedCommand = adaptForCmd(command);
    args = ["/c", adaptedCommand];
    shell = "cmd.exe";
  } else if (isWindows && isPowerShell) {
    adaptedCommand = adaptForPowerShell(command);
    args = [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      adaptedCommand,
    ];
    shell = "powershell.exe";
  } else {
    args = ["-c", adaptedCommand];
    shell = platform.shell || "/bin/bash";
  }

  if (subCommandCount > SUB_COMMAND_LIMIT) {
    safe = false;
  }

  return {
    command: adaptedCommand,
    shell,
    args,
    safe,
    subCommandCount,
  };
}

function adaptForCmd(command: string): string {
  let adapted = command;

  adapted = adapted.replace(/\$([A-Z_]+)/g, (_, varName) => `%${varName}%`);

  const driveLetterPattern = /([A-Z]:\\(?:Program Files(?: \(x86\))?|Users|Windows)[^&|><]*)/gi;
  adapted = adapted.replace(driveLetterPattern, (match) => `"${match}"`);

  return adapted;
}

function adaptForPowerShell(command: string): string {
  let adapted = command;

  // CMD → PowerShell redirection: 2>nul → 2>$null, >nul → >$null, 1>nul → 1>$null
  adapted = adapted.replace(/([12]?)\s*>\s*nul\b/gi, "$1>`$null");
  // Undo over-escape of $ when preceded by backtick
  adapted = adapted.replace(/``/g, "`");

  // CMD → PowerShell: nul → $null (standalone, not part of redirection)
  adapted = adapted.replace(/\bnul\b/g, "`$null");

  // Escaped dollar signs for PowerShell
  adapted = adapted.replace(/\$([A-Z_]+)/g, "`$$1");

  // CMD → PowerShell: && → ; (PowerShell uses ; not &&)
  adapted = adapted.replace(/&&/g, ";");

  if (!adapted.startsWith("&") && !adapted.startsWith(".") && adapted.includes(" ")) {
    const firstSpace = adapted.indexOf(" ");
    const cmd = adapted.slice(0, firstSpace);
    if (cmd.includes("-") || cmd.includes("/")) {
      adapted = `& ${adapted}`;
    }
  }

  return adapted;
}

function countSubCommands(command: string): number {
  const separators = command.match(/(\||&&|;)/g);
  return separators ? separators.length + 1 : 1;
}

export async function shellExec(
  command: string,
  platform: PlatformInfo,
  options?: { cwd?: string; timeout?: number }
): Promise<ShellResult> {
  const adapted = adaptCommand(command, platform);

  return new Promise((resolve) => {
    const child = spawn(adapted.shell, adapted.args, {
      cwd: options?.cwd || process.cwd(),
      timeout: options?.timeout || TIMEOUT_DEFAULT,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > OUTPUT_TRUNCATE_THRESHOLD) {
        stdout = truncateOutput(stdout);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > OUTPUT_TRUNCATE_THRESHOLD) {
        stderr = truncateOutput(stderr);
      }
    });

    child.on("close", (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
      });
    });

    child.on("error", (err) => {
      resolve({
        stdout: "",
        stderr: err.message,
        exitCode: 1,
      });
    });
  });
}

export function shellExecSync(
  command: string,
  platform: PlatformInfo,
  options?: { cwd?: string }
): ShellResult {
  const adapted = adaptCommand(command, platform);

  try {
    const result = execSync(adapted.command, {
      cwd: options?.cwd || process.cwd(),
      encoding: "utf-8",
      timeout: TIMEOUT_DEFAULT,
      maxBuffer: MAX_BUFFER,
      shell: adapted.shell,
    });
    return { stdout: result.trim(), stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string; status?: number };
    return {
      stdout: execErr.stdout?.trim() || "",
      stderr: execErr.stderr?.trim() || (err instanceof Error ? err.message : String(err)),
      exitCode: execErr.status ?? 1,
    };
  }
}

function truncateOutput(output: string): string {
  return output.slice(0, OUTPUT_SLICE_SIZE) + "\n...(truncated)...\n" + output.slice(-OUTPUT_SLICE_SIZE);
}

export function sanitizeShellArg(arg: string): string {
  if (!arg || arg.length === 0) return arg;

  if (arg.length > ARG_LENGTH_LIMIT) {
    arg = arg.slice(0, ARG_LENGTH_LIMIT);
  }

  const dangerous = /[;&|`$(){}[\]<>\\!"'\n\r\t]/g;
  if (dangerous.test(arg)) {
    arg = arg.replace(dangerous, "");
  }

  arg = arg.replace(/\/\//g, "/");

  return arg.trim();
}

export function validateShellCommand(command: string): { valid: boolean; reason?: string } {
  if (!command || command.trim().length === 0) {
    return { valid: false, reason: "Empty command" };
  }

  if (command.length > COMMAND_LENGTH_LIMIT) {
    return { valid: false, reason: `Command exceeds ${COMMAND_LENGTH_LIMIT} character limit` };
  }

  const shellInjectionPatterns = [
    /\$\{/,
    /\$\(/,
    /`[^`]*`/,
    /;\s*(rm|sudo|chmod|format|del)/i,
    /\|\s*(rm|sudo|shutdown)/i,
    /\\x[0-9a-fA-F]{2}/,
    /\\u[0-9a-fA-F]{4}/,
    /\\[0-7]{3}/,
  ];

  for (const pattern of shellInjectionPatterns) {
    if (pattern.test(command)) {
      return { valid: false, reason: `Suspicious shell pattern detected: ${pattern.source}` };
    }
  }

  return { valid: true };
}

export function commandExists(
  command: string,
  platform: PlatformInfo
): boolean {
  try {
    const sanitized = sanitizeShellArg(command);
    if (sanitized.length === 0) return false;

    if (platform.os === "windows") {
      const result = execSync(`where ${sanitized}`, {
        encoding: "utf-8",
        stdio: "pipe",
        timeout: TIMEOUT_COMMAND_EXISTS,
        windowsHide: true,
      });
      return result.trim().length > 0 && result.toLowerCase().includes(sanitized.toLowerCase());
    } else {
      const result = execSync(`which ${sanitized}`, {
        encoding: "utf-8",
        stdio: "pipe",
        timeout: TIMEOUT_COMMAND_EXISTS_UNIX,
      });
      return result.trim().length > 0;
    }
  } catch {
    return false;
  }
}
