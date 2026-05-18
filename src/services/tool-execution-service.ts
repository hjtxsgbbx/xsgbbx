/**
 * ToolExecutionService — wraps ToolExecutor into a service layer.
 * Supports lazy init: call initialize() if no executor at construction.
 */

import type { ToolCall, ToolResult } from "../types/index.js";
import type { Tool } from "../tools/index.js";
import type { PermissionPipeline } from "../permissions/index.js";
import { ToolExecutor, type ToolExecutionCallbacks } from "../engine/tool-executor.js";

export interface ToolExecutionConfig {
  executor?: ToolExecutor;
  permissionPipeline?: PermissionPipeline;
  tools?: Tool[];
}

export interface HealResult {
  executed: boolean;
  result: ToolResult;
  attempts: number;
  healed: boolean;
}

export interface ExecuteToolsResult {
  results: ToolResult[];
  allSuccess: boolean;
  failureCount: number;
}

export class ToolExecutionService {
  private executor: ToolExecutor | null = null;
  private permissionPipeline: PermissionPipeline | null = null;
  private initializedTools: Tool[] = [];

  constructor(
    executorOrConfig?: ToolExecutor | ToolExecutionConfig,
    permissionPipeline?: PermissionPipeline,
  ) {
    if (executorOrConfig instanceof ToolExecutor) {
      this.executor = executorOrConfig;
      this.permissionPipeline = permissionPipeline ?? null;
    } else if (executorOrConfig) {
      const cfg = executorOrConfig as ToolExecutionConfig;
      this.executor = cfg.executor ?? null;
      this.permissionPipeline = cfg.permissionPipeline ?? permissionPipeline ?? null;
      if (cfg.tools) {
        this.initializedTools = [...cfg.tools];
      }
    } else {
      this.permissionPipeline = permissionPipeline ?? null;
    }
  }

  initialize(executor: ToolExecutor, pipeline: PermissionPipeline): void {
    this.executor = executor;
    this.permissionPipeline = pipeline;

    if (this.initializedTools.length > 0) {
      executor.registerTools(this.initializedTools);
      this.initializedTools = [];
    }
  }

  isInitialized(): boolean {
    return this.executor !== null;
  }

  registerTools(tools: Tool[]): void {
    if (this.executor) {
      this.executor.registerTools(tools);
    } else {
      this.initializedTools.push(...tools);
    }
  }

  getTool(name: string): Tool | undefined {
    if (!this.executor) return undefined;
    return this.executor.getToolMap().get(name);
  }

  hasTool(name: string): boolean {
    if (!this.executor) return false;
    return this.executor.getToolMap().has(name);
  }

  async executeTools(
    toolCalls: ToolCall[],
    context: { platform: unknown; session: unknown },
    callbacks: ToolExecutionCallbacks,
  ): Promise<ExecuteToolsResult> {
    const executor = this.getExecutor();

    const costTracker = null; // cost tracking handled externally
    const metricsCollector = null;

    const results = await executor.executeWithHealing(
      toolCalls,
      context,
      costTracker,
      metricsCollector,
      callbacks,
    );

    const failureCount = results.filter((r) => !r.success).length;

    return {
      results,
      allSuccess: failureCount === 0,
      failureCount,
    };
  }

  async executeWithHealing(
    toolCalls: ToolCall[],
    context: { platform: unknown; session: unknown },
    callbacks: ToolExecutionCallbacks,
  ): Promise<HealResult[]> {
    const executor = this.getExecutor();

    const rawResults = await executor.executeWithHealing(
      toolCalls,
      context,
      null,
      null,
      callbacks,
    );

    return rawResults.map((result, i) => ({
      executed: true,
      result,
      attempts: result.success ? 1 : toolCalls[i] ? 2 : 1,
      healed: !result.success,
    }));
  }

  private getExecutor(): ToolExecutor {
    if (!this.executor) {
      throw new Error(
        "ToolExecutionService is not initialized. Call initialize() with a ToolExecutor " +
        "and PermissionPipeline before using execute methods.",
      );
    }
    return this.executor;
  }
}
