/**
 * Services — Centralized Service Layer
 *
 * Each service wraps a domain subsystem (compaction, MCP, tool execution,
 * session memory, settings, LSP, tips) behind a consistent, testable
 * interface. The ServiceRegistry provides runtime discovery and DI.
 *
 * Usage:
 *   const services = createServices(config);
 *   services.compact.compactIfNeeded(messages, tokenUsage);
 *   services.settings.get("model");
 */

import { CompactService } from "./compact-service.js";
import { MCPService } from "./mcp-service.js";
import {
  ToolExecutionService,
  type ToolExecutionConfig,
} from "./tool-execution-service.js";
import { SessionMemoryService } from "./session-memory-service.js";
import { LSPService } from "./lsp-service.js";
import { SettingsService } from "./settings-service.js";
import { TipsService } from "./tips-service.js";

// ---------------------------------------------------------------------------
// Service Registry
// ---------------------------------------------------------------------------

export class ServiceRegistry {
  private services = new Map<string, unknown>();

  register(name: string, service: unknown): void {
    if (this.services.has(name)) {
      throw new Error(`Service "${name}" is already registered`);
    }
    this.services.set(name, service);
  }

  get<T>(name: string): T {
    const svc = this.services.get(name);
    if (!svc) {
      throw new Error(`Service "${name}" not found. Registered: ${this.listAll().join(", ")}`);
    }
    return svc as T;
  }

  listAll(): string[] {
    return [...this.services.keys()].sort();
  }

  has(name: string): boolean {
    return this.services.has(name);
  }
}

// ---------------------------------------------------------------------------
// Service bundle type
// ---------------------------------------------------------------------------

export interface ServiceBundle {
  compact: CompactService;
  mcp: MCPService;
  toolExecution: ToolExecutionService;
  sessionMemory: SessionMemoryService;
  lsp: LSPService;
  settings: SettingsService;
  tips: TipsService;
  registry: ServiceRegistry;
}

// ---------------------------------------------------------------------------
// Factory config
// ---------------------------------------------------------------------------

export interface CreateServicesConfig {
  /** Path to agent_1 data directory (defaults to ~/.agent_1) */
  dataDir?: string;
  /** Tool executor instance or config (optional) */
  toolExecutor?: unknown;
  /** Permission pipeline (optional) */
  permissionPipeline?: unknown;
  /** Resolved model name for compaction thresholds */
  model?: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create all services and register them in a ServiceRegistry.
 *
 * This is the primary entry point. Call once during app initialization,
 * then access services through the returned bundle or registry.
 */
export function createServices(config: CreateServicesConfig = {}): ServiceBundle {
  const registry = new ServiceRegistry();

  const compactService = new CompactService({ model: config.model });
  registry.register("compact", compactService);

  const mcpService = new MCPService();
  registry.register("mcp", mcpService);

  const toolExecutionService = new ToolExecutionService(
    config.toolExecutor as ToolExecutionConfig | undefined,
  );
  registry.register("toolExecution", toolExecutionService);

  const sessionMemoryService = new SessionMemoryService({ dataDir: config.dataDir });
  registry.register("sessionMemory", sessionMemoryService);

  const lspService = new LSPService();
  registry.register("lsp", lspService);

  const settingsService = new SettingsService();
  registry.register("settings", settingsService);

  const tipsService = new TipsService();
  registry.register("tips", tipsService);

  return {
    compact: compactService,
    mcp: mcpService,
    toolExecution: toolExecutionService,
    sessionMemory: sessionMemoryService,
    lsp: lspService,
    settings: settingsService,
    tips: tipsService,
    registry,
  };
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { CompactService } from "./compact-service.js";
export type { CompactServiceConfig, CompactIfNeededInput, CompactWarningInfo } from "./compact-service.js";

export { MCPService } from "./mcp-service.js";
export type { MCPServiceConfig, ServerInfo } from "./mcp-service.js";

export { ToolExecutionService } from "./tool-execution-service.js";
export type { ToolExecutionConfig, HealResult } from "./tool-execution-service.js";

export { SessionMemoryService } from "./session-memory-service.js";
export type { SessionMemoryEntry, SessionMemoryServiceConfig } from "./session-memory-service.js";

export { LSPService } from "./lsp-service.js";
export type { LSPDiagnostic, LSPHoverResult, LSPPosition } from "./lsp-service.js";

export { SettingsService } from "./settings-service.js";

export { TipsService } from "./tips-service.js";
export type { Tip, TipsServiceConfig } from "./tips-service.js";
