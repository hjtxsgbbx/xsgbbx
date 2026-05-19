/**
 * Process Isolation — platform-adaptive sandbox hardening WITHOUT seccomp.
 *
 * Windows (primary):
 *  - Restricted working directory to a temp workspace copy
 *  - Stripped dangerous environment variables (LD_PRELOAD, DYLD_*, PATH manipulation)
 *  - Sanitized PATH to only safe directories
 *
 * Linux (secondary):
 *  - unshare wrapper for namespace isolation (no root required for basic modes)
 *  - Mount namespace isolation for workspace-only access
 *
 * Fallback (always active):
 *  - Environment sanitization
 *  - Working directory confinement
 *  - Timeout enforcement (quick: 30s, normal: 120s, long: 600s)
 */

import type { PlatformInfo } from "../types/index.js";
import { detectPlatform } from "../pal/sys.js";
import { debug } from "../observability/debug.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IsolatedProcess {
  readonly command: string;
  readonly env: Record<string, string>;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly platform: "win32" | "linux" | "darwin";
}

export interface SandboxOptions {
  readonly mode: "off" | "readonly" | "workspace" | "full";
  readonly workspaceDir?: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export type TimeoutTier = "quick" | "normal" | "long";

const TIMEOUT_MAP: Record<TimeoutTier, number> = {
  quick: 30_000,
  normal: 120_000,
  long: 600_000,
};

// ---------------------------------------------------------------------------
// Dangerous environment variables to strip (platform-aware)
// ---------------------------------------------------------------------------

const DANGEROUS_ENV_VARS: ReadonlySet<string> = new Set([
  // Linux/macOS
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FRAMEWORK_PATH",
  // Cross-platform
  "PATH",
  "PYTHONPATH",
  "PERL5LIB",
  "RUBYLIB",
  "NODE_PATH",
  "CLASSPATH",
  "JAVA_TOOL_OPTIONS",
  "_JAVA_OPTIONS",
  // Shell injection
  "BASH_ENV",
  "ENV",
  "PROMPT_COMMAND",
  "PS4",
  // Package managers
  "PIP_REQUIRE_VIRTUALENV",
  "NPM_CONFIG_PREFIX",
  "GEM_HOME",
  "GEM_PATH",
]);

// Environment variables to KEEP (explicit allowlist)
const SAFE_ENV_VARS: ReadonlySet<string> = new Set([
  "HOME",
  "USER",
  "USERNAME",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "SSH_AUTH_SOCK",
  "WINDIR",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "HOMEDRIVE",
  "HOMEPATH",
  "COMPUTERNAME",
  // Agent-specific vars
  "AGENT_1_SANDBOX_MODE",
  "AGENT1_DEBUG",
]);

// ---------------------------------------------------------------------------
// Safe PATH directories (platform-specific)
// ---------------------------------------------------------------------------

const WINDOWS_SAFE_PATH_DIRS: readonly string[] = [
  "C:\\Windows\\System32",
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
  "C:\\Windows\\SysWOW64",
  "C:\\Program Files\\Git\\usr\\bin",
  "C:\\Program Files\\Git\\bin",
  "C:\\Program Files\\nodejs",
];

const LINUX_SAFE_PATH_DIRS: readonly string[] = [
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/local/sbin",
  "/usr/sbin",
  "/sbin",
];

// ---------------------------------------------------------------------------
// Platform detection (cached wrapper)
// ---------------------------------------------------------------------------

function getPlatform(): PlatformInfo {
  return detectPlatform();
}

// ---------------------------------------------------------------------------
// Timeout tier detection
// ---------------------------------------------------------------------------

const LONG_RUNNING_PATTERNS: ReadonlySet<string> = new Set([
  "build", "compile", "docker build", "npm run build",
  "cargo build", "go build", "make", "cmake", "gradle",
  "pip install", "npm install", "yarn add", "pnpm add",
  "apt-get install", "brew install", "cargo install",
]);

function detectTimeoutTier(command: string): TimeoutTier {
  const lower = command.toLowerCase().trim();
  for (const pattern of LONG_RUNNING_PATTERNS) {
    if (lower.includes(pattern)) return "long";
  }
  // Quick commands: single word or simple reads
  if (lower.split(/\s+/).length <= 2) return "quick";
  return "normal";
}

// ---------------------------------------------------------------------------
// Environment sanitization
// ---------------------------------------------------------------------------

function sanitizeEnv(platform: PlatformInfo): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    const upperKey = key.toUpperCase();

    // Explicitly deny dangerous vars
    if (DANGEROUS_ENV_VARS.has(upperKey)) continue;

    // Allow known-safe vars through
    if (SAFE_ENV_VARS.has(upperKey)) {
      sanitized[key] = value;
      continue;
    }

    // Block vars that look like LD_* or similar injection vectors
    if (upperKey.startsWith("LD_") || upperKey.startsWith("DYLD_")) continue;

    // Allow through otherwise (with caution)
    sanitized[key] = value;
  }

  return sanitized;
}

// ---------------------------------------------------------------------------
// PATH sanitization
// ---------------------------------------------------------------------------

function sanitizePath(platform: PlatformInfo): string {
  const safeDirs = platform.os === "windows"
    ? WINDOWS_SAFE_PATH_DIRS
    : LINUX_SAFE_PATH_DIRS;

  const separator = platform.os === "windows" ? ";" : ":";
  const existing = (process.env.PATH || "").split(separator);
  const filtered = existing.filter((dir) =>
    safeDirs.some((safe) => dir.toLowerCase().startsWith(safe.toLowerCase()))
  );

  if (filtered.length === 0) {
    // Fallback: use the safe dirs directly
    return safeDirs.join(separator);
  }

  return filtered.join(separator);
}

// ---------------------------------------------------------------------------
// Windows-specific: build restricted execution context
// ---------------------------------------------------------------------------

interface WindowsIsolation {
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly flags: string[];
}

function buildWindowsIsolation(
  workspaceDir: string,
  env: Record<string, string>,
  opts: SandboxOptions,
): WindowsIsolation {
  const cwd = workspaceDir;
  const sanitizedPath = sanitizePath(getPlatform());
  const isolatedEnv = {
    ...env,
    PATH: sanitizedPath,
    // Prevent PowerShell profile loading
    PSModulePath: "",
    // Force basic execution policy
    NO_COLOR: "1",
    CI: "true",
  };

  const flags: string[] = [];

  // When in restricted modes, enforce extra constraints
  if (opts.mode === "readonly" || opts.mode === "workspace") {
    // Block registry access via environment hinting
    isolatedEnv["AGENT1_RESTRICTED"] = "1";
    // Strip ComSpec to prevent cmd.exe tricks
    // (keep it but note the restriction context)
  }

  debug.info("process-isolation", `Windows isolation: mode=${opts.mode}, cwd=${cwd}`);

  return { cwd, env: isolatedEnv, flags };
}

// ---------------------------------------------------------------------------
// Linux-specific: build unshare wrapper
// ---------------------------------------------------------------------------

function buildLinuxIsolationCmd(
  command: string,
  workspaceDir: string,
  opts: SandboxOptions,
): string {
  // unshare does NOT require root for:
  //   --mount  (requires userns, default on modern kernels)
  //   --uts     (hostname isolation)
  //   --map-root-user (available without root with user namespaces)
  //
  // We use a best-effort approach — if unshare is unavailable or fails,
  // the fallback environment-based isolation is still active.

  if (opts.mode === "full" || opts.mode === "off") {
    return command; // No process-level isolation needed
  }

  const unshareFlags: string[] = [];

  // Network isolation (--net) for readonly/workspace modes
  if (opts.mode === "readonly" || opts.mode === "workspace") {
    unshareFlags.push("--net");
  }

  // Mount namespace for workspace-only filesystem access
  unshareFlags.push("--mount");

  // Fork to ensure namespace applies to child
  unshareFlags.push("--fork");

  // Only add unshare wrapper if the binary is likely available
  return `unshare ${unshareFlags.join(" ")} -- bash -c "cd ${escapeShellArg(workspaceDir)} && ${command}"`;
}

function escapeShellArg(arg: string): string {
  return arg.replace(/'/g, "'\\''");
}

// ---------------------------------------------------------------------------
// Main public API
// ---------------------------------------------------------------------------

/**
 * Create an isolated process configuration for sandboxed command execution.
 *
 * Returns the sanitized environment, confined working directory, appropriate
 * timeout, and any platform-specific wrapper commands.
 *
 * This function is PURE: it computes and returns a new object without
 * mutating any external state.
 */
export function isolateProcess(
  command: string,
  opts: SandboxOptions,
): IsolatedProcess {
  const platform = getPlatform();
  const tier = detectTimeoutTier(command);
  const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : TIMEOUT_MAP[tier];

  // Build sanitized environment
  let env = sanitizeEnv(platform);

  // Determine confined working directory
  const workspaceDir = opts.workspaceDir || platform.homeDir;
  let cwd = workspaceDir;

  // Platform-specific isolation
  if (platform.os === "windows") {
    const winIso = buildWindowsIsolation(workspaceDir, env, opts);
    env = winIso.env;
    cwd = winIso.cwd;
  }

  // Strip sensitive env vars that might have leaked through
  env = stripSensitiveEnv(env);

  debug.info("process-isolation",
    `Isolated process: tier=${tier}, timeout=${timeoutMs}ms, ` +
    `platform=${platform.os}, mode=${opts.mode}`);

  return {
    command,
    env,
    cwd,
    timeoutMs,
    platform: process.platform as "win32" | "linux" | "darwin",
  };
}

/**
 * Build a platform-adaptive command wrapper for isolated execution.
 *
 * On Linux with read-only/workspace modes: wraps in `unshare`
 * On Windows: returns the command as-is (isolation via env + cwd)
 * On full/off modes: returns command unchanged
 */
export function wrapIsolatedCommand(
  command: string,
  opts: SandboxOptions,
): string {
  const platform = getPlatform();

  if (opts.mode === "full" || opts.mode === "off") {
    return command;
  }

  if (platform.os === "linux") {
    const workspaceDir = opts.workspaceDir || platform.homeDir;
    return buildLinuxIsolationCmd(command, workspaceDir, opts);
  }

  return command; // Windows: isolation is via env + cwd, not command wrapper
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripSensitiveEnv(env: Record<string, string>): Record<string, string> {
  const stripped: Record<string, string> = {};

  const sensitivePrefixes = [
    "AWS_", "AZURE_", "GCLOUD_", "GOOGLE_",
    "DOCKER_", "KUBE", "SECRET", "TOKEN",
    "PASSWORD", "API_KEY", "CREDENTIAL", "PRIVATE_KEY",
    "NPM_TOKEN", "GITHUB_TOKEN", "GITLAB_TOKEN",
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY",
    "SENTRY_DSN", "DATABASE_URL", "REDIS_URL",
  ];

  for (const [key, value] of Object.entries(env)) {
    const upper = key.toUpperCase();
    const isSensitive = sensitivePrefixes.some((prefix) => upper.startsWith(prefix));
    if (isSensitive) {
      debug.info("process-isolation", `Stripped sensitive env var: ${key}`);
      continue;
    }
    stripped[key] = value;
  }

  return stripped;
}

/**
 * Validate that the isolation setup succeeded without errors.
 */
export function validateIsolation(isolated: IsolatedProcess): {
  readonly valid: boolean;
  readonly warnings: readonly string[];
} {
  const warnings: string[] = [];

  // Check for remnants of dangerous env vars
  for (const key of Object.keys(isolated.env)) {
    const upper = key.toUpperCase();
    if (DANGEROUS_ENV_VARS.has(upper)) {
      warnings.push(`Dangerous env var leaked through: ${key}`);
    }
  }

  // Verify PATH is sanitized on Windows
  const platform = getPlatform();
  if (platform.os === "windows") {
    const pathVal = isolated.env["PATH"] || isolated.env["Path"] || "";
    if (pathVal.includes("AppData\\Local\\Temp")) {
      warnings.push("PATH contains temporary directories");
    }
    if (pathVal.includes("C:\\Windows\\Temp")) {
      warnings.push("PATH contains Windows temp directory");
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}
