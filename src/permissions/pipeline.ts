import {
  ToolCall,
  PermissionDecision,
  PermissionLayer,
  PermissionMode,
  PlatformInfo,
  ExecutionContext,
} from "../types/index.js";
import { AIGuard } from "../core/ai-guard.js";

const CONFIDENCE_THRESHOLD = 0.7;

export type PermissionRuleType = "deny" | "ask" | "allow";

export interface PermissionRule {
  id: string;
  pattern: string;
  type: PermissionRuleType;
  description: string;
  toolNames?: string[];
  platform?: "windows" | "unix" | "all";
}

const BUILTIN_RULES: PermissionRule[] = [
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

const READONLY_TOOLS = [
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

function lookupCache(toolCall: ToolCall): PermissionDecision | null {
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

function addToCache(toolCall: ToolCall, decision: PermissionDecision): void {
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

function classifyCommandPerTier(
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

export class PermissionPipeline {
  private mode: PermissionMode;
  private customRules: PermissionRule[] = [];
  private nextRuleId = 1;

  constructor(mode: PermissionMode = "default") {
    this.mode = mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  addRule(
    pattern: string,
    type: PermissionRuleType,
    description: string,
    toolNames?: string[]
  ): PermissionRule {
    const rule: PermissionRule = {
      id: `custom-${this.nextRuleId++}`,
      pattern,
      type,
      description,
      toolNames,
    };
    this.customRules.push(rule);
    return rule;
  }

  removeRule(id: string): boolean {
    const idx = this.customRules.findIndex((r) => r.id === id);
    if (idx >= 0) {
      this.customRules.splice(idx, 1);
      return true;
    }
    return false;
  }

  getRules(): PermissionRule[] {
    return [...BUILTIN_RULES, ...this.customRules];
  }

  addDenyPattern(pattern: string): void {
    this.addRule(pattern, "deny", `User-defined deny pattern`);
  }

  removeDenyPattern(pattern: string): boolean {
    const idx = this.customRules.findIndex(
      (r) => r.type === "deny" && r.pattern === pattern
    );
    if (idx >= 0) {
      this.customRules.splice(idx, 1);
      return true;
    }
    return false;
  }

  getDenyPatterns(): string[] {
    return this.customRules
      .filter((r) => r.type === "deny")
      .map((r) => r.pattern);
  }

  async check(
    toolCall: ToolCall,
    context: ExecutionContext
  ): Promise<PermissionDecision> {
    const command =
      toolCall.name === "shell_command"
        ? (toolCall.arguments.command as string) || ""
        : "";
    const platform = context.platform;

    const cached = lookupCache(toolCall);
    if (cached) return cached;

    // Plan mode: only read-only
    if (this.mode === "plan") {
      const isReadOnly = READONLY_TOOLS.includes(toolCall.name) ||
        (toolCall.name === "shell_command" && command.length > 0 && !classifyCommandCheck(command, platform));
      const decision: PermissionDecision = {
        allowed: isReadOnly,
        reason: isReadOnly
          ? "Read-only tool allowed in plan mode"
          : "Plan mode: write tools are blocked",
        layer: "whitelist",
        canOverride: false,
      };
      addToCache(toolCall, decision);
      return decision;
    }

    // Tier 1: Check DENY rules (highest precedence, never overridable)
    if (command.length > 0) {
      const denyDecision = this.checkDenyTier(command, platform);
      if (denyDecision) {
        addToCache(toolCall, denyDecision);
        return denyDecision;
      }
    }

    // Read-only tools: automatic allow
    if (READONLY_TOOLS.includes(toolCall.name)) {
      const decision: PermissionDecision = {
        allowed: true,
        reason: "Read-only tool",
        layer: "whitelist",
        canOverride: false,
      };
      addToCache(toolCall, decision);
      return decision;
    }

    // Non-shell write tools: trust AI
    if (toolCall.name !== "shell_command" && command.length === 0) {
      const decision: PermissionDecision = {
        allowed: true,
        reason: "Code edit tool, trusting AI",
        layer: "ai_classifier",
        canOverride: true,
      };
      addToCache(toolCall, decision);
      return decision;
    }

    // Tier 2: Check ASK rules (requires confirmation)
    if (command.length > 0) {
      const askDecision = this.checkAskTier(command, platform);
      if (askDecision) {
        addToCache(toolCall, askDecision);
        return askDecision;
      }
    }

    // Tier 3: Check ALLOW rules (automatic)
    if (command.length > 0) {
      const allowDecision = this.checkAllowTier(command, platform);
      if (allowDecision) {
        addToCache(toolCall, allowDecision);
        return allowDecision;
      }
    }

    // Fallback: AI classifier for unknown commands
    const aiDecision = this.aiClassify(toolCall, command, platform);
    addToCache(toolCall, aiDecision);
    return aiDecision;
  }

  private checkDenyTier(command: string, platform: PlatformInfo): PermissionDecision | null {
    const allRules = [...BUILTIN_RULES, ...this.customRules];
    const isWindows = platform.os === "windows";
    const isUnix = platform.os === "macos" || platform.os === "linux";

    for (const rule of allRules) {
      if (rule.type !== "deny") continue;
      if (rule.platform === "windows" && !isWindows) continue;
      if (rule.platform === "unix" && !isUnix) continue;

      try {
        if (new RegExp(rule.pattern, "i").test(command)) {
          return {
            allowed: false,
            reason: `DENY: ${rule.description} (${rule.id})`,
            layer: "cache",
            canOverride: false,
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private checkAskTier(command: string, platform: PlatformInfo): PermissionDecision | null {
    const allRules = [...BUILTIN_RULES, ...this.customRules];
    const isWindows = platform.os === "windows";
    const isUnix = platform.os === "macos" || platform.os === "linux";

    for (const rule of allRules) {
      if (rule.type !== "ask") continue;
      if (rule.platform === "windows" && !isWindows) continue;
      if (rule.platform === "unix" && !isUnix) continue;

      try {
        if (new RegExp(rule.pattern, "i").test(command)) {
          const hasPipes = command.includes("|");
          const subCommandCount = command.split(/[|;&]/).length;

          if (subCommandCount > 50) {
            return {
              allowed: false,
              reason: `ASK: ${rule.description} + has ${subCommandCount} sub-commands (limit: 50)`,
              layer: "ai_classifier",
              canOverride: true,
              confirmationRequired: true,
            };
          }

          return {
            allowed: false,
            reason: `ASK: ${rule.description} (${rule.id}) - Type "I understand the risk" to proceed`,
            layer: "ai_classifier",
            canOverride: true,
            confirmationRequired: true,
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private checkAllowTier(command: string, platform: PlatformInfo): PermissionDecision | null {
    const allRules = [...BUILTIN_RULES, ...this.customRules];
    const isWindows = platform.os === "windows";
    const isUnix = platform.os === "macos" || platform.os === "linux";

    for (const rule of allRules) {
      if (rule.type !== "allow") continue;
      if (rule.platform === "windows" && !isWindows) continue;
      if (rule.platform === "unix" && !isUnix) continue;

      try {
        if (new RegExp(rule.pattern, "i").test(command)) {
          return {
            allowed: true,
            reason: `ALLOW: ${rule.description}`,
            layer: "whitelist",
            canOverride: false,
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private aiClassify(
    _toolCall: ToolCall,
    command: string,
    platform: PlatformInfo
  ): PermissionDecision {
    if (command.length === 0) {
      return {
        allowed: true,
        layer: "ai_classifier",
        canOverride: true,
        reason: "No shell command to classify",
      };
    }

    if (command.includes("sudo") && !command.includes("apt-get")) {
      return {
        allowed: false,
        reason: "sudo detected outside of apt-get context - requires confirmation",
        layer: "ai_classifier",
        canOverride: true,
        confirmationRequired: true,
      };
    }

    if ((command.includes("curl") || command.includes("wget")) &&
        !command.includes("https://") && !command.includes("https:")) {
      return {
        allowed: false,
        reason: "Download commands must use HTTPS",
        layer: "ai_classifier",
        canOverride: true,
      };
    }

    const guard = new AIGuard(platform);
    const guardResult = guard.validateShellCommand(command);

    if (!guardResult.passed) {
      return {
        allowed: false,
        reason: guardResult.reason ||
          `AI safety confidence low (${(guardResult.confidence * 100).toFixed(0)}%)`,
        layer: "ai_classifier",
        canOverride: guardResult.confidence >= 0.4,
      };
    }

    return {
      allowed: true,
      layer: "ai_classifier",
      canOverride: true,
      reason: `AI classifier allowed (confidence: ${(guardResult.confidence * 100).toFixed(0)}%)`,
    };
  }

  clearCache(): void {
    decisionCache.length = 0;
  }
}

function classifyCommandCheck(command: string, platform: PlatformInfo): boolean {
  const allRules = [...BUILTIN_RULES];
  const isWindows = platform.os === "windows";
  const isUnix = platform.os === "macos" || platform.os === "linux";

  for (const rule of allRules) {
    if (rule.platform === "windows" && !isWindows) continue;
    if (rule.platform === "unix" && !isUnix) continue;
    if (rule.type === "allow") continue;

    try {
      if (new RegExp(rule.pattern, "i").test(command)) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}