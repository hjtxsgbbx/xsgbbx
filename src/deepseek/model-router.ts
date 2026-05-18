/**
 * Multi-model router — intelligently routes tasks to the best model.
 *
 * DeepSeek-exclusive: uses DeepSeek for generation, can fall back to
 * other providers for specialized tasks. Claude Code doesn't have this
 * because it's Anthropic-only.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelEndpoint {
  name: string;
  provider: string;
  model: string;
  /** Capabilities this model has */
  capabilities: ModelCapability[];
  /** Cost per 1M tokens (input/output) */
  costPerM: { input: number; output: number };
  /** Performance tier: 1=fastest, 5=smartest */
  tier: number;
  /** Max context window */
  contextWindow: number;
}

export type ModelCapability =
  | "chat"
  | "code-generation"
  | "code-review"
  | "reasoning"
  | "planning"
  | "tool-use"
  | "vision"
  | "long-context"
  | "fast";

export interface RoutingDecision {
  endpoint: ModelEndpoint;
  reason: string;
  alternatives: ModelEndpoint[];
}

export interface TaskProfile {
  type: "chat" | "code-gen" | "code-review" | "debug" | "plan" | "search" | "refactor";
  estimatedComplexity: 1 | 2 | 3 | 4 | 5;
  requiresTools: boolean;
  requiresReasoning: boolean;
  maxTokens: number;
  estimatedInputTokens: number;
}

// ---------------------------------------------------------------------------
// Pre-configured DeepSeek endpoints
// ---------------------------------------------------------------------------

const DEEPSEEK_ENDPOINTS: ModelEndpoint[] = [
  {
    name: "deepseek-v3",
    provider: "deepseek",
    model: "deepseek-chat",
    capabilities: ["chat", "code-generation", "code-review", "tool-use", "fast"],
    costPerM: { input: 0.27, output: 1.10 },
    tier: 3,
    contextWindow: 128_000,
  },
  {
    name: "deepseek-r1",
    provider: "deepseek",
    model: "deepseek-reasoner",
    capabilities: ["chat", "code-generation", "reasoning", "planning", "tool-use", "long-context"],
    costPerM: { input: 0.55, output: 2.19 },
    tier: 5,
    contextWindow: 1_000_000,
  },
];

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export class ModelRouter {
  private endpoints: ModelEndpoint[] = [...DEEPSEEK_ENDPOINTS];
  private metrics: Map<string, { successes: number; failures: number; avgLatency: number }> = new Map();

  addEndpoint(ep: ModelEndpoint): void {
    this.endpoints.push(ep);
  }

  removeEndpoint(name: string): boolean {
    const idx = this.endpoints.findIndex((e) => e.name === name);
    if (idx >= 0) {
      this.endpoints.splice(idx, 1);
      return true;
    }
    return false;
  }

  getEndpoints(): ModelEndpoint[] {
    return [...this.endpoints];
  }

  /**
   * Route a task to the best model based on task profile.
   */
  route(task: TaskProfile): RoutingDecision {
    const candidates = this.endpoints.filter((ep) => {
      // Must support tool-use if required
      if (task.requiresTools && !ep.capabilities.includes("tool-use")) return false;
      // Must have enough context
      if (ep.contextWindow < task.estimatedInputTokens * 1.5) return false;
      return true;
    });

    if (candidates.length === 0) {
      // Fall back to any endpoint with the largest context
      const fallback = [...this.endpoints].sort(
        (a, b) => b.contextWindow - a.contextWindow,
      )[0]!;
      return {
        endpoint: fallback,
        reason: `No model meets all requirements; falling back to ${fallback.name} (largest context)`,
        alternatives: [],
      };
    }

    // Sort by fitness for the task
    const scored = candidates.map((ep) => ({
      endpoint: ep,
      score: this.scoreEndpoint(ep, task),
    }));
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0]!;
    const alternatives = scored.slice(1, 3).map((s) => s.endpoint);

    return {
      endpoint: best.endpoint,
      reason: `Best fit: ${best.endpoint.name} (score: ${best.score})`,
      alternatives,
    };
  }

  /**
   * Route with a specific capability requirement.
   */
  routeByCapability(capability: ModelCapability): RoutingDecision {
    return this.route({
      type: "chat",
      estimatedComplexity: 3,
      requiresTools: capability === "tool-use",
      requiresReasoning: capability === "reasoning",
      maxTokens: 4096,
      estimatedInputTokens: 5000,
    });
  }

  /**
   * Get the default model for general use.
   */
  getDefault(): ModelEndpoint {
    // Prefer a fast, cheap, capable model
    const preferred = this.endpoints.find((e) => e.name === "deepseek-v3");
    return preferred || this.endpoints[0]!;
  }

  /**
   * Get the best model for reasoning-heavy tasks.
   */
  getReasoningModel(): ModelEndpoint {
    const r1 = this.endpoints.find((e) => e.name === "deepseek-r1");
    return r1 || this.getDefault();
  }

  private scoreEndpoint(ep: ModelEndpoint, task: TaskProfile): number {
    let score = 0;

    // Capability fit
    if (task.requiresReasoning && ep.capabilities.includes("reasoning")) score += 30;
    if (task.requiresTools && ep.capabilities.includes("tool-use")) score += 20;
    if (task.type === "code-gen" && ep.capabilities.includes("code-generation")) score += 15;
    if (task.type === "code-review" && ep.capabilities.includes("code-review")) score += 10;
    if (task.type === "plan" && ep.capabilities.includes("planning")) score += 10;

    // Context fit: prefer models that can comfortably hold the input
    const contextRatio = ep.contextWindow / (task.estimatedInputTokens || 1);
    if (contextRatio > 10) score += 10;
    else if (contextRatio > 5) score += 5;

    // Cost efficiency for simple tasks
    if (task.estimatedComplexity <= 2) {
      const costPerCall = ep.costPerM.input * (task.estimatedInputTokens / 1_000_000);
      if (costPerCall < 0.001) score += 15;
      else if (costPerCall < 0.01) score += 8;
    }

    // Reliability bonus
    const stats = this.metrics.get(ep.name);
    if (stats && stats.successes > 10) {
      const successRate = stats.successes / (stats.successes + stats.failures);
      score += Math.round(successRate * 10);
    }

    // Performance tier match: prefer smarter models for complex tasks
    const tierMatch = 10 - Math.abs(ep.tier - task.estimatedComplexity);
    score += Math.max(0, tierMatch);

    return score;
  }

  recordSuccess(endpointName: string, latencyMs: number): void {
    const stats = this.metrics.get(endpointName) || { successes: 0, failures: 0, avgLatency: 0 };
    stats.successes++;
    stats.avgLatency =
      (stats.avgLatency * (stats.successes - 1) + latencyMs) / stats.successes;
    this.metrics.set(endpointName, stats);
  }

  recordFailure(endpointName: string): void {
    const stats = this.metrics.get(endpointName) || { successes: 0, failures: 0, avgLatency: 0 };
    stats.failures++;
    this.metrics.set(endpointName, stats);
  }

  getMetrics(): Map<string, { successes: number; failures: number; avgLatency: number }> {
    return new Map(this.metrics);
  }
}

export const modelRouter = new ModelRouter();
