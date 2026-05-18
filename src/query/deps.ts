import type { AIProvider } from "../api/types.js";
import type { Tool } from "../types/index.js";
import type { PermissionPipeline } from "../permissions/index.js";
import type { ToolExecutor } from "../engine/tool-executor.js";
import type { AsyncHookRegistry } from "../hooks/async-hook-registry.js";
import type { CostTracker } from "../observability/cost-tracker.js";
import type { SessionStore } from "../storage/session-store.js";
import type { AuditLogger } from "../storage/audit-logger.js";
import type { QueryConfig } from "./config.js";
import { resolveQueryConfig, queryConfigFromGlobal } from "./config.js";
import { createProviderFromConfig } from "../api/index.js";
import { PermissionPipeline as PermissionPipelineCtor } from "../permissions/index.js";
import { ToolExecutor as ToolExecutorCtor } from "../engine/tool-executor.js";
import { getAllTools } from "../tools/index.js";
import { SessionStore as SessionStoreCtor } from "../storage/session-store.js";
import { AuditLogger as AuditLoggerCtor } from "../storage/audit-logger.js";
import type { Config } from "../types/index.js";

// ---------------------------------------------------------------------------
// QueryDeps — all dependencies the query engine needs
// ---------------------------------------------------------------------------

export interface QueryDeps {
  /** AI model provider (Anthropic, OpenAI, DeepSeek, etc.) */
  provider: AIProvider;
  /** Registered tools available for the model to call */
  tools: Tool[];
  /** Permission pipeline for tool-approval flow */
  permissionPipeline: PermissionPipeline;
  /** Tool executor with healing/retry logic */
  toolExecutor: ToolExecutor;
  /** User-configured hook registry (may be null if no hooks configured) */
  hookRegistry: AsyncHookRegistry | null;
  /** Cost/budget tracker (may be null if budget tracking disabled) */
  costTracker: CostTracker | null;
  /** Session persistence store */
  sessionStore: SessionStore;
  /** Audit log writer */
  auditLogger: AuditLogger;
}

// ---------------------------------------------------------------------------
// Factory — create a full QueryDeps from a config
// ---------------------------------------------------------------------------

export interface CreateQueryDepsOptions {
  /** Global agent config */
  config: Config;
  /** Pre-loaded hooks registry (optional; created fresh if omitted) */
  hookRegistry?: AsyncHookRegistry | null;
  /** Pre-loaded tools (optional; uses getAllTools() if omitted) */
  tools?: Tool[];
}

export function createQueryDeps(opts: CreateQueryDepsOptions): QueryDeps {
  const config = opts.config;
  const tools = opts.tools ?? getAllTools();
  const permissionPipeline = new PermissionPipelineCtor(config.permission_mode ?? "default");
  const toolExecutor = new ToolExecutorCtor(tools, permissionPipeline);
  const provider = createProviderFromConfig(config);
  const sessionStore = new SessionStoreCtor();
  const auditLogger = new AuditLoggerCtor();
  const hookRegistry = opts.hookRegistry ?? null;

  return {
    provider,
    tools,
    permissionPipeline,
    toolExecutor,
    hookRegistry,
    costTracker: null,
    sessionStore,
    auditLogger,
  };
}

// ---------------------------------------------------------------------------
// Lighter factory for when you already have a session and cost tracker
// ---------------------------------------------------------------------------

export function createQueryDepsForSession(
  deps: QueryDeps,
  costTracker: CostTracker,
  hookRegistry: AsyncHookRegistry | null,
): QueryDeps {
  return { ...deps, costTracker, hookRegistry };
}
