import { Message, TokenUsage, CompactionLevel } from "../types/index.js";

const SNIP_THRESHOLD = 0.6;
const COLLAPSE_THRESHOLD = 0.7;
const AUTO_THRESHOLD = 0.92;
const OUTPUT_MAX_LENGTH = 8000;
const IDLE_COMPACTION_MS = 300000;

const CRITICAL_KEYWORDS = [
  "error",
  "ERROR",
  "failed",
  "FAILED",
  "permission denied",
  "Permission Denied",
  "/mark",
];

export interface CompactionResult {
  messages: Message[];
  level: CompactionLevel | null;
  compactedCount: number;
  summary?: string;
}

export class ContextCompactor {
  private lastActivityTime: number = Date.now();

  setActivity(): void {
    this.lastActivityTime = Date.now();
  }

  checkAndCompact(
    messages: Message[],
    tokenUsage: TokenUsage
  ): CompactionResult {
    const usageRatio = tokenUsage.total / tokenUsage.limit;
    const idleTime = Date.now() - this.lastActivityTime;

    let truncated = this.truncateLongOutputs(messages);

    if (idleTime > IDLE_COMPACTION_MS && usageRatio > 0.5) {
      return this.microCompact(truncated);
    }

    if (usageRatio > AUTO_THRESHOLD) {
      return this.autoCompact(truncated, usageRatio);
    }

    if (usageRatio > COLLAPSE_THRESHOLD) {
      return this.collapseCompact(truncated, usageRatio);
    }

    if (usageRatio > SNIP_THRESHOLD) {
      return this.snipCompact(truncated);
    }

    return { messages: truncated, level: null, compactedCount: 0 };
  }

  private truncateLongOutputs(messages: Message[]): Message[] {
    return messages.map((msg) => {
      if (typeof msg.content === "string" && msg.content.length > OUTPUT_MAX_LENGTH) {
        const head = msg.content.slice(0, 4000);
        const tail = msg.content.slice(-4000);
        return {
          ...msg,
          content: head + "\n...(truncated)...\n" + tail,
        };
      }
      return msg;
    });
  }

  private snipCompact(messages: Message[]): CompactionResult {
    const nonCritical = messages.filter((m) => !m.critical);
    if (nonCritical.length < 3) {
      return { messages, level: "snip", compactedCount: 0 };
    }

    const toSnip = nonCritical.slice(0, Math.floor(nonCritical.length * 0.3));
    const snipIds = new Set(toSnip.map((m) => m.tool_id).filter(Boolean));

    const result: CompactionResult = {
      messages: messages.filter((m) => {
        if (m.critical) return true;
        if (m.tool_id && snipIds.has(m.tool_id)) return false;
        return !toSnip.find((s) => s === m);
      }),
      level: "snip",
      compactedCount: toSnip.length,
    };

    return result;
  }

  private microCompact(messages: Message[]): CompactionResult {
    const result: Message[] = [];
    let compactedCount = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (
        !msg.critical &&
        msg.role === "tool" &&
        typeof msg.content === "string" &&
        msg.content.length > 500
      ) {
        const nextMsg = messages[i + 1];
        const prevMsg = messages[i - 1];
        if (
          (nextMsg && nextMsg.role === "tool") ||
          (prevMsg && prevMsg.role === "tool")
        ) {
          result.push({
            ...msg,
            content: "[Tool output folded - see full session for details]",
          });
          compactedCount++;
          continue;
        }
      }
      result.push(msg);
    }

    return {
      messages: result,
      level: "micro",
      compactedCount,
    };
  }

  private collapseCompact(
    messages: Message[],
    usageRatio: number
  ): CompactionResult {
    const criticalMessages = messages.filter((m) => m.critical);
    const nonCritical = messages.filter((m) => !m.critical);

    if (nonCritical.length === 0) {
      return { messages, level: "collapse", compactedCount: 0 };
    }

    const keepCount = Math.floor(nonCritical.length * 0.4);
    const recent = nonCritical.slice(-keepCount);
    const old = nonCritical.slice(0, nonCritical.length - keepCount);

    const oldSummary = this.generateLocalSummary(old);

    const summaryMsg: Message = {
      role: "assistant",
      content: `[Earlier conversation summary (${old.length} messages): ${oldSummary}]`,
      timestamp: new Date().toISOString(),
      critical: false,
    };

    return {
      messages: [...criticalMessages, summaryMsg, ...recent],
      level: "collapse",
      compactedCount: old.length,
      summary: oldSummary,
    };
  }

  private autoCompact(
    messages: Message[],
    usageRatio: number
  ): CompactionResult {
    const criticalMessages = messages.filter((m) => m.critical);
    const nonCritical = messages.filter((m) => !m.critical);

    if (nonCritical.length === 0) {
      return { messages, level: "auto", compactedCount: 0 };
    }

    const keepCount = Math.max(2, Math.floor(nonCritical.length * 0.15));
    const recent = nonCritical.slice(-keepCount);
    const old = nonCritical.slice(0, nonCritical.length - keepCount);

    const oldSummary = this.generateLocalSummary(old);

    const summaryMsg: Message = {
      role: "assistant",
      content: `[Previous conversation aggressively compressed (${old.length} messages): ${oldSummary}]`,
      timestamp: new Date().toISOString(),
      critical: false,
    };

    return {
      messages: [...criticalMessages, summaryMsg, ...recent],
      level: "auto",
      compactedCount: old.length,
      summary: oldSummary,
    };
  }

  private generateLocalSummary(messages: Message[]): string {
    const userMessages = messages.filter((m) => m.role === "user");
    const toolResult = messages.filter(
      (m) => m.role === "tool" || m.role === "assistant"
    );

    const userSummary = userMessages
      .slice(0, 5)
      .map((m) =>
        typeof m.content === "string"
          ? m.content.slice(0, 100)
          : "[tool calls]"
      )
      .join(" | ");

    const successCount = toolResult.filter((m) =>
      typeof m.content === "string" && m.content.includes("success")
    ).length;

    return userMessages.length > 0
      ? `${userMessages.length} user queries, ${toolResult.length} responses, ${successCount} successful tool executions. Topics: ${userSummary}`
      : `${toolResult.length} system interactions.`;
  }

  aggressiveCompact(messages: Message[]): Message[] {
    const criticalMessages = messages.filter((m) => m.critical);
    const nonCritical = messages.filter((m) => !m.critical);

    if (nonCritical.length === 0) return messages;

    const keepCount = Math.max(2, Math.floor(nonCritical.length * 0.15));
    const recent = nonCritical.slice(-keepCount);
    const old = nonCritical.slice(0, nonCritical.length - keepCount);
    const oldSummary = this.generateLocalSummary(old);

    const summaryMsg: Message = {
      role: "assistant",
      content: `[Compacted ${old.length} messages: ${oldSummary}]`,
      timestamp: new Date().toISOString(),
      critical: false,
    };

    return [...criticalMessages, summaryMsg, ...recent];
  }

  forceCompact(messages: Message[]): Message[] {
    const criticalMessages = messages.filter((m) => m.critical);
    const nonCritical = messages.filter((m) => !m.critical);

    if (nonCritical.length === 0) return messages;

    const keepCount = Math.max(1, Math.floor(nonCritical.length * 0.08));
    const recent = nonCritical.slice(-keepCount);
    const old = nonCritical.slice(0, nonCritical.length - keepCount);

    const summaryMsg: Message = {
      role: "assistant",
      content: `[Forced compaction: ${old.length} messages discarded to preserve token budget. Key topics: ${old.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content.slice(0, 60) : '').filter(Boolean).slice(0, 3).join(' | ')}]`,
      timestamp: new Date().toISOString(),
      critical: false,
    };

    return [...criticalMessages, summaryMsg, ...recent];
  }
}