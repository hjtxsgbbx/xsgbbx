import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import { type OS, type Terminal, type PlatformInfo } from "../types/index.js";

let cachedPlatform: PlatformInfo | null = null;

export function detectPlatform(): PlatformInfo {
  if (cachedPlatform) return cachedPlatform;

  const platform = os.platform();
  let osType: OS;
  if (platform === "win32") {
    osType = "windows";
  } else if (platform === "darwin") {
    osType = "macos";
  } else {
    osType = "linux";
  }

  const terminal = detectTerminal();
  const shell = detectShell(osType);

  cachedPlatform = {
    os: osType,
    terminal,
    shell,
    isElevated: detectElevation(osType),
    homeDir: getHomeDir(osType),
    tempDir: getTempDir(osType),
    nodeVersion: process.version,
    arch: os.arch(),
  };

  return cachedPlatform;
}

function detectTerminal(): Terminal {
  const term = (process.env.TERM || "").toLowerCase();
  const termProgram = (process.env.TERM_PROGRAM || "").toLowerCase();
  const shellPath = (process.env.SHELL || process.env.COMSPEC || "").toLowerCase();

  if (process.platform === "win32") {
    if (shellPath.includes("powershell") || process.env.PSModulePath) {
      const psVersion = detectPSVersion();
      return psVersion >= 7 ? "powershell_7" : "powershell_5";
    }
    if (shellPath.includes("bash")) return "git_bash";
    if (process.env.WT_SESSION) return "windows_terminal";
    return "cmd";
  }

  if (process.platform === "darwin") {
    if (termProgram.includes("iterm")) return "iterm2";
    return "terminal_app";
  }

  if (term.includes("konsole")) return "konsole";
  return "gnome_terminal";
}

function detectPSVersion(): number {
  try {
    const output = process.env.PSVersionTable
      ? JSON.parse(process.env.PSVersionTable)
      : {};
    return output.PSVersion?.Major || 5;
  } catch {
    return 5;
  }
}

function detectShell(osType: OS): string {
  if (osType === "windows") {
    const comspec = process.env.COMSPEC || "cmd.exe";
    if (comspec.toLowerCase().includes("powershell")) return "powershell";
    return "cmd";
  }
  return process.env.SHELL || "/bin/bash";
}

function detectElevation(osType: OS): boolean {
  if (osType === "windows") {
    try {
      execSync("net session", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
  return process.getuid?.() === 0;
}

function getHomeDir(osType: OS): string {
  if (osType === "windows") {
    return process.env.USERPROFILE || os.homedir();
  }
  return process.env.HOME || os.homedir();
}

function getTempDir(osType: OS): string {
  if (osType === "windows") {
    return process.env.TEMP || path.join(os.tmpdir(), "agent_1");
  }
  return process.env.TMPDIR || "/tmp";
}

let cachedAgentDir: string | null = null;

export function getAgentDir(): string {
  if (cachedAgentDir) return cachedAgentDir;
  const platform = detectPlatform();
  cachedAgentDir = path.join(platform.homeDir, ".agent_1");
  return cachedAgentDir;
}