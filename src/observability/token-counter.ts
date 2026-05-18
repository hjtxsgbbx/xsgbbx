const TOKEN_ESTIMATE_PATTERNS = [
  { pattern: /\b(claude|anthropic)\b/i, charsPerToken: 3.2 },
  { pattern: /\b(gpt|openai)\b/i, charsPerToken: 3.5 },
  { pattern: /./, charsPerToken: 3.5 },
];

const tokenCache = new Map<string, number>();
const TOKEN_CACHE_MAX_SIZE = 256;

function cacheKey(text: string, modelName?: string): string {
  const len = text.length;
  const prefix = text.slice(0, 32);
  const suffix = text.slice(-32);
  return `${modelName || "default"}:${len}:${prefix}:${suffix}`;
}

export function estimateTokens(text: string, modelName?: string): number {
  if (!text || text.length === 0) return 0;

  const key = cacheKey(text, modelName);
  const cached = tokenCache.get(key);
  if (cached !== undefined) return cached;

  const modelPattern = TOKEN_ESTIMATE_PATTERNS.find(
    (p) => modelName && p.pattern.test(modelName)
  ) || TOKEN_ESTIMATE_PATTERNS[TOKEN_ESTIMATE_PATTERNS.length - 1];

  const charsPerToken = modelPattern.charsPerToken;
  const baseTokens = Math.ceil(text.length / charsPerToken);

  const codeBlockCount = (text.match(/```[\s\S]*?```/g) || []).length;
  const codeTokenBonus = codeBlockCount * 0.15 * baseTokens;

  const specialCharCount = (text.match(/[{}()[\]<>&|~`@#$%^*+\-=]/g) || []).length;
  const specialTokenBonus = specialCharCount * 0.03;

  const chineseCharCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const chineseTokenBonus = chineseCharCount * 0.6;

  const result = Math.ceil(baseTokens + codeTokenBonus + specialTokenBonus + chineseTokenBonus);

  if (tokenCache.size >= TOKEN_CACHE_MAX_SIZE) {
    const firstKey = tokenCache.keys().next().value;
    if (firstKey !== undefined) tokenCache.delete(firstKey);
  }
  tokenCache.set(key, result);

  return result;
}

export function clearTokenCache(): void {
  tokenCache.clear();
}

export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string }>,
  modelName?: string
): number {
  return messages.reduce((total, msg) => {
    const overhead = msg.role === "system" ? 8 : msg.role === "assistant" ? 6 : 5;
    return total + overhead + estimateTokens(msg.content, modelName);
  }, 3);
}

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "claude-sonnet-4-20250514": 200000,
  "claude-3-5-sonnet-20241022": 200000,
  "claude-3-opus-20240229": 200000,
  "claude-3-haiku-20240307": 200000,
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  default: 128000,
};

export interface TokenBudget {
  total: number;
  used: number;
  remaining: number;
  limit: number;
  percentUsed: number;
  needsCompaction: boolean;
  hardLimitExceeded: boolean;
}

export function calculateBudget(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  repoMapText: string,
  modelName: string,
  maxOutputTokens = 4096
): TokenBudget {
  const limit = MODEL_CONTEXT_LIMITS[modelName] || MODEL_CONTEXT_LIMITS.default;
  const systemTokens = estimateTokens(systemPrompt, modelName);
  const messagesTokens = estimateMessagesTokens(messages, modelName);
  const repoMapTokens = estimateTokens(repoMapText, modelName);
  const used = systemTokens + messagesTokens + repoMapTokens + maxOutputTokens + 100;
  const remaining = Math.max(0, limit - used);

  return {
    total: limit,
    used,
    remaining,
    limit,
    percentUsed: Math.round((used / limit) * 100),
    needsCompaction: used > limit * 0.85,
    hardLimitExceeded: remaining < 1000,
  };
}

export function shouldCompact(budget: TokenBudget): boolean {
  return budget.needsCompaction || budget.hardLimitExceeded;
}

export function getModelLimit(modelName: string): number {
  return MODEL_CONTEXT_LIMITS[modelName] || MODEL_CONTEXT_LIMITS.default;
}

export class TokenBudgetExceededError extends Error {
  public budget: TokenBudget;

  constructor(message: string, budget: TokenBudget) {
    super(message);
    this.name = "TokenBudgetExceededError";
    this.budget = budget;
  }
}
