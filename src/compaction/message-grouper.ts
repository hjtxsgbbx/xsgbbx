/**
 * Message Grouper
 *
 * Groups conversation messages by API round. Each user message starts a new
 * group; all subsequent assistant and tool messages belong to that group until
 * the next user message.
 *
 * The primary use case is PTL (prompt-too-long) retry: when the API rejects
 * a request because it exceeds the context limit, we drop the oldest groups
 * (from the head of the conversation) until the token gap is covered.
 */

import type { Message } from "../types/index.js";
import { estimateMessagesTokens } from "../observability/token-counter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MessageGroup {
  /** Index of this group (0 = oldest) */
  index: number;
  /** Messages in this group */
  messages: Message[];
  /** Estimated token count for this group */
  estimatedTokens: number;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * Groups messages by API round.
 *
 * A new group starts when we see a user message. All subsequent assistant
 * and tool messages belong to that same group until the next user message.
 *
 * This mirrors Claude Code's approach where each assistant response with
 * a new id starts a new group. Since our Message type lacks a UUID field,
 * we use user-message boundaries as the grouping heuristic — which is
 * equivalent in practice because each user turn triggers exactly one API
 * round.
 */
export function groupMessagesByApiRound(
  messages: Message[],
  modelName?: string,
): MessageGroup[] {
  if (messages.length === 0) return [];

  const groups: MessageGroup[] = [];
  let currentGroup: Message[] = [];
  let groupIndex = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // A user message starts a new group (unless it's the very first message
    // and we haven't accumulated anything yet)
    if (msg.role === "user" && currentGroup.length > 0) {
      // But wait: system messages (role === "user" with special content) that
      // are injected by the framework should NOT start new groups.
      // A framework user message is usually non-critical and injected.
      // We treat critical user messages as genuine user turns.
      if (isFrameworkInjectedUser(msg)) {
        currentGroup.push(msg);
        continue;
      }

      groups.push(finishGroup(currentGroup, groupIndex, modelName));
      groupIndex++;
      currentGroup = [msg];
    } else {
      currentGroup.push(msg);
    }
  }

  // Don't forget the last group
  if (currentGroup.length > 0) {
    groups.push(finishGroup(currentGroup, groupIndex, modelName));
  }

  return groups;
}

// ---------------------------------------------------------------------------
// PTL Retry Truncation
// ---------------------------------------------------------------------------

/**
 * Drops groups from the head (oldest) of the conversation until the estimated
 * token savings cover the requested gap.
 *
 * Used in prompt-too-long (PTL) retry: the API rejected the request because
 * it exceeded the context window. We need to remove old content to fit.
 *
 * Returns a new array of messages (immutable — original is unchanged).
 */
export function truncateHeadForPTLRetry(
  groups: MessageGroup[],
  tokenGap: number,
): Message[] {
  if (groups.length === 0) return [];

  let tokensFreed = 0;
  let dropCount = 0;

  // Drop oldest groups until savings >= gap
  for (let i = 0; i < groups.length - 1; i++) {
    // Always keep at least the last group (most recent turn)
    tokensFreed += groups[i].estimatedTokens;
    dropCount++;

    if (tokensFreed >= tokenGap) {
      break;
    }
  }

  // If we've dropped everything and still not enough, keep only the last group
  if (dropCount >= groups.length) {
    dropCount = groups.length - 1;
  }

  if (dropCount === 0) {
    // Can't drop anything meaningful — return flattened
    return groups.flatMap((g) => g.messages);
  }

  // Build truncated message list from remaining groups
  const remainingGroups = groups.slice(dropCount);
  return remainingGroups.flatMap((g) => g.messages);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if a user-role message was injected by the framework rather
 * than typed by the human user.
 *
 * Framework-injected user messages typically:
 *   - Are not marked critical
 *   - Contain system instruction content (starts with patterns like
 *     "[System", "<system", "You are", etc.)
 */
function isFrameworkInjectedUser(msg: Message): boolean {
  if (msg.role !== "user") return false;
  if (msg.critical) return false; // Critical user msgs are genuine turns

  const content = typeof msg.content === "string" ? msg.content : "";
  if (content.length === 0) return true;

  // Framework-injected messages often have system-like content patterns
  const injectedPatterns = [
    /^\[System/i,
    /^<system/i,
    /^Here is a summary of the conversation so far/i,
    /^\[Previous conversation/i,
    /^\[Compacted/i,
    /^\[Earlier conversation/i,
    /^The conversation above is now complete/i,
  ];

  return injectedPatterns.some((p) => p.test(content));
}

function finishGroup(
  messages: Message[],
  index: number,
  modelName?: string,
): MessageGroup {
  const asTyped = messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));

  return {
    index,
    messages: [...messages], // shallow copy for immutability
    estimatedTokens: estimateMessagesTokens(asTyped, modelName),
  };
}
