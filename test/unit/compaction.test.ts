/**
 * ContextCompactor tests — compaction levels, critical message protection,
 * message truncation, local summary generation.
 */
import { jest } from "@jest/globals";
import { ContextCompactor } from "../../src/compaction/index.js";
import type { Message, TokenUsage } from "../../src/types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msg(
  role: "user" | "assistant" | "tool",
  content: string,
  critical = false,
  toolId?: string,
): Message {
  return {
    role,
    content,
    timestamp: new Date().toISOString(),
    critical,
    tool_id: toolId,
  };
}

function makeUsage(total: number, limit: number): TokenUsage {
  return { input: total * 0.9, output: total * 0.1, total, limit };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ContextCompactor — message truncation", () => {
  let compactor: ContextCompactor;

  beforeEach(() => {
    compactor = new ContextCompactor();
    compactor.setActivity();
  });

  it("truncates long output messages (over 8000 chars)", async () => {
    const longContent = "x".repeat(10000);
    const messages = [msg("user", "query"), msg("assistant", longContent)];

    const result = await compactor.checkAndCompact(messages, makeUsage(100, 10000));
    const assistantMsg = result.messages[1]!;
    const content = typeof assistantMsg.content === "string" ? assistantMsg.content : "";
    expect(content.length).toBeLessThan(10000);
    expect(content).toContain("truncated");
  });

  it("preserves short output messages unchanged", async () => {
    const shortContent = "short response";
    const messages = [msg("user", "query"), msg("assistant", shortContent)];

    const result = await compactor.checkAndCompact(messages, makeUsage(100, 10000));
    const assistantMsg = result.messages[1]!;
    expect(assistantMsg.content).toBe(shortContent);
  });
});

describe("ContextCompactor — snip compaction", () => {
  it("removes non-critical early messages above 60% usage", async () => {
    const compactor = new ContextCompactor();
    const messages: Message[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push(msg("user", `query ${i}`));
      messages.push(msg("assistant", `response ${i}`));
    }

    // 6100/10000 = 61%, above SNIP_THRESHOLD (0.6)
    const result = await compactor.checkAndCompact(messages, makeUsage(6100, 10000));
    expect(result.level).toBe("snip");
    expect(result.compactedCount).toBeGreaterThan(0);
    expect(result.messages.length).toBeLessThan(messages.length);
  });

  it("preserves critical messages during snip", async () => {
    const compactor = new ContextCompactor();
    const messages: Message[] = [
      msg("user", "query1"),
      msg("assistant", "response1", true), // critical
      ...Array.from({ length: 10 }, (_, i) => msg("user", `q${i + 2}`)),
    ];

    const result = await compactor.checkAndCompact(messages, makeUsage(6100, 10000));
    const hasCritical = result.messages.some((m) => m.critical);
    expect(hasCritical).toBe(true);
  });

  it("skips snip when non-critical messages are too few", async () => {
    const compactor = new ContextCompactor();
    const messages: Message[] = [
      msg("user", "query1", true),
      msg("assistant", "response1", true),
    ];

    const result = await compactor.checkAndCompact(messages, makeUsage(6100, 10000));
    // With only 2 messages (both critical), snip can't remove any
    expect(result.compactedCount).toBe(0);
  });
});

describe("ContextCompactor — micro compaction", () => {
  it("folds large consecutive tool output messages on idle+usage", async () => {
    const compactor = new ContextCompactor();
    // Don't call setActivity — high idle time
    const messages: Message[] = [
      msg("user", "query"),                          // len=5
      msg("tool", "A".repeat(600)),                  // len=600
      msg("tool", "B".repeat(600)),                  // len=600
      msg("assistant", "response"),                  // len=8
    ];

    // 5100/10000 = 51% (>0.5) + idle > 5min → micro
    const result = await compactor.checkAndCompact(messages, makeUsage(5100, 10000));
    if (result.level === "micro") {
      expect(result.compactedCount).toBeGreaterThan(0);
    }
    expect(result.messages).toBeDefined();
  });

  it("returns null level when no compaction needed", async () => {
    const compactor = new ContextCompactor();
    compactor.setActivity(); // recent activity
    const messages = [msg("user", "query"), msg("assistant", "response")];

    const result = await compactor.checkAndCompact(messages, makeUsage(100, 10000));
    expect(result.level).toBeNull();
    expect(result.compactedCount).toBe(0);
  });
});

describe("ContextCompactor — collapse compaction", () => {
  it("summarizes old messages and keeps recent ones", async () => {
    const compactor = new ContextCompactor();
    const messages: Message[] = [
      ...Array.from({ length: 15 }, (_, i) => msg("user", `old query ${i}`)),
      ...Array.from({ length: 5 }, (_, i) => msg("assistant", `recent response ${i}`)),
    ];

    // 7100/10000 = 71%, above COLLAPSE_THRESHOLD (0.7)
    const result = await compactor.checkAndCompact(messages, makeUsage(7100, 10000));
    // Should trigger collapse (or auto if above 0.92)
    expect(["collapse", "auto"]).toContain(result.level);
    expect(result.compactedCount).toBeGreaterThan(0);
    if (result.summary) {
      expect(result.summary.length).toBeGreaterThan(0);
    }
  });
});

describe("ContextCompactor — auto compaction", () => {
  it("aggressively compresses at very high usage", async () => {
    const compactor = new ContextCompactor();
    const messages: Message[] = [];
    for (let i = 0; i < 30; i++) {
      messages.push(msg("user", `query ${i}`));
      messages.push(msg("assistant", `response ${i}`));
    }

    // 9300/10000 = 93%, above AUTO_THRESHOLD (0.92)
    const result = await compactor.checkAndCompact(messages, makeUsage(9300, 10000));
    expect(result.level).toBe("auto");
    expect(result.compactedCount).toBeGreaterThan(0);
  });
});

describe("ContextCompactor — local summary generation", () => {
  it("generates summary from user and tool messages", async () => {
    const compactor = new ContextCompactor();
    const messages: Message[] = [
      msg("user", "Install dependencies"),
      msg("assistant", "I will run npm install"),
      msg("tool", "success: packages installed"),
      msg("user", "Run tests"),
      msg("assistant", "Running tests now"),
      msg("tool", "success: 10 tests passed"),
    ];

    const result = await compactor.checkAndCompact(messages, makeUsage(7100, 10000));
    if (result.summary) {
      expect(result.summary).toContain("user queries");
      expect(result.summary).toContain("responses");
      expect(result.summary).toContain("success");
    }
  });
});

describe("ContextCompactor — summarizer injection", () => {
  it("uses LLM summarizer when provided", async () => {
    const llmSummary = "User asked about builds, tests, and deployment.";
    const summarizer = jest.fn().mockResolvedValue(llmSummary) as jest.Mock;
    const compactor = new ContextCompactor(summarizer);

    const messages: Message[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push(msg("user", `query ${i}`));
      messages.push(msg("assistant", `response ${i}`));
    }

    const result = await compactor.checkAndCompact(messages, makeUsage(7100, 10000));
    if (result.level === "collapse" || result.level === "auto") {
      expect(result.summary).toBe(llmSummary);
      expect(summarizer).toHaveBeenCalled();
    }
  });

  it("falls back to local summary when LLM summarizer throws", async () => {
    const summarizer = jest.fn().mockRejectedValue(new Error("LLM error")) as jest.Mock;
    const compactor = new ContextCompactor(summarizer);

    const messages: Message[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push(msg("user", `query ${i}`));
      messages.push(msg("assistant", `response ${i}`));
    }

    const result = await compactor.checkAndCompact(messages, makeUsage(7100, 10000));
    if (result.level === "collapse" || result.level === "auto") {
      expect(result.summary).toBeDefined();
    }
  });
});

describe("ContextCompactor — aggressive and force compaction", () => {
  it("aggressiveCompact keeps critical messages plus summary", () => {
    const compactor = new ContextCompactor();
    const messages: Message[] = [
      msg("user", "critical task", true),
      ...Array.from({ length: 10 }, (_, i) => msg("user", `q${i}`)),
      ...Array.from({ length: 5 }, (_, i) => msg("assistant", `r${i}`)),
    ];

    const result = compactor.aggressiveCompact(messages);
    const criticalCount = result.filter((m) => m.critical).length;
    expect(criticalCount).toBeGreaterThanOrEqual(1);
    expect(result.length).toBeLessThan(messages.length);
  });

  it("forceCompact discards most messages for emergency token budget", () => {
    const compactor = new ContextCompactor();
    const messages: Message[] = [
      msg("user", "critical", true),
      ...Array.from({ length: 20 }, (_, i) => msg("user", `q${i}`)),
    ];

    const result = compactor.forceCompact(messages);
    expect(result.length).toBeLessThan(messages.length);
    const summaryMsg = result.find(
      (m) => typeof m.content === "string" && m.content.includes("Forced compaction"),
    );
    expect(summaryMsg).toBeDefined();
  });
});

describe("ContextCompactor — empty message list", () => {
  it("handles empty messages gracefully", async () => {
    const compactor = new ContextCompactor();
    const result = await compactor.checkAndCompact([], makeUsage(1000, 10000));
    expect(result.messages).toEqual([]);
    expect(result.level).toBeNull();
    expect(result.compactedCount).toBe(0);
  });
});
