/**
 * Enhanced 6-layer shell command safety pipeline.
 *
 * Layers:
 *  1. Blocked patterns (regex)      — catastrophic commands always rejected
 *  2. AST parse + decomposition     — extract SimpleCommand[]; too-complex => escalate
 *  3. Dangerous patterns per seg    — regex applied to EACH pipe segment independently
 *  4. Command semantics             — interpret exit codes, detect eval-like builtins
 *  5. Path validation               — check output redirects, dangerous paths
 *  6. Permission matching           — wildcard allow/deny/ask rules
 */

import { parse } from "./bash-parser.js";
import {
  parseForSecurity,
  checkSemantics,
  type SimpleCommand,
} from "./ast-analyzer.js";
import {
  BLOCKED_PATTERNS,
  DANGEROUS_PATTERNS,
  DANGEROUS_REDIRECT_PATHS,
  DEFAULT_PERMISSION_RULES,
  matchWildcard,
  type SafetySeverity,
  type SafetyWarning,
  type PermissionRule,
} from "./safety-patterns.js";

// Re-export for consumers
export type { SafetySeverity, SafetyWarning, PermissionRule } from "./safety-patterns.js";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface SafetyResult {
  severity: SafetySeverity;
  warnings: SafetyWarning[];
  reason: string;
  requiresConfirmation: boolean;
  /** Extracted command segments for downstream use. */
  commands: SimpleCommand[];
}

export interface SafetyPipelineOptions {
  permissionRules?: PermissionRule[];
}

// ---------------------------------------------------------------------------
// Safety pipeline class
// ---------------------------------------------------------------------------

export class SafetyPipeline {
  private permissionRules: PermissionRule[];

  constructor(options: SafetyPipelineOptions = {}) {
    this.permissionRules = [
      ...(options.permissionRules ?? []),
      ...DEFAULT_PERMISSION_RULES,
    ];
  }

  /**
   * Run the full 6-layer safety pipeline. Short-circuits on BLOCKED.
   */
  check(command: string): SafetyResult {
    const warnings: SafetyWarning[] = [];

    // Layer 1: Blocked patterns
    const blocked = this.layer1(command);
    if (blocked) {
      warnings.push(blocked);
      return this.result("blocked", warnings, []);
    }

    // Layer 2: AST parse + decomposition
    const parsed = parse(command);
    if (parsed.error) {
      warnings.push({
        layer: 2,
        severity: "caution",
        message: `AST parse failed: ${parsed.error}; escalating to confirmation`,
      });
      return this.result("caution", warnings, []);
    }

    const decomposed = parseForSecurity(parsed.ast);
    if (decomposed.kind !== "ok") {
      warnings.push({
        layer: 2,
        severity: "dangerous",
        message: `AST decomposition ${decomposed.kind}: ${decomposed.reason}; requires confirmation`,
      });
      return this.result("dangerous", warnings, []);
    }

    const commands = decomposed.commands;

    // Empty or comment-only
    if (commands.length === 0) {
      return this.result("safe", [], []);
    }

    // Layer 3: Dangerous patterns per segment
    const l3w = this.layer3(commands);
    warnings.push(...l3w);
    if (l3w.some((w) => w.severity === "blocked")) {
      return this.result("blocked", warnings, commands);
    }

    // Layer 4: Command semantics
    warnings.push(...this.layer4(commands));

    // Layer 5: Path validation
    const l5w = this.layer5(commands);
    warnings.push(...l5w);
    if (l5w.some((w) => w.severity === "blocked")) {
      return this.result("blocked", warnings, commands);
    }

    // Layer 6: Permission matching
    const permAction = this.layer6(commands);
    if (permAction) {
      const sev = permAction === "deny" ? "blocked" : "caution";
      warnings.push({
        layer: 6,
        severity: sev,
        message:
          permAction === "deny"
            ? "Command denied by permission rules"
            : "Command requires confirmation by permission rules",
      });
      if (permAction === "deny") return this.result("blocked", warnings, commands);
    }

    return this.result(this.overallSeverity(warnings), warnings, commands);
  }

  // ---- layer implementations ----

  private layer1(command: string): SafetyWarning | null {
    for (const { pattern, reason } of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return { layer: 1, severity: "blocked", message: reason };
      }
    }
    return null;
  }

  private layer3(commands: SimpleCommand[]): SafetyWarning[] {
    const warnings: SafetyWarning[] = [];
    for (const cmd of commands) {
      const text = cmd.text || cmd.argv.join(" ");
      for (const dp of DANGEROUS_PATTERNS) {
        if (dp.pattern.test(text)) {
          warnings.push({
            layer: 3,
            severity: dp.severity,
            message: dp.reason,
            segment: text.length > 120 ? text.slice(0, 120) + "..." : text,
          });
        }
      }
    }
    return warnings;
  }

  private layer4(commands: SimpleCommand[]): SafetyWarning[] {
    const warnings: SafetyWarning[] = [];
    for (const cmd of commands) {
      const info = checkSemantics(cmd);
      if (info.isEvalLike) {
        warnings.push({
          layer: 4,
          severity: "dangerous",
          message: `Command '${info.commandName}' can execute dynamic code`,
          segment: cmd.text,
        });
      }
    }
    return warnings;
  }

  private layer5(commands: SimpleCommand[]): SafetyWarning[] {
    const warnings: SafetyWarning[] = [];
    for (const cmd of commands) {
      for (const redirect of cmd.redirects) {
        const expanded = redirect.target.startsWith("~")
          ? redirect.target.replace(/^~/, "/home")
          : redirect.target;
        for (const { pattern, reason } of DANGEROUS_REDIRECT_PATHS) {
          if (pattern.test(expanded)) {
            warnings.push({
              layer: 5,
              severity: "blocked",
              message: `${reason} (redirect target: ${redirect.target})`,
              segment: cmd.text,
            });
            break;
          }
        }
      }
      // Path traversal in args
      for (const arg of cmd.argv) {
        if (/(?:^|\/)\.\.\/(?:\.\.\/)/.test(arg)) {
          warnings.push({
            layer: 5,
            severity: "caution",
            message: `Path traversal in argument: ${arg}`,
            segment: cmd.text,
          });
        }
      }
    }
    return warnings;
  }

  private layer6(commands: SimpleCommand[]): "deny" | "ask" | null {
    for (const cmd of commands) {
      const cmdText = cmd.argv.join(" ");

      // Check multi-word rules first
      for (const rule of this.permissionRules) {
        if (rule.pattern.includes(" ") && matchWildcard(rule.pattern, cmdText)) {
          if (rule.action === "deny") return "deny";
          if (rule.action === "ask") return "ask";
        }
      }
      // Then single-word rules
      for (const rule of this.permissionRules) {
        if (!rule.pattern.includes(" ") && matchWildcard(rule.pattern, cmd.argv[0] ?? "")) {
          if (rule.action === "deny") return "deny";
          if (rule.action === "ask") return "ask";
        }
      }
    }
    return null;
  }

  // ---- helpers ----

  private overallSeverity(warnings: SafetyWarning[]): SafetySeverity {
    if (warnings.some((w) => w.severity === "blocked")) return "blocked";
    if (warnings.some((w) => w.severity === "dangerous")) return "dangerous";
    if (warnings.some((w) => w.severity === "caution")) return "caution";
    return "safe";
  }

  private result(
    severity: SafetySeverity,
    warnings: SafetyWarning[],
    commands: SimpleCommand[],
  ): SafetyResult {
    return {
      severity,
      warnings,
      reason:
        warnings.length > 0
          ? warnings.map((w) => `[L${w.layer}] ${w.message}`).join("; ")
          : severity === "safe"
            ? "Command appears safe"
            : "Safety check passed",
      requiresConfirmation: severity === "blocked" || severity === "dangerous",
      commands,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton + convenience
// ---------------------------------------------------------------------------

let defaultPipeline: SafetyPipeline | null = null;

export function getSafetyPipeline(): SafetyPipeline {
  if (!defaultPipeline) defaultPipeline = new SafetyPipeline();
  return defaultPipeline;
}

export function checkCommand(command: string): SafetyResult {
  return getSafetyPipeline().check(command);
}

export function needsConfirmation(command: string): boolean {
  return checkCommand(command).requiresConfirmation;
}

export function isBlocked(command: string): boolean {
  return checkCommand(command).severity === "blocked";
}

export function getSafetyReport(command: string): string {
  const result = checkCommand(command);
  const lines: string[] = [
    `Severity: ${result.severity.toUpperCase()}`,
    `Commands detected: ${result.commands.length}`,
  ];
  for (const w of result.warnings) {
    lines.push(`  [Layer ${w.layer}] ${w.severity}: ${w.message}`);
  }
  if (result.requiresConfirmation) lines.push("Requires user confirmation.");
  return lines.join("\n");
}
