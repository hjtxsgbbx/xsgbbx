import {
  estimateTokens,
  calculateBudget,
  shouldCompact,
  getModelLimit,
  BudgetExceededError,
} from "../src/core/token-counter.js";

describe("TokenCounter", () => {
  describe("estimateTokens", () => {
    it("should estimate tokens for English text", () => {
      const text = "Hello world this is a test sentence";
      const tokens = estimateTokens(text, "claude-sonnet-4-20250514");
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThanOrEqual(text.length);
    });

    it("should estimate tokens for Chinese text", () => {
      const text = "这是一段中文测试文本用于验证token计数";
      const tokens = estimateTokens(text, "gpt-4o");
      expect(tokens).toBeGreaterThan(0);
    });

    it("should estimate tokens for code", () => {
      const text = "function hello() {\n  return 'world';\n}";
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
    });

    it("should handle empty string", () => {
      const tokens = estimateTokens("");
      expect(tokens).toBe(0);
    });

    it("should add bonuses for code blocks", () => {
      const codeText = "```\nfunction test() { return 1; }\n```";
      const plainText = "function test() { return 1; }";
      const codeTokens = estimateTokens(codeText);
      const plainTokens = estimateTokens(plainText);
      expect(codeTokens).toBeGreaterThan(plainTokens);
    });
  });

  describe("calculateBudget", () => {
    it("should calculate budget for a conversation", () => {
      const messages = [
        { role: "user", content: "Help me write a function" },
        { role: "assistant", content: "Here is the function..." },
      ];
      const budget = calculateBudget(
        "You are a helpful assistant",
        messages,
        "",
        "claude-sonnet-4-20250514"
      );

      expect(budget.used).toBeGreaterThan(0);
      expect(budget.total).toBeGreaterThan(0);
      expect(budget.percentUsed).toBeGreaterThan(0);
      expect(budget.percentUsed).toBeLessThan(100);
      expect(budget.needsCompaction).toBe(false);
      expect(budget.hardLimitExceeded).toBe(false);
    });

    it("should detect when compaction is needed", () => {
      const largeMessages = Array.from({ length: 200 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant" as const,
        content: "x".repeat(400),
      }));
      const budget = calculateBudget(
        "x".repeat(5000),
        largeMessages,
        "",
        "gpt-4o"
      );
      expect(budget.percentUsed).toBeGreaterThan(0);
    });

    it("should detect hard limit exceeded with huge context", () => {
      const hugeMessages = Array.from({ length: 500 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant" as const,
        content: "x".repeat(2000),
      }));
      const budget = calculateBudget(
        "x".repeat(5000),
        hugeMessages,
        "",
        "gpt-4o"
      );
      expect(budget.hardLimitExceeded).toBe(true);
    });

    it("should include repo map in budget calculation", () => {
      const messages = [{ role: "user", content: "test" }];
      const withoutMap = calculateBudget("sys", messages, "");
      const withMap = calculateBudget("sys", messages, "Repo structure here...");
      expect(withMap.used).toBeGreaterThan(withoutMap.used);
    });
  });

  describe("shouldCompact", () => {
    it("should return true for budget needing compaction", () => {
      const budget = calculateBudget(
        "short",
        Array.from({ length: 200 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant" as const,
          content: "x".repeat(400),
        })),
        "",
        "gpt-4o"
      );
      expect(shouldCompact(budget)).toBe(budget.needsCompaction || budget.hardLimitExceeded);
    });

    it("should return false for small budgets", () => {
      const budget = calculateBudget(
        "sys",
        [{ role: "user", content: "hello" }],
        "",
        "claude-sonnet-4-20250514"
      );
      expect(shouldCompact(budget)).toBe(false);
    });
  });

  describe("getModelLimit", () => {
    it("should return correct limit for Claude", () => {
      expect(getModelLimit("claude-sonnet-4-20250514")).toBe(200000);
    });

    it("should return correct limit for GPT-4o", () => {
      expect(getModelLimit("gpt-4o")).toBe(128000);
    });

    it("should return default for unknown model", () => {
      const limit = getModelLimit("unknown-model");
      expect(limit).toBeGreaterThan(0);
    });
  });

  describe("BudgetExceededError", () => {
    it("should create error with budget info", () => {
      const budget = {
        used: 150000,
        total: 128000,
        remaining: 0,
        limit: 128000,
        percentUsed: 117,
        needsCompaction: true,
        hardLimitExceeded: true,
      };
      const error = new BudgetExceededError("Budget exceeded", budget);
      expect(error.message).toBe("Budget exceeded");
      expect(error.budget.hardLimitExceeded).toBe(true);
      expect(error.name).toBe("BudgetExceededError");
    });
  });
});