export { SandboxExecutor, sandbox } from "./sandbox.js";
export type { SandboxMode, SandboxOptions } from "./sandbox.js";
export { HooksSystem, hooksSystem } from "./hooks.js";
export type { HookEvent, HookContext, HookHandler } from "./hooks.js";
export { resolveSafePath, isInWorkspace, sanitizeFilePath, enumerateDangerousPaths } from "./path-guard.js";
export { createPinnedAgent, setPinningEnabled, setPinningErrorCallback, verifyHostname, getPinnedHosts } from "./cert-pinner.js";

// ── Sandbox Hardening (new) ──
export {
  isolateProcess,
  wrapIsolatedCommand,
  validateIsolation,
} from "./process-isolation.js";
export type { IsolatedProcess } from "./process-isolation.js";
export {
  restrictNetwork,
  disallowNetwork,
  allowLocalhostOnly,
  allowList,
  applyNetworkRestriction,
  blockDnsResolution,
  checkFirewallStatus,
  getHostsFilePath,
} from "./network-guard.js";
export type { NetworkRestrictionLevel, NetworkRestriction } from "./network-guard.js";
export {
  createWriteGuard,
  isProtectedSystemPath,
  isPathInWorkspace as isPathWriteProtected,
  getProtectedPaths,
  validateWrite,
} from "./write-protection.js";
export type { WriteGuard, WriteCheckResult } from "./write-protection.js";
export { createSandbox } from "./sandbox-manager.js";
export type {
  Sandbox,
  SandboxResult,
  SandboxSecurityCheck,
  SandboxSecurityLevel,
  SandboxConfig,
} from "./sandbox-manager.js";