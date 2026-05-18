import { type AIProvider, createProvider } from "./index.js";
import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";
import { type Config } from "../types/index.js";
import { PROVIDER_PRESETS, resolveProviderConfig } from "../storage/index.js";
import { DEFAULT_MODEL, ANTHROPIC_API_VERSION, TIMEOUTS, PROVIDER_DEFAULTS, LOCAL_PROVIDER_PROBES } from "../core/constants.js";

export interface ProviderStatus {
  provider: string;
  label: string;
  type: "cloud" | "local" | "custom";
  connected: boolean;
  models: string[];
  error?: string;
  baseUrl: string;
}

export interface ProviderRegistryEntry {
  name: string;
  label: string;
  type: "cloud" | "local" | "custom";
  baseUrl: string;
  apiKey: string;
  models: string[];
  createProvider: () => AIProvider;
}

export function createProviderFromConfig(config: Config): AIProvider {
  const providerName = config.chosen_provider || "anthropic";
  const resolved = resolveProviderConfig(config);

  if (providerName === "anthropic") {
    return createProvider("anthropic");
  }

  return new OpenAICompatibleProvider({
    baseUrl: resolved.base_url,
    apiKey: resolved.api_key,
    providerName,
  });
}

export async function checkProviderHealth(
  providerName: string,
  baseUrl: string,
  apiKey: string
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  if (providerName === "anthropic") {
    return checkAnthropicHealth(apiKey);
  }

  const provider = new OpenAICompatibleProvider({
    baseUrl,
    apiKey,
    providerName,
  });

  return provider.healthCheck();
}

async function checkAnthropicHealth(
  apiKey: string
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  if (!apiKey) {
    return { ok: false, models: [], error: "API key not configured" };
  }

  try {
    const response = await fetch(`${PROVIDER_DEFAULTS.anthropic.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: AbortSignal.timeout(TIMEOUTS.HEALTH_CHECK_MS * 2),
    });

    if (response.status === 401 || response.status === 403) {
      return { ok: false, models: [], error: "Invalid API key" };
    }

    const models = [...PROVIDER_DEFAULTS.anthropic.models];

    return { ok: true, models };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, models: [], error: message };
  }
}

export async function autoDetectLocalProviders(): Promise<
  Array<{ provider: string; baseUrl: string; ok: boolean; models: string[]; error?: string }>
> {
  const results: Array<{ provider: string; baseUrl: string; ok: boolean; models: string[]; error?: string }> = [];

  for (const [name, probe] of Object.entries(LOCAL_PROVIDER_PROBES)) {
    const health = await checkProviderHealth(name, probe.baseUrl, probe.apiKey);
    results.push({ provider: name, baseUrl: probe.baseUrl, ...health });
  }

  return results;
}

export async function scanAllProviders(config: Config): Promise<ProviderStatus[]> {
  const results: ProviderStatus[] = [];

  for (const [name, preset] of Object.entries(PROVIDER_PRESETS)) {
    const savedConfig = config.provider_configs?.[name];
    const baseUrl = savedConfig?.base_url || preset.base_url;
    const apiKey = savedConfig?.api_key || preset.api_key || config.api_key_ref;

    if (!baseUrl && preset.type !== "custom") continue;

    const health = await checkProviderHealth(name, baseUrl, apiKey);

    results.push({
      provider: name,
      label: preset.label,
      type: preset.type,
      connected: health.ok,
      models: health.models || savedConfig?.models || preset.models,
      error: health.error,
      baseUrl,
    });
  }

  return results;
}

export function buildProviderRegistry(config: Config): Map<string, ProviderRegistryEntry> {
  const registry = new Map<string, ProviderRegistryEntry>();

  for (const [name, preset] of Object.entries(PROVIDER_PRESETS)) {
    const savedConfig = config.provider_configs?.[name];
    const baseUrl = savedConfig?.base_url || preset.base_url;
    const apiKey = savedConfig?.api_key || preset.api_key || config.api_key_ref;
    const models = savedConfig?.models || preset.models;

    registry.set(name, {
      name,
      label: preset.label,
      type: preset.type,
      baseUrl,
      apiKey,
      models,
      createProvider: () => {
        if (name === "anthropic") {
          return createProvider("anthropic");
        }
        return new OpenAICompatibleProvider({
          baseUrl,
          apiKey,
          providerName: name,
        });
      },
    });
  }

  return registry;
}