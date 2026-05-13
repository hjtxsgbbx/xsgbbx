import { exec, execSync, spawn } from "child_process";
import * as path from "path";
import { PlatformInfo, CommandAdapterResult } from "../types/index.js";

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
  let subCommandCount = countSubCommands(command);

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

  if (subCommandCount > 50) {
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
  return command;
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
      timeout: options?.timeout || 300000,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > 8000) {
        stdout = stdout.slice(0, 4000) + "\n...(truncated)...\n" + stdout.slice(-4000);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > 8000) {
        stderr = stderr.slice(0, 4000) + "\n...(truncated)...\n" + stderr.slice(-4000);
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
  const shellCmd = `"${adapted.shell}" ${adapted.args.map((a) => `"${a}"`).join(" ")}`;

  try {
    const result = execSync(shellCmd, {
      cwd: options?.cwd || process.cwd(),
      encoding: "utf-8",
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
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

export function sanitizeShellArg(arg: string): string {
  if (!arg || arg.length === 0) return arg;

  if (arg.length > 256) {
    arg = arg.slice(0, 256);
  }

  const dangerous = /[;&|`$(){}\[\]<>\\!"'\n\r\t]/g;
  if (dangerous.test(arg)) {
    arg = arg.replace(dangerous, "");
  }

  arg = arg.replace(/--/g, "").replace(/\/\//g, "/");

  return arg.trim();
}

export function validateShellCommand(command: string): { valid: boolean; reason?: string } {
  if (!command || command.trim().length === 0) {
    return { valid: false, reason: "Empty command" };
  }

  if (command.length > 4096) {
    return { valid: false, reason: "Command exceeds 4096 character limit" };
  }

  const shellInjectionPatterns = [
    /\$\{/,
    /\$\(/,
    /`[^`]*`/,
    /;\s*(rm|sudo|chmod|format|del)/i,
    /\|\s*(rm|sudo|shutdown)/i,
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
        timeout: 5000,
        windowsHide: true,
      });
      return result.trim().length > 0 && result.toLowerCase().includes(sanitized.toLowerCase());
    } else {
      const result = execSync(`which ${sanitized}`, {
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 3000,
      });
      return result.trim().length > 0;
    }
  } catch {
    return false;
  }
}