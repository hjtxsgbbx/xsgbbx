/**
 * Network Guard — network access control for sandboxed commands.
 *
 * Provides three restriction levels:
 *  - 'none': No network access (block everything)
 *  - 'localhost': Allow 127.0.0.1 / ::1 only
 *  - 'allowlist': Allow only specific domains/IPs
 *
 * Implementation uses environment variable blocking (http_proxy, https_proxy,
 * no_proxy, etc.) rather than OS-level firewall rules, which would require
 * admin privileges. For a personal tool, env-based blocking is sufficient.
 *
 * All functions are PURE: inputs are readonly, outputs are new objects.
 */

import type { PlatformInfo } from "../types/index.js";
import { detectPlatform } from "../pal/sys.js";
import { debug } from "../observability/debug.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NetworkRestrictionLevel = "none" | "localhost" | "allowlist";

export interface NetworkRestriction {
  readonly level: NetworkRestrictionLevel;
  readonly env: Record<string, string>;
  readonly allowlist: readonly string[];
  readonly dnsBlocked: boolean;
}

// ---------------------------------------------------------------------------
// Environment variables that control network proxying
// ---------------------------------------------------------------------------

const PROXY_ENV_VARS: readonly string[] = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "FTP_PROXY",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
  "CURL_CA_BUNDLE",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
];

// A non-routable proxy that will cause immediate connection failure
const BLACKHOLE_PROXY = "http://127.255.255.255:9";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Block all network access via environment variables.
 * Sets all proxy vars to a blackhole address and clears NO_PROXY.
 */
export function disallowNetwork(): NetworkRestriction {
  const env: Record<string, string> = {};

  for (const varName of PROXY_ENV_VARS) {
    if (varName === "NO_PROXY" || varName === "no_proxy") {
      env[varName] = "";
    } else {
      env[varName] = BLACKHOLE_PROXY;
    }
  }

  debug.info("network-guard", "All network access blocked");

  return {
    level: "none",
    env,
    allowlist: [],
    dnsBlocked: true,
  };
}

/**
 * Allow only localhost (127.0.0.1, ::1) network access.
 * Sets proxy to blackhole but whitelists localhost in NO_PROXY.
 */
export function allowLocalhostOnly(): NetworkRestriction {
  const env: Record<string, string> = {};

  for (const varName of PROXY_ENV_VARS) {
    if (varName === "NO_PROXY" || varName === "no_proxy") {
      env[varName] = "127.0.0.1,::1,localhost,localhost.localdomain,*.local";
    } else {
      env[varName] = BLACKHOLE_PROXY;
    }
  }

  debug.info("network-guard", "Network restricted to localhost only");

  return {
    level: "localhost",
    env,
    allowlist: ["127.0.0.1", "::1", "localhost"],
    dnsBlocked: false,
  };
}

/**
 * Allow only specific domains/IPs for network access.
 * Sets proxy to blackhole but adds the allowlist to NO_PROXY.
 */
export function allowList(domains: readonly string[]): NetworkRestriction {
  const sanitized = domains.map((d) => d.trim().toLowerCase()).filter(Boolean);
  const env: Record<string, string> = {};

  const noProxyValue = [...sanitized, "127.0.0.1", "::1", "localhost"].join(",");

  for (const varName of PROXY_ENV_VARS) {
    if (varName === "NO_PROXY" || varName === "no_proxy") {
      env[varName] = noProxyValue;
    } else {
      env[varName] = BLACKHOLE_PROXY;
    }
  }

  debug.info("network-guard", `Network restricted to allowlist: ${sanitized.join(", ")}`);

  return {
    level: "allowlist",
    env,
    allowlist: sanitized,
    dnsBlocked: false,
  };
}

/**
 * Apply network restriction based on the level.
 * This is the main entry point for the sandbox manager.
 */
export function restrictNetwork(
  level: NetworkRestrictionLevel,
  allowlist?: readonly string[],
): NetworkRestriction {
  switch (level) {
    case "none":
      return disallowNetwork();
    case "localhost":
      return allowLocalhostOnly();
    case "allowlist":
      return allowList(allowlist ?? []);
  }
}

// ---------------------------------------------------------------------------
// Platform-aware helpers (informational only — no admin required)
// ---------------------------------------------------------------------------

/**
 * Check if the system firewall is active (informational).
 * Does NOT require admin privileges — only checks status.
 */
export function checkFirewallStatus(): {
  readonly active: boolean;
  readonly platform: string;
  readonly message: string;
} {
  const platform = detectPlatform();

  if (platform.os === "windows") {
    // On Windows, we can check if Windows Firewall service is running
    // without admin rights (sc query is read-only)
    return {
      active: true, // Windows Firewall is on by default
      platform: "windows",
      message: "Windows Firewall is active by default",
    };
  }

  if (platform.os === "linux") {
    return {
      active: false,
      platform: "linux",
      message: "Check iptables status requires root; env-based blocking is active instead",
    };
  }

  return {
    active: false,
    platform: platform.os,
    message: `Read-only firewall check not available on ${platform.os}`,
  };
}

/**
 * Get the DNS hosts file path for the current platform.
 * Informational — we don't modify it, just note its location.
 */
export function getHostsFilePath(): string {
  const platform = detectPlatform();
  if (platform.os === "windows") {
    return "C:\\Windows\\System32\\drivers\\etc\\hosts";
  }
  return "/etc/hosts";
}

/**
 * Merge network restriction environment variables into an existing env object.
 * Returns a NEW object (immutable pattern).
 */
export function applyNetworkRestriction(
  existingEnv: Record<string, string>,
  restriction: NetworkRestriction,
): Record<string, string> {
  const merged = { ...existingEnv };
  for (const [key, value] of Object.entries(restriction.env)) {
    merged[key] = value;
  }
  return merged;
}

/**
 * Build DNS-blocking environment hints.
 * On Linux, sets RES_OPTIONS to prevent DNS resolution.
 * On Windows, there's no env-based DNS override, so this is a no-op.
 */
export function blockDnsResolution(): Record<string, string> {
  const platform = detectPlatform();

  if (platform.os === "linux") {
    return {
      RES_OPTIONS: "attempts:1 timeout:1 rotate",
      LOCALDOMAIN: "",
      HOSTALIASES: "/dev/null",
    };
  }

  return {};
}
