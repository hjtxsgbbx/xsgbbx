/**
 * Bundled skill registration — adapted from Claude Code's skills/bundledSkills.ts.
 *
 * Skills are prompt-templates that ship with the CLI. They extend agent_1's
 * capabilities without plugins. The model sees them as slash-commands that
 * expand into detailed instructions.
 *
 * DeepSeek adaptation: prompts are written for OpenAI-compatible function
 * calling, not Anthropic tool_use. No beta headers or prompt-cache markers.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContentBlock = { type: "text"; text: string };

export interface BundledSkillDefinition {
  name: string;
  description: string;
  aliases?: string[];
  argumentHint?: string;
  whenToUse?: string;
  allowedTools?: string[];
  userInvocable?: boolean;
  context?: "inline" | "fork";
  files?: Record<string, string>;
  getPromptForCommand: (args: string) => Promise<ContentBlock[]>;
}

export interface SkillCommand {
  type: "prompt";
  name: string;
  description: string;
  aliases?: string[];
  argumentHint?: string;
  whenToUse?: string;
  allowedTools: string[];
  userInvocable: boolean;
  source: "bundled" | "disk";
  loadedFrom: string;
  isHidden: boolean;
  context?: "inline" | "fork";
  getPromptForCommand: (args: string) => Promise<ContentBlock[]>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry: SkillCommand[] = [];

export function registerBundledSkill(def: BundledSkillDefinition): void {
  registry.push({
    type: "prompt",
    name: def.name,
    description: def.description,
    aliases: def.aliases,
    argumentHint: def.argumentHint,
    whenToUse: def.whenToUse,
    allowedTools: def.allowedTools ?? [],
    userInvocable: def.userInvocable ?? true,
    source: "bundled",
    loadedFrom: "bundled",
    isHidden: !(def.userInvocable ?? true),
    context: def.context,
    getPromptForCommand: def.getPromptForCommand,
  });
}

export function getBundledSkills(): SkillCommand[] {
  return [...registry];
}

export function clearBundledSkills(): void {
  registry.length = 0;
}
