/**
 * Simple chat CLI — no Ink/React, just readline + async loop.
 * Reliable on all platforms including Windows PowerShell.
 */
import { createInterface } from "readline";
import { createQueryEngine } from "../engine/index.js";
import { ConfigStore, SessionStore } from "../storage/index.js";
import { detectPlatform } from "../pal/index.js";
import type { Config, PlatformInfo, Message } from "../types/index.js";

export interface StartCLIOptions {
  projectPath: string;
  headless: boolean;
  prompt?: string;
}

function printBanner(config: Config) {
  console.log("agent_1  " + (config.model || "?") + "  /help  /exit\n");
}

export async function startCLI(opts: StartCLIOptions): Promise<void> {
  const configStore = new ConfigStore();
  const config = configStore.load();
  const platform = detectPlatform();

  if (!config.chosen_provider) {
    console.log("No provider configured. Run: xsgbbx config set chosen_provider deepseek");
    process.exit(1);
  }

  const engine = createQueryEngine(config);
  const sessionStore = new SessionStore();
  const session = sessionStore.create(
    opts.projectPath, platform.os, platform.terminal,
    config.chosen_provider, config.model
  );
  engine.setSession(session);

  const messages: Message[] = [];

  // Headless mode: single prompt
  if (opts.headless && opts.prompt) {
    messages.push({ role: "user", content: opts.prompt, timestamp: new Date().toISOString(), critical: false });
    try {
      const result = await engine.query(
        { text: opts.prompt, timestamp: new Date().toISOString() },
        { messages, config, platform, projectMemory: "" }
      );
      console.log(result?.response?.content || "");
    } catch (err: unknown) {
      console.error(String(err));
    }
    return;
  }

  // Interactive mode
  printBanner(config);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question("> ", async (line) => {
      const text = line.trim();
      if (!text) { ask(); return; }

      if (text === "/exit" || text === "/q") { console.log("bye"); rl.close(); process.exit(0); }
      if (text === "/help") {
        console.log("/exit /help /clear\n");
        ask(); return;
      }
      if (text === "/clear") { messages.length = 0; console.log("Cleared.\n"); ask(); return; }

      messages.push({ role: "user", content: text, timestamp: new Date().toISOString(), critical: false });

      try {
        const result = await engine.query(
          { text, timestamp: new Date().toISOString() },
          { messages, config, platform, projectMemory: "" }
        );

        if (result?.response?.content) {
          console.log("\n" + result.response.content + "\n");
          messages.push({ role: "assistant", content: result.response.content, timestamp: new Date().toISOString(), critical: false });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log("\nError: " + msg + "\n");
      }

      ask();
    });
  };

  ask();
}
