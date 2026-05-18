# ADR-002: Generic OpenAI-Compatible Provider Abstraction

**Status**: ✅ Accepted
**Date**: 2026-05-14
**Deciders**: agent_1 Team
**Tags**: api, provider, architecture, abstraction

## Context

The agent_1 system needs to support multiple AI providers (Anthropic, OpenAI, Ollama, LM Studio, custom endpoints). Research found that Ollama (port 11434) and LM Studio (port 1234) both expose OpenAI-compatible Chat Completions APIs. Creating separate providers for each would lead to code duplication and maintenance burden.

## Decision

Adopt a **Generic OpenAI-Compatble Provider** pattern:

1. Create `OpenAICompatibleProvider` class parameterized by `baseUrl` and `apiKey`
2. Define `ProviderConfig` type with per-provider settings in Config
3. Build `ProviderRegistry` for health-check, auto-detection, and model listing
4. Keep `AnthropicProvider` separate since it uses a proprietary API format

## Consequences

**Positive**:
- One adapter covers OpenAI, Ollama, LM Studio, and any future OpenAI-compatible service
- Local model auto-detection works out of the box via `/v1/models` endpoint
- Adding a new OpenAI-compatible provider requires just config, not code

**Negative**:
- Anthropic's non-standard API format requires its own adapter
- Some OpenAI-compatible services may have subtle variations (e.g., response format)

## Alternatives Considered

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Individual providers per service | Full control, no assumptions | High code duplication, hard to maintain | ❌ Rejected |
| Generic OpenAI-Compatible adapter | Low duplication, auto-detection | Assumes API compatibility | ✅ Accepted |
| gRPC unified interface | Strong typing, performance | Over-engineered for REST APIs | ❌ Rejected |