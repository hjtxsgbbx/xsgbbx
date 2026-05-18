/**
 * Teammate Prompt Addendum
 *
 * Builds a system prompt addendum injected into each teammate's session.
 * This gives the teammate:
 *  - Its identity (name, team, display color)
 *  - Leader contact information
 *  - Available tools and their boundaries
 *  - Permission rules and escalation path
 *  - Output format expectations
 *
 * The prompt is DeepSeek-optimized: concise, structured, with clear
 * behavioral boundaries that reduce unnecessary tool-use loops.
 */

import type { TeammateIdentity, TeammateSpawnConfig } from "./types.js";
import { getAgentColor } from "./agent-color-manager.js";

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Build the teammate system prompt addendum.
 *
 * This is appended to the base system prompt. It tells the teammate
 * who it is, what team it belongs to, what tools it has, and how to
 * request help from the leader.
 *
 * @param identity - The teammate's identity.
 * @param config   - Full spawn configuration (for permissions etc.).
 * @returns A string to append to the system prompt.
 */
export function buildTeammatePrompt(
  identity: TeammateIdentity,
  config: TeammateSpawnConfig,
): string {
  const color = identity.color ?? getAgentColor(identity.name);

  const sections: string[] = [];

  // 1. Identity block
  sections.push(buildIdentityBlock(identity, color));

  // 2. Team context
  sections.push(buildTeamContextBlock(identity, config));

  // 3. Permission boundaries
  sections.push(buildPermissionBlock(config));

  // 4. Communication rules
  sections.push(buildCommunicationBlock(identity, config));

  // 5. Output format
  sections.push(buildOutputFormatBlock());

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Section Builders
// ---------------------------------------------------------------------------

function buildIdentityBlock(
  identity: TeammateIdentity,
  color: string,
): string {
  return [
    `## Your Identity`,
    ``,
    `- **Name**: ${identity.name}`,
    `- **Team**: ${identity.teamName}`,
    `- **Role**: Teammate agent operating under the team leader's direction`,
    `- **Display Color**: ${color}`,
    ``,
    `You are a specialized sub-agent in a multi-agent team. Your job is to`,
    `complete the task assigned to you and report results to the leader.`,
    `Stay focused on your assigned scope — do not expand beyond it without`,
    `explicit permission.`,
  ].join("\n");
}

function buildTeamContextBlock(
  identity: TeammateIdentity,
  config: TeammateSpawnConfig,
): string {
  const lines = [
    `## Team Context`,
    ``,
    `- **Leader**: The agent that spawned you (parent session: ${config.parentSessionId ?? "unknown"})`,
    `- **Working Directory**: ${config.cwd}`,
  ];

  if (config.permissions?.allowedTools?.length) {
    lines.push(
      `- **Allowed Tools**: ${config.permissions.allowedTools.join(", ")}`,
    );
  }

  if (config.permissions?.deniedTools?.length) {
    lines.push(
      `- **Denied Tools**: ${config.permissions.deniedTools.join(", ")}`,
    );
  }

  if (config.permissions?.maxTurns) {
    lines.push(`- **Turn Limit**: ${config.permissions.maxTurns} turns`);
  }

  if (config.permissions?.timeoutMs) {
    const sec = (config.permissions.timeoutMs / 1000).toFixed(0);
    lines.push(`- **Timeout**: ${sec}s`);
  }

  lines.push(
    ``,
    `The leader may send you additional instructions via the team mailbox.`,
    `Check for messages if you are waiting for input.`,
  );

  return lines.join("\n");
}

function buildPermissionBlock(config: TeammateSpawnConfig): string {
  const lines = [
    `## Permissions`,
    ``,
    `Your actions are governed by the team's permission policy.`,
  ];

  if (config.permissions?.allowedTools) {
    lines.push(`- You may only use these tools: ${config.permissions.allowedTools.join(", ")}`);
  }

  if (config.permissions?.deniedTools) {
    lines.push(`- You must NOT use these tools: ${config.permissions.deniedTools.join(", ")}`);
  }

  if (config.permissions?.readPaths?.length) {
    lines.push(`- Read access is limited to: ${config.permissions.readPaths.join(", ")}`);
  }

  if (config.permissions?.writePaths?.length) {
    lines.push(`- Write access is limited to: ${config.permissions.writePaths.join(", ")}`);
  }

  if (config.allowPermissionPrompts) {
    lines.push(
      `- If you need to use a tool outside your allowed set, request`,
      `  permission from the leader via the permission system.`,
    );
  } else {
    lines.push(
      `- You cannot request additional permissions. If a tool is not`,
      `  available, find an alternative approach or report the limitation.`,
    );
  }

  return lines.join("\n");
}

function buildCommunicationBlock(
  identity: TeammateIdentity,
  config: TeammateSpawnConfig,
): string {
  return [
    `## Communication`,
    ``,
    `- Address the leader directly when reporting results or requesting help.`,
    `- Use clear, concise language. Avoid conversational filler.`,
    `- If you finish your task, report the result and transition to idle.`,
    `- If you encounter an error you cannot resolve:`,
    `  1. Describe the error clearly.`,
    `  2. List what you tried.`,
    `  3. State what you need from the leader.`,
    `- Do not make assumptions about the leader's intent. If the task is`,
    `  ambiguous, ask for clarification once rather than guessing.`,
    config.allowPermissionPrompts
      ? `- To request permission, use the permission_request message type.`
      : `- Permission requests are disabled. Work within your granted scope.`,
  ].join("\n");
}

function buildOutputFormatBlock(): string {
  return [
    `## Output Format`,
    ``,
    `When reporting results, structure your output as follows:`,
    ``,
    `\`\`\``,
    `### Summary`,
    `<1-2 sentence summary of what was accomplished>`,
    ``,
    `### Key Findings`,
    `- <finding 1>`,
    `- <finding 2>`,
    ``,
    `### Files Modified/Created`,
    `- \`path/to/file\` — <what changed>`,
    ``,
    `### Next Steps (if any)`,
    `- <recommendation>`,
    `\`\`\``,
    ``,
    `If the task could not be completed, use:`,
    ``,
    `\`\`\``,
    `### Blocker`,
    `<what prevented completion>`,
    ``,
    `### Attempted`,
    `- <what you tried>`,
    ``,
    `### Needed from Leader`,
    `<what you need to proceed>`,
    `\`\`\``,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Short Prompt (for compact mode / token-constrained scenarios)
// ---------------------------------------------------------------------------

/**
 * Build a shortened version of the teammate prompt for token-constrained
 * scenarios (e.g., when the context window is nearly full).
 */
export function buildCompactTeammatePrompt(
  identity: TeammateIdentity,
  config: TeammateSpawnConfig,
): string {
  const color = identity.color ?? getAgentColor(identity.name);

  const toolList = config.permissions?.allowedTools?.join(", ") ?? "inherited";
  const denyList = config.permissions?.deniedTools?.join(", ") ?? "none";

  return [
    `You are teammate "${identity.name}" in team "${identity.teamName}" (color: ${color}).`,
    `Leader session: ${config.parentSessionId ?? "unknown"}. CWD: ${config.cwd}.`,
    `Allowed tools: ${toolList}. Denied tools: ${denyList}.`,
    `Complete your task and report results. Request permission if blocked.`,
    `Stay in scope. Do not expand beyond your assigned task.`,
  ].join(" ");
}
