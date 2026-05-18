import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { PROVIDER_PRESETS } from "../../storage/index.js";
import { autoDetectLocalProviders, checkProviderHealth } from "../../api/index.js";
import type { Config } from "../../types/index.js";

interface ProviderInfo {
  key: string;
  label: string;
  type: "cloud" | "local" | "custom";
  baseUrl: string;
  status: "available" | "unavailable" | "checking";
  models: string[];
  error?: string;
}

interface ProviderSelectProps {
  config: Config;
  onSelect: (provider: string, customConfig?: Partial<Config>) => void;
}

export const ProviderSelect: React.FC<ProviderSelectProps> = ({ config, onSelect }) => {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [scanning, setScanning] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [step, setStep] = useState<"select" | "custom_url" | "custom_key" | "custom_model">("select");
  const [_customModel, setCustomModel] = useState("");
  const pendingProviderRef = React.useRef<string>("");

  const [scanError, setScanError] = useState<string>("");

  useEffect(() => {
    scanProviders();
  }, []);

  async function scanProviders(): Promise<void> {
    setScanning(true);
    setScanError("");

    try {
      const localResults = await autoDetectLocalProviders();
      const localMap = new Map(localResults.map((r) => [r.provider, r]));

      const entries: ProviderInfo[] = [];

      for (const [key, preset] of Object.entries(PROVIDER_PRESETS)) {
        if (key === "openai-compatible" && !showAdvanced) continue;

        const savedConfig = config.provider_configs?.[key];
        const baseUrl = savedConfig?.base_url || preset.base_url;
        const status: ProviderInfo["status"] = key === "openai-compatible"
          ? "available"
          : localMap.get(key)?.ok
            ? "available"
            : "checking";

        entries.push({
          key,
          label: preset.label,
          type: preset.type,
          baseUrl: baseUrl || preset.base_url,
          status,
          models: localMap.get(key)?.models || savedConfig?.models || preset.models || [],
          error: localMap.get(key)?.error,
        });
      }

      const localPromises = entries
        .filter((e) => e.status === "checking" && e.type === "local")
        .map(async (entry) => {
          try {
            const health = await checkProviderHealth(entry.key, entry.baseUrl, entry.key === "ollama" ? "ollama" : "lm-studio");
            return { key: entry.key, ok: health.ok, models: health.models, error: health.error };
          } catch {
            return { key: entry.key, ok: false, models: [], error: "Health check failed" };
          }
        });

      const healthResults = await Promise.all(localPromises);
      for (const result of healthResults) {
        const entry = entries.find((e) => e.key === result.key);
        if (entry) {
          entry.status = result.ok ? "available" : "unavailable";
          entry.models = result.models.length > 0 ? result.models : entry.models;
          entry.error = result.error;
        }
      }

      setProviders(entries);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setScanError(message);
      setProviders([]);
    }
    setScanning(false);
  }

  function handleSelectProvider(key: string): void {
    const entry = providers.find((p) => p.key === key);
    if (!entry) return;

    if (entry.type === "cloud" && !config.provider_configs?.[key]?.api_key && !config.api_key_ref) {
      setStep("custom_key");
      pendingProviderRef.current = key;
      return;
    }

    if (entry.key === "openai-compatible") {
      setStep("custom_url");
      pendingProviderRef.current = key;
      return;
    }

    commitProvider(key);
  }

  function commitProvider(key: string): void {
    const entry = providers.find((p) => p.key === key);
    const preset = PROVIDER_PRESETS[key];
    const savedConfig = config.provider_configs?.[key];

    if (savedConfig || (entry && entry.models.length > 0)) {
      const customConfig: Partial<Config> = {};
      customConfig.provider_configs = {
        ...config.provider_configs,
        [key]: {
          provider: key,
          base_url: savedConfig?.base_url || entry?.baseUrl || preset?.base_url,
          api_key: savedConfig?.api_key,
          models: savedConfig?.models || entry?.models || preset?.models || [],
        },
      };
      if (entry?.models?.[0]) {
        customConfig.model = entry.models[0];
      }
      onSelect(key, customConfig);
    } else {
      onSelect(key);
    }
  }

  function handleCustomUrlSubmit(url: string): void {
    const trimmed = url.trim();
    if (!trimmed) return;
    setCustomUrl(trimmed);
    setStep("custom_key");
  }

  function handleCustomKeySubmit(key: string): void {
    setCustomKey(key.trim());
    setStep("custom_model");
  }

  function handleCustomModelSubmit(model: string): void {
    setCustomModel(model.trim());
    const providerKey = pendingProviderRef.current || "openai-compatible";
    const preset = PROVIDER_PRESETS[providerKey];
    const entry = providers.find((p) => p.key === providerKey);

    const customConfig: Partial<Config> = {};
    customConfig.provider_configs = {
      ...config.provider_configs,
      [providerKey]: {
        provider: providerKey,
        base_url: customUrl || entry?.baseUrl || preset?.base_url || "",
        api_key: customKey,
        models: model.trim() ? [model.trim()] : (entry?.models || preset?.models || []),
      },
    };
    customConfig.model = model.trim() || entry?.models?.[0] || preset?.models?.[0] || "default";

    onSelect(providerKey, customConfig);
  }

  if (step === "custom_url") {
    return (
      <Box flexDirection="column">
        <Box marginY={1}>
          <Text bold>Enter OpenAI-compatible API base URL:</Text>
        </Box>
        <Box>
          <Text>  URL (e.g. https://api.openai.com/v1): </Text>
          <UrlInput onSubmit={handleCustomUrlSubmit} />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>  Press Enter to continue, Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  if (step === "custom_key") {
    return (
      <Box flexDirection="column">
        <Box marginY={1}>
          <Text bold>Enter API Key (leave empty if not required):</Text>
        </Box>
        <Box>
          <Text>  API Key: </Text>
          <KeyInput onSubmit={handleCustomKeySubmit} />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>  For local servers like Ollama/LM Studio, press Enter to skip</Text>
        </Box>
      </Box>
    );
  }

  if (step === "custom_model") {
    return (
      <Box flexDirection="column">
        <Box marginY={1}>
          <Text bold>Enter model name:</Text>
        </Box>
        <Box>
          <Text>  Model: </Text>
          <ModelInput onSubmit={handleCustomModelSubmit} />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>  Press Enter to confirm, leave empty for default</Text>
        </Box>
      </Box>
    );
  }

  const localProviders = providers.filter((p) => p.type === "local");
  const cloudProviders = providers.filter((p) => p.type === "cloud");
  const customProviders = providers.filter((p) => p.type === "custom");

  return (
    <Box flexDirection="column">
      <Box
        borderStyle="classic"
        borderColor="yellow"
        paddingX={2}
        paddingY={1}
        flexDirection="column"
      >
        <Text bold color="yellow">
          ================================================
        </Text>
        <Text bold>
          agent_1 needs to send code to an AI provider
        </Text>
        <Text>  for intelligent responses. See PRIVACY.md for details.</Text>
        <Text bold color="yellow">
          ================================================
        </Text>
      </Box>

      {scanning && (
        <Box marginY={1}>
          <Text color="yellow">  Scanning for local providers...</Text>
        </Box>
      )}

      {scanError && (
        <Box marginY={1}>
          <Text color="red">  Scan error: {scanError}</Text>
        </Box>
      )}

      <Box marginY={1}>
        <Text bold>  Cloud Providers:</Text>
      </Box>
      {cloudProviders.map((p, i) => (
        <Box key={p.key}>
          <Text>
            {"  "}
            <Text color="cyan">[{i + 1}]</Text> {p.label.padEnd(20)}
            <Text dimColor>
              {p.baseUrl ? ` (${p.baseUrl})` : ""}
            </Text>
          </Text>
        </Box>
      ))}

      <Box marginY={1}>
        <Text bold>  Local Providers:</Text>
      </Box>
      {localProviders.map((p, i) => (
        <Box key={p.key} flexDirection="column">
          <Box>
            <Text>
              {"  "}
              <Text color="green">[{cloudProviders.length + i + 1}]</Text>{" "}
              {p.label.padEnd(20)}
              <Text color={p.status === "available" ? "green" : p.status === "checking" ? "yellow" : "red"}>
                {p.status === "available"
                  ? ` [connected${p.models.length > 0 ? ` - ${p.models.length} models` : ""}]`
                  : p.status === "checking"
                    ? " [checking...]"
                    : ` [unavailable${p.error ? `: ${p.error}` : ""}]`}
              </Text>
            </Text>
          </Box>
          {p.status === "available" && p.models.length > 0 && (
            <Box>
              <Text dimColor>
                {"    Models: "}{p.models.slice(0, 6).join(", ")}
                {p.models.length > 6 ? ` +${p.models.length - 6} more` : ""}
              </Text>
            </Box>
          )}
        </Box>
      ))}

      {customProviders.map((p, i) => {
        const idx = cloudProviders.length + localProviders.length + i + 1;
        return (
          <Box key={p.key}>
            <Text>
              {"  "}
              <Text color="magenta">[{idx}]</Text> {p.label.padEnd(20)}
              <Text dimColor>(custom endpoint)</Text>
            </Text>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text>{showAdvanced ? "  [A] Hide custom  " : "  [A] Show custom  "}</Text>
        <Text color="yellow">[R] Refresh  </Text>
        <Text color="red">[Q] Quit</Text>
      </Box>
      <Box marginTop={1}>
        <Text>  Select provider (or 'q' to quit): </Text>
        <ProviderInput
          providers={[...cloudProviders, ...localProviders, ...customProviders]}
          onSelect={handleSelectProvider}
          onRefresh={() => scanProviders()}
          onToggleAdvanced={() => { setShowAdvanced(!showAdvanced); scanProviders(); }}
        />
      </Box>
    </Box>
  );
};

const ProviderInput: React.FC<{
  providers: ProviderInfo[];
  onSelect: (key: string) => void;
  onRefresh: () => void;
  onToggleAdvanced: () => void;
}> = ({ providers, onSelect, onRefresh, onToggleAdvanced }) => {
  const [value, setValue] = useState("");

  const handleSubmit = (val: string) => {
    const trimmed = val.trim().toLowerCase();

    if (trimmed === "a") {
      onToggleAdvanced();
      setValue("");
      return;
    }
    if (trimmed === "r") {
      onRefresh();
      setValue("");
      return;
    }
    if (trimmed === "q") {
      process.exit(0);
    }

    const idx = parseInt(trimmed);
    if (idx >= 1 && idx <= providers.length) {
      const provider = providers[idx - 1];
      if (provider) {
        onSelect(provider.key);
      }
    }
    setValue("");
  };

  return (
    <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
  );
};

const UrlInput: React.FC<{ onSubmit: (url: string) => void }> = ({ onSubmit }) => {
  const [value, setValue] = useState("");

  return (
    <TextInput
      value={value}
      onChange={setValue}
      onSubmit={(val) => {
        if (val.trim()) onSubmit(val.trim());
        setValue("");
      }}
    />
  );
};

const KeyInput: React.FC<{ onSubmit: (key: string) => void }> = ({ onSubmit }) => {
  const [value, setValue] = useState("");

  return (
    <TextInput
      value={value}
      onChange={setValue}
      onSubmit={(val) => {
        onSubmit(val);
        setValue("");
      }}
    />
  );
};

const ModelInput: React.FC<{ onSubmit: (model: string) => void }> = ({ onSubmit }) => {
  const [value, setValue] = useState("");

  return (
    <TextInput
      value={value}
      onChange={setValue}
      onSubmit={(val) => {
        onSubmit(val);
        setValue("");
      }}
    />
  );
};