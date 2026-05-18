export const APP_NAME = "xsgbbx";
export const APP_VERSION = "1.0.0";

export const DEFAULT_MODEL = "deepseek-v4-pro";
export const FALLBACK_MODEL = "deepseek-v4-flash";

// Only DeepSeek is actively supported. Other entries exist solely for
// internal code compatibility (config-store defaults, provider-registry).
export const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; models: string[]; placeholderKey: string }> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    models: ["deepseek-v4-pro", "deepseek-v4-flash"],
    placeholderKey: "",
  },
  // Legacy compatibility stubs — not offered to users
  anthropic: { baseUrl: "https://api.anthropic.com/v1", models: [], placeholderKey: "" },
  openai: { baseUrl: "https://api.openai.com/v1", models: [], placeholderKey: "" },
  google: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", models: [], placeholderKey: "" },
  mistral: { baseUrl: "https://api.mistral.ai/v1", models: [], placeholderKey: "" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", models: [], placeholderKey: "" },
  together: { baseUrl: "https://api.together.xyz/v1", models: [], placeholderKey: "" },
  xai: { baseUrl: "https://api.x.ai/v1", models: [], placeholderKey: "" },
  cohere: { baseUrl: "https://api.cohere.ai/v2", models: [], placeholderKey: "" },
  ollama: { baseUrl: "http://localhost:11434/v1", models: [], placeholderKey: "ollama" },
  lmstudio: { baseUrl: "http://localhost:1234/v1", models: [], placeholderKey: "lm-studio" },
  llamacpp: { baseUrl: "http://localhost:8080/v1", models: [], placeholderKey: "llamacpp" },
  vllm: { baseUrl: "http://localhost:8000/v1", models: [], placeholderKey: "vllm" },
  "openai-compatible": { baseUrl: "", models: [], placeholderKey: "" },
};

export const ANTHROPIC_API_VERSION = "2023-06-01";

export const TIMEOUTS = {
  API_REQUEST_MS: 120_000,
  API_STREAM_MS: 120_000,
  HEALTH_CHECK_MS: 5_000,
  FILE_READ_MS: 10_000,
  GIT_STATUS_MS: 10_000,
  GIT_DIFF_MS: 15_000,
  GIT_OPERATION_MS: 30_000,
  PR_OPERATION_MS: 30_000,
  AI_CLASSIFIER_MS: 3_000,
  BENCHMARK_COMPILE_MS: 30_000,
  BENCHMARK_TEST_MS: 30_000,
  PROCESS_SHUTDOWN_MS: 3_000,
  PROCESS_TIMEOUT_MS: 300_000,
  URL_FETCH_MS: 15_000,
  SSE_WAIT_MS: 10_000,
  CONNECTION_MS: 5_000,
  MCP_RECONNECT_BASE_MS: 1_000,
  MCP_HEALTH_CHECK_MS: 30_000,
  MCP_HTTP_MS: 15_000,
  MCP_MAX_RECONNECT_MS: 30_000,
  AGENT_DEFAULT_MS: 120_000,
  AGENT_ITERATION_MS: 300_000,
  QUERY_RETRY_MS: 2_000,
  HEAL_RETRY_MS: 1_000,
  APPROVAL_DEFAULT_MS: 30_000,
  APPROVAL_EXTENDED_MS: 60_000,
  APPROVAL_CRITICAL_MS: 120_000,
  APPROVAL_AUTO_MS: 300_000,
  CACHE_RULES_MS: 1_800_000,
  CACHE_PERMISSIONS_MS: 300_000,
  CACHE_TOOLS_MS: 600_000,
  CACHE_SESSIONS_MS: 120_000,
  AUTO_CHECKPOINT_MS: 300_000,
  IDLE_COMPACTION_MS: 300_000,
  LOG_FLUSH_MS: 2_000,
} as const;

export const LIMITS = {
  MAX_TURNS: 200,
  MAX_TURNS_CONTINUE: 50,
  MAX_CONSECUTIVE_FAILURES: 3,
  MAX_RETRIES: 3,
  MAX_TASK_LENGTH: 10_000,
  MAX_DIFF_OUTPUT: 8_000,
  MAX_FETCH_OUTPUT: 12_000,
  MAX_AGENT_OUTPUT: 4_000,
  MAX_COMPACTION_OUTPUT: 8_000,
  MAX_SHELL_BUFFER: 10 * 1024 * 1024,
  MAX_LOG_SIZE: 50 * 1024 * 1024,
  MAX_TELEMETRY_LOG_SIZE: 100 * 1024 * 1024,
  MAX_LOG_AGE_DAYS: 90,
  MAX_SESSION_AGE_MS: 24 * 60 * 60 * 1000,
  SESSION_RETENTION_DAYS: 30,
  MAX_CODE_STYLE_SIZE: 5 * 1024 * 1024,
  MAX_RAG_DOCUMENT_SIZE: 10 * 1024 * 1024,
  MAX_EXPORT_SIZE: 10 * 1024 * 1024,
  MAX_COMMIT_MESSAGE_LENGTH: 80,
  MAX_TOOL_SUMMARY_LENGTH: 100,
  MAX_STREAMING_DISPLAY_CHARS: 200,
  MAX_PROVIDER_MODELS_DISPLAY: 6,
  DEFAULT_MAX_TOKENS: 16384,
  RESERVED_TOKENS: 32768,
  CONTEXT_SELECTOR_DEFAULT_BUDGET: 100_000,
  REPO_MAP_MAX_TOKENS: 4_000,
  BUDGET_CRITICAL_THRESHOLD: 0.9,
  BUDGET_COMPACT_THRESHOLD: 0.6,
  AI_SAFETY_CONFIDENCE_THRESHOLD: 0.7,
} as const;

export const FILE_NAMES = {
  CONFIG: "config.json",
  CONFIG_TMP_SUFFIX: ".tmp",
  CONFIG_BAK_SUFFIX: ".bak",
  SESSIONS_DIR: "sessions",
  SESSION_EXT: ".json",
  AUDIT_DIR: "audit",
  AUDIT_EXT: ".log",
  AUDIT_ARCHIVED_SUFFIX: ".archived",
  LOGS_DIR: "logs",
  TELEMETRY_LOG: "agent_1.log",
  AGENT_DIR: ".xsgbbx",
  ENTRYPOINT: "xsgbbx.md",
  MEMORY_INDEX: "MEMORY.md",
  RULES_DIR: "rules",
  AGENTS_DIR: "agents",
  SKILLS_DIR: "skills",
} as const;

export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "deepseek-v4-pro": 1_000_000,
  "deepseek-v4-flash": 1_000_000,
};

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "deepseek-v4-pro": { input: 0.435, output: 0.87 },
  "deepseek-v4-flash": { input: 0.14, output: 0.28 },
};

export const ENV_KEY_MAP: Record<string, string> = {
  DEEPSEEK_API_KEY: "deepseek",
};

// Local provider probing is disabled — DeepSeek cloud API only.
// Type declaration kept as Record for compatibility with scanner code.
export const LOCAL_PROVIDER_PROBES: Record<string, { baseUrl: string; healthEndpoint: string; apiKey: string; port: number }> = {};
export const LOCAL_PROVIDER_SCAN_INTERVAL_MS = 0;
export const LOCAL_PROVIDER_STARTUP_SCAN_DELAY_MS = 0;

export const INTENT_TOKEN_BUDGETS: Record<string, number> = {
  code_generation: 64_000,
  code_modification: 100_000,
  code_review: 80_000,
  debugging: 90_000,
  exploration: 80_000,
  general: 64_000,
};
