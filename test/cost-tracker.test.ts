import { CostTracker } from "../src/core/cost-tracker.js";

describe("CostTracker", () => {
  const sessionId = "test-session-001";

  describe("basic tracking", () => {
    it("should start with zero cost", () => {
      const tracker = new CostTracker(sessionId);
      const metrics = tracker.getMetrics();
      expect(metrics.estimatedCostUSD).toBe(0);
      expect(metrics.totalInputTokens).toBe(0);
      expect(metrics.totalTurns).toBe(0);
    });

    it("should track a turn", () => {
      const tracker = new CostTracker(sessionId);
      tracker.trackTurn();
      const metrics = tracker.getMetrics();
      expect(metrics.totalTurns).toBe(1);
    });

    it("should accumulate across multiple turns", () => {
      const tracker = new CostTracker(sessionId);
      tracker.trackTurn();
      tracker.trackTurn();
      const metrics = tracker.getMetrics();
      expect(metrics.totalTurns).toBe(2);
    });
  });

  describe("token tracking", () => {
    it("should track tokens for Claude model", () => {
      const tracker = new CostTracker(sessionId);
      tracker.trackTokens(1000, 500, "claude-sonnet-4-20250514");
      const metrics = tracker.getMetrics();
      expect(metrics.totalInputTokens).toBe(1000);
      expect(metrics.totalOutputTokens).toBe(500);
      expect(metrics.estimatedCostUSD).toBeGreaterThan(0);
    });

    it("should track tokens for OpenAI model", () => {
      const tracker = new CostTracker(sessionId);
      tracker.trackTokens(1000, 500, "gpt-4o");
      const metrics = tracker.getMetrics();
      expect(metrics.estimatedCostUSD).toBeGreaterThan(0);
    });

    it("should use different rates for different models", () => {
      const tracker1 = new CostTracker("s1");
      tracker1.trackTokens(1000000, 1000000, "claude-sonnet-4-20250514");
      const cost1 = tracker1.getMetrics().estimatedCostUSD;

      const tracker2 = new CostTracker("s2");
      tracker2.trackTokens(1000000, 1000000, "gpt-4o");
      const cost2 = tracker2.getMetrics().estimatedCostUSD;

      expect(cost1).not.toBe(cost2);
    });
  });

  describe("tool tracking", () => {
    it("should track successful tool calls", () => {
      const tracker = new CostTracker(sessionId);
      tracker.trackToolCall(true);
      const metrics = tracker.getMetrics();
      expect(metrics.totalToolCalls).toBe(1);
      expect(metrics.successfulToolCalls).toBe(1);
      expect(metrics.failedToolCalls).toBe(0);
    });

    it("should track failed tool calls", () => {
      const tracker = new CostTracker(sessionId);
      tracker.trackToolCall(false);
      const metrics = tracker.getMetrics();
      expect(metrics.failedToolCalls).toBe(1);
      expect(metrics.successfulToolCalls).toBe(0);
    });
  });

  describe("error and heal tracking", () => {
    it("should track errors", () => {
      const tracker = new CostTracker(sessionId);
      tracker.trackError();
      expect(tracker.getMetrics().errorsEncountered).toBe(1);
    });

    it("should track heal attempts", () => {
      const tracker = new CostTracker(sessionId);
      tracker.trackHeal(true);
      expect(tracker.getMetrics().autoHealsAttempted).toBe(1);
      expect(tracker.getMetrics().autoHealsSucceeded).toBe(1);
    });
  });

  describe("reset", () => {
    it("should reset all metrics", () => {
      const tracker = new CostTracker(sessionId);
      tracker.trackTurn();
      tracker.trackTokens(1000, 500, "gpt-4o");
      tracker.reset();

      const metrics = tracker.getMetrics();
      expect(metrics.totalTurns).toBe(0);
      expect(metrics.totalInputTokens).toBe(0);
      expect(metrics.estimatedCostUSD).toBe(0);
    });
  });

  describe("progress and summary", () => {
    it("should report progress", () => {
      const tracker = new CostTracker(sessionId, 10);
      tracker.trackTurn();
      const progress = tracker.getProgress();
      expect(progress).toBeGreaterThan(0);
    });

    it("should generate cost summary", () => {
      const tracker = new CostTracker(sessionId);
      const summary = tracker.getCostSummary();
      expect(summary).toContain("Turns:");
      expect(summary).toContain("Cost:");
    });
  });
});