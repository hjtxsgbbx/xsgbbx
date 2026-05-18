// ---------------------------------------------------------------------------
// entrypoints/index.ts — documented SDK public surface
//
// This module is the canonical entrypoint for SDK consumers.
// All exports are documented and stable.
// ---------------------------------------------------------------------------

// -- Core types: AgentSDK, AgentConfig, Session, QueryDeps, TaskManager ------
export type { AgentSDK, AgentConfig } from "./core-types.js";
export { DEFAULT_AGENT_CONFIG } from "./core-types.js";

// Re-export commonly-referenced internal types through the SDK surface
export type { Session, SessionStore } from "./core-types.js";
export type { AuditLogger } from "./core-types.js";
export type { QueryDeps } from "./core-types.js";
export type { TaskManager } from "./core-types.js";

// -- Tool types: descriptor, discovery, signatures ---------------------------
export type {
  Tool,
  ToolDescriptor,
  ToolFilter,
  ToolSignature,
  JSONSchema,
  ExecutionContext,
  ToolResult,
} from "./tool-types.js";
export {
  toolFromDescriptor,
  discoverTools,
  extractToolSignatures,
} from "./tool-types.js";

// -- Settings types: descriptors, validation, type guards, docs --------------
export { SETTINGS, validateSettings, generateSettingsDocs } from "./settings-types.js";
export type { SettingDescriptor, ValidationResult } from "./settings-types.js";
export { isPermissionMode, isProviderConfig, isMCPConfigItem } from "./settings-types.js";
