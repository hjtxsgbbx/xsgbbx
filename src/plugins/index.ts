/**
 * Plugin system — load plugins from local directories and git repositories.
 *
 * Expanded from minimal skeleton to support full plugin lifecycle:
 * discovery, validation, loading, enable/disable, and integration with
 * the host tool/command/hook registries.
 *
 * DeepSeek optimization: plugins provide additional tools, hooks, and skills
 * as plain TypeScript modules.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { pathToFileURL } from "url";
import {
  validatePluginManifest,
  type PluginManifest,
  looksLikeManifest,
} from "./plugin-schema.js";
import {
  createPluginContext,
} from "./plugin-context.js";
import { APP_NAME, FILE_NAMES } from "../core/constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { PluginManifest } from "./plugin-schema.js";
export type { PluginContext, PluginConfig, LogLevel } from "./plugin-context.js";
export {
  installFromGit,
  uninstall,
  listInstalled,
} from "./git-installer.js";

/** Information about a loaded/installed plugin. */
export interface PluginInfo {
  manifest: PluginManifest;
  /** Absolute path to the plugin directory on disk. */
  path: string;
  /** Where the plugin came from. */
  source: "local" | "git";
  /** Whether the plugin is currently enabled. */
  enabled: boolean;
  /** Whether the plugin's main module was successfully loaded. */
  loaded: boolean;
  /** Error message if loading failed. */
  error?: string;
}

/** Shape of a plugin's main module exports. */
export interface PluginModule {
  activate?: (context: import("./plugin-context.js").PluginContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
  [key: string]: unknown;
}

// Keep for backwards compatibility
/** @deprecated Use PluginInfo instead */
export type LoadedPlugin = PluginInfo;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** In-memory registry of all discovered plugins. */
let pluginRegistry: PluginInfo[] = [];

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function getPluginDirs(): string[] {
  const dirs: string[] = [];
  const globalDir = join(homedir(), `.${APP_NAME}`, FILE_NAMES.AGENTS_DIR || "plugins");
  if (existsSync(globalDir)) dirs.push(globalDir);

  const projectDir = join(process.cwd(), `.${APP_NAME}`, FILE_NAMES.AGENTS_DIR || "plugins");
  if (existsSync(projectDir)) dirs.push(projectDir);

  return dirs;
}

function discoverPluginsInDir(dir: string): PluginInfo[] {
  const plugins: PluginInfo[] = [];

  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      if (!statSync(fullPath).isDirectory()) continue;

      const manifestPath = join(fullPath, "plugin.json");
      const pkgPath = join(fullPath, "package.json");

      let manifest: PluginManifest | null = null;

      // Prefer plugin.json with Zod validation
      if (existsSync(manifestPath)) {
        try {
          const raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as unknown;
          const result = validatePluginManifest(raw);
          if (result.valid) {
            manifest = result.manifest;
          }
        } catch {
          // Invalid JSON or schema — skip
        }
      }

      // Fallback to package.json with xsgbbx field
      if (!manifest && existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
          const raw = pkg[APP_NAME] || pkg.agent_1;
          if (raw && looksLikeManifest(raw)) {
            const result = validatePluginManifest(raw);
            if (result.valid) {
              manifest = result.manifest;
            }
          }
        } catch {
          // Invalid JSON — skip
        }
      }

      if (manifest) {
        plugins.push({
          manifest,
          path: fullPath,
          source: "local",
          enabled: true,
          loaded: false,
        });
      }
    }
  } catch {
    // Directory read failed
  }

  return plugins;
}

// ---------------------------------------------------------------------------
// Validation (kept for backward compat)
// ---------------------------------------------------------------------------

const PLUGIN_REQUIRED_FIELDS: Array<keyof PluginManifest> = [
  "name",
  "version",
  "description",
];

export interface PluginValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePlugin(manifest: unknown): PluginValidationResult {
  const result = validatePluginManifest(manifest);
  return {
    valid: result.valid,
    errors: result.errors,
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

let cachedPlugins: PluginInfo[] | null = null;

/**
 * Discover and return all installed plugins.
 * Results are cached; call invalidatePluginCache() to force re-discovery.
 */
export function loadPlugins(): PluginInfo[] {
  if (cachedPlugins) return cachedPlugins;

  const dirs = getPluginDirs();
  const all: PluginInfo[] = [];

  for (const dir of dirs) {
    const plugins = discoverPluginsInDir(dir);
    all.push(...plugins);
  }

  cachedPlugins = all;
  pluginRegistry = all;
  return all;
}

export function invalidatePluginCache(): void {
  cachedPlugins = null;
}

// ---------------------------------------------------------------------------
// Plugin lifecycle
// ---------------------------------------------------------------------------

/**
 * Dynamically import and activate a single plugin by its directory path.
 * Validates the manifest, loads the main module, and calls activate().
 *
 * Errors during loading are caught and stored — a failing plugin must
 * never crash the host process.
 */
export async function loadPlugin(
  pluginPath: string,
): Promise<PluginInfo> {
  const manifestPath = join(pluginPath, "plugin.json");

  if (!existsSync(manifestPath)) {
    const info: PluginInfo = {
      manifest: { name: "unknown", version: "0.0.0", description: "", main: "" },
      path: pluginPath,
      source: "local",
      enabled: false,
      loaded: false,
      error: `Missing plugin.json at ${manifestPath}`,
    };
    pluginRegistry = [...pluginRegistry, info];
    return info;
  }

  let manifest: PluginManifest;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as unknown;
    const result = validatePluginManifest(raw);
    if (!result.valid || !result.manifest) {
      const errorMsg = result.errors.join("; ");
      const info: PluginInfo = {
        manifest: {
          name: "invalid",
          version: "0.0.0",
          description: "",
          main: "",
        },
        path: pluginPath,
        source: "local",
        enabled: false,
        loaded: false,
        error: `Invalid manifest: ${errorMsg}`,
      };
      pluginRegistry = [...pluginRegistry, info];
      return info;
    }
    manifest = result.manifest;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const info: PluginInfo = {
      manifest: { name: "error", version: "0.0.0", description: "", main: "" },
      path: pluginPath,
      source: "local",
      enabled: false,
      loaded: false,
      error: `Failed to read manifest: ${message}`,
    };
    pluginRegistry = [...pluginRegistry, info];
    return info;
  }

  // Check if already registered
  const existing = pluginRegistry.find(
    (p) => p.manifest.name === manifest.name,
  );
  if (existing) return existing;

  const info: PluginInfo = {
    manifest,
    path: pluginPath,
    source: "local",
    enabled: true,
    loaded: false,
  };

  // Load the main module
  const mainFile = manifest.main || "index.js";
  const mainPath = join(pluginPath, mainFile);

  if (!existsSync(mainPath)) {
    info.error = `Main entry "${mainFile}" not found at ${mainPath}`;
    pluginRegistry = [...pluginRegistry, info];
    return info;
  }

  try {
    const fileUrl = pathToFileURL(mainPath).href;
    const mod: PluginModule = (await import(fileUrl)) as PluginModule;

    if (typeof mod.activate === "function") {
      const ctx = createPluginContext(manifest.name, pluginPath);
      await mod.activate(ctx);
    }

    info.loaded = true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    info.error = `Load failed: ${message}`;
    // Plugin stays in registry even on failure, just marked as not loaded
  }

  pluginRegistry = [...pluginRegistry, info];
  return info;
}

/**
 * Activate an already-discovered but previously loaded-as-disabled plugin.
 * Calls the plugin's activate() function via loadPlugin() semantics.
 */
export function enablePlugin(name: string): PluginInfo | undefined {
  const idx = pluginRegistry.findIndex((p) => p.manifest.name === name);
  if (idx === -1) return undefined;

  const current = pluginRegistry[idx];
  if (current.enabled) return current;

  const updated: PluginInfo = { ...current, enabled: true };
  pluginRegistry = [
    ...pluginRegistry.slice(0, idx),
    updated,
    ...pluginRegistry.slice(idx + 1),
  ];

  // Invalidate cache so loadPlugins picks up the change
  invalidatePluginCache();

  return updated;
}

/**
 * Disable a plugin without uninstalling it.
 * The plugin stays on disk but won't contribute tools/commands/hooks.
 */
export function disablePlugin(name: string): PluginInfo | undefined {
  const idx = pluginRegistry.findIndex((p) => p.manifest.name === name);
  if (idx === -1) return undefined;

  const current = pluginRegistry[idx];
  if (!current.enabled) return current;

  const updated: PluginInfo = { ...current, enabled: false };
  pluginRegistry = [
    ...pluginRegistry.slice(0, idx),
    updated,
    ...pluginRegistry.slice(idx + 1),
  ];

  invalidatePluginCache();

  return updated;
}

/**
 * Look up a single plugin by name.
 */
export function getPlugin(name: string): PluginInfo | undefined {
  return pluginRegistry.find((p) => p.manifest.name === name);
}

/**
 * Return all registered plugins (loaded state, not just discovered).
 */
export function listPlugins(): PluginInfo[] {
  return [...pluginRegistry];
}

// ---------------------------------------------------------------------------
// Plugin module import (kept for backwards compat)
// ---------------------------------------------------------------------------

/**
 * Load a plugin's main module and return its exports.
 */
export async function importPlugin(
  plugin: PluginInfo,
): Promise<Record<string, unknown>> {
  const mainFile = plugin.manifest.main || "index.js";
  const mainPath = join(plugin.path, mainFile);

  if (!existsSync(mainPath)) {
    throw new Error(
      `Plugin "${plugin.manifest.name}": main entry not found: ${mainPath}`,
    );
  }

  return (await import(mainPath)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Hook discovery from plugins
// ---------------------------------------------------------------------------

/**
 * Get all plugin-provided hook event names.
 * Each hook name is validated against the HookEvent type by the caller.
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
    if (!p.enabled) continue;

    // New-style: hooks is string[] of event names
    if (p.manifest.hooks && p.manifest.hooks.length > 0) {
      for (const event of p.manifest.hooks) {
        hooks.push({
          event,
          type: "command",
          command: `xsgbbx-plugin-hook ${p.manifest.name} ${event}`,
        });
      }
    }
  }

  return hooks;
}

// ---------------------------------------------------------------------------
// Startup integration
// ---------------------------------------------------------------------------

/**
 * Initialize the plugin system during host startup.
 *
 * Should be called once after the config is loaded and before the CLI starts.
 * Discovers and loads all enabled plugins, handling failures gracefully.
 */
export async function initializePlugins(): Promise<void> {
  const plugins = loadPlugins();

  for (const info of plugins) {
    if (!info.enabled) continue;

    try {
      await loadPlugin(info.path);
    } catch {
      // loadPlugin already catches and stores errors;
      // double-guard ensures initializePlugins never throws.
    }
  }
}
