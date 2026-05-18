import { DEFAULT_MODEL, FALLBACK_MODEL, LIMITS } from "../core/constants.js";

// ---------------------------------------------------------------------------
// QueryConfig — typed query configuration separate from global Config
// ---------------------------------------------------------------------------

export interface QueryConfig {
  /** Maximum turns (API round-trips) before forced stop */
  maxTurns: number;
  /** Primary model name (e.g. "deepseek-chat") */
  model: string;
  /** Fallback model to use after consecutive failures */
  fallbackModel: string;
  /** API key identifier (provider-specific) */
  apiKey: string;
  /** Permission mode governing tool approval flow */
  permissionMode: "default" | "plan" | "defaultDeny" | "autoApprove" | "sandbox";
  /** DeepSeek/OpenAI reasoning-effort hint */
  thinkingEffort: "low" | "medium" | "high" | null;
  /** Sampling temperature (0-2) */
  temperature: number;
  /** Max output tokens per completion */
  maxOutputTokens: number;
  /** Whether auto-compaction is enabled for context management */
  autoCompactEnabled: boolean;
  /** AbortSignal for cancelling the query mid-flight */
  abortSignal: AbortSignal | null;
}

// ---------------------------------------------------------------------------
// Sensible defaults
// ---------------------------------------------------------------------------

export const DEFAULT_QUERY_CONFIG: QueryConfig = {
  maxTurns: LIMITS.MAX_TURNS,
  model: DEFAULT_MODEL,
  fallbackModel: FALLBACK_MODEL,
  apiKey: "",
  permissionMode: "default",
  thinkingEffort: "medium",
  temperature: 0.7,
  maxOutputTokens: LIMITS.DEFAULT_MAX_TOKENS,
  autoCompactEnabled: true,
  abortSignal: null,
};

// ---------------------------------------------------------------------------
// resolveQueryConfig — merge user overrides onto defaults
// ---------------------------------------------------------------------------

export function resolveQueryConfig(
  userConfig: Partial<QueryConfig> & { abortSignal?: AbortSignal | null },
): QueryConfig {
  const merged: QueryConfig = {
    ...DEFAULT_QUERY_CONFIG,
    ...userConfig,
    abortSignal: userConfig.abortSignal ?? null,
  };

  // Clamp temperature to valid range
  if (merged.temperature < 0) merged.temperature = 0;
  if (merged.temperature > 2) merged.temperature = 2;

  // Clamp maxOutputTokens
  if (merged.maxOutputTokens < 1) merged.maxOutputTokens = 1024;
  if (merged.maxOutputTokens > 128_000) merged.maxOutputTokens = 128_000;

  // Clamp maxTurns
  if (merged.maxTurns < 1) merged.maxTurns = 1;
  if (merged.maxTurns > 1000) merged.maxTurns = 1000;

  return merged;
}

// ---------------------------------------------------------------------------
// Extract QueryConfig from the global Config object
// ---------------------------------------------------------------------------

import type { Config } from "../types/index.js";

export function queryConfigFromGlobal(config: Config): QueryConfig {
  return {
    maxTurns: config.max_turns ?? DEFAULT_QUERY_CONFIG.maxTurns,
    model: config.model ?? DEFAULT_QUERY_CONFIG.model,
    fallbackModel: config.fallback_model ?? DEFAULT_QUERY_CONFIG.fallbackModel,
    apiKey: config.api_key_ref ?? "",
    permissionMode: config.permission_mode ?? DEFAULT_QUERY_CONFIG.permissionMode,
    thinkingEffort: (config.thinking_effort as QueryConfig["thinkingEffort"]) ?? DEFAULT_QUERY_CONFIG.thinkingEffort,
    temperature: 0.7,
    maxOutputTokens: LIMITS.DEFAULT_MAX_TOKENS,
    autoCompactEnabled: true,
    abortSignal: null,
  };
}
