import { EventEmitter } from "events";
import { LOCAL_PROVIDER_PROBES, LOCAL_PROVIDER_SCAN_INTERVAL_MS, LOCAL_PROVIDER_STARTUP_SCAN_DELAY_MS } from "../core/constants.js";
import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";
import { type Config } from "../types/index.js";
import { debug } from "../observability/debug.js";

export interface LocalProviderState {
  name: string;
  baseUrl: string;
  running: boolean;
  models: string[];
  lastChecked: number;
  autoActivated: boolean;
}

type LocalProviderName = keyof typeof LOCAL_PROVIDER_PROBES;

export class LocalProviderScanner extends EventEmitter {
  private states: Map<string, LocalProviderState> = new Map();
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private config: Config | null = null;
  private started = false;

  constructor() {
    super();
    for (const [name, probe] of Object.entries(LOCAL_PROVIDER_PROBES)) {
      this.states.set(name, {
        name,
        baseUrl: probe.baseUrl,
        running: false,
        models: [],
        lastChecked: 0,
        autoActivated: false,
      });
    }
  }

  start(config: Config): void {
    if (this.started) return;
    this.config = config;
    this.started = true;

    setTimeout(() => {
      this.scanAll();
      this.scanTimer = setInterval(() => this.scanAll(), LOCAL_PROVIDER_SCAN_INTERVAL_MS);
    }, LOCAL_PROVIDER_STARTUP_SCAN_DELAY_MS);

    debug.info("local-scanner", "Started local provider scanning");
  }

  stop(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    this.started = false;
    debug.info("local-scanner", "Stopped local provider scanning");
  }

  async scanAll(): Promise<LocalProviderState[]> {
    const results: LocalProviderState[] = [];

    for (const [name, probe] of Object.entries(LOCAL_PROVIDER_PROBES)) {
      const state = this.states.get(name);
      if (!state) continue;
      const wasRunning = state.running;

      try {
        const provider = new OpenAICompatibleProvider({
          baseUrl: probe.baseUrl,
          apiKey: probe.apiKey,
          providerName: name,
        });

        const health = await provider.healthCheck();
        state.running = health.ok;
        state.models = health.models || [];
        state.lastChecked = Date.now();

        if (health.ok && !wasRunning) {
          debug.info("local-scanner", `Local provider ${name} detected with models: ${state.models.join(", ")}`);
          this.emit("provider:started", { name, models: state.models, baseUrl: probe.baseUrl });

          if (this.config && this.shouldAutoActivate(name, state)) {
            this.autoActivate(name, state);
          }
        } else if (!health.ok && wasRunning) {
          debug.info("local-scanner", `Local provider ${name} stopped`);
          this.emit("provider:stopped", { name, baseUrl: probe.baseUrl });
        }
      } catch {
        if (state.running) {
          state.running = false;
          state.models = [];
          this.emit("provider:stopped", { name, baseUrl: probe.baseUrl });
        }
        state.lastChecked = Date.now();
      }

      results.push({ ...state });
    }

    this.emit("scan:complete", results);
    return results;
  }

  private shouldAutoActivate(name: string, state: LocalProviderState): boolean {
    if (!this.config) return false;
    if (state.autoActivated) return false;

    const hasCloudProvider = this.config.api_key_ref || this.config.chosen_provider;
    if (!hasCloudProvider) return true;

    const currentProviderConfig = this.config.provider_configs?.[this.config.chosen_provider || ""];
    const hasApiKey = currentProviderConfig?.api_key;
    if (!hasApiKey) return true;

    return false;
  }

  private autoActivate(name: string, state: LocalProviderState): void {
    if (!this.config) return;

    state.autoActivated = true;
    this.config.chosen_provider = name;

    if (state.models.length > 0) {
      this.config.model = state.models[0];
    }

    const providerConfig = this.config.provider_configs?.[name];
    if (providerConfig) {
      providerConfig.models = [...state.models];
    }

    this.emit("provider:auto-activated", {
      name,
      model: this.config.model,
      models: state.models,
      baseUrl: state.baseUrl,
    });

    debug.info("local-scanner", `Auto-activated local provider: ${name} with model: ${this.config.model}`);
  }

  getStates(): LocalProviderState[] {
    return Array.from(this.states.values());
  }

  getState(name: string): LocalProviderState | undefined {
    return this.states.get(name);
  }

  getRunningProviders(): LocalProviderState[] {
    return Array.from(this.states.values()).filter((s) => s.running);
  }

  isRunning(name: string): boolean {
    return this.states.get(name)?.running ?? false;
  }

  updateConfig(config: Config): void {
    this.config = config;
  }
}

let scannerInstance: LocalProviderScanner | null = null;

export function getLocalProviderScanner(): LocalProviderScanner {
  if (!scannerInstance) {
    scannerInstance = new LocalProviderScanner();
  }
  return scannerInstance;
}

export async function probeLocalProvider(name: string): Promise<{ ok: boolean; models: string[]; error?: string }> {
  const probe = LOCAL_PROVIDER_PROBES[name as LocalProviderName];
  if (!probe) {
    return { ok: false, models: [], error: `Unknown local provider: ${name}` };
  }

  try {
    const provider = new OpenAICompatibleProvider({
      baseUrl: probe.baseUrl,
      apiKey: probe.apiKey,
      providerName: name,
    });

    return provider.healthCheck();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, models: [], error: message };
  }
}
