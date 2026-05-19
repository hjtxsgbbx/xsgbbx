/**
 * Bash parser module barrel export.
 *
 * Re-exports from all bash sub-modules: tokenizer, core parser, word parser,
 * control-flow/arithmetic parser, AST analysis, and heredoc utilities.
 */

// ────────────────────────── Tokenizer ──────────────────────────
export type {
  TsNode,
  ParserModule,
  Token,
  TokenType,
  Lexer,
  HeredocPending,
} from './bash-tokenizer.js'

export {
  PARSE_TIMEOUT_MS,
  MAX_NODES,
  MODULE,
  SHELL_KEYWORDS,
  DECL_KEYWORDS,
  SPECIAL_VARS,
  ensureParserInitialized,
  getParserModule,
  makeLexer,
  advance,
  peek,
  byteAt,
  isWordChar,
  isWordStart,
  isIdentStart,
  isIdentChar,
  isDigit,
  isHexDigit,
  isBaseDigit,
  isHeredocDelimChar,
  skipBlanks,
  nextToken,
} from './bash-tokenizer.js'

// ────────────────────────── Core Parser ──────────────────────────
export type {
  ParseState,
  LexSave,
} from './bash-parser-core.js'

export {
  parseSource,
  byteLengthUtf8,
  checkBudget,
  mk,
  sliceBytes,
  leaf,
  parseProgram,
  saveLex,
  restoreLex,
  parseStatements,
  parseAndOr,
  skipNewlines,
  parsePipeline,
  parseCommand,
  parseSimpleCommand,
} from './bash-parser-core.js'

// ────────────────────────── Word Parser ──────────────────────────
export {
  maybeRedirect,
  tryParseAssignment,
  parseSubscriptIndexInline,
  parseSubscriptIndex,
  isRedirectLiteralStart,
  tryParseRedirect,
  parseProcessSub,
  scanHeredocBodies,
  parseHeredocBodyContent,
  restoreLexToByte,
  parseWord,
  parseBareWord,
  tryParseBraceExpr,
  tryParseBraceLikeCat,
  parseDoubleQuoted,
  parseDollarLike,
  parseExpansionBody,
} from './bash-parser-word.js'

// ────────────────────── Control / Arithmetic ─────────────────────
export type {
  ArithMode,
} from './bash-parser-ctrl.js'

export {
  parseExpansionRest,
  parseExpansionRegexSegmented,
  parseBacktick,
  parseIf,
  parseWhile,
  parseFor,
  parseDoGroup,
  parseCase,
  parseCaseItem,
  parseCasePattern,
  parseCasePatternSegmented,
  parseFunction,
  parseDeclaration,
  parseUnset,
  consumeKeyword,
  parseTestExpr,
  parseTestOr,
  parseTestAnd,
  parseTestUnary,
  parseTestNegatablePrimary,
  parseTestBinary,
  parseTestRegexRhs,
  parseTestExtglobRhs,
  parseTestPrimary,
  ARITH_PREC,
  ARITH_RIGHT_ASSOC,
  parseArithExpr,
  parseArithCommaList,
  parseArithTernary,
  scanArithOp,
  parseArithBinary,
  parseArithUnary,
  parseArithPostfix,
  parseArithPrimary,
  isArithStop,
} from './bash-parser-ctrl.js'

// ───────────────────────── AST Analysis ─────────────────────────
export type {
  Redirect,
  SimpleCommand,
  ParseForSecurityResult,
  SemanticCheckResult,
} from './bash-ast.js'

export {
  nodeTypeId,
  parseForSecurity,
  parseForSecurityFromAst,
  checkSemantics,
} from './bash-ast.js'

// ───────────────────── Heredoc Utilities ────────────────────────
export type {
  HeredocInfo,
  HeredocExtractionResult,
} from './heredoc.js'

export {
  extractHeredocs,
  restoreHeredocs,
  containsHeredoc,
} from './heredoc.js'
