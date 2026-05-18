/**
 * AST Security Analyzer — walks the bash AST to extract SimpleCommand[]
 * for per-segment security checks.
 *
 * Fail-closed design: only decomposes allow-listed node types. An
 * unrecognized node type anywhere in the tree returns 'too-complex'.
 */

import type { AstNode } from "./bash-parser.js";

// ---------------------------------------------------------------------------
// SimpleCommand — the decomposed form used by downstream safety checks
// ---------------------------------------------------------------------------

export interface SimpleCommand {
  /** Argument vector — first element is the command name. */
  argv: string[];
  /** Environment variable assignments (e.g. FOO=bar) preceding the command. */
  envVars: Record<string, string>;
  /** I/O redirects extracted from the AST node. */
  redirects: Array<{ operator: string; target: string }>;
  /** Original source text of this command segment. */
  text: string;
}

// ---------------------------------------------------------------------------
// Allow-listed node types that we know how to decompose safely
// ---------------------------------------------------------------------------

const DECOMPOSABLE_TYPES: ReadonlySet<string> = new Set([
  "program",
  "pipeline",
  "list",
  "command",
  "word",
  "file_redirect",
  "string",
  "raw_string",
  "concatenation",
  "simple_expansion",
  "command_substitution",
  "subshell",
  "heredoc_start",
  "heredoc_body",
  "heredoc_end",
  "arithmetic_expansion",
]);

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type AnalyzerResult =
  | { kind: "ok"; commands: SimpleCommand[] }
  | { kind: "too-complex"; reason: string }
  | { kind: "parse-unavailable"; reason: string };

// ---------------------------------------------------------------------------
// Node type guard
// ---------------------------------------------------------------------------

function isDecomposable(node: AstNode): boolean {
  return DECOMPOSABLE_TYPES.has(node.type);
}

// ---------------------------------------------------------------------------
// Environment variable assignment detection
// ---------------------------------------------------------------------------

const ENV_ASSIGN_RE = /^[a-zA-Z_][a-zA-Z0-9_]*=.*$/;

function isEnvAssignment(word: string): boolean {
  return ENV_ASSIGN_RE.test(word);
}

function parseEnvAssignment(word: string): [string, string] | null {
  const eqIdx = word.indexOf("=");
  if (eqIdx <= 0) return null;
  const name = word.slice(0, eqIdx);
  const value = word.slice(eqIdx + 1);
  // Strip surrounding quotes from value
  const stripped =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
      ? value.slice(1, -1)
      : value;
  return [name, stripped];
}

// ---------------------------------------------------------------------------
// Word extraction — collect plain words from a node tree, skipping
// redirects and other structural nodes.
// ---------------------------------------------------------------------------

function extractWords(node: AstNode): string[] {
  const words: string[] = [];

  function walk(n: AstNode): void {
    switch (n.type) {
      case "word":
      case "raw_string":
        words.push(n.text);
        break;
      case "string":
        // Quoted string — strip outer quotes for argv
        words.push(unquote(n.text));
        break;
      case "command":
      case "pipeline":
      case "list":
      case "program":
        for (const child of n.children) walk(child);
        break;
      case "file_redirect":
      case "heredoc_start":
      case "heredoc_body":
      case "heredoc_end":
      case "arithmetic_expansion":
        // Skip — these don't contribute to argv
        break;
      case "concatenation":
      case "simple_expansion":
      case "command_substitution":
      case "subshell":
        // These are dynamic — include the raw text as an opaque argument
        // so downstream checkers can apply regex patterns to them
        words.push(n.text);
        break;
      default:
        break;
    }
  }

  walk(node);
  return words;
}

function unquote(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Redirect extraction
// ---------------------------------------------------------------------------

function extractRedirects(node: AstNode): Array<{ operator: string; target: string }> {
  const redirects: Array<{ operator: string; target: string }> = [];

  function walk(n: AstNode): void {
    if (n.type === "file_redirect" && n.children.length >= 2) {
      const op = n.children[0].text;
      const target = n.children[1].text;
      redirects.push({ operator: op, target });
      return;
    }
    for (const child of n.children) walk(child);
  }

  walk(node);
  return redirects;
}

// ---------------------------------------------------------------------------
// Walk the AST and collect SimpleCommand[] for each leaf command
// ---------------------------------------------------------------------------

function collectCommands(node: AstNode, depth: number, maxDepth: number): SimpleCommand[] {
  if (depth > maxDepth) {
    throw new Error("max traversal depth exceeded");
  }

  // TypeScript exhaustiveness: if this node type is not allow-listed, fail closed
  if (!isDecomposable(node)) {
    throw new Error(`non-decomposable node type: ${node.type}`);
  }

  const results: SimpleCommand[] = [];

  switch (node.type) {
    case "program":
    case "pipeline":
    case "list":
      // Recurse into children
      for (const child of node.children) {
        results.push(...collectCommands(child, depth + 1, maxDepth));
      }
      break;

    case "command": {
      const words = extractWords(node);
      const redirects = extractRedirects(node);
      const envVars: Record<string, string> = {};

      // Separate env assignments from argv
      const argv: string[] = [];
      let doneAssignments = false;
      for (const w of words) {
        if (!doneAssignments && isEnvAssignment(w)) {
          const parsed = parseEnvAssignment(w);
          if (parsed) {
            envVars[parsed[0]] = parsed[1];
            continue;
          }
        }
        // First non-assignment word starts argv (command name)
        doneAssignments = true;
        argv.push(w);
      }

      // Only emit a SimpleCommand if there is at least a command name
      if (argv.length > 0 || Object.keys(envVars).length > 0 || redirects.length > 0) {
        results.push({
          argv,
          envVars,
          redirects,
          text: node.text,
        });
      }
      break;
    }

    case "subshell":
    case "command_substitution":
      // Mark as opaque — downstream checkers will scan the raw text
      results.push({
        argv: [node.text],
        envVars: {},
        redirects: [],
        text: node.text,
      });
      break;

    // Leaf types we encounter during walk — skip (they're handled by extractWords)
    case "word":
    case "string":
    case "raw_string":
    case "file_redirect":
    case "simple_expansion":
    case "arithmetic_expansion":
    case "concatenation":
    case "heredoc_start":
    case "heredoc_body":
    case "heredoc_end":
      // These should only appear as children of 'command', not at top level.
      // If we hit them here, skip gracefully.
      break;

    default:
      // Exhaustiveness: unknown type that slipped through isDecomposable
      throw new Error(`unhandled node type: ${node.type}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MAX_TRAVERSAL_DEPTH = 64;

/**
 * Walk a parsed AST and extract decomposed SimpleCommand objects.
 *
 * Returns:
 *  - { kind: 'ok', commands } on success
 *  - { kind: 'too-complex', reason } when the AST cannot be safely decomposed
 *  - { kind: 'parse-unavailable', reason } when the AST itself is null/invalid
 */
export function parseForSecurity(ast: AstNode | null): AnalyzerResult {
  if (!ast) {
    return { kind: "parse-unavailable", reason: "null AST" };
  }

  if (!isDecomposable(ast)) {
    return {
      kind: "too-complex",
      reason: `root node type '${ast.type}' is not decomposable`,
    };
  }

  try {
    const commands = collectCommands(ast, 0, MAX_TRAVERSAL_DEPTH);

    // Cap results — if we got an absurd number of commands, something is wrong
    if (commands.length > 1000) {
      return { kind: "too-complex", reason: "excessive command count from AST" };
    }

    return { kind: "ok", commands };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "too-complex", reason: msg };
  }
}

// ---------------------------------------------------------------------------
// Command semantics — detect eval-like builtins and exit-code semantics
// ---------------------------------------------------------------------------

/**
 * Builtins that dynamically evaluate string arguments as code.
 * These are dangerous even if the rest of the command looks safe.
 */
const EVAL_LIKE_BUILTINS = new Set([
  "eval",
  "source",
  ".",
  "exec",
]);

/**
 * Shells / interpreters invoked with -c, -e, or similar flags
 * that execute a string argument as code.
 */
const INTERPRETER_EXEC_FLAGS: Array<{ cmd: string; flags: string[] }> = [
  { cmd: "bash", flags: ["-c"] },
  { cmd: "sh", flags: ["-c"] },
  { cmd: "zsh", flags: ["-c"] },
  { cmd: "dash", flags: ["-c"] },
  { cmd: "node", flags: ["-e", "-p", "--eval", "--print"] },
  { cmd: "python", flags: ["-c"] },
  { cmd: "python3", flags: ["-c"] },
  { cmd: "ruby", flags: ["-e"] },
  { cmd: "perl", flags: ["-e"] },
  { cmd: "php", flags: ["-r"] },
];

export interface SemanticInfo {
  /** The base command name (e.g. 'grep', 'eval', 'node'). */
  commandName: string;
  /** True if this command is eval-like (dynamic code execution). */
  isEvalLike: boolean;
  /** True if non-zero exit codes are NOT errors for this command. */
  exitCodeIsMeaningful: boolean;
}

/**
 * Commands whose non-zero exit codes carry semantics (not errors):
 *  - grep: exit 1 = no matches
 *  - diff: exit 1 = differences found
 *  - find: exit 1 = ... (actually find exits 0 normally; but some flags change this)
 *  - test / [: exit 1 = condition false
 *  - cmp: exit 1 = files differ
 */
const MEANINGFUL_EXIT_CODES = new Set([
  "grep", "egrep", "fgrep", "zgrep",
  "diff", "cmp",
  "test", "[",
]);

export function checkSemantics(cmd: SimpleCommand): SemanticInfo {
  if (cmd.argv.length === 0) {
    return { commandName: "", isEvalLike: false, exitCodeIsMeaningful: false };
  }

  const base = extractBaseCommand(cmd.argv[0]);

  // Check eval-like builtins
  if (EVAL_LIKE_BUILTINS.has(base)) {
    return { commandName: base, isEvalLike: true, exitCodeIsMeaningful: false };
  }

  // Check interpreter + exec-flag combinations
  for (const { cmd: interpreterName, flags } of INTERPRETER_EXEC_FLAGS) {
    if (base === interpreterName) {
      // Check if any exec flag appears in argv
      for (let i = 1; i < cmd.argv.length; i++) {
        if (flags.includes(cmd.argv[i])) {
          return { commandName: base, isEvalLike: true, exitCodeIsMeaningful: false };
        }
      }
      break;
    }
  }

  return {
    commandName: base,
    isEvalLike: false,
    exitCodeIsMeaningful: MEANINGFUL_EXIT_CODES.has(base),
  };
}

function extractBaseCommand(argv0: string): string {
  // /usr/bin/git → git; ./script.sh → script.sh; node → node
  const parts = argv0.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || argv0;
}
