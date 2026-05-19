/**
 * Simple chat CLI — raw stdin, works on all platforms including Windows.
 */
import { createQueryEngine } from "../engine/index.js";
import { ConfigStore, SessionStore } from "../storage/index.js";
import { detectPlatform } from "../pal/index.js";
import type { Config, PlatformInfo, Message } from "../types/index.js";

export interface StartCLIOptions { projectPath: string; headless: boolean; prompt?: string; }

export async function startCLI(opts: StartCLIOptions): Promise<void> {
  const configStore = new ConfigStore();
  const config = configStore.load();
  const platform = detectPlatform();

  if (!config.chosen_provider) { console.log("No provider configured."); process.exit(1); }

  const engine = createQueryEngine(config);
  const sessionStore = new SessionStore();
  engine.setSession(sessionStore.create(opts.projectPath, platform.os, platform.terminal, config.chosen_provider, config.model));

  const messages: Message[] = [];

  if (opts.headless && opts.prompt) {
    messages.push({ role: "user", content: opts.prompt, timestamp: new Date().toISOString(), critical: false });
    const r = await engine.query({ text: opts.prompt, timestamp: new Date().toISOString() }, { messages, config, platform, projectMemory: "" });
    console.log(r?.response?.content || "");
    return;
  }

  process.stdout.write("agent_1  " + (config.model || "?") + "  /help  /exit\n\n> ");

  let buf = "";
  process.stdin.setEncoding("utf-8");

  process.stdin.on("data", (chunk: string) => {
    for (const ch of chunk) {
      const c = ch.charCodeAt(0);
      if (c === 3) { process.stdout.write("\nbye\n"); process.exit(0); }
      if (c === 13 || c === 10) {
        const text = buf.trim();
        buf = "";
        if (text) { process.stdout.write("\n"); doSubmit(text); }
        else { process.stdout.write("\n> "); }
        return;
      }
      if (c === 8 || c === 127) { if (buf.length > 0) buf = buf.slice(0, -1); continue; }
      if (c >= 32) { buf += ch; process.stdout.write(ch); }
    }
  });

  process.stdin.on("end", () => process.exit(0));

  async function doSubmit(text: string) {
    if (text === "/exit" || text === "/q") { console.log("bye"); process.exit(0); }
    if (text === "/help") { process.stdout.write("/exit /help /clear\n\n> "); return; }
    if (text === "/clear") { messages.length = 0; process.stdout.write("Cleared.\n\n> "); return; }

    messages.push({ role: "user", content: text, timestamp: new Date().toISOString(), critical: false });
    try {
      const r = await engine.query({ text, timestamp: new Date().toISOString() }, { messages, config, platform, projectMemory: "" });
      if (r?.response?.content) {
        process.stdout.write("\n" + r.response.content + "\n\n");
        messages.push({ role: "assistant", content: r.response.content, timestamp: new Date().toISOString(), critical: false });
      }
    } catch (err: unknown) { process.stdout.write("\nError: " + String(err) + "\n\n"); }
    process.stdout.write("> ");
  }
}
