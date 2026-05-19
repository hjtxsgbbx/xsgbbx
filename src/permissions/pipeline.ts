import {
  type ToolCall,
  type PermissionDecision,
  type PermissionMode,
  type PlatformInfo,
  type ExecutionContext,
} from "../types/index.js";
import { AIGuard } from "./ai-guard.js";
import {
  BUILTIN_RULES,
  READONLY_TOOLS,
  lookupCache,
  addToCache,
  clearCache as clearDecisionCache,
  matchRuleTier,
} from "./rules.js";
import { classifyBashCommand } from "./bash-classifier.js";
import type { ClassifierResult } from "./bash-classifier.js";

export type PermissionRuleType = "deny" | "ask" | "allow";

export interface PermissionRule {
  id: string;
  pattern: string;
  type: PermissionRuleType;
  description: string;
  toolNames?: string[];
  platform?: "windows" | "unix" | "all";
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
    this.addRule(pattern, "deny", "User-defined deny pattern");
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

    if (this.mode === "plan") {
      const decision = this.planModeDecision(toolCall, platform);
      addToCache(toolCall, decision);
      return decision;
    }

    if (this.mode === "defaultDeny") {
      const decision = this.defaultDenyDecision(toolCall, command, platform);
      addToCache(toolCall, decision);
      return decision;
    }

    if (this.mode === "autoApprove") {
      const decision = this.autoApproveDecision(toolCall, command, platform);
      addToCache(toolCall, decision);
      return decision;
    }

    if (this.mode === "sandbox") {
      const decision = this.sandboxModeDecision(toolCall, command, platform);
      addToCache(toolCall, decision);
      return decision;
    }

    // --- Layer 1: Primary bash security classifier (AST-backed, 23 checks) ---
    if (command.length > 0) {
      const bashDecision = this.primaryBashClassify(command);
      if (bashDecision) {
        addToCache(toolCall, bashDecision);
        return bashDecision;
      }
    }

    // --- Layer 2: Regex-based deny tier (fallback when classifier allows) ---
    if (command.length > 0) {
      const denyDecision = this.checkDenyTier(command, platform);
      if (denyDecision) {
        addToCache(toolCall, denyDecision);
        return denyDecision;
      }
    }

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

    // --- Layer 3: Regex-based ask tier (fallback when classifier allows) ---
    if (command.length > 0) {
      const askDecision = this.checkAskTier(command, platform);
      if (askDecision) {
        addToCache(toolCall, askDecision);
        return askDecision;
      }
    }

    // --- Layer 4: Regex-based allow tier ---
    if (command.length > 0) {
      const allowDecision = this.checkAllowTier(command, platform);
      if (allowDecision) {
        addToCache(toolCall, allowDecision);
        return allowDecision;
      }
    }

    const aiDecision = this.aiClassify(toolCall, command, platform);
    addToCache(toolCall, aiDecision);
    return aiDecision;
  }

  private defaultDenyDecision(
    toolCall: ToolCall,
    command: string,
    platform: PlatformInfo
  ): PermissionDecision {
    const isReadOnly = READONLY_TOOLS.includes(toolCall.name);

    if (isReadOnly) {
      return {
        allowed: true,
        reason: "Read-only tool allowed in defaultDeny mode",
        layer: "whitelist",
        canOverride: false,
      };
    }

    // Primary bash security classifier (Layer 1)
    if (command.length > 0) {
      const bashDecision = this.primaryBashClassify(command);
      if (bashDecision) {
        return bashDecision;
      }
    }

    if (command.length > 0) {
      const denyDecision = this.checkDenyTier(command, platform);
      if (denyDecision && !denyDecision.allowed) {
        return denyDecision;
      }
    }

    return {
      allowed: false,
      reason: `Default-deny mode: ${toolCall.name} requires explicit approval`,
      layer: "ai_classifier",
      canOverride: true,
      confirmationRequired: true,
    };
  }

  private autoApproveDecision(
    toolCall: ToolCall,
    command: string,
    platform: PlatformInfo
  ): PermissionDecision {
    if (command.length > 0) {
      // Primary bash security classifier (Layer 1)
      const bashDecision = this.primaryBashClassify(command);
      if (bashDecision) {
        return bashDecision;
      }

      const denyDecision = this.checkDenyTier(command, platform);
      if (denyDecision && !denyDecision.allowed) {
        return denyDecision;
      }

      const guard = new AIGuard(platform);
      const guardResult = guard.validateShellCommand(command);
      if (!guardResult.passed && guardResult.confidence < 0.3) {
        return {
          allowed: false,
          reason: `Auto-approve blocked: ${guardResult.reason || "very low confidence"}`,
          layer: "ai_classifier",
          canOverride: true,
          confirmationRequired: true,
        };
      }
    }

    return {
      allowed: true,
      reason: `Auto-approved: ${toolCall.name}`,
      layer: "whitelist",
      canOverride: false,
    };
  }

  private sandboxModeDecision(
    toolCall: ToolCall,
    command: string,
    platform: PlatformInfo
  ): PermissionDecision {
    const isReadOnly = READONLY_TOOLS.includes(toolCall.name);

    if (isReadOnly) {
      return {
        allowed: true,
        reason: "Read-only tool allowed in sandbox mode",
        layer: "whitelist",
        canOverride: false,
      };
    }

    if (command.length > 0) {
      // Primary bash security classifier (Layer 1)
      const bashDecision = this.primaryBashClassify(command);
      if (bashDecision) {
        return bashDecision;
      }

      const denyDecision = this.checkDenyTier(command, platform);
      if (denyDecision && !denyDecision.allowed) {
        return denyDecision;
      }

      const dangerousPatterns = [
        /\brm\s+-rf\s+\//i, /\bdel\s+\/[sf]/i,
        /\bformat\s+[a-z]:/i, /\bshutdown/i, /\breboot/i,
        /\bsudo\s+(?!apt-get)/i,
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(command)) {
          return {
            allowed: false,
            reason: `Sandbox mode: blocked destructive command`,
            layer: "cache",
            canOverride: false,
          };
        }
      }
    }

    return {
      allowed: true,
      reason: `Sandbox mode: ${toolCall.name} allowed (non-destructive)`,
      layer: "whitelist",
      canOverride: false,
      confirmationRequired: !isReadOnly,
    };
  }

  private planModeDecision(
    toolCall: ToolCall,
    _platform: PlatformInfo
  ): PermissionDecision {
    const isReadOnly = READONLY_TOOLS.includes(toolCall.name);
    return {
      allowed: isReadOnly,
      reason: isReadOnly
        ? "Read-only tool allowed in plan mode"
        : "Plan mode: write tools are blocked",
      layer: "whitelist",
      canOverride: false,
    };
  }

  /**
   * Primary bash command security classification using the AST-backed
   * security validator chain (23 checks).
   *
   * This is the primary decision maker for shell commands. It runs BEFORE
   * the regex-based rule matching. The classifier uses AST parsing when
   * available and regex patterns as a fallback — providing more accurate
   * detection of shell injection, command structure issues, and dangerous
   * patterns than regex-only matching.
   *
   * @returns PermissionDecision if a security issue was found, null if the
   *          classifier returned 'allow' (meaning "continue with regex checks")
   */
  private primaryBashClassify(command: string): PermissionDecision | null {
    if (command.length === 0) {
      return null;
    }

    const result: ClassifierResult = classifyBashCommand(command);

    switch (result.tier) {
      case 'deny':
        return {
          allowed: false,
          reason: `BASH-SEC DENY [check ${result.checkId ?? '?'}]: ${result.reason}`,
          layer: 'cache',
          canOverride: false,
        };

      case 'ask':
        return {
          allowed: false,
          reason: `BASH-SEC ASK [check ${result.checkId ?? '?'}]: ${result.reason}`,
          layer: 'ai_classifier',
          canOverride: true,
          confirmationRequired: true,
        };

      case 'allow':
        // Classifier passed — fall through to existing regex-based checks
        return null;

      default:
        return null;
    }
  }

  private checkDenyTier(command: string, platform: PlatformInfo): PermissionDecision | null {
    const allRules = [...BUILTIN_RULES, ...this.customRules];
    const rule = matchRuleTier(command, platform, allRules, "deny");
    if (rule) {
      return {
        allowed: false,
        reason: `DENY: ${rule.description} (${rule.id})`,
        layer: "cache",
        canOverride: false,
      };
    }
    return null;
  }

  private checkAskTier(command: string, platform: PlatformInfo): PermissionDecision | null {
    const allRules = [...BUILTIN_RULES, ...this.customRules];
    const rule = matchRuleTier(command, platform, allRules, "ask");
    if (rule) {
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
    return null;
  }

  private checkAllowTier(command: string, platform: PlatformInfo): PermissionDecision | null {
    const allRules = [...BUILTIN_RULES, ...this.customRules];
    const rule = matchRuleTier(command, platform, allRules, "allow");
    if (rule) {
      return {
        allowed: true,
        reason: `ALLOW: ${rule.description}`,
        layer: "whitelist",
        canOverride: false,
      };
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
    clearDecisionCache();
  }
}