/**
 * Write Protection — filesystem write guard for sandboxed commands.
 *
 * Validates whether a target path can be written to, checking against
 * protected system directories. Integrates with the existing path-guard.ts
 * module for workspace containment.
 *
 * All functions are PURE: inputs are readonly, outputs are new objects.
 */

import * as path from "path";
import { isInWorkspace, resolveSafePath } from "./path-guard.js";
import { detectPlatform } from "../pal/sys.js";
import { debug } from "../observability/debug.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WriteGuard {
  readonly workspaceRoot: string;
  /** Check if a given path can be written to */
  canWrite(targetPath: string): boolean;
  /** Check if a path is within the workspace */
  isPathInWorkspace(targetPath: string): boolean;
  /** Get all protected paths */
  getProtectedPaths(): readonly string[];
}

export interface WriteCheckResult {
  readonly allowed: boolean;
  readonly path: string;
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Platform-specific protected paths
// ---------------------------------------------------------------------------

const WINDOWS_PROTECTED_PATHS: readonly string[] = [
  "C:\\Windows",
  "C:\\Windows\\System32",
  "C:\\Windows\\SysWOW64",
  "C:\\Windows\\System",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
  "C:\\ProgramData",
  "C:\\Users\\All Users",
  "C:\\$Recycle.Bin",
  "C:\\System Volume Information",
  "C:\\Boot",
  "C:\\Recovery",
];

const LINUX_PROTECTED_PATHS: readonly string[] = [
  "/etc",
  "/proc",
  "/sys",
  "/dev",
  "/boot",
  "/lib",
  "/lib64",
  "/usr/lib",
  "/usr/lib64",
  "/usr/libexec",
  "/usr/include",
  "/usr/share",
  "/usr/bin",
  "/usr/sbin",
  "/bin",
  "/sbin",
  "/root",
  "/var/log",
  "/var/run",
  "/var/lock",
  "/run",
];

// Subdirectories of workspace that should still be read-only
const WORKSPACE_READONLY_SUBDIRS: readonly string[] = [
  ".git",
  ".svn",
  ".hg",
  "node_modules",
];

// Files outside workspace that are always protected
const PROTECTED_DOTFILES: readonly string[] = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".config/gcloud",
  ".docker",
  ".kube",
  ".bashrc",
  ".bash_profile",
  ".zshrc",
  ".profile",
  ".gitconfig",
  ".npmrc",
  ".pypirc",
];

// ---------------------------------------------------------------------------
// Path normalizer
// ---------------------------------------------------------------------------

function normalizePath(input: string): string {
  return path.normalize(input).toLowerCase();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a write guard for a given workspace root.
 * Returns an immutable guard object with check methods.
 */
export function createWriteGuard(workspaceRoot: string): WriteGuard {
  const normalizedRoot = path.resolve(workspaceRoot);
  const platform = detectPlatform();
  const protectedPaths = platform.os === "windows"
    ? WINDOWS_PROTECTED_PATHS.map((p) => normalizePath(p))
    : LINUX_PROTECTED_PATHS.map((p) => normalizePath(p));

  debug.info("write-protection", `Write guard created for: ${normalizedRoot}`);

  return {
    workspaceRoot: normalizedRoot,

    canWrite(targetPath: string): boolean {
      return checkCanWrite(targetPath, normalizedRoot, protectedPaths).allowed;
    },

    isPathInWorkspace(targetPath: string): boolean {
      return isInWorkspace(targetPath, normalizedRoot);
    },

    getProtectedPaths(): readonly string[] {
      return protectedPaths;
    },
  };
}

/**
 * Check whether a target path can be written to.
 */
function checkCanWrite(
  targetPath: string,
  workspaceRoot: string,
  protectedPaths: readonly string[],
): WriteCheckResult {
  if (!targetPath || targetPath.trim().length === 0) {
    return { allowed: false, path: targetPath, reason: "Empty path" };
  }

  const normalized = normalizePath(path.resolve(targetPath));

  // 1. Check against protected system directories
  for (const protectedPath of protectedPaths) {
    if (normalized === protectedPath || normalized.startsWith(protectedPath + path.sep)) {
      return {
        allowed: false,
        path: targetPath,
        reason: `Protected system directory: ${protectedPath}`,
      };
    }
  }

  // 2. Check against workspace containment
  const workspaceCheck = resolveSafePath(targetPath, workspaceRoot);
  if (!workspaceCheck.safe) {
    return {
      allowed: false,
      path: targetPath,
      reason: workspaceCheck.reason || "Path outside workspace",
    };
  }

  // 3. Check for dotfile protection outside workspace home
  const platform = detectPlatform();
  const homeDir = normalizePath(platform.homeDir);
  const isInHome = normalized.startsWith(homeDir);
  const isInWorkspace = normalized.startsWith(normalizePath(workspaceRoot));

  if (isInHome && !isInWorkspace) {
    for (const dotfile of PROTECTED_DOTFILES) {
      const dotfilePath = normalizePath(path.join(homeDir, dotfile));
      if (normalized === dotfilePath || normalized.startsWith(dotfilePath + path.sep)) {
        return {
          allowed: false,
          path: targetPath,
          reason: `Protected dotfile outside workspace: ${dotfile}`,
        };
      }
    }
  }

  return { allowed: true, path: targetPath };
}

/**
 * Check if a path is within the workspace.
 * Thin wrapper over path-guard's isInWorkspace.
 */
export function isPathInWorkspace(targetPath: string, workspaceRoot: string): boolean {
  return isInWorkspace(targetPath, workspaceRoot);
}

/**
 * Check if a path is a system directory that should never be written to.
 */
export function isProtectedSystemPath(targetPath: string): boolean {
  const platform = detectPlatform();
  const normalized = normalizePath(path.resolve(targetPath));
  const protectedPaths = platform.os === "windows"
    ? WINDOWS_PROTECTED_PATHS.map((p) => normalizePath(p))
    : LINUX_PROTECTED_PATHS.map((p) => normalizePath(p));

  for (const protectedPath of protectedPaths) {
    if (normalized === protectedPath || normalized.startsWith(protectedPath + path.sep)) {
      return true;
    }
  }

  return false;
}

/**
 * Get the list of protected system paths for the current platform.
 */
export function getProtectedPaths(): readonly string[] {
  const platform = detectPlatform();
  return platform.os === "windows" ? WINDOWS_PROTECTED_PATHS : LINUX_PROTECTED_PATHS;
}

/**
 * Validate a write operation against the write guard.
 * Returns a detailed result with reason on denial.
 */
export function validateWrite(
  targetPath: string,
  writeGuard: WriteGuard,
): WriteCheckResult {
  if (!writeGuard.canWrite(targetPath)) {
    return {
      allowed: false,
      path: targetPath,
      reason: `Write denied by sandbox for path: ${targetPath}`,
    };
  }
  return { allowed: true, path: targetPath };
}
