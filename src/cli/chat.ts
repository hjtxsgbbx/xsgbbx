/**
 * Simple chat CLI — raw stdin, no Ink/React/readline.
 * Works on all platforms including Windows PowerShell.
 */
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
  process.stdout.write("agent_1  " + (config.model || "?") + "  /help  /exit\n\n");
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

  // Headless mode
  if (opts.headless && opts.prompt) {
    messages.push({ role: "user", content: opts.prompt, timestamp: new Date().toISOString(), critical: false });
    try {
      const result = await engine.query(
        { text: opts.prompt, timestamp: new Date().toISOString() },
        { messages, config, platform, projectMemory: "" }
      );
      console.log(result?.response?.content || "");
    } catch (err: unknown) { console.error(String(err)); }
    return;
  }

  // Interactive mode — use raw stdin
  printBanner(config);
  process.stdout.write("> ");

  let buf = "";

  process.stdin.setEncoding("utf-8");
  if (process.stdin.isTTY) process.stdin.setRawMode?.(true);

  const onSubmit = async (text: string) => {
    if (!text) { process.stdout.write("> "); return; }

    if (text === "/exit" || text === "/q") { console.log("bye"); process.exit(0); }
    if (text === "/help") { console.log("/exit /help /clear\n"); process.stdout.write("> "); return; }
    if (text === "/clear") { messages.length = 0; console.log("Cleared.\n"); process.stdout.write("> "); return; }

    messages.push({ role: "user", content: text, timestamp: new Date().toISOString(), critical: false });

    try {
      process.stdout.write("\n");
      const result = await engine.query(
        { text, timestamp: new Date().toISOString() },
        { messages, config, platform, projectMemory: "" }
      );
      if (result?.response?.content) {
        process.stdout.write("\n" + result.response.content + "\n\n");
        messages.push({ role: "assistant", content: result.response.content, timestamp: new Date().toISOString(), critical: false });
      }
    } catch (err: unknown) {
      process.stdout.write("\nError: " + String(err) + "\n\n");
    }

    process.stdout.write("> ");
  };

  process.stdin.on("data", (chunk: string) => {
    for (const ch of chunk) {
      if (ch === "\r" || ch === "\n") {
        const text = buf.trim();
        buf = "";
        onSubmit(text);
        return;
      }
      if (ch === "\b" || ch === "\x7f") {
        if (buf.length > 0) { buf = buf.slice(0, -1); process.stdout.write("\b \b"); }
        return;
      }
      if (ch >= " ") {
        buf += ch;
        process.stdout.write(ch);
      }
    }
  });

  process.stdin.on("end", () => { process.exit(0); });
  process.stdin.resume();
}
