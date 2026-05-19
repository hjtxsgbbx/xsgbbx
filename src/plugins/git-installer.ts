/**
 * Git-based plugin installer — clone, remove, and list plugins from git repos.
 *
 * Plugins are stored in ~/.xsgbbx/plugins/ (global) or
 * <project>/.xsgbbx/plugins/ (project-local).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { APP_NAME, FILE_NAMES } from "../core/constants.js";
import {
  validatePluginManifest,
  type PluginManifest,
} from "./plugin-schema.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getGlobalPluginsDir(): string {
  const dir = join(homedir(), `.${APP_NAME}`, FILE_NAMES.AGENTS_DIR || "plugins");
  return dir;
}

function getProjectPluginsDir(): string {
  return join(process.cwd(), `.${APP_NAME}`, FILE_NAMES.AGENTS_DIR || "plugins");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function repoNameFromUrl(url: string): string {
  const cleaned = url.replace(/\.git$/, "");
  const name = basename(cleaned);
  return name || "unknown-plugin";
}

function readManifest(dirPath: string): PluginManifest | null {
  const manifestPath = join(dirPath, "plugin.json");
  if (!existsSync(manifestPath)) return null;

  try {
    const raw = readFileSync(manifestPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    const result = validatePluginManifest(parsed);
    return result.manifest;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Clone a plugin from a git URL into the global plugins directory.
 * Validates the manifest after cloning.
 */
export async function installFromGit(url: string): Promise<PluginManifest> {
  const pluginsDir = getGlobalPluginsDir();
  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true });
  }

  const repoName = repoNameFromUrl(url);
  const targetDir = join(pluginsDir, repoName);

  if (existsSync(targetDir)) {
    throw new Error(
      `Plugin directory already exists: ${targetDir}. Use --force to overwrite.`,
    );
  }

  try {
    execSync(`git clone "${url}" "${targetDir}"`, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 120_000,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Clean up failed clone
    try {
      if (existsSync(targetDir)) rmSync(targetDir, { recursive: true });
    } catch { /* best effort */ }
    throw new Error(`Failed to clone "${url}": ${message}`);
  }

  const manifest = readManifest(targetDir);
  if (!manifest) {
    throw new Error(
      `Plugin cloned but no valid plugin.json found in: ${targetDir}`,
    );
  }

  return manifest;
}

/**
 * Remove a plugin by name from the global plugins directory.
 */
export async function uninstall(name: string): Promise<boolean> {
  const pluginsDir = getGlobalPluginsDir();
  if (!existsSync(pluginsDir)) return false;

  const targetDir = join(pluginsDir, name);

  if (!existsSync(targetDir)) {
    // Try the project-local directory
    const projDir = getProjectPluginsDir();
    const projTarget = join(projDir, name);
    if (!existsSync(projTarget)) return false;

    rmSync(projTarget, { recursive: true, force: true });
    return true;
  }

  rmSync(targetDir, { recursive: true, force: true });
  return true;
}

/**
 * List all installed plugin manifests (global + project-local).
 */
export async function listInstalled(): Promise<
  Array<{ manifest: PluginManifest; path: string; source: "local" | "git" }>
> {
  const results: Array<{
    manifest: PluginManifest;
    path: string;
    source: "local" | "git";
  }> = [];

  function scan(dir: string, source: "local" | "git"): void {
    if (!existsSync(dir)) return;

    try {
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        try {
          if (!statSync(fullPath).isDirectory()) continue;
        } catch {
          continue;
        }

        const manifest = readManifest(fullPath);
        if (manifest) {
          results.push({ manifest, path: fullPath, source });
        }
      }
    } catch {
      // Directory read failed
    }
  }

  scan(getGlobalPluginsDir(), "git");
  scan(getProjectPluginsDir(), "local");

  return results;
}
