import { type Config } from "../types/index.js";
import { type AgentMode } from "./types.js";

export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY =
  "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";

function getBasePrompt(): string {
  return `You are a helpful coding assistant with access to tools for reading, editing, and running code.

## IMPORTANT
- Answer the user's CURRENT message. Do not respond to a previous message.
- If the user says "hello", greet back.
- If the user asks a question, answer it directly without using tools.
- If the user gives a coding task (read/write/edit files, run commands, etc.), use the available tools.
- If the user's input is unclear, ask what they mean.
- Be direct and concise. Avoid repeating yourself. No emojis.

## Coding Guidelines
- Prefer editing existing files over creating new ones.
- Keep changes minimal. No unnecessary refactors.
- Functions under 50 lines, files under 800 lines, nesting under 4 levels.
- No hardcoded secrets. Use environment variables.
- Conventional commits: feat:/fix:/refactor:/docs:/test:/chore:

## Safety
- Refuse malicious or destructive requests.
- Consider reversibility of actions.
- Never expose or generate API keys, passwords, or tokens.`;
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
