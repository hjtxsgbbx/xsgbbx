/**
 * Plugin manifest schema — Zod validation for plugin.json files.
 *
 * Validates the manifest structure at load time, providing early and
 * detailed error messages when a plugin is misconfigured.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const PluginManifestSchema = z.object({
  /** Plugin name, used as the unique identifier */
  name: z.string().min(1).max(100),
  /** Semver version string */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Short description (500 chars max) */
  description: z.string().max(500),
  /** Plugin author */
  author: z.string().optional(),
  /** SPDX license identifier */
  license: z.string().optional(),
  /** Entry point relative to plugin root */
  main: z.string(),
  /** Engine compatibility constraint */
  engines: z.object({ xsgbbx: z.string() }).optional(),
  /** Slash commands provided by this plugin */
  commands: z.array(z.string()).optional(),
  /** Tool implementations provided */
  tools: z.array(z.string()).optional(),
  /** Hook names this plugin responds to */
  hooks: z.array(z.string()).optional(),
  /** Skill definitions provided */
  skills: z.array(z.string()).optional(),
});

/** Inferred type from the Zod schema */
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
  manifest: PluginManifest | null;
}

/**
 * Validate raw data against the PluginManifest schema.
 * Returns a structured result with parsed manifest on success.
 */
export function validatePluginManifest(
  data: unknown,
): SchemaValidationResult {
  const result = PluginManifestSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    return { valid: false, errors, manifest: null };
  }

  return { valid: true, errors: [], manifest: result.data };
}

/**
 * Check whether a raw object looks like it might be a plugin manifest.
 * Lightweight pre-check before full Zod validation.
 */
export function looksLikeManifest(data: unknown): data is Record<string, unknown> {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  return typeof obj.name === "string" && typeof obj.version === "string";
}
