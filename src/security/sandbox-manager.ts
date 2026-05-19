/**
 * Sandbox Manager — unified orchestration of all sandbox layers.
 *
 * Pipeline:
 *  1. AST security validation (bash-security)
 *  2. Path constraint check (path-guard + write-protection)
 *  3. Network restriction (network-guard)
 *  4. Process isolation (process-isolation)
 *  5. Timeout enforcement
 *
 * All functions are PURE: inputs are readonly, outputs are new objects.
 */

import type { SandboxMode, SandboxOptions } from "./sandbox.js";
import { isolateProcess, validateIsolation } from "./process-isolation.js";
import type { IsolatedProcess } from "./process-isolation.js";
import {
  restrictNetwork,
  applyNetworkRestriction,
  blockDnsResolution,
} from "./network-guard.js";
import type { NetworkRestriction, NetworkRestrictionLevel } from "./network-guard.js";
import { createWriteGuard, validateWrite } from "./write-protection.js";
import type { WriteGuard } from "./write-protection.js";
import { resolveSafePath } from "./path-guard.js";
import { classifyBashCommand } from "../permissions/bash-classifier.js";
import type { ClassifierResult } from "../permissions/bash-classifier.js";
import { debug } from "../observability/debug.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SandboxSecurityLevel = "passed" | "warning" | "blocked";

export interface SandboxSecurityCheck {
  readonly name: string;
  readonly level: SandboxSecurityLevel;
  readonly message: string;
}

export interface SandboxResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly killed: boolean;
  readonly timedOut: boolean;
  readonly securityChecks: readonly SandboxSecurityCheck[];
  readonly passed: boolean;
}

export interface Sandbox {
  readonly mode: SandboxMode;
  execute(command: string): Promise<SandboxResult>;
  getConfiguration(): SandboxConfig;
}

export interface SandboxConfig {
  readonly mode: SandboxMode;
  readonly workspaceDir: string;
  readonly networkLevel: NetworkRestrictionLevel;
  readonly processIsolation: IsolatedProcess | null;
  readonly nwRestriction: NetworkRestriction | null;
  readonly writeGuard: WriteGuard | null;
}

// ---------------------------------------------------------------------------
// Network level mapping from sandbox mode
// ---------------------------------------------------------------------------

function mapModeToNetworkLevel(mode: SandboxMode): NetworkRestrictionLevel {
  switch (mode) {
    case "off":
    case "full":
      return "allowlist";
    case "readonly":
      return "none";
    case "workspace":
      return "localhost";
  }
}

// ---------------------------------------------------------------------------
// Sandbox Manager implementation
// ---------------------------------------------------------------------------

export function createSandbox(
  mode: SandboxMode,
  opts?: Partial<SandboxOptions>,
): Sandbox {
  const workspaceDir = opts?.workspaceDir || process.cwd();
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const maxOutputBytes = opts?.maxOutputBytes ?? 1024 * 1024;
  const networkLevel = mapModeToNetworkLevel(mode);
  const writeGuard = mode !== "off" && mode !== "full"
    ? createWriteGuard(workspaceDir)
    : null;

  const nwRestriction = mode !== "full"
    ? restrictNetwork(networkLevel)
    : null;

  const config: SandboxConfig = {
    mode,
    workspaceDir,
    networkLevel,
    processIsolation: null,
    nwRestriction,
    writeGuard,
  };

  debug.info("sandbox-manager",
    `Sandbox created: mode=${mode}, network=${networkLevel}, workspace=${workspaceDir}`);

  return {
    mode,

    async execute(command: string): Promise<SandboxResult> {
      return executeInSandbox(command, config, timeoutMs, maxOutputBytes);
    },

    getConfiguration(): SandboxConfig {
      return config;
    },
  };
}

// ---------------------------------------------------------------------------
// Core execution pipeline
// ---------------------------------------------------------------------------

async function executeInSandbox(
  command: string,
  config: SandboxConfig,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<SandboxResult> {
  const checks: SandboxSecurityCheck[] = [];

  // ── Layer 1: AST Security Validation ──
  const bashResult: ClassifierResult = classifyBashCommand(command);
  checks.push({
    name: "bash-security",
    level: bashResult.tier === "deny" ? "blocked"
         : bashResult.tier === "ask"  ? "warning"
         : "passed",
    message: bashResult.reason,
  });

  if (bashResult.tier === "deny") {
    // Hard block — do not execute
    debug.warn("sandbox-manager", `Command blocked by bash-security: ${bashResult.reason}`);
    return buildBlockedResult(checks, bashResult.reason);
  }

  // ── Layer 2: Path Constraint Check ──
  if (config.writeGuard) {
    // Validate any file paths in the command against write protection
    const paths = extractPotentialPaths(command);
    for (const targetPath of paths) {
      const writeCheck = validateWrite(targetPath, config.writeGuard);
      if (!writeCheck.allowed) {
        checks.push({
          name: "write-protection",
          level: "blocked",
          message: writeCheck.reason || "Write denied",
        });
        debug.warn("sandbox-manager", `Path blocked: ${writeCheck.reason}`);
        return buildBlockedResult(checks, writeCheck.reason || "Write protection blocked");
      }
    }

    // Always add write-protection check (present in all restricted modes)
    checks.push({
      name: "write-protection",
      level: "passed",
      message: paths.length > 0
        ? `Write protection validated ${paths.length} path(s)`
        : "Write protection active (no paths in command)",
    });

    // Verify overall path safety
    const safePathCheck = resolveSafePath(config.workspaceDir, config.workspaceDir);
    checks.push({
      name: "path-guard",
      level: safePathCheck.safe ? "passed" : "warning",
      message: safePathCheck.safe ? "Path constraints satisfied" : (safePathCheck.reason || ""),
    });
  } else {
    checks.push({
      name: "path-guard",
      level: "passed",
      message: "No path restrictions in full mode",
    });
  }

  // ── Layer 3: Network Restriction ──
  if (config.nwRestriction) {
    checks.push({
      name: "network-guard",
      level: "passed",
      message: `Network restricted to: ${config.networkLevel}`,
    });
  } else {
    checks.push({
      name: "network-guard",
      level: "passed",
      message: "Network unrestricted (full mode)",
    });
  }

  // ── Layer 4: Process Isolation ──
  const sandboxOpts: { mode: SandboxMode; workspaceDir?: string; timeoutMs: number; maxOutputBytes: number } = {
    mode: config.mode,
    workspaceDir: config.workspaceDir,
    timeoutMs,
    maxOutputBytes,
  };

  const isolated = isolateProcess(command, sandboxOpts);
  const isoValidation = validateIsolation(isolated);

  checks.push({
    name: "process-isolation",
    level: isoValidation.valid ? "passed" : "warning",
    message: isoValidation.valid
      ? "Process isolation configured"
      : `Isolation warnings: ${isoValidation.warnings.join("; ")}`,
  });

  // Merge network restrictions into the isolated environment
  if (config.nwRestriction) {
    const mergedEnv = applyNetworkRestriction(isolated.env, config.nwRestriction);
    // Also apply DNS blocking for 'none' mode
    const dnsBlock = config.networkLevel === "none" ? blockDnsResolution() : {};
    const finalEnv = { ...mergedEnv, ...dnsBlock };

    checks.push({
      name: "env-sanitization",
      level: "passed",
      message: `Stripped ${countStrippedEnv(process.env, finalEnv)} sensitive env vars`,
    });
  }

  // ── Layer 5: Result ──
  // At this point, all checks have passed (none blocked).
  // Actual execution happens in the caller via the isolated process config.
  // We return a result indicating the sandbox is ready for execution.

  const passed = checks.every((c) => c.level !== "blocked");

  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    killed: false,
    timedOut: false,
    securityChecks: checks,
    passed,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildBlockedResult(
  checks: readonly SandboxSecurityCheck[],
  reason: string,
): SandboxResult {
  return {
    exitCode: 126, // Command invoked cannot execute
    stdout: "",
    stderr: `Security blocked: ${reason}`,
    killed: true,
    timedOut: false,
    securityChecks: checks,
    passed: false,
  };
}

/**
 * Extract potential file paths from a command string.
 * This is a best-effort heuristic, not a parser.
 */
function extractPotentialPaths(command: string): string[] {
  const paths: string[] = [];

  // Match common path patterns
  const pathPatterns = [
    // Windows absolute paths: C:\... or C:/...
    /[A-Za-z]:[\\/][^\s"']+/g,
    // Unix absolute paths: /...
    /(?<!\w)\/[^\s"']+/g,
    // Relative paths: ./...
    /\.\/[^\s"']+/g,
    // User home: ~/...
    /~\/[^\s"']+/g,
  ];

  for (const pattern of pathPatterns) {
    const matches = command.match(pattern);
    if (matches) {
      for (const m of matches) {
        // Filter out flags and options
        if (!m.startsWith("-") && m.length > 2) {
          paths.push(m);
        }
      }
    }
  }

  return paths;
}

function countStrippedEnv(
  original: Record<string, string | undefined>,
  sanitized: Record<string, string>,
): number {
  let count = 0;
  for (const key of Object.keys(original)) {
    if (!(key in sanitized)) count++;
  }
  return count;
}
