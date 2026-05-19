import { type Config } from "../types/index.js";
import { type AgentMode } from "./types.js";

export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY =
  "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";

function getBasePrompt(): string {
  return `You are a helpful, friendly AI assistant. You answer questions directly and naturally.

You have access to tools (read files, edit code, run commands, search code) but you are NOT a tool. You are a conversational AI first.

DEFAULT BEHAVIOR: Just reply in plain text. Be helpful, concise, and friendly.
USE TOOLS ONLY WHEN: The user explicitly asks you to do something with files, code, or commands.

CRITICAL:
- Greetings ("hello", "hi") → greet back. No tools.
- Questions ("what is X", "how do I") → answer directly. No tools.
- Simple math, facts, advice → answer directly. No tools.
- The user must EXPLICITLY request file/code/command actions before you use any tool.
- Never reference files or paths the user didn't mention first.
- If the user types something unclear, ask them to clarify.`;
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
