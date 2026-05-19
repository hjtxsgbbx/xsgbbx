/**
 * Bash Security Validator — barrel export.
 *
 * Re-exports all types, validators, and utility functions from the
 * bash-security module for easy consumption.
 */

// ─────────────────── Main validator ───────────────────
export {
  VALIDATORS,
  validateCommandSecurity,
  validateWithReport,
  isCommandSafe,
  isCommandDenied,
  requiresConfirmation,
  createContext,
} from './bash-security-validator.js';

export type {
  ValidationContext,
  ValidatorResult,
  ValidatorFn,
  ValidationReport,
} from './bash-security-validator.js';

// ─────────────────── Individual checks ───────────────────
export {
  checkEmptyCommand,
  checkIncompletePipe,
  checkIncompleteBoolean,
  checkIncompleteHeredoc,
  checkUnmatchedDelimiters,
} from './command-structure-checks.js';

export {
  checkUnescapedMetacharacters,
  checkCommandSubstitution,
  checkParameterExpansion,
  checkIFSManipulation,
  checkSensitiveOutputRedirect,
  checkSensitiveInputRedirect,
  checkProcessSubstitution,
  checkUnicodeHomoglyphs,
} from './shell-injection-checks.js';

export {
  checkJqSystemCall,
  checkJqFileBypass,
} from './jq-security-checks.js';

export {
  checkGitShellInjection,
} from './git-security-checks.js';

export {
  checkProcAccess,
  checkControlCharacters,
  checkBase64Payload,
  checkPipeToShell,
  checkSudoWithoutCommand,
  checkChmodSuspicious,
} from './safety-detection.js';

export {
  checkZshDangerousBuiltins,
} from './zsh-security-checks.js';

// ─────────────────── Utilities ───────────────────
export {
  extractQuotedContent,
  stripSafeRedirections,
  hasUnescapedChar,
  findUnescapedChars,
  isSafelyQuoted,
} from './quote-extraction.js';
