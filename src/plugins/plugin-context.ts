/**
 * PluginContext — runtime API surface provided to each loaded plugin.
 *
 * Plugins call registerTool / registerCommand / registerHook during their
 * activate() phase. The context is scoped to a single plugin instance.
 */

import type { Tool } from "../types/index.js";
import { registerExternalTool } from "../tools/external-tools.js";
import { registerExternalHook, type HookHandler } from "../engine/hook-system.js";
import {
  registerExternalCommand,
  type CommandHandler,
} from "../commands/index.js";
import { APP_NAME } from "../core/constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Configuration shape passed to a plugin at activation time. */
export interface PluginConfig {
  /** Plugin-level overrides from the host config */
  [key: string]: unknown;
}

export interface PluginContext {
  /** Register a tool implementation. tool.execute(params, ctx) will be called by the engine. */
  registerTool(name: string, tool: Tool): void;

  /** Register a slash-command handler. */
  registerCommand(name: string, handler: CommandHandler): void;

  /** Register a lifecycle hook handler. */
  registerHook(event: string, handler: HookHandler): void;

  /** Get the plugin's configuration object. */
  getConfig(): PluginConfig;

  /** Write a log message through the host logger. */
  log(level: LogLevel, message: string): void;

  /** The plugin's own name (set by the loader). */
  readonly pluginName: string;

  /** The plugin's root directory on disk. */
  readonly pluginDir: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createPluginContext(
  pluginName: string,
  pluginDir: string,
  config?: PluginConfig,
): PluginContext {
  const pluginConfig: PluginConfig = { ...config };

  const ctx: PluginContext = {
    pluginName,
    pluginDir,

    registerTool(name: string, tool: Tool): void {
      const prefixedName = tool.name || name;
      registerExternalTool(prefixedName, tool);
    },

    registerCommand(name: string, handler: CommandHandler): void {
      registerExternalCommand(name, handler);
    },

    registerHook(event: string, handler: HookHandler): void {
      registerExternalHook(event, handler);
    },

    getConfig(): PluginConfig {
      return { ...pluginConfig };
    },

    log(level: LogLevel, message: string): void {
      const timestamp = new Date().toISOString();
      const prefix = `[${APP_NAME}:plugin:${pluginName}]`;
      const line = `${timestamp} ${prefix} [${level.toUpperCase()}] ${message}`;

      switch (level) {
        case "error":
          console.error(line);
          break;
        case "warn":
          console.warn(line);
          break;
        case "debug":
          // Debug only when verbose logging is enabled
          if (process.env.XSGBBX_DEBUG) console.debug(line);
          break;
        default:
          console.log(line);
      }
    },
  };

  return ctx;
}
