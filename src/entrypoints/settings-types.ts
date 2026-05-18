// ---------------------------------------------------------------------------
// settings-types.ts — typed configuration with runtime validation guards
// ---------------------------------------------------------------------------

import type { Config, PermissionMode, ProviderConfig, MCPConfigItem } from "../types/index.js";
import { DEFAULT_MODEL, FALLBACK_MODEL, LIMITS } from "../core/constants.js";

// ---------------------------------------------------------------------------
// Individual setting descriptors for documentation and validation
// ---------------------------------------------------------------------------

export interface SettingDescriptor<T> {
  /** The setting key name */
  key: string;
  /** Human-readable description */
  description: string;
  /** Default value */
  default: T;
  /** Runtime validator / type guard */
  validate(value: unknown): value is T;
}

// ---------------------------------------------------------------------------
// Key settings with documentation and type guards
// ---------------------------------------------------------------------------

export const SETTINGS = {
  model: {
    key: "model",
    description: "AI model name to use for queries.",
    default: DEFAULT_MODEL,
    validate: (v: unknown): v is string => typeof v === "string" && v.length > 0,
  },

  fallbackModel: {
    key: "fallback_model",
    description: "Model to switch to after consecutive primary-model failures.",
    default: FALLBACK_MODEL,
    validate: (v: unknown): v is string => typeof v === "string" && v.length > 0,
  },

  permissionMode: {
    key: "permission_mode",
    description: "Tool-approval strategy: 'default', 'plan', 'defaultDeny', 'autoApprove', or 'sandbox'.",
    default: "default" as PermissionMode,
    validate: (v: unknown): v is PermissionMode =>
      typeof v === "string" &&
      ["default", "plan", "defaultDeny", "autoApprove", "sandbox"].includes(v),
  },

  maxTurns: {
    key: "max_turns",
    description: "Max API round-trips per query before forced stop.",
    default: LIMITS.MAX_TURNS,
    validate: (v: unknown): v is number =>
      typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 1000,
  },

  thinkingEffort: {
    key: "thinking_effort",
    description: "Reasoning-effort hint for models that support it.",
    default: "medium" as const,
    validate: (v: unknown): v is string =>
      typeof v === "string" && ["low", "medium", "high"].includes(v),
  },

  temperature: {
    key: "temperature",
    description: "Sampling temperature (0-2). Lower = more deterministic.",
    default: 0.7,
    validate: (v: unknown): v is number =>
      typeof v === "number" && v >= 0 && v <= 2,
  },

  maxOutputTokens: {
    key: "maxOutputTokens",
    description: "Maximum tokens per completion response.",
    default: LIMITS.DEFAULT_MAX_TOKENS,
    validate: (v: unknown): v is number =>
      typeof v === "number" && Number.isInteger(v) && v >= 256 && v <= 128_000,
  },

  sandboxMode: {
    key: "sandbox_mode",
    description: "Filesystem sandbox level: 'off', 'readonly', 'workspace', or 'full'.",
    default: "off" as const,
    validate: (v: unknown): v is string =>
      typeof v === "string" && ["off", "readonly", "workspace", "full"].includes(v),
  },
} as const;

// ---------------------------------------------------------------------------
// SettingCollection — typed lookup from setting key to value type
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type ExtractSettingValue<T> = T extends SettingDescriptor<infer V> ? V : never;

// ---------------------------------------------------------------------------
// Validate a partial config object, returning validated values + errors
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ key: string; message: string; received: unknown }>;
  warnings: Array<{ key: string; message: string }>;
}

/**
 * Validate a user-supplied config object against the known settings.
 * Returns a ValidationResult with any errors found.
 */
export function validateSettings(
  overrides: Record<string, unknown>,
): ValidationResult {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };

  for (const [, setting] of Object.entries(SETTINGS)) {
    const value = overrides[setting.key];
    if (value === undefined) continue;

    if (!setting.validate(value)) {
      result.valid = false;
      result.errors.push({
        key: setting.key,
        message: `Invalid value for "${setting.key}" (${setting.description}).`,
        received: value,
      });
    }
  }

  // Warn on unknown keys
  for (const key of Object.keys(overrides)) {
    const known = Object.values(SETTINGS).some((s: { key: string }) => s.key === key);
    if (!known) {
      result.warnings.push({
        key,
        message: `Unknown setting "${key}". It will be ignored.`,
      });
    }
  }

  return result;
}

/**
 * Quick type guard: is the value a valid PermissionMode?
 */
export function isPermissionMode(value: unknown): value is PermissionMode {
  return (
    typeof value === "string" &&
    ["default", "plan", "defaultDeny", "autoApprove", "sandbox"].includes(value)
  );
}

/**
 * Quick type guard: is the object a valid ProviderConfig?
 */
export function isProviderConfig(value: unknown): value is ProviderConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["provider"] === "string" &&
    typeof v["base_url"] === "string" &&
    Array.isArray(v["models"])
  );
}

/**
 * Quick type guard: is the object a valid MCPConfigItem?
 */
export function isMCPConfigItem(value: unknown): value is MCPConfigItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["name"] === "string" &&
    (v["transport"] === "stdio" || v["transport"] === "http") &&
    typeof v["enabled"] === "boolean"
  );
}

// ---------------------------------------------------------------------------
// Setting documentation (markdown-formatted for display)
// ---------------------------------------------------------------------------

/**
 * Generate human-readable documentation for all settings.
 */
export function generateSettingsDocs(): string {
  const lines: string[] = ["# Agent Settings", ""];
  for (const [, s] of Object.entries(SETTINGS)) {
    lines.push(`## \`${s.key}\``);
    lines.push(`- **Default**: \`${JSON.stringify(s.default)}\``);
    lines.push(`- **Description**: ${s.description}`);
    lines.push("");
  }
  return lines.join("\n");
}
