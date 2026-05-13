import type { ToolResult, ToolCall } from "../types/index.js";

interface CacheEntry {
  result: ToolResult;
  timestamp: number;
}

const WRITE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "shell_command",
  "git_commit",
  "git_push",
]);

export class ToolResultCache {
  private cache: Map<string, CacheEntry>;
  private turnNumber: number;

  constructor() {
    this.cache = new Map();
    this.turnNumber = 0;
  }

  private makeKey(toolCall: ToolCall): string {
    return `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`;
  }

  get(toolCall: ToolCall): ToolResult | null {
    const key = this.makeKey(toolCall);
    const entry = this.cache.get(key);
    if (entry) {
      return { ...entry.result, output: `[CACHED] ${entry.result.output}` };
    }
    return null;
  }

  set(toolCall: ToolCall, result: ToolResult): void {
    if (WRITE_TOOLS.has(toolCall.name)) {
      this.cache.clear();
      return;
    }
    const key = this.makeKey(toolCall);
    this.cache.set(key, { result, timestamp: Date.now() });
  }

  nextTurn(): void {
    this.turnNumber++;
    this.cache.clear();
  }

  invalidateWrites(): void {
    const readCache = new Map<string, CacheEntry>();
    for (const [key, entry] of this.cache) {
      const toolName = key.split(":")[0];
      if (!WRITE_TOOLS.has(toolName)) {
        readCache.set(key, entry);
      }
    }
    this.cache = readCache;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  get currentTurn(): number {
    return this.turnNumber;
  }
}

export const toolCache = new ToolResultCache();