/**
 * ZSH-specific security checks for bash command security.
 *
 * Check ID 20 — ZSH provides additional builtin commands beyond bash that
 * can load dynamic modules, open network sockets, and manipulate the runtime.
 *
 * These checks align with Claude Code's bashSecurity.ts design:
 * 20. ZSH-specific dangerous builtins
 */

import type { ValidationContext, ValidatorResult } from './bash-security-validator.js';

// ---------------------------------------------------------------------------
// ZSH dangerous builtin commands
// ---------------------------------------------------------------------------

/**
 * ZSH builtins that can load native code, create network connections,
 * or manipulate the shell runtime. These are rarely needed in automated
 * tool contexts and are strong indicators of shell escape attempts.
 *
 * Categories:
 * - Module loading: zmodload loads C modules into the shell
 * - Network: ztcp opens TCP connections, zpty creates pseudo-terminals
 * - Filesystem: zf_* commands manipulate compressed archives (zip/tar)
 * - System calls: sysopen, sysread, syswrite (direct syscall interface)
 * - Emulation: emulate changes shell compatibility mode
 */

interface ZshBuiltin {
  name: string;
  regex: RegExp;
  description: string;
  severity: 'deny' | 'ask';
}

const ZSH_DANGEROUS_BUILTINS: readonly ZshBuiltin[] = [
  {
    name: 'zmodload',
    regex: /\bzmodload\b/,
    description: 'Loads native C shared objects into the shell runtime. ' +
      'Equivalent to arbitrary code execution.',
    severity: 'deny',
  },
  {
    name: 'zpty',
    regex: /\bzpty\b/,
    description: 'Creates pseudo-terminals and commands. Can be used to ' +
      'spawn hidden processes or escape sandboxes.',
    severity: 'deny',
  },
  {
    name: 'ztcp',
    regex: /\bztcp\b/,
    description: 'Opens raw TCP connections from inside the shell. Used for ' +
      'reverse shells or data exfiltration.',
    severity: 'deny',
  },
  {
    name: 'sysopen',
    regex: /\bsysopen\b/,
    description: 'Direct syscall wrapper for opening files. Bypasses shell ' +
      'protections and file descriptor limits.',
    severity: 'deny',
  },
  {
    name: 'sysread',
    regex: /\bsysread\b/,
    description: 'Direct syscall wrapper for reading file descriptors. Can ' +
      'bypass permission checks.',
    severity: 'deny',
  },
  {
    name: 'syswrite',
    regex: /\bsyswrite\b/,
    description: 'Direct syscall wrapper for writing file descriptors. Can ' +
      'write to arbitrary file descriptors.',
    severity: 'deny',
  },
  {
    name: 'emulate',
    regex: /\bemulate\b/,
    description: 'Changes shell compatibility mode at runtime. Can alter ' +
      'command parsing behavior to bypass security checks.',
    severity: 'ask',
  },
  {
    name: 'zf_*',
    regex: /\bzf_(cd|get|put|open|close|flock|stat|delete|mkdir|rmdir|mv|cp|ln|pipe)\b/,
    description: 'ZSH filesystem manipulation commands. Built-in archive/remote ' +
      'file operations that bypass standard tool restrictions.',
    severity: 'deny',
  },
  {
    name: 'zcompile',
    regex: /\bzcompile\b/,
    description: 'Compiles ZSH scripts to bytecode (.zwc files). Can be used ' +
      'to create pre-compiled malicious modules.',
    severity: 'ask',
  },
  {
    name: 'zparseopts',
    regex: /\bzparseopts\b/,
    description: 'Advanced ZSH option parsing that can redefine command ' +
      'behavior dynamically.',
    severity: 'ask',
  },
  {
    name: 'autoload',
    regex: /\bautoload\b/,
    description: 'Auto-loads ZSH functions from file paths. Can execute ' +
      'arbitrary code from user-controlled paths.',
    severity: 'ask',
  },
];

/**
 * Check 20: ZSH-specific dangerous builtins.
 *
 * Only activates when the platform is detected as using ZSH
 * (Darwin/macOS default is zsh, or explicit zsh usage).
 * Returns 'passthrough' if the current platform is unlikely to use ZSH.
 */
export function checkZshDangerousBuiltins(ctx: ValidationContext): ValidatorResult {
  // Only check ZSH-specific threats on platforms where ZSH is common
  if (!isZshLikely(ctx)) {
    return { kind: 'passthrough' };
  }

  for (const builtin of ZSH_DANGEROUS_BUILTINS) {
    if (builtin.regex.test(ctx.command)) {
      return {
        kind: builtin.severity,
        checkId: 20,
        message: `ZSH dangerous builtin "${builtin.name}" detected: ${builtin.description}`,
      };
    }
  }

  return { kind: 'passthrough' };
}

// ---------------------------------------------------------------------------
// ZSH detection
// ---------------------------------------------------------------------------

/**
 * Determine if the current environment is likely using ZSH.
 * ZSH is the default shell on macOS since Catalina (10.15).
 * On Linux, bash is the default but zsh may be installed.
 */
function isZshLikely(ctx: ValidationContext): boolean {
  const platform = ctx.platform.toLowerCase();

  // Darwin (macOS) has zsh as default since 10.15 Catalina
  if (platform === 'darwin') {
    return true;
  }

  // Check for explicit ZSH invocation in the command itself
  if (/\b(?:zsh|zsh-[0-9]+(?:\.[0-9]+)?)\b/.test(ctx.command)) {
    return true;
  }

  // Check for ZSH-specific syntax
  // - Extended glob modifiers: (#q) qualifiers
  // - ZSH-specific parameter flags: ${(flags)var}
  if (/\(\#q[^)]*\)/.test(ctx.command)) {
    return true;
  }
  if (/\$\{[^}]*(?:u|L|U|C|q|Q|z|P|f|F|w|W|c|o|O|s|a|m|t)\b[^}]*\}/.test(ctx.command)) {
    return true;
  }

  return false;
}
