import * as path from "path";
import * as fs from "fs";
import { promises as fsp } from "fs";
import { type Config } from "../types/index.js";
import { getAgentDir } from "../pal/index.js";
import { debug } from "../observability/debug.js";
import { DEFAULT_MODEL, PROVIDER_DEFAULTS, LIMITS, ENV_KEY_MAP } from "../core/constants.js";

export const DEFAULT_CONFIG: Config = {
  version: 3,
  permission_mode: "default",
  auto_create_pr: false,
  auto_commit: true,
  accept_terms: false,
  chosen_provider: "",
  session_retention_days: LIMITS.SESSION_RETENTION_DAYS,
  telemetry_enabled: false,
  max_turns: LIMITS.MAX_TURNS,
  model: DEFAULT_MODEL,
  api_key_ref: "",
  ui: {
    color_theme: "dark",
    compact_mode: false,
  },
  ai_safety_confidence_threshold: LIMITS.AI_SAFETY_CONFIDENCE_THRESHOLD,
  thinking_effort: "medium",
  provider_configs: {
    anthropic: {
      provider: "anthropic",
      base_url: PROVIDER_DEFAULTS.anthropic.baseUrl,
      api_key: PROVIDER_DEFAULTS.anthropic.placeholderKey,
      models: [...PROVIDER_DEFAULTS.anthropic.models],
    },
    openai: {
      provider: "openai",
      base_url: PROVIDER_DEFAULTS.openai.baseUrl,
      api_key: PROVIDER_DEFAULTS.openai.placeholderKey,
      models: [...PROVIDER_DEFAULTS.openai.models],
    },
    google: {
      provider: "google",
      base_url: PROVIDER_DEFAULTS.google.baseUrl,
      api_key: PROVIDER_DEFAULTS.google.placeholderKey,
      models: [...PROVIDER_DEFAULTS.google.models],
    },
    deepseek: {
      provider: "deepseek",
      base_url: PROVIDER_DEFAULTS.deepseek.baseUrl,
      api_key: PROVIDER_DEFAULTS.deepseek.placeholderKey,
      models: [...PROVIDER_DEFAULTS.deepseek.models],
    },
    mistral: {
      provider: "mistral",
      base_url: PROVIDER_DEFAULTS.mistral.baseUrl,
      api_key: PROVIDER_DEFAULTS.mistral.placeholderKey,
      models: [...PROVIDER_DEFAULTS.mistral.models],
    },
    groq: {
      provider: "groq",
      base_url: PROVIDER_DEFAULTS.groq.baseUrl,
      api_key: PROVIDER_DEFAULTS.groq.placeholderKey,
      models: [...PROVIDER_DEFAULTS.groq.models],
    },
    together: {
      provider: "together",
      base_url: PROVIDER_DEFAULTS.together.baseUrl,
      api_key: PROVIDER_DEFAULTS.together.placeholderKey,
      models: [...PROVIDER_DEFAULTS.together.models],
    },
    xai: {
      provider: "xai",
      base_url: PROVIDER_DEFAULTS.xai.baseUrl,
      api_key: PROVIDER_DEFAULTS.xai.placeholderKey,
      models: [...PROVIDER_DEFAULTS.xai.models],
    },
    cohere: {
      provider: "cohere",
      base_url: PROVIDER_DEFAULTS.cohere.baseUrl,
      api_key: PROVIDER_DEFAULTS.cohere.placeholderKey,
      models: [...PROVIDER_DEFAULTS.cohere.models],
    },
    ollama: {
      provider: "ollama",
      base_url: PROVIDER_DEFAULTS.ollama.baseUrl,
      api_key: PROVIDER_DEFAULTS.ollama.placeholderKey,
      models: [...PROVIDER_DEFAULTS.ollama.models],
    },
    lmstudio: {
      provider: "lmstudio",
      base_url: PROVIDER_DEFAULTS.lmstudio.baseUrl,
      api_key: PROVIDER_DEFAULTS.lmstudio.placeholderKey,
      models: [...PROVIDER_DEFAULTS.lmstudio.models],
    },
    llamacpp: {
      provider: "llamacpp",
      base_url: PROVIDER_DEFAULTS.llamacpp.baseUrl,
      api_key: PROVIDER_DEFAULTS.llamacpp.placeholderKey,
      models: [...PROVIDER_DEFAULTS.llamacpp.models],
    },
    vllm: {
      provider: "vllm",
      base_url: PROVIDER_DEFAULTS.vllm.baseUrl,
      api_key: PROVIDER_DEFAULTS.vllm.placeholderKey,
      models: [...PROVIDER_DEFAULTS.vllm.models],
    },
    "openai-compatible": {
      provider: "openai-compatible",
      base_url: PROVIDER_DEFAULTS["openai-compatible"].baseUrl,
      api_key: PROVIDER_DEFAULTS["openai-compatible"].placeholderKey,
      models: [...PROVIDER_DEFAULTS["openai-compatible"].models],
    },
  },
};

export const PROVIDER_PRESETS: Record<string, { label: string; base_url: string; api_key: string; models: string[]; type: "cloud" | "local" | "custom" }> = {
  anthropic: {
    label: "Anthropic",
    base_url: PROVIDER_DEFAULTS.anthropic.baseUrl,
    api_key: PROVIDER_DEFAULTS.anthropic.placeholderKey,
    models: [...PROVIDER_DEFAULTS.anthropic.models],
    type: "cloud",
  },
  openai: {
    label: "OpenAI",
    base_url: PROVIDER_DEFAULTS.openai.baseUrl,
    api_key: PROVIDER_DEFAULTS.openai.placeholderKey,
    models: [...PROVIDER_DEFAULTS.openai.models],
    type: "cloud",
  },
  google: {
    label: "Google Gemini",
    base_url: PROVIDER_DEFAULTS.google.baseUrl,
    api_key: PROVIDER_DEFAULTS.google.placeholderKey,
    models: [...PROVIDER_DEFAULTS.google.models],
    type: "cloud",
  },
  deepseek: {
    label: "DeepSeek",
    base_url: PROVIDER_DEFAULTS.deepseek.baseUrl,
    api_key: PROVIDER_DEFAULTS.deepseek.placeholderKey,
    models: [...PROVIDER_DEFAULTS.deepseek.models],
    type: "cloud",
  },
  mistral: {
    label: "Mistral",
    base_url: PROVIDER_DEFAULTS.mistral.baseUrl,
    api_key: PROVIDER_DEFAULTS.mistral.placeholderKey,
    models: [...PROVIDER_DEFAULTS.mistral.models],
    type: "cloud",
  },
  groq: {
    label: "Groq",
    base_url: PROVIDER_DEFAULTS.groq.baseUrl,
    api_key: PROVIDER_DEFAULTS.groq.placeholderKey,
    models: [...PROVIDER_DEFAULTS.groq.models],
    type: "cloud",
  },
  together: {
    label: "Together AI",
    base_url: PROVIDER_DEFAULTS.together.baseUrl,
    api_key: PROVIDER_DEFAULTS.together.placeholderKey,
    models: [...PROVIDER_DEFAULTS.together.models],
    type: "cloud",
  },
  xai: {
    label: "xAI (Grok)",
    base_url: PROVIDER_DEFAULTS.xai.baseUrl,
    api_key: PROVIDER_DEFAULTS.xai.placeholderKey,
    models: [...PROVIDER_DEFAULTS.xai.models],
    type: "cloud",
  },
  cohere: {
    label: "Cohere",
    base_url: PROVIDER_DEFAULTS.cohere.baseUrl,
    api_key: PROVIDER_DEFAULTS.cohere.placeholderKey,
    models: [...PROVIDER_DEFAULTS.cohere.models],
    type: "cloud",
  },
  ollama: {
    label: "Ollama (Local)",
    base_url: PROVIDER_DEFAULTS.ollama.baseUrl,
    api_key: PROVIDER_DEFAULTS.ollama.placeholderKey,
    models: [...PROVIDER_DEFAULTS.ollama.models],
    type: "local",
  },
  lmstudio: {
    label: "LM Studio (Local)",
    base_url: PROVIDER_DEFAULTS.lmstudio.baseUrl,
    api_key: PROVIDER_DEFAULTS.lmstudio.placeholderKey,
    models: [...PROVIDER_DEFAULTS.lmstudio.models],
    type: "local",
  },
  llamacpp: {
    label: "llama.cpp (Local)",
    base_url: PROVIDER_DEFAULTS.llamacpp.baseUrl,
    api_key: PROVIDER_DEFAULTS.llamacpp.placeholderKey,
    models: [...PROVIDER_DEFAULTS.llamacpp.models],
    type: "local",
  },
  vllm: {
    label: "vLLM (Local)",
    base_url: PROVIDER_DEFAULTS.vllm.baseUrl,
    api_key: PROVIDER_DEFAULTS.vllm.placeholderKey,
    models: [...PROVIDER_DEFAULTS.vllm.models],
    type: "local",
  },
  "openai-compatible": {
    label: "OpenAI Compatible",
    base_url: PROVIDER_DEFAULTS["openai-compatible"].baseUrl,
    api_key: PROVIDER_DEFAULTS["openai-compatible"].placeholderKey,
    models: [...PROVIDER_DEFAULTS["openai-compatible"].models],
    type: "custom",
  },
};

export function resolveProviderConfig(config: Config): { base_url: string; api_key: string } {
  const provider = config.chosen_provider || "anthropic";
  const providerConfig = config.provider_configs?.[provider];
  if (providerConfig) {
    return {
      base_url: providerConfig.base_url || PROVIDER_PRESETS[provider]?.base_url || "",
      api_key: providerConfig.api_key || config.api_key_ref || "",
    };
  }
  const preset = PROVIDER_PRESETS[provider];
  return {
    base_url: preset?.base_url || "",
    api_key: config.api_key_ref || preset?.api_key || "",
  };
}

export { ENV_KEY_MAP };

function validateProviderModelMatch(config: Config): Config {
  if (!config.chosen_provider || !config.model) return config;

  const providerConfig = config.provider_configs?.[config.chosen_provider];
  if (!providerConfig?.models?.length) return config;

  if (providerConfig.models.includes(config.model)) return config;

  const result = { ...config };
  result.model = providerConfig.models[0];
  return result;
}

function detectEnvApiKeys(config: Config): Config {
  const result = { ...config };
  const providerConfigs = { ...result.provider_configs };

  for (const [envVar, provider] of Object.entries(ENV_KEY_MAP)) {
    const envValue = process.env[envVar];
    if (envValue && providerConfigs[provider]) {
      const pc = { ...providerConfigs[provider] };
      if (!pc.api_key) {
        pc.api_key = envValue;
        providerConfigs[provider] = pc;
      }
    }
  }

  result.provider_configs = providerConfigs;

  if (!result.chosen_provider) {
    for (const [envVar, provider] of Object.entries(ENV_KEY_MAP)) {
      if (process.env[envVar]) {
        result.chosen_provider = provider;
        const pc = providerConfigs[provider];
        if (pc?.models?.[0]) {
          result.model = pc.models[0];
        }
        break;
      }
    }
  }

  return validateProviderModelMatch(result);
}

export class ConfigStore {
  private configPath: string;

  constructor() {
    const agentDir = getAgentDir();
    this.configPath = path.join(agentDir, "config.json");
  }

  load(): Config {
    try {
      if (!fs.existsSync(this.configPath)) {
        return detectEnvApiKeys({ ...DEFAULT_CONFIG });
      }

      const raw = fs.readFileSync(this.configPath, "utf-8");
      const stored = JSON.parse(raw) as Config;

      return detectEnvApiKeys({ ...DEFAULT_CONFIG, ...stored });
    } catch (err) {
      debug.warn("config-store", "Config load failed, using defaults", err);
      return detectEnvApiKeys({ ...DEFAULT_CONFIG });
    }
  }

  async save(config: Config): Promise<boolean> {
    try {
      const dir = path.dirname(this.configPath);
      await fsp.mkdir(dir, { recursive: true });

      config.version = DEFAULT_CONFIG.version;
      const data = JSON.stringify(config, null, 2);
      const tmpPath = this.configPath + ".tmp";
      await fsp.writeFile(tmpPath, data, "utf-8");
      await fsp.rename(tmpPath, this.configPath);
      return true;
    } catch (err) {
      debug.warn("config-store", "Config save failed", err);
      return false;
    }
  }

  backup(): boolean {
    try {
      if (!fs.existsSync(this.configPath)) return false;
      const backupPath = this.configPath + ".bak";
      fs.copyFileSync(this.configPath, backupPath);
      return true;
    } catch (err) {
      debug.warn("config-store", "Config backup failed", err);
      return false;
    }
  }

  restore(): boolean {
    try {
      const backupPath = this.configPath + ".bak";
      if (!fs.existsSync(backupPath)) return false;
      fs.copyFileSync(backupPath, this.configPath);
      fs.unlinkSync(backupPath);
      return true;
    } catch (err) {
      debug.warn("config-store", "Config restore failed", err);
      return false;
    }
  }
}