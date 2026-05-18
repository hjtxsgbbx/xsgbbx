import { type ToolCall, type PermissionDecision, type PlatformInfo } from "../types/index.js";
import { type PermissionRule, type PermissionRuleType } from "./pipeline.js";
import { debug } from "../observability/debug.js";

export const BUILTIN_RULES: PermissionRule[] = [
  {
    id: "deny-rm-root",
    pattern: "rm\\s+-rf\\s+/",
    type: "deny",
    description: "Recursive delete from root directory",
    platform: "unix",
  },
  {
    id: "deny-format-windows",
    pattern: "format\\s+[A-Z]:",
    type: "deny",
    description: "Format drive",
    platform: "windows",
  },
  {
    id: "deny-diskpart",
    pattern: "diskpart",
    type: "deny",
    description: "Windows disk partition tool",
    platform: "windows",
  },
  {
    id: "deny-dd-dev",
    pattern: ">\\s*/dev/sd[a-z]",
    type: "deny",
    description: "Write to block device",
    platform: "unix",
  },
  {
    id: "deny-mkfs",
    pattern: "mkfs\\.",
    type: "deny",
    description: "Filesystem creation",
    platform: "unix",
  },
  {
    id: "deny-fork-bomb",
    pattern: ":\\(\\)\\s*\\{",
    type: "deny",
    description: "Fork bomb pattern",
  },
  {
    id: "deny-del-windows",
    pattern: "del\\s+/f\\s+/[A-Z]:\\\\windows",
    type: "deny",
    description: "Force delete Windows directory",
    platform: "windows",
  },
  {
    id: "ask-chmod-777",
    pattern: "chmod\\s+777",
    type: "ask",
    description: "Set world-writable permissions",
    platform: "unix",
  },
  {
    id: "ask-rm-recursive",
    pattern: "rm\\s+-rf\\s+(?!/)",
    type: "ask",
    description: "Recursive delete (non-root)",
  },
  {
    id: "ask-sudo",
    pattern: "sudo\\s+(?!apt-get)",
    type: "ask",
    description: "Superuser command",
  },
  {
    id: "ask-curl-http",
    pattern: "(curl|wget)\\s+(?!https://)",
    type: "ask",
    description: "Non-HTTPS download",
  },
  {
    id: "allow-npm",
    pattern: "^(npm|npx|yarn|pnpm)\\s",
    type: "allow",
    description: "Package manager commands",
  },
  {
    id: "allow-git",
    pattern: "^(git|git\\s+(add|commit|push|pull|checkout|switch|merge|branch|log|status|diff|show))",
    type: "allow",
    description: "Git operations",
  },
  {
    id: "allow-test",
    pattern: "^(npm run test|yarn test|pnpm test|pytest|cargo test|go test)",
    type: "allow",
    description: "Test runners",
  },
  {
    id: "allow-build",
    pattern: "^(npm run build|yarn build|pnpm build|tsc|cargo build|go build|make)",
    type: "allow",
    description: "Build tools",
  },
  {
    id: "allow-pip",
    pattern: "^pip(3)?\\s+(install|uninstall|list|freeze|show)",
    type: "allow",
    description: "Python package management",
  },
  {
    id: "allow-fs",
    pattern: "^(echo|cat|head|tail|mkdir|cp|mv|touch|find|wc|sort|uniq|ls|dir|type)",
    type: "allow",
    description: "Basic filesystem operations",
  },
];

export const READONLY_TOOLS = [
  "grep", "glob", "read_file", "git_log", "git_status", "ls",
  "echo", "cat", "head", "tail", "find", "wc", "sort", "uniq",
  "diff", "git_diff", "git_show", "npm_list", "npm_view",
];

interface CacheEntry {
  toolName: string;
  command: string;
  decision: PermissionDecision;
  timestamp: number;
}

const decisionCache: CacheEntry[] = [];
const MAX_CACHE_SIZE = 500;

const CACHE_TTL_BY_LAYER: Record<string, number> = {
  whitelist: 1800000,
  ai_classifier: 300000,
  cache: 600000,
  default: 300000,
};

const CACHE_TTL_ALLOW = 1800000;
const CACHE_TTL_CONFIRMATION_REQUIRED = 120000;

function getCacheTTL(decision: PermissionDecision): number {
  if (decision.layer && CACHE_TTL_BY_LAYER[decision.layer]) {
    return CACHE_TTL_BY_LAYER[decision.layer];
  }
  if (decision.confirmationRequired) {
    return CACHE_TTL_CONFIRMATION_REQUIRED;
  }
  if (decision.allowed && !decision.canOverride) {
    return CACHE_TTL_ALLOW;
  }
  return CACHE_TTL_BY_LAYER.default;
}

export function lookupCache(toolCall: ToolCall): PermissionDecision | null {
  const command = JSON.stringify(toolCall.arguments);
  const now = Date.now();

  const index = decisionCache.findIndex((c) => {
    if (c.toolName !== toolCall.name || c.command !== command) return false;
    const ttl = getCacheTTL(c.decision);
    return now - c.timestamp < ttl;
  });

  if (index >= 0) {
    const entry = decisionCache[index];
    decisionCache.splice(index, 1);
    decisionCache.push(entry);
    return entry.decision;
  }

  return null;
}

export function addToCache(toolCall: ToolCall, decision: PermissionDecision): void {
  const command = JSON.stringify(toolCall.arguments);
  decisionCache.push({
    toolName: toolCall.name,
    command,
    decision,
    timestamp: Date.now(),
  });

  pruneStaleEntries();

  if (decisionCache.length > MAX_CACHE_SIZE) {
    decisionCache.shift();
  }
}

function pruneStaleEntries(): void {
  const now = Date.now();
  for (let i = decisionCache.length - 1; i >= 0; i--) {
    const ttl = getCacheTTL(decisionCache[i].decision);
    if (now - decisionCache[i].timestamp > ttl * 2) {
      decisionCache.splice(i, 1);
    }
  }
}

export function clearCache(): void {
  decisionCache.length = 0;
}

export function classifyCommandPerTier(
  command: string,
  platform: PlatformInfo,
  customRules: PermissionRule[]
): { type: PermissionRuleType; rule?: PermissionRule } {
  const allRules = [...BUILTIN_RULES, ...customRules];
  const isWindows = platform.os === "windows";
  const isUnix = platform.os === "macos" || platform.os === "linux";

  for (const rule of allRules) {
    if (rule.platform === "windows" && !isWindows) continue;
    if (rule.platform === "unix" && !isUnix) continue;

    try {
      if (new RegExp(rule.pattern, "i").test(command)) {
        return { type: rule.type, rule };
      }
    } catch {
      continue;
    }
  }

  return { type: "ask" };
}

export function classifyCommandCheck(command: string, platform: PlatformInfo): boolean {
  const isWindows = platform.os === "windows";
  const isUnix = platform.os === "macos" || platform.os === "linux";

  for (const rule of BUILTIN_RULES) {
    if (rule.type !== "deny" && rule.type !== "ask") continue;
    if (rule.platform === "windows" && !isWindows) continue;
    if (rule.platform === "unix" && !isUnix) continue;

    try {
      if (new RegExp(rule.pattern, "i").test(command)) {
        return true;
      }
    } catch (err) {
      debug.info("rules", `Invalid regex pattern: ${rule.pattern}`, err);
      continue;
    }
  }

  return false;
}

export function matchRuleTier(
  command: string,
  platform: PlatformInfo,
  allRules: PermissionRule[],
  filterType: PermissionRuleType
): PermissionRule | null {
  const isWindows = platform.os === "windows";
  const isUnix = platform.os === "macos" || platform.os === "linux";

  for (const rule of allRules) {
    if (rule.type !== filterType) continue;
    if (rule.platform === "windows" && !isWindows) continue;
    if (rule.platform === "unix" && !isUnix) continue;

    try {
      if (new RegExp(rule.pattern, "i").test(command)) {
        return rule;
      }
    } catch {
      continue;
    }
  }

  return null;
}