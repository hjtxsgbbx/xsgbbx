/**
 * Session Memory Compaction
 *
 * Before invoking expensive LLM-based compaction, check whether a session
 * memory file already contains summaries of earlier messages. If it covers
 * enough of the conversation, use it directly — saving an LLM call.
 *
 * Flow:
 * 1. Read session memory from ~/.agent_1/sessions/{id}/memory.md
 * 2. Match memory entries to messages by timestamp
 * 3. Calculate how many recent messages to keep intact
 * 4. Adjust boundary to avoid splitting tool_use/tool_result pairs
 * 5. Validate post-compact token count is below threshold; fall back if not
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Message } from "../types/index.js";
import { estimateTokens, estimateMessagesTokens } from "../observability/token-counter.js";
import { debug } from "../observability/debug.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_DATA_DIR = ".agent_1";
const SESSIONS_DIR = "sessions";
const MEMORY_FILENAME = "MEMORY.md";
const MIN_RECENT_TOKENS = 12000;
const MAX_RECENT_TOKENS = 30000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionMemoryCompactionResult {
  wasApplied: boolean;
  messages: Message[];
  compactedCount: number;
  lastCompactedIndex: number;
  reason: string;
}

interface MemoryEntry {
  timestamp: string;
  summary: string;
  lineIndex: number;
}

// ---------------------------------------------------------------------------
// Memory File Reading
// ---------------------------------------------------------------------------

function getSessionMemoryPath(sessionId: string): string {
  const homeDir = process.env.USERPROFILE || process.env.HOME || "~";
  return path.join(homeDir, AGENT_DATA_DIR, SESSIONS_DIR, sessionId, MEMORY_FILENAME);
}

function readSessionMemory(sessionId: string): MemoryEntry[] {
  const memPath = getSessionMemoryPath(sessionId);
  try {
    if (!fs.existsSync(memPath)) {
      debug.info("session-memory-compact", `No memory file at ${memPath}`);
      return [];
    }
    return parseMemoryEntries(fs.readFileSync(memPath, "utf-8"));
  } catch (err) {
    debug.warn("session-memory-compact", `Failed to read memory file: ${memPath}`, err);
    return [];
  }
}

/**
 * Parse memory entries from markdown.
 * Expected format:
 *   ### 2024-01-15 10:30:00
 *   Summary text...
 *   ### 2024-01-15 10:45:00
 *   More text...
 */
function parseMemoryEntries(content: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const lines = content.split("\n");
  let currentTimestamp = "";
  let currentSummary = "";
  let lineIndex = 0;

  for (const line of lines) {
    const tsMatch = line.match(/^#{2,3}\s+(\d{4}-\d{2}-\d{2}[T\s].*)$/);
    if (tsMatch) {
      if (currentTimestamp && currentSummary.trim()) {
        entries.push({ timestamp: currentTimestamp, summary: currentSummary.trim(), lineIndex });
      }
      currentTimestamp = tsMatch[1].trim();
      currentSummary = "";
      lineIndex++;
      continue;
    }
    if (line.match(/^#+\s/)) continue;
    if (currentTimestamp) currentSummary += line + "\n";
  }

  if (currentTimestamp && currentSummary.trim()) {
    entries.push({ timestamp: currentTimestamp, summary: currentSummary.trim(), lineIndex });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Message Matching
// ---------------------------------------------------------------------------

/** Find the index of the last message already summarized in session memory. */
function findLastSummarizedIndex(
  messages: Message[],
  memoryEntries: MemoryEntry[],
): number {
  if (memoryEntries.length === 0 || messages.length === 0) return -1;

  const lastEntry = memoryEntries[memoryEntries.length - 1];
  const memoryTimestamp = new Date(lastEntry.timestamp).getTime();
  if (isNaN(memoryTimestamp)) return -1;

  let lastIndex = -1;
  for (let i = 0; i < messages.length; i++) {
    const msgTs = new Date(messages[i].timestamp).getTime();
    if (!isNaN(msgTs) && msgTs <= memoryTimestamp) {
      lastIndex = i;
    } else if (!isNaN(msgTs) && msgTs > memoryTimestamp) {
      break; // messages are chronological
    }
  }
  return lastIndex;
}

// ---------------------------------------------------------------------------
// Boundary Adjustment (Don't Split Tool Pairs)
// ---------------------------------------------------------------------------

/**
 * Adjust the keep-boundary so tool_use/tool_result pairs stay together.
 * Returns the adjusted boundary (messages from this index onward are kept).
 */
function adjustBoundaryForToolPairs(
  messages: Message[],
  boundaryIndex: number,
): number {
  if (boundaryIndex <= 0 || boundaryIndex >= messages.length) return boundaryIndex;

  const boundaryMsg = messages[boundaryIndex];

  // Tool result at boundary → pull in its preceding tool call
  if (boundaryMsg.role === "tool" && boundaryMsg.tool_id) {
    for (let i = boundaryIndex - 1; i >= 0; i--) {
      const candidate = messages[i];
      if (candidate.role === "assistant") {
        if (Array.isArray(candidate.content)) {
          const hasMatch = candidate.content.some(
            (tc) => tc.id === boundaryMsg.tool_id,
          );
          if (hasMatch) return adjustBoundaryForToolPairs(messages, i);
        }
        return adjustBoundaryForToolPairs(messages, i);
      }
    }
  }

  // Assistant with tool calls at boundary → include their results
  if (boundaryMsg.role === "assistant" && Array.isArray(boundaryMsg.content)) {
    const toolIds = new Set(boundaryMsg.content.map((tc) => tc.id));
    let newBoundary = boundaryIndex;
    for (let i = boundaryIndex + 1; i < messages.length; i++) {
      const candidate = messages[i];
      if (candidate.role === "tool" && candidate.tool_id && toolIds.has(candidate.tool_id)) {
        newBoundary = i + 1;
      } else if (candidate.role === "assistant") {
        break;
      }
    }
    if (newBoundary > boundaryIndex) return newBoundary;
  }

  return boundaryIndex;
}

// ---------------------------------------------------------------------------
// Main Logic
// ---------------------------------------------------------------------------

/**
 * Calculate which message index to keep from (inclusive).
 * Walks backward from the end, accumulating tokens until MAX_RECENT_TOKENS
 * or reaching lastSummarizedIndex. Ensures MIN_RECENT_TOKENS is met.
 */
function calculateMessagesToKeepIndex(
  messages: Message[],
  lastSummarizedIndex: number,
  modelName?: string,
): number {
  let accumulatedTokens = 0;
  let boundary = messages.length;

  for (let i = messages.length - 1; i > lastSummarizedIndex; i--) {
    const rawContent = messages[i].content;
    const content: string = typeof rawContent === "string"
      ? rawContent : JSON.stringify(rawContent);
    const msgTokens = estimateTokens(content, modelName) + 5;

    if (accumulatedTokens + msgTokens > MAX_RECENT_TOKENS) {
      if (accumulatedTokens >= MIN_RECENT_TOKENS) {
        boundary = i + 1;
        break;
      }
    }
    accumulatedTokens += msgTokens;
    boundary = i;
  }

  return boundary >= messages.length ? Math.max(0, lastSummarizedIndex + 1) : boundary;
}

function estimateMessageTokens(messages: Message[], modelName?: string): number {
  return estimateMessagesTokens(
    messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    })),
    modelName,
  );
}

/**
 * Try session memory-based compaction before falling back to LLM compaction.
 *
 * @returns {SessionMemoryCompactionResult} indicating success and the modified messages.
 */
export function trySessionMemoryCompaction(
  messages: Message[],
  sessionId: string,
  threshold: number,
  modelName?: string,
): SessionMemoryCompactionResult {
  if (messages.length < 6) {
    return { wasApplied: false, messages, compactedCount: 0, lastCompactedIndex: -1,
      reason: "Too few messages to compact via session memory" };
  }

  // 1. Read session memory
  const memoryEntries = readSessionMemory(sessionId);
  if (memoryEntries.length === 0) {
    return { wasApplied: false, messages, compactedCount: 0, lastCompactedIndex: -1,
      reason: "No session memory entries found" };
  }

  // 2. Find last summarized index
  const lastSummarizedIndex = findLastSummarizedIndex(messages, memoryEntries);
  if (lastSummarizedIndex < 0) {
    return { wasApplied: false, messages, compactedCount: 0, lastCompactedIndex: -1,
      reason: "Could not match memory entries to messages" };
  }

  // 3. Calculate keep boundary (enough recent tokens)
  const messagesToKeepIndex = calculateMessagesToKeepIndex(
    messages, lastSummarizedIndex, modelName,
  );
  if (messagesToKeepIndex <= 0) {
    return { wasApplied: false, messages, compactedCount: 0, lastCompactedIndex: -1,
      reason: "Not enough messages above the last summarized index" };
  }

  // 4. Adjust boundary for tool pairs
  const adjustedBoundary = adjustBoundaryForToolPairs(messages, messagesToKeepIndex);

  // 5. Build compacted message list
  const toKeep = messages.slice(adjustedBoundary);
  const criticalMessages = messages.filter((m) => m.critical);
  const toCompactCount = adjustedBoundary - criticalMessages.filter(
    (cm) => messages.slice(0, adjustedBoundary).some(
      (tc) => tc.role === cm.role && tc.timestamp === cm.timestamp && tc.content === cm.content,
    ),
  ).length;

  if (toCompactCount <= 0) {
    return { wasApplied: false, messages, compactedCount: 0, lastCompactedIndex: -1,
      reason: "Nothing to compact after boundary adjustment" };
  }

  // Build summary from memory entries
  const memorySnapshot = memoryEntries.slice(-3)
    .map((e) => `[${e.timestamp.slice(0, 16)}]: ${e.summary.slice(0, 200)}`)
    .join(" | ");

  const summaryMessage: Message = {
    role: "user",
    content: `[Session memory compacted ${toCompactCount} messages. ` +
      `Memory file: ~/.agent_1/sessions/${sessionId}/MEMORY.md. ` +
      `Recent entries: ${memorySnapshot || "See memory file for details"}]`,
    timestamp: new Date().toISOString(),
    critical: false,
  };

  const result: Message[] = [...criticalMessages, summaryMessage, ...toKeep];

  // 6. Validate post-compact token count
  const resultTokens = estimateMessageTokens(result, modelName);
  if (resultTokens >= threshold) {
    debug.warn("session-memory-compact",
      `Post-compact tokens (${resultTokens}) exceed threshold (${threshold}). Falling back.`);
    return { wasApplied: false, messages, compactedCount: 0, lastCompactedIndex: -1,
      reason: `Post-compact tokens (${resultTokens}) exceed threshold (${threshold})` };
  }

  const beforeTokens = estimateMessageTokens(messages, modelName);
  debug.info("session-memory-compact",
    `Compacted ${toCompactCount} messages. Tokens: ${beforeTokens} → ${resultTokens}.`);

  return {
    wasApplied: true,
    messages: result,
    compactedCount: toCompactCount,
    lastCompactedIndex: adjustedBoundary - 1,
    reason: "Session memory compaction successful",
  };
}
