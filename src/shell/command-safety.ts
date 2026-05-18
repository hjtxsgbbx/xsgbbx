/**
 * Legacy shell command safety analyzer — now delegates to the enhanced
 * 6-layer safety pipeline (safety-checker.ts).
 *
 * Maintains backward compatibility with the original API surface while
 * routing all checks through the new layered pipeline.
 *
 * DeepSeek adaptation: no Anthropic-specific safety headers, so we do
 * more aggressive client-side validation.
 */

import {
  checkCommand,
  type SafetySeverity,
  type SafetyResult,
} from "./safety-checker.js";

// Re-export types for backward compat
export type { SafetySeverity, SafetyResult };

/**
 * Analyze a shell command for safety. Delegates to the 6-layer pipeline.
 */
export function analyzeCommand(command: string): SafetyResult {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return {
      severity: "safe",
      warnings: [],
      reason: "Empty command",
      requiresConfirmation: false,
      commands: [],
    };
  }
  return checkCommand(command);
}

/**
 * Quick check: does this command need confirmation?
 */
export function needsConfirmation(command: string): boolean {
  return analyzeCommand(command).requiresConfirmation;
}

/**
 * Check if a command is blocked (should never be allowed).
 */
export function isBlocked(command: string): boolean {
  return analyzeCommand(command).severity === "blocked";
}

/**
 * Get a human-readable safety report for a command.
 */
export function getSafetyReport(command: string): string {
  const result = analyzeCommand(command);
  const lines: string[] = [
    `Severity: ${result.severity.toUpperCase()}`,
    `Reason: ${result.reason}`,
    `Pipeline segments: ${result.commands.length}`,
  ];
  if (result.warnings.length > 0) {
    lines.push("Warnings:");
    for (const w of result.warnings) {
      lines.push(`  - [L${w.layer}] ${w.severity}: ${w.message}`);
    }
  }
  if (result.requiresConfirmation) {
    lines.push("Requires user confirmation before execution.");
  }
  return lines.join("\n");
}
