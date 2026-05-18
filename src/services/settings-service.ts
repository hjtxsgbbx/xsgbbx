/**
 * SettingsService
 *
 * Typed key-value access to the agent_1 configuration store.
 * Delegates persistence to storage/config-store (ConfigStore).
 *
 * All writes are async and atomic (write-to-tmp + rename).
 * Reads are synchronous and cached in memory after first load.
 */

import { ConfigStore, DEFAULT_CONFIG } from "../storage/config-store.js";
import type { Config } from "../types/index.js";

// ---------------------------------------------------------------------------
// SettingsService
// ---------------------------------------------------------------------------

export class SettingsService {
  private store: ConfigStore;
  private config: Config;

  constructor() {
    this.store = new ConfigStore();
    this.config = this.store.load();
  }

  // -------------------------------------------------------------------------
  // Key-value access
  // -------------------------------------------------------------------------

  /**
   * Get a setting value by key. Returns undefined if the key doesn't exist.
   */
  get<T = unknown>(key: string): T | undefined {
    return (this.config as unknown as Record<string, unknown>)[key] as T | undefined;
  }

  /**
   * Set a setting value by key. Automatically persists to disk.
   * Returns true on success, false if the save failed.
   */
  async set<T = unknown>(key: string, value: T): Promise<boolean> {
    const newConfig: Config = {
      ...this.config,
      [key]: value,
    } as Config;

    const saved = await this.store.save(newConfig);
    if (saved) {
      this.config = newConfig;
    }
    return saved;
  }

  /**
   * Set multiple settings at once (single disk write).
   * Returns true on success, false if the save failed.
   */
  async setMany(partial: Partial<Config>): Promise<boolean> {
    const newConfig: Config = {
      ...this.config,
      ...partial,
    };

    const saved = await this.store.save(newConfig);
    if (saved) {
      this.config = newConfig;
    }
    return saved;
  }

  // -------------------------------------------------------------------------
  // Bulk access
  // -------------------------------------------------------------------------

  /**
   * Get all settings as a flat key-value record.
   * Excludes provider_configs (nested configs should be accessed via get).
   */
  getAll(): Record<string, unknown> {
    const { provider_configs: _pc, ...flat } = this.config;
    return flat as unknown as Record<string, unknown>;
  }

  /**
   * Get the full config object (typed).
   */
  getConfig(): Readonly<Config> {
    return this.config;
  }

  // -------------------------------------------------------------------------
  // Specialized accessors
  // -------------------------------------------------------------------------

  /** Get the currently selected model. */
  getModel(): string {
    return this.config.model || DEFAULT_CONFIG.model;
  }

  /** Get the chosen provider key. */
  getProvider(): string {
    return this.config.chosen_provider || "deepseek";
  }

  /** Get the permission mode. */
  getPermissionMode(): string {
    return this.config.permission_mode;
  }

  /** Check if telemetry is enabled. */
  isTelemetryEnabled(): boolean {
    return this.config.telemetry_enabled ?? false;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Reload the config from disk. Useful after external config changes.
   */
  reload(): void {
    this.config = this.store.load();
  }

  /**
   * Reset all settings to factory defaults and persist.
   */
  async reset(): Promise<boolean> {
    const saved = await this.store.save({ ...DEFAULT_CONFIG });
    if (saved) {
      this.config = { ...DEFAULT_CONFIG };
    }
    return saved;
  }

  /**
   * Restore from the backup file. Returns false if no backup exists.
   */
  restore(): boolean {
    const restored = this.store.restore();
    if (restored) {
      this.config = this.store.load();
    }
    return restored;
  }
}
