/**
 * Plugin system — load plugins from local directories and git repositories.
 *
 * Simplified vs Claude Code's plugins/ (no online marketplace, no autoupdate).
 * DeepSeek optimization: plugins provide additional tools, hooks, and skills
 * as plain TypeScript modules.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  main?: string;
  /** Additional tools provided by the plugin */
  tools?: string[];
  /** Hook definitions */
  hooks?: Array<{
    event: string;
    type: "command" | "http";
    command?: string;
    url?: string;
    matcher?: string;
  }>;
  /** Skill definitions (paths to SKILL.md files) */
  skills?: string[];
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  path: string;
  source: "local" | "git";
  enabled: boolean;
}

export interface PluginValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function getPluginDirs(): string[] {
  const dirs: string[] = [];
  const globalDir = join(homedir(), ".agent_1", "plugins");
  if (existsSync(globalDir)) dirs.push(globalDir);

  const projectDir = join(process.cwd(), ".agent_1", "plugins");
  if (existsSync(projectDir)) dirs.push(projectDir);

  return dirs;
}

function discoverPluginsInDir(dir: string): LoadedPlugin[] {
  const plugins: LoadedPlugin[] = [];

  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      if (!statSync(fullPath).isDirectory()) continue;

      const manifestPath = join(fullPath, "plugin.json");
      const pkgPath = join(fullPath, "package.json");

      let manifest: PluginManifest | null = null;

      if (existsSync(manifestPath)) {
        manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as PluginManifest;
      } else if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
        if (pkg.xsgbbx || pkg.agent_1) {
          const raw = (pkg.xsgbbx || pkg.agent_1) as Record<string, unknown>;
          manifest = {
            name: (raw.name as string) || (pkg.name as string) || entry,
            version: (raw.version as string) || (pkg.version as string) || "0.0.0",
            description: (raw.description as string) || (pkg.description as string) || "",
            author: (raw.author as string) || (pkg.author as string),
            license: (raw.license as string) || (pkg.license as string),
          };
        }
      }

      if (manifest) {
        plugins.push({
          manifest,
          path: fullPath,
          source: "local",
          enabled: true,
        });
      }
    }
  } catch {
    // Directory read failed
  }

  return plugins;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PLUGIN_REQUIRED_FIELDS: Array<keyof PluginManifest> = [
  "name",
  "version",
  "description",
];

export function validatePlugin(manifest: unknown): PluginValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!manifest || typeof manifest !== "object") {
    return { valid: false, errors: ["manifest must be an object"], warnings: [] };
  }

  const m = manifest as Record<string, unknown>;

  for (const field of PLUGIN_REQUIRED_FIELDS) {
    if (!m[field]) {
      errors.push(`missing required field: ${field}`);
    }
  }

  if (m.name && typeof m.name !== "string") {
    errors.push("name must be a string");
  }

  if (m.version && typeof m.version !== "string") {
    errors.push("version must be a string");
  }

  if (m.main && typeof m.main === "string") {
    const mainPath = join((m._path as string) || "", m.main);
    if (!existsSync(mainPath)) {
      warnings.push(`main entry "${m.main}" not found at ${mainPath}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

let cachedPlugins: LoadedPlugin[] | null = null;

export function loadPlugins(): LoadedPlugin[] {
  if (cachedPlugins) return cachedPlugins;

  const dirs = getPluginDirs();
  const all: LoadedPlugin[] = [];

  for (const dir of dirs) {
    const plugins = discoverPluginsInDir(dir);
    all.push(...plugins);
  }

  cachedPlugins = all;
  return all;
}

export function getPlugin(name: string): LoadedPlugin | undefined {
  return loadPlugins().find((p) => p.manifest.name === name);
}

export function invalidatePluginCache(): void {
  cachedPlugins = null;
}

/**
 * Load a plugin's main module and return its exports.
 */
export async function importPlugin(
  plugin: LoadedPlugin,
): Promise<Record<string, unknown>> {
  const mainFile = plugin.manifest.main || "index.js";
  const mainPath = join(plugin.path, mainFile);

  if (!existsSync(mainPath)) {
    throw new Error(`Plugin "${plugin.manifest.name}": main entry not found: ${mainPath}`);
  }

  return (await import(mainPath)) as Record<string, unknown>;
}

/**
 * Get all plugin-provided hooks.
 */
export function getPluginHooks(): Array<{
  event: string;
  type: "command" | "http";
  command?: string;
  url?: string;
  matcher?: string;
}> {
  const plugins = loadPlugins();
  const hooks: Array<{
    event: string;
    type: "command" | "http";
    command?: string;
    url?: string;
    matcher?: string;
  }> = [];

  for (const p of plugins) {
    if (p.enabled && p.manifest.hooks) {
      hooks.push(...p.manifest.hooks);
    }
  }

  return hooks;
}
