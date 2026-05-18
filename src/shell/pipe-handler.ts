/**
 * Pipe Segment Handler — splits shell commands by pipe operators and
 * runs each segment through the full safety pipeline independently.
 *
 * Key behaviors:
 *  - Splits by | and |& but NOT by && or ;
 *  - Each segment goes through the full safety pipeline independently
 *  - Detects cd + destructive git cross-segment attacks
 *  - Strips output redirections before permission-checking each segment
 */

import {
  SafetyPipeline,
  type SafetyResult,
  type SafetyWarning,
  type PermissionRule,
} from "./safety-checker.js";

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export interface PipeSegment {
  /** The raw text of this pipe segment (after splitting but before stripping). */
  raw: string;
  /** The text with output redirections stripped (for permission checking). */
  stripped: string;
  /** The safety analysis result for this segment. */
  safety: SafetyResult;
}

export interface PipeAnalysis {
  /** All pipe segments, in order. */
  segments: PipeSegment[];
  /** The overall safety verdict (worst severity across all segments). */
  overallSeverity: SafetyResult["severity"];
  /** Combined warnings from all segments + cross-segment analysis. */
  allWarnings: SafetyWarning[];
  /** Whether any segment requires confirmation. */
  requiresConfirmation: boolean;
  /** Cross-segment attack warnings (e.g. cd + destructive git). */
  crossSegmentWarnings: SafetyWarning[];
}

// ---------------------------------------------------------------------------
// Pipe splitting — split on | or |& but not on &&, ||, ;
// ---------------------------------------------------------------------------

/**
 * Split a command string into pipe segments.
 *
 * Splits on `|` and `|&`, but protects against splitting inside:
 *  - Single-quoted strings
 *  - Double-quoted strings
 *  - Backtick-delimited command substitutions
 *  - $( ) command substitutions
 */
export function splitPipes(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let i = 0;
  const len = command.length;

  while (i < len) {
    const ch = command[i];

    // Single-quoted string — consume until closing quote
    if (ch === "'") {
      current += ch;
      i++;
      while (i < len && command[i] !== "'") {
        if (command[i] === "\\" && i + 1 < len) {
          current += command[i]; // backslash
          i++;
        }
        current += command[i];
        i++;
      }
      if (i < len) {
        current += "'";
        i++;
      }
      continue;
    }

    // Double-quoted string
    if (ch === '"') {
      current += ch;
      i++;
      while (i < len && command[i] !== '"') {
        if (command[i] === "\\" && i + 1 < len) {
          current += command[i];
          i++;
        }
        current += command[i];
        i++;
      }
      if (i < len) {
        current += '"';
        i++;
      }
      continue;
    }

    // Backtick command substitution
    if (ch === "`") {
      current += ch;
      i++;
      while (i < len && command[i] !== "`") {
        if (command[i] === "\\" && i + 1 < len) {
          current += command[i];
          i++;
        }
        current += command[i];
        i++;
      }
      if (i < len) {
        current += "`";
        i++;
      }
      continue;
    }

    // $( ) command substitution
    if (ch === "$" && i + 1 < len && command[i + 1] === "(") {
      current += "$(";
      i += 2;
      let parenDepth = 1;
      while (i < len && parenDepth > 0) {
        if (command[i] === "(") parenDepth++;
        else if (command[i] === ")") parenDepth--;
        // Handle nested quotes inside $( )
        if (command[i] === "'") {
          current += "'";
          i++;
          while (i < len && command[i] !== "'") {
            current += command[i];
            i++;
          }
          if (i < len) current += "'";
          i++;
          continue;
        }
        if (command[i] === '"') {
          current += '"';
          i++;
          while (i < len && command[i] !== '"') {
            if (command[i] === "\\" && i + 1 < len) {
              current += command[i];
              i++;
            }
            current += command[i];
            i++;
          }
          if (i < len) current += '"';
          i++;
          continue;
        }
        current += command[i];
        i++;
      }
      continue;
    }

    // Pipe operators — `|&` first (longest match), then `|`
    if (ch === "|" && i + 1 < len && command[i + 1] === "&") {
      // |& — piped with stderr
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        segments.push(trimmed);
      }
      current = "";
      i += 2;
      continue;
    }

    if (ch === "|") {
      // Plain pipe
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        segments.push(trimmed);
      }
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  // Final segment
  const trimmed = current.trim();
  if (trimmed.length > 0) {
    segments.push(trimmed);
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Redirect stripping — remove output redirections from segment text
// ---------------------------------------------------------------------------

const REDIRECT_RE = /\s*([0-9]*>>?|&>>?|[0-9]*&>>?|2>>?|1>>?)\s*\S+/g;

/**
 * Strip output redirection targets from a command string so permission
 * checking operates on the logical command, not the I/O plumbing.
 */
export function stripOutputRedirects(segment: string): string {
  return segment.replace(REDIRECT_RE, "").trim();
}

// ---------------------------------------------------------------------------
// Cross-segment attack detection
// ---------------------------------------------------------------------------

/**
 * Detect patterns like `cd /somewhere && git push --force` or
 * `cd /critical/path | destructive-cmd` — where one segment changes
 * directory and another performs a destructive action.
 */
const DESTRUCTIVE_GIT_PATTERNS = [
  /git\s+(push\s+(-f|--force)|reset\s+--hard|clean\s+-[fdx])/,
  /git\s+push\s+--delete/,
];

const DESTRUCTIVE_FS_PATTERNS = [
  /rm\s+(-[rRf]+\s*)+/,
  /chmod\s+(-R\s+)?7[0-7][0-7]/,
  /chown\s+-R/,
];

export function detectCrossSegmentAttacks(segments: PipeSegment[]): SafetyWarning[] {
  const warnings: SafetyWarning[] = [];
  const rawTexts = segments.map((s) => s.raw);

  // Check if any segment contains cd
  const hasCd = rawTexts.some((s) => /(^|\s|;|&&|\|\||`|\$\(|^)cd\s/.test(s));

  if (hasCd) {
    // Check for destructive git in other segments
    for (let i = 0; i < rawTexts.length; i++) {
      for (const pattern of DESTRUCTIVE_GIT_PATTERNS) {
        if (pattern.test(rawTexts[i])) {
          warnings.push({
            layer: 0,
            severity: "dangerous",
            message: `Cross-segment attack: cd detected with destructive git in segment ${i + 1}`,
            segment: rawTexts[i],
          });
        }
      }
    }

    // Check for destructive fs ops
    for (let i = 0; i < rawTexts.length; i++) {
      for (const pattern of DESTRUCTIVE_FS_PATTERNS) {
        if (pattern.test(rawTexts[i])) {
          warnings.push({
            layer: 0,
            severity: "dangerous",
            message: `Cross-segment attack: cd detected with destructive filesystem operation in segment ${i + 1}`,
            segment: rawTexts[i],
          });
        }
      }
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Pipe handler
// ---------------------------------------------------------------------------

export interface PipeHandlerOptions {
  permissionRules?: PermissionRule[];
}

export class PipeHandler {
  private pipeline: SafetyPipeline;

  constructor(options: PipeHandlerOptions = {}) {
    this.pipeline = new SafetyPipeline({ permissionRules: options.permissionRules });
  }

  /**
   * Analyze a full shell command line by splitting it at pipe boundaries
   * and running each segment through the safety pipeline independently.
   */
  analyze(command: string): PipeAnalysis {
    const segments = splitPipes(command);

    // If single command (no pipes), run through pipeline directly
    if (segments.length <= 1) {
      const safety = this.pipeline.check(command);
      const stripped = stripOutputRedirects(command);
      return {
        segments: [{ raw: command, stripped, safety }],
        overallSeverity: safety.severity,
        allWarnings: safety.warnings,
        requiresConfirmation: safety.requiresConfirmation,
        crossSegmentWarnings: [],
      };
    }

    // Multi-segment: analyze each independently
    const pipeSegments: PipeSegment[] = segments.map((seg) => {
      const stripped = stripOutputRedirects(seg);
      const safety = this.pipeline.check(stripped);
      return { raw: seg, stripped, safety };
    });

    const crossWarnings = detectCrossSegmentAttacks(pipeSegments);

    const allWarnings: SafetyWarning[] = [];
    for (const seg of pipeSegments) {
      allWarnings.push(...seg.safety.warnings);
    }
    allWarnings.push(...crossWarnings);

    // Compute overall severity: worst across all segments + cross-segment
    const overallSeverity = computeOverall(
      pipeSegments.map((s) => s.safety),
      crossWarnings,
    );

    return {
      segments: pipeSegments,
      overallSeverity,
      allWarnings,
      requiresConfirmation:
        overallSeverity === "blocked" ||
        overallSeverity === "dangerous" ||
        crossWarnings.length > 0,
      crossSegmentWarnings: crossWarnings,
    };
  }
}

function computeOverall(
  results: SafetyResult[],
  crossWarnings: SafetyWarning[],
): SafetyResult["severity"] {
  for (const r of results) {
    if (r.severity === "blocked") return "blocked";
  }
  if (crossWarnings.some((w) => w.severity === "blocked")) return "blocked";

  for (const r of results) {
    if (r.severity === "dangerous") return "dangerous";
  }
  if (crossWarnings.some((w) => w.severity === "dangerous")) return "dangerous";

  for (const r of results) {
    if (r.severity === "caution") return "caution";
  }
  if (crossWarnings.some((w) => w.severity === "caution")) return "caution";

  return "safe";
}

// ---------------------------------------------------------------------------
// Singleton + convenience
// ---------------------------------------------------------------------------

let defaultHandler: PipeHandler | null = null;

export function getPipeHandler(): PipeHandler {
  if (!defaultHandler) {
    defaultHandler = new PipeHandler();
  }
  return defaultHandler;
}

export function analyzePipes(command: string): PipeAnalysis {
  return getPipeHandler().analyze(command);
}
