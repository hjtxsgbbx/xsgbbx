import { type Config } from "../types/index.js";
import { type AgentMode } from "./types.js";

export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY =
  "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";

function getBasePrompt(): string {
  return `You are a helpful coding assistant. You can read, edit, and run code on the user's machine.

Talk naturally. Do what the user asks. If something is unclear, just ask.

## When to use tools
Only use tools when the user gives you a specific coding task (read a file, edit code, run a command, search the codebase).
For greetings ("hello"), simple questions ("what is 1+1"), or general chat — just reply with text. Do NOT use any tools.

## Rules
- Never invent file paths, projects, or conversation history the user never mentioned.
- If the user's input looks like an accidental keystroke, ask what they meant.
- No emojis unless asked.`;
}

function getPlatformSection(platform: string): string {
  return `\nPlatform: ${platform}`;
}

function getPlanModeOverlay(): string {
  return `\n## PLAN MODE — analyze and design only. Do not modify files or run commands.`;
}

function getActModeOverlay(): string {
  return `\n## ACT MODE — execute the plan step by step.`;
}

export function createSystemPrompt(
  platform: string,
  permissionMode: string,
  _projectSummary: string,
  mode: AgentMode = "default",
  _repoMapText?: string,
  _projectMemory?: string,
  _envSnapshot?: string,
): string {
  const parts = [getBasePrompt()];

  if (mode === "plan") parts.push(getPlanModeOverlay());
  if (mode === "act") parts.push(getActModeOverlay());

  parts.push(getPlatformSection(platform));

  return parts.join("\n");
}

export function buildThinkingConfig(
  _config: Config,
  _isModernModel: boolean,
): Record<string, unknown> | undefined {
  return undefined;
}
