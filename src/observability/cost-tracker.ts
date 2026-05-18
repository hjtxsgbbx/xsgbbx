import { EventEmitter } from "events";

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
}

export interface SessionMetrics {
  sessionId: string;
  startTime: string;
  totalTurns: number;
  totalToolCalls: number;
  successfulToolCalls: number;
  failedToolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUSD: number;
  currentTurn: number;
  maxTurns: number;
  averageConfidence: number;
  errorsEncountered: number;
  autoHealsAttempted: number;
  autoHealsSucceeded: number;
  lastActivity: string;
}

export interface BudgetConfig {
  maxCostUSD?: number;
  maxTokens?: number;
  warningThreshold?: number;
}

export interface BudgetStatus {
  costWithinBudget: boolean;
  tokensWithinBudget: boolean;
  costPercentUsed: number;
  tokensPercentUsed: number;
  costWarning: boolean;
  tokensWarning: boolean;
}

const DEFAULT_WARNING_THRESHOLD = 0.8;

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
  "claude-opus-4-20250514": { input: 15.0, output: 75.0 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4.0 },
  "claude-3-opus-20240229": { input: 15.0, output: 75.0 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10.0, output: 30.0 },
  "deepseek-chat": { input: 0.14, output: 0.28 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
  default: { input: 3.0, output: 15.0 },
};

export class CostBudgetExceededError extends Error {
  readonly metric: "cost" | "tokens";
  readonly current: number;
  readonly limit: number;

  constructor(metric: "cost" | "tokens", current: number, limit: number) {
    const label = metric === "cost" ? `$${current.toFixed(4)}` : `${current.toLocaleString()} tokens`;
    const limitLabel = metric === "cost" ? `$${limit.toFixed(2)}` : `${limit.toLocaleString()} tokens`;
    super(`Budget exceeded (${metric}): ${label} > ${limitLabel}`);
    this.name = "CostBudgetExceededError";
    this.metric = metric;
    this.current = current;
    this.limit = limit;
  }
}

export class CostTracker extends EventEmitter {
  private metrics: SessionMetrics;
  private budgetConfig: BudgetConfig;
  private warningFired = new Set<string>();

  constructor(sessionId: string, maxTurns = 50, budget?: BudgetConfig) {
    super();
    this.budgetConfig = budget || {};
    this.metrics = {
      sessionId,
      startTime: new Date().toISOString(),
      totalTurns: 0,
      totalToolCalls: 0,
      successfulToolCalls: 0,
      failedToolCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUSD: 0,
      currentTurn: 1,
      maxTurns,
      averageConfidence: 0,
      errorsEncountered: 0,
      autoHealsAttempted: 0,
      autoHealsSucceeded: 0,
      lastActivity: new Date().toISOString(),
    };
  }

  trackTurn(): void {
    this.metrics.totalTurns++;
    this.metrics.currentTurn++;
    this.metrics.lastActivity = new Date().toISOString();
    this.emit("costUpdate", this.getMetrics());
  }

  trackToolCall(success: boolean): void {
    this.metrics.totalToolCalls++;
    if (success) {
      this.metrics.successfulToolCalls++;
    } else {
      this.metrics.failedToolCalls++;
    }
    this.metrics.lastActivity = new Date().toISOString();
    this.emit("costUpdate", this.getMetrics());
  }

  trackTokens(input: number, output: number, model: string): void {
    this.metrics.totalInputTokens += input;
    this.metrics.totalOutputTokens += output;
    this.metrics.lastActivity = new Date().toISOString();

    const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
    const cost =
      (input / 1000000) * pricing.input +
      (output / 1000000) * pricing.output;

    this.metrics.estimatedCostUSD += cost;
    this.metrics.estimatedCostUSD = Math.round(this.metrics.estimatedCostUSD * 10000) / 10000;

    this.checkBudgetThresholds();
    this.emit("costUpdate", this.getMetrics());
  }

  trackError(): void {
    this.metrics.errorsEncountered++;
    this.metrics.lastActivity = new Date().toISOString();
  }

  trackHeal(success: boolean): void {
    this.metrics.autoHealsAttempted++;
    if (success) {
      this.metrics.autoHealsSucceeded++;
    }
    this.metrics.lastActivity = new Date().toISOString();
  }

  trackConfidence(confidence: number): void {
    const total = this.metrics.averageConfidence * (this.metrics.totalTurns - 1) + confidence;
    this.metrics.averageConfidence = this.metrics.totalTurns > 0
      ? total / this.metrics.totalTurns
      : confidence;
  }

  getMetrics(): Readonly<SessionMetrics> {
    return { ...this.metrics };
  }

  getProgress(): number {
    return Math.min(
      Math.round((this.metrics.currentTurn / this.metrics.maxTurns) * 100),
      100
    );
  }

  getCostSummary(): string {
    return `Session: ${this.metrics.sessionId.slice(0, 8)} | Turns: ${this.metrics.totalTurns}/${this.metrics.maxTurns} | Tools: ${this.metrics.totalToolCalls} (${this.metrics.successfulToolCalls}✓ ${this.metrics.failedToolCalls}✗) | Tokens: ${this.metrics.totalInputTokens.toLocaleString()}→${this.metrics.totalOutputTokens.toLocaleString()} | Cost: ≈$${this.metrics.estimatedCostUSD.toFixed(4)} | Errors: ${this.metrics.errorsEncountered}`;
  }

  getTokenBurnRate(): number {
    const elapsedMs = Date.now() - new Date(this.metrics.startTime).getTime();
    const elapsedMin = Math.max(elapsedMs / 60000, 0.1);
    return Math.round((this.metrics.totalInputTokens + this.metrics.totalOutputTokens) / elapsedMin);
  }

  getBudgetStatus(): BudgetStatus {
    const threshold = this.budgetConfig.warningThreshold ?? DEFAULT_WARNING_THRESHOLD;
    const totalTokens = this.metrics.totalInputTokens + this.metrics.totalOutputTokens;

    const costPercentUsed = this.budgetConfig.maxCostUSD
      ? (this.metrics.estimatedCostUSD / this.budgetConfig.maxCostUSD) * 100
      : -1;

    const tokensPercentUsed = this.budgetConfig.maxTokens
      ? (totalTokens / this.budgetConfig.maxTokens) * 100
      : -1;

    return {
      costWithinBudget: this.budgetConfig.maxCostUSD
        ? this.metrics.estimatedCostUSD <= this.budgetConfig.maxCostUSD
        : true,
      tokensWithinBudget: this.budgetConfig.maxTokens
        ? totalTokens <= this.budgetConfig.maxTokens
        : true,
      costPercentUsed,
      tokensPercentUsed,
      costWarning: this.budgetConfig.maxCostUSD
        ? costPercentUsed >= threshold * 100
        : false,
      tokensWarning: this.budgetConfig.maxTokens
        ? tokensPercentUsed >= threshold * 100
        : false,
    };
  }

  isBudgetExceeded(): boolean {
    const status = this.getBudgetStatus();
    return !status.costWithinBudget || !status.tokensWithinBudget;
  }

  checkBudgetAndThrow(): void {
    const totalTokens = this.metrics.totalInputTokens + this.metrics.totalOutputTokens;

    if (this.budgetConfig.maxCostUSD && this.metrics.estimatedCostUSD > this.budgetConfig.maxCostUSD) {
      throw new CostBudgetExceededError(
        "cost",
        this.metrics.estimatedCostUSD,
        this.budgetConfig.maxCostUSD
      );
    }

    if (this.budgetConfig.maxTokens && totalTokens > this.budgetConfig.maxTokens) {
      throw new CostBudgetExceededError(
        "tokens",
        totalTokens,
        this.budgetConfig.maxTokens
      );
    }
  }

  private checkBudgetThresholds(): void {
    const threshold = this.budgetConfig.warningThreshold ?? DEFAULT_WARNING_THRESHOLD;
    const totalTokens = this.metrics.totalInputTokens + this.metrics.totalOutputTokens;

    if (this.budgetConfig.maxCostUSD) {
      const ratio = this.metrics.estimatedCostUSD / this.budgetConfig.maxCostUSD;
      if (ratio >= threshold && !this.warningFired.has("cost_warning")) {
        this.warningFired.add("cost_warning");
        this.emit("budgetWarning", "cost", this.metrics.estimatedCostUSD, this.budgetConfig.maxCostUSD);
      }
      if (ratio >= 1.0 && !this.warningFired.has("cost_exceeded")) {
        this.warningFired.add("cost_exceeded");
        this.emit("budgetExceeded", "cost", this.metrics.estimatedCostUSD, this.budgetConfig.maxCostUSD);
      }
    }

    if (this.budgetConfig.maxTokens) {
      const ratio = totalTokens / this.budgetConfig.maxTokens;
      if (ratio >= threshold && !this.warningFired.has("tokens_warning")) {
        this.warningFired.add("tokens_warning");
        this.emit("budgetWarning", "tokens", totalTokens, this.budgetConfig.maxTokens);
      }
      if (ratio >= 1.0 && !this.warningFired.has("tokens_exceeded")) {
        this.warningFired.add("tokens_exceeded");
        this.emit("budgetExceeded", "tokens", totalTokens, this.budgetConfig.maxTokens);
      }
    }
  }

  reset(): void {
    const sessionId = this.metrics.sessionId;
    const maxTurns = this.metrics.maxTurns;
    this.metrics = new CostTracker(sessionId, maxTurns, this.budgetConfig).metrics;
    this.warningFired.clear();
  }
}
