/**
 * First-run onboarding wizard for xsgbbx.
 * Guides the user to set up their DeepSeek API key on first launch.
 */

import { createInterface } from "readline";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_PATH = join(homedir(), ".agent_1", "config.json");

async function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      resolve(answer.trim());
    });
  });
}

async function ensureConfigDirExists(): Promise<void> {
  const { mkdirSync } = await import("fs");
  const dir = join(homedir(), ".agent_1");
  mkdirSync(dir, { recursive: true });
}

export interface OnboardingResult {
  configured: boolean;
  apiKey: string;
  model: string;
}

export async function runOnboarding(): Promise<OnboardingResult> {
  // Check if already configured
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      const config = JSON.parse(raw);
      const pc = config.provider_configs?.deepseek;
      if (pc?.api_key && config.accept_terms) {
        return { configured: true, apiKey: pc.api_key, model: config.model || "deepseek-v4-pro" };
      }
    } catch {
      // Corrupted config — re-onboard
    }
  }

  console.log("");
  console.log("  ╔══════════════════════════════════════════╗");
  console.log("  ║       Welcome to xsgbbx — AI Coding Agent  ║");
  console.log("  ║         Powered by DeepSeek               ║");
  console.log("  ╚══════════════════════════════════════════╝");
  console.log("");
  console.log("  This assistant helps you write, review, and manage code.");
  console.log("  It uses DeepSeek's API — you'll need an API key.");
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // Step 1: Get API key
  let apiKey = "";
  const envKey = process.env.DEEPSEEK_API_KEY || "";
  if (envKey) {
    console.log(`  DeepSeek API key found in environment (DEEPSEEK_API_KEY)`);
    apiKey = envKey;
  } else {
    console.log("  To get your API key:");
    console.log("    1. Go to https://platform.deepseek.com");
    console.log("    2. Sign up or log in");
    console.log("    3. Navigate to API Keys and create one");
    console.log("");
    apiKey = await ask(rl, "  Paste your DeepSeek API key: ");
    if (!apiKey || apiKey.length < 10) {
      console.log("");
      console.log("  No valid API key provided. You can set it later:");
      console.log("    export DEEPSEEK_API_KEY=sk-your-key");
      console.log("    xsgbbx config set api_key sk-your-key");
      console.log("");
      rl.close();
      return { configured: false, apiKey: "", model: "" };
    }
  }

  // Step 2: Choose model
  console.log("");
  console.log("  Choose your model:");
  console.log("    [1] deepseek-v4-pro  — flagship, best for complex tasks (recommended)");
  console.log("    [2] deepseek-v4-flash — faster, cheaper, good for daily use");
  console.log("");
  const choice = await ask(rl, "  Enter 1 or 2 [default: 1]: ");
  const model = choice === "2" ? "deepseek-v4-flash" : "deepseek-v4-pro";

  // Step 3: Terms
  console.log("");
  console.log("  ⚠ Data Notice:");
  console.log("    Your code and prompts will be sent to DeepSeek's API servers.");
  console.log("    All other data stays on your machine.");
  console.log("");
  const agree = await ask(rl, "  Accept and continue? [Y/n]: ");
  const accepted = !agree.toLowerCase().startsWith("n");

  rl.close();

  // Save config
  await ensureConfigDirExists();

  const config = {
    version: 3,
    chosen_provider: "deepseek",
    model,
    permission_mode: "default",
    accept_terms: accepted,
    thinking_effort: "high",
    max_turns: 200,
    auto_commit: false,
    auto_create_pr: false,
    session_retention_days: 30,
    telemetry_enabled: false,
    provider_configs: {
      deepseek: {
        provider: "deepseek",
        base_url: "https://api.deepseek.com",
        api_key: apiKey,
        models: ["deepseek-v4-pro", "deepseek-v4-flash"],
      },
    },
  };

  const { writeFileSync } = await import("fs");
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");

  console.log("");
  if (model === "deepseek-v4-pro") {
    console.log(`  ✓ Configured: DeepSeek V4 Pro — 1M context, best reasoning`);
  } else {
    console.log(`  ✓ Configured: DeepSeek V4 Flash — 1M context, fast & cheap`);
  }
  console.log(`  ✓ API key saved to ~/.agent_1/config.json`);
  console.log("");
  console.log("  Start coding! Type /help for commands.");
  console.log("");

  return { configured: true, apiKey, model };
}
