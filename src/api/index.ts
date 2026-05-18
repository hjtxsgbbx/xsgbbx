export type { StreamEvent, AIProvider, AgentMode } from "./types.js";
export { createSystemPrompt } from "./system-prompt.js";
export { AnthropicProvider } from "./anthropic-provider.js";
export { OpenAIProvider } from "./openai-provider.js";
export { OpenAICompatibleProvider } from "./openai-compatible-provider.js";
export type { ProviderEndpoint } from "./openai-compatible-provider.js";
export { mapStopReason, safeParseJson, extractStringParam, extractRequiredStringParam, extractNumberParam } from "./utils.js";
export {
  createProviderFromConfig,
  checkProviderHealth,
  autoDetectLocalProviders,
  scanAllProviders,
  buildProviderRegistry,
} from "./provider-registry.js";
export type { ProviderStatus, ProviderRegistryEntry } from "./provider-registry.js";
export { LocalProviderScanner, getLocalProviderScanner, probeLocalProvider } from "./local-provider-scanner.js";
export type { LocalProviderState } from "./local-provider-scanner.js";

import { type AIProvider } from "./types.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";
import { PROVIDER_DEFAULTS } from "../core/constants.js";

export function createProvider(providerName: string): AIProvider {
  if (providerName === "openai") {
    return new OpenAICompatibleProvider({
      baseUrl: PROVIDER_DEFAULTS.openai.baseUrl,
      apiKey: "",
      providerName: "openai",
    });
  }
  return new AnthropicProvider();
}
