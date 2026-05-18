// ---------------------------------------------------------------------------
// tool-types.ts — SDK surface for tool definition, registration, and discovery
// ---------------------------------------------------------------------------

import type { Tool } from "../types/index.js";
import type { JSONSchema } from "../types/index.js";
import type { ExecutionContext, ToolResult } from "../types/index.js";

// ---------------------------------------------------------------------------
// Re-export the canonical Tool interface
// ---------------------------------------------------------------------------

export type { Tool, JSONSchema, ExecutionContext, ToolResult };

// ---------------------------------------------------------------------------
// SDK-facing tool definition format (simpler than the full Tool interface)
// ---------------------------------------------------------------------------

/**
 * ToolDescriptor is the format SDK consumers use to register custom tools.
 * It omits internal methods like getPath(), renderResult(), etc.
 */
export interface ToolDescriptor {
  /** Unique tool name, lowercase with hyphens (e.g. "web-fetch"). */
  name: string;
  /** Human-readable description shown to the model. */
  description: string;
  /** JSON Schema for the tool's parameters. */
  parameters: JSONSchema;
  /** Whether this tool is read-only (can run concurrently). */
  readonly: boolean;
  /** The actual implementation function. */
  execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult>;
}

/**
 * Convert a ToolDescriptor into a full Tool interface.
 */
export function toolFromDescriptor(
  descriptor: ToolDescriptor,
  overrides?: Partial<Tool>,
): Tool {
  return {
    name: descriptor.name,
    description: descriptor.description,
    parameters: descriptor.parameters,
    readonly: descriptor.readonly,
    execute: descriptor.execute,

    isReadOnly(): boolean {
      return descriptor.readonly;
    },
    isConcurrencySafe(): boolean {
      return descriptor.readonly;
    },
    isEnabled(): boolean {
      return true;
    },

    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tool discovery — find tools by name, role, or capability
// ---------------------------------------------------------------------------

/**
 * Filter criteria for tool discovery.
 */
export interface ToolFilter {
  /** Glob pattern for tool name (e.g. "read*", "*write*"). */
  namePattern?: string;
  /** Only return read-only tools. */
  readonlyOnly?: boolean;
  /** Only return writable (mutating) tools. */
  writableOnly?: boolean;
  /** Only return enabled tools. */
  enabledOnly?: boolean;
}

/**
 * Find tools matching the filter from a tool array.
 */
export function discoverTools(tools: Tool[], filter: ToolFilter = {}): Tool[] {
  let result = tools;

  if (filter.namePattern) {
    const regex = globToRegex(filter.namePattern);
    result = result.filter((t) => regex.test(t.name));
  }

  if (filter.readonlyOnly) {
    result = result.filter((t) => (t.isReadOnly ? t.isReadOnly() : t.readonly));
  }

  if (filter.writableOnly) {
    result = result.filter((t) => !(t.isReadOnly ? t.isReadOnly() : t.readonly));
  }

  if (filter.enabledOnly) {
    result = result.filter((t) => (t.isEnabled ? t.isEnabled() : true));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tool signatures for model consumption
// ---------------------------------------------------------------------------

export interface ToolSignature {
  name: string;
  description: string;
  parameters: JSONSchema;
}

/**
 * Extract lightweight tool signatures for sending to the AI provider.
 */
export function extractToolSignatures(tools: Tool[]): ToolSignature[] {
  return tools
    .filter((t) => (t.isEnabled ? t.isEnabled() : true))
    .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}
