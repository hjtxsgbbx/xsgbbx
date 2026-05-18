// ---------------------------------------------------------------------------
// Shell safety module — public API surface
// ---------------------------------------------------------------------------

// Bash parser (pure TS, no native deps)
export { parse, tokenize, BashParser } from "./bash-parser.js";
export type { AstNode, NodeType, ParseResult } from "./bash-parser.js";

// AST security analyzer
export {
  parseForSecurity,
  checkSemantics,
} from "./ast-analyzer.js";
export type { SimpleCommand, AnalyzerResult, SemanticInfo } from "./ast-analyzer.js";

// Enhanced 6-layer safety pipeline (primary entry point)
export {
  SafetyPipeline,
  getSafetyPipeline,
  checkCommand,
  needsConfirmation,
  isBlocked,
  getSafetyReport,
} from "./safety-checker.js";
export type {
  SafetySeverity,
  SafetyResult,
  SafetyWarning,
  PermissionRule,
  SafetyPipelineOptions,
} from "./safety-checker.js";

// Pipe segment handler
export {
  PipeHandler,
  getPipeHandler,
  analyzePipes,
  splitPipes,
  stripOutputRedirects,
  detectCrossSegmentAttacks,
} from "./pipe-handler.js";
export type { PipeSegment, PipeAnalysis, PipeHandlerOptions } from "./pipe-handler.js";

// Legacy compatibility — delegates to new pipeline
export {
  analyzeCommand,
  needsConfirmation as needsConfirmationLegacy,
  isBlocked as isBlockedLegacy,
  getSafetyReport as getSafetyReportLegacy,
} from "./command-safety.js";
export type { SafetySeverity as SafetySeverityLegacy, SafetyResult as SafetyResultLegacy } from "./command-safety.js";
