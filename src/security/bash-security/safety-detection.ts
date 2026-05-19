/**
 * Safety detection checks for bash command security.
 *
 * Check IDs 13, 17-19, 22-23 — detects dangerous command patterns that
 * indicate malicious intent, privilege escalation, or data exfiltration.
 *
 * These checks align with Claude Code's bashSecurity.ts design:
 * 13. Reading/writing /proc/ files
 * 17. Control characters in command
 * 18. Base64-encoded payloads in command
 * 19. curl/wget piping to shell interpreter
 * 22. sudo/doas without explicit command
 * 23. chmod +x on suspicious files
 */

import type { ValidationContext, ValidatorResult } from './bash-security-validator.js';

// ---------------------------------------------------------------------------
// Check 13: Reading/writing /proc/ files
// ---------------------------------------------------------------------------

const PROC_READ_WRITE_PATTERNS = [
  // Writing to /proc entries
  /\/proc\/sys\/(kernel|net|vm|fs)\//,
  /\/proc\/([0-9]+)\/(mem|maps|environ|fd|cwd|root|exe)\b/,
  /\/proc\/self\/(mem|maps|environ|fd|cwd|root|exe)\b/,
  // Reading sensitive /proc entries
  /<\s*\/proc\/([0-9]+)\/mem\b/,
  /<\s*\/proc\/kcore\b/,
  /<\s*\/proc\/kallsyms\b/,
];

/**
 * /proc filesystem access to kernel parameters, process memory, or
 * process internals is a serious security risk. Writing to /proc/sys
 * changes kernel behavior. Reading /proc/PID/mem reads process memory.
 */
export function checkProcAccess(ctx: ValidationContext): ValidatorResult {
  for (const pattern of PROC_READ_WRITE_PATTERNS) {
    const match = pattern.exec(ctx.command);
    if (match) {
      return {
        kind: 'deny',
        checkId: 13,
        message: `Access to /proc detected: ${match[0]}. ` +
          'Reading/writing /proc entries can modify kernel behavior ' +
          'or access other process memory.',
      };
    }
  }

  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// Check 17: Control characters in command
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/;

/**
 * Control characters (except tab, CR, LF) in shell commands are almost
 * certainly malicious. They can:
 * - Hide commands from terminal display (e.g., \x08 backspace to overwrite)
 * - Bypass string-based filtering (injection hidden inside control chars)
 * - Corrupt log files or audit trails
 */
export function checkControlCharacters(ctx: ValidationContext): ValidatorResult {
  if (CONTROL_CHAR_RE.test(ctx.command)) {
    // Locate the first offending character
    const match = CONTROL_CHAR_RE.exec(ctx.command)!;
    const charCode = match[0].charCodeAt(0);

    return {
      kind: 'deny',
      checkId: 17,
      message: `Control character (0x${charCode.toString(16).padStart(2, '0')}) detected in command. ` +
        'Control characters can hide or obfuscate malicious commands.',
    };
  }

  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// Check 18: Base64-encoded payloads in command
// ---------------------------------------------------------------------------

const BASE64_PAYLOAD_RE = /\b(?:echo\s+)?(['"]?)([A-Za-z0-9+/]{12,}={0,2})\1\s*\|\s*(?:base64|openssl\s+base64)\s*(?:-d|--decode)\b/i;

/**
 * Detects base64-encoded strings piped to a decoder. This is a common
 * obfuscation technique for hiding malicious payloads.
 *
 * Examples:
 *   echo "d2dldCBldmlsLmNvbS9zaGVsbC5zaA==" | base64 -d | sh
 *   echo cHl0aG9uIC1jICdpbXBvcnQgb3M7IG9zLnN5c3RlbSgibHMiKSc= | base64 --decode | bash
 */
export function checkBase64Payload(ctx: ValidationContext): ValidatorResult {
  if (BASE64_PAYLOAD_RE.test(ctx.command)) {
    return {
      kind: 'deny',
      checkId: 18,
      message: 'Base64-encoded payload detected being piped to a decoder. ' +
        'This is a common obfuscation technique for hiding malicious commands.',
    };
  }

  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// Check 19: curl/wget piping to shell interpreter
// ---------------------------------------------------------------------------

const PIPE_TO_SHELL_PATTERNS = [
  // curl/wget piped directly to bash/sh/zsh/dash
  /\b(?:curl|wget)\b.*\|\s*(?:ba)?sh\b/,
  /\b(?:curl|wget)\b.*\|\s*(?:zsh|dash|ksh)\b/,
  // With -s silent flag
  /\b(?:curl\s+-s\S*|wget\s+-q\S*)\b.*\|\s*(?:ba)?sh\b/,
  // Using -o- to pipe to stdout then to shell
  /\bwget\s+-O-?\s*\S+.*\|\s*(?:ba)?sh\b/,
  // curl piping to python/perl/ruby interpreter
  /\b(?:curl|wget)\b.*\|\s*(?:python|perl|ruby|node)\b/,
  // source /dev/stdin pattern
  /\b(?:curl|wget)\b.*\|\s*(?:source|\.)\s+\/dev\/stdin\b/,
];

/**
 * Piping curl or wget output directly into a shell interpreter is the
 * most common remote code execution pattern. The remote server controls
 * the script content, so this is effectively arbitrary code execution.
 *
 * This is the #1 real-world attack vector for shell injection.
 */
export function checkPipeToShell(ctx: ValidationContext): ValidatorResult {
  for (const pattern of PIPE_TO_SHELL_PATTERNS) {
    if (pattern.test(ctx.command)) {
      return {
        kind: 'deny',
        checkId: 19,
        message: 'curl/wget output piped to a shell interpreter detected. ' +
          'This is a remote code execution vector — the remote server ' +
          'controls the script content.',
      };
    }
  }

  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// Check 22: sudo/doas without explicit command
// ---------------------------------------------------------------------------

const SUDO_AMBIGUOUS_PATTERNS = [
  // sudo at end of string with no command
  /(?:^|[\s;&|])(?:sudo|doas)\s*$/,
  // sudo with only -flags but no command
  /(?:^|[\s;&|])(?:sudo|doas)(?:\s+-[A-Za-z]+)*\s*$/,
  // sudo -i (interactive root shell)
  /(?:^|[\s;&|])(?:sudo|doas)\s+-i\b/,
  // sudo su — getting a root shell
  /(?:^|[\s;&|])(?:sudo|doas)\s+su\b/,
  // sudo /bin/bash or sudo bash (interactive root shell)
  /(?:^|[\s;&|])(?:sudo|doas)\s+(?:\/usr\/bin\/|\/bin\/)?(?:ba)?sh\b/,
];

/**
 * sudo or doas without a specific command can give an interactive root
 * shell. Even sudo with a specific command is concerning but may be
 * legitimate — we flag only clearly dangerous patterns.
 */
export function checkSudoWithoutCommand(ctx: ValidationContext): ValidatorResult {
  for (const pattern of SUDO_AMBIGUOUS_PATTERNS) {
    if (pattern.test(ctx.command)) {
      return {
        kind: 'deny',
        checkId: 22,
        message: 'sudo/doas detected without an explicit, safe command. ' +
          'Privilege escalation without a specific command is dangerous.',
      };
    }
  }

  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// Check 23: chmod +x on suspicious files
// ---------------------------------------------------------------------------

const CHMOD_SUSPICIOUS_PATTERNS = [
  // chmod on files in /tmp, /dev/shm, /var/tmp (world-writable dirs)
  /chmod\s+(?:[0-7]+\s+|[+a-z]+x\s+)(?:\/tmp\/|\/dev\/shm\/|\/var\/tmp\/)\S+/,
  // chmod on hidden files in writable dirs
  /chmod\s+(?:[0-7]+\s+|[+a-z]+x\s+)\/tmp\/\.\S+/,
  // chmod making suid/guid binaries (octal with setuid/setgid bit)
  /chmod\s+[46][0-7]{3}\s+(?:\/tmp\/|\/dev\/shm\/|\/var\/tmp\/)\S+/,
  // chmod +x on files with suspicious extensions in /tmp or /dev/shm
  /chmod\s+\+x\s+(?:\/tmp\/|\/dev\/shm\/|\/var\/tmp\/)\S+\.(?:sh|bash|py|pl|rb|php)\b/,
];

/**
 * chmod +x on files in world-writable directories or creating SUID
 * binaries are privilege escalation primitives. An attacker who can
 * write to /tmp can place a malicious script there and make it executable.
 */
export function checkChmodSuspicious(ctx: ValidationContext): ValidatorResult {
  for (const pattern of CHMOD_SUSPICIOUS_PATTERNS) {
    const match = pattern.exec(ctx.command);
    if (match) {
      return {
        kind: 'deny',
        checkId: 23,
        message: `Suspicious chmod usage: ${match[0]}. ` +
          'Making files executable in shared directories or creating SUID binaries ' +
          'is a privilege escalation vector.',
      };
    }
  }

  return { kind: 'passthrough' };
}
