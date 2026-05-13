import { createQueryEngine } from "../src/core/query-engine.js";
import { detectPlatform } from "../src/pal/index.js";
import { SessionStore } from "../src/storage/index.js";
import { createProvider, createSystemPrompt } from "../src/api/provider.js";

describe("QueryEngine creation", () => {
  test("creates engine without error", () => {
    const engine = createQueryEngine("anthropic");
    expect(engine).toBeDefined();
    expect(typeof engine.query).toBe("function");
  });

  test("can set and get session", () => {
    const engine = createQueryEngine("anthropic");
    const store = new SessionStore();
    const p = detectPlatform();
    const session = store.create(
      process.cwd(),
      p.os,
      p.terminal,
      "anthropic",
      "claude-sonnet-4-20250514"
    );
    engine.setSession(session);

    expect(session.session_id).toBeDefined();
    expect(session.client_type).toBe("cli");
    expect(session.meta.project_path).toBe(process.cwd());
  });

  test("emits events correctly", () => {
    const engine = createQueryEngine("anthropic");
    const events: string[] = [];
    engine.on("thinking", () => events.push("thinking"));
    engine.on("error", () => events.push("error"));
    engine.on("progress", () => events.push("progress"));
    expect(events.length).toBe(0);
  });
});

describe("API provider structure", () => {
  test("provider factory exists", () => {
    expect(createProvider).toBeDefined();
    expect(createSystemPrompt).toBeDefined();
  });

  test("system prompt includes required sections", () => {
    const prompt = createSystemPrompt();
    expect(prompt).toContain("agent_1");
    expect(prompt.length).toBeGreaterThan(100);
  });

  test("provider can be instantiated", () => {
    const provider = createProvider("anthropic");
    expect(provider).toBeDefined();
    expect(provider.name).toBeDefined();
    expect(typeof provider.chatCompletion).toBe("function");
  });
});