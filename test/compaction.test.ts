import { ContextCompactor } from "../src/compaction/index.js";
import { Message, TokenUsage } from "../src/types/index.js";

describe("Context Compactor", () => {
  const compactor = new ContextCompactor();

  const createMessages = (count: number): Message[] => {
    const msgs: Message[] = [];
    for (let i = 0; i < count; i++) {
      msgs.push(
        {
          role: "user",
          content: `Question ${i}`,
          timestamp: new Date().toISOString(),
          critical: false,
        },
        {
          role: "assistant",
          content: `Answer ${i}: This is a very long response with lots of details.`.repeat(5),
          timestamp: new Date().toISOString(),
          critical: false,
        }
      );
    }
    return msgs;
  };

  test("should not compact when usage is low", () => {
    const messages = createMessages(5);
    const usage: TokenUsage = { input: 100, output: 50, total: 150, limit: 10000 };

    const result = compactor.checkAndCompact(messages, usage);
    expect(result.level).toBeNull();
    expect(result.compactedCount).toBe(0);
  });

  test("should snip compact when usage > 60%", () => {
    const messages = createMessages(10);
    const usage: TokenUsage = { input: 600, output: 100, total: 700, limit: 1000 };

    const result = compactor.checkAndCompact(messages, usage);
    expect(["snip", "micro"]).toContain(result.level);
  });

  test("should collapse when usage > 70%", () => {
    const messages = createMessages(15);
    const usage: TokenUsage = { input: 750, output: 100, total: 850, limit: 1000 };

    const result = compactor.checkAndCompact(messages, usage);
    expect(result.level).toBeDefined();
    expect(result.messages.length).toBeLessThan(messages.length);
  });

  test("should auto compact when usage > 92%", () => {
    const messages = createMessages(20);
    const usage: TokenUsage = { input: 930, output: 50, total: 980, limit: 1000 };

    const result = compactor.checkAndCompact(messages, usage);
    expect(result.level).toBe("auto");
    expect(result.messages.length).toBeLessThan(messages.length);
  });

  test("should never drop critical messages", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "Normal question",
        timestamp: new Date().toISOString(),
        critical: false,
      },
      {
        role: "assistant",
        content: "Critical error info",
        timestamp: new Date().toISOString(),
        critical: true,
      },
      {
        role: "user",
        content: "Normal question 2",
        timestamp: new Date().toISOString(),
        critical: false,
      },
    ];

    const usage: TokenUsage = { input: 930, output: 50, total: 980, limit: 1000 };
    const result = compactor.checkAndCompact(messages, usage);

    const hasCritical = result.messages.some((m) => m.critical);
    expect(hasCritical).toBe(true);
  });

  test("should truncate long outputs", () => {
    const messages: Message[] = [
      {
        role: "tool",
        content: "x".repeat(10000),
        timestamp: new Date().toISOString(),
        critical: false,
      },
    ];

    const usage: TokenUsage = { input: 10, output: 10, total: 20, limit: 10000 };
    const result = compactor.checkAndCompact(messages, usage);

    const content = result.messages[0].content as string;
    expect(content.length).toBeLessThan(10000);
    expect(content).toContain("truncated");
  });
});