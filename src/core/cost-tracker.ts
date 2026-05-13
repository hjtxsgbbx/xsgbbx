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

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
  "claude-3-opus-20240229": { input: 15.0, output: 75.0 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10.0, output: 30.0 },
  default: { input: 3.0, output: 15.0 },
};

export class CostTracker {
  private metrics: SessionMetrics;

  constructor(sessionId: string, maxTurns = 50) {
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
  }

  trackToolCall(success: boolean): void {
    this.metrics.totalToolCalls++;
    if (success) {
      this.metrics.successfulToolCalls++;
    } else {
      this.metrics.failedToolCalls++;
    }
    this.metrics.lastActivity = new Date().toISOString();
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

  reset(): void {
    this.metrics = new CostTracker(this.metrics.sessionId, this.metrics.maxTurns).metrics;
  }
}