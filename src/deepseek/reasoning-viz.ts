/**
 * DeepSeek reasoning chain visualization — captures and renders
 * DeepSeek-R1 reasoning_content as interactive thinking blocks.
 *
 * This is a DeepSeek-exclusive feature not available in Claude Code.
 * Claude models don't expose chain-of-thought tokens.
 */

import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasoningStep {
  /** Step number in the reasoning chain */
  index: number;
  /** The reasoning text */
  content: string;
  /** Timestamp when this step was received */
  timestamp: string;
  /** Token count estimate */
  estimatedTokens: number;
}

export interface ReasoningSession {
  /** Session / query identifier */
  queryId: string;
  steps: ReasoningStep[];
  /** Total reasoning tokens */
  totalTokens: number;
  /** Whether reasoning is complete */
  complete: boolean;
}

export interface ReasoningVizEvents {
  "step": (step: ReasoningStep) => void;
  "complete": (session: ReasoningSession) => void;
  "token-count": (queryId: string, reasoningTokens: number, outputTokens: number) => void;
}

// ---------------------------------------------------------------------------
// Reasoning collector
// ---------------------------------------------------------------------------

export class ReasoningCollector extends EventEmitter {
  private activeSession: ReasoningSession | null = null;

  /**
   * Start collecting reasoning for a query.
   */
  startSession(queryId: string): void {
    this.activeSession = {
      queryId,
      steps: [],
      totalTokens: 0,
      complete: false,
    };
  }

  /**
   * Feed a reasoning chunk from DeepSeek's streaming response.
   * Called for each reasoning_content delta.
   */
  feed(chunk: string): void {
    if (!this.activeSession) return;

    const step: ReasoningStep = {
      index: this.activeSession.steps.length,
      content: chunk,
      timestamp: new Date().toISOString(),
      estimatedTokens: Math.ceil(chunk.length / 2.5), // rough: ~2.5 chars per token
    };

    this.activeSession.steps.push(step);
    this.activeSession.totalTokens += step.estimatedTokens;
    this.emit("step", step);
  }

  /**
   * End the reasoning collection for the current query.
   */
  endSession(): ReasoningSession | null {
    if (!this.activeSession) return null;

    this.activeSession.complete = true;
    const session = { ...this.activeSession };
    this.emit("complete", session);
    this.activeSession = null;
    return session;
  }

  /**
   * Get the current session.
   */
  getSession(): ReasoningSession | null {
    return this.activeSession;
  }

  /**
   * Format reasoning steps for display in terminal.
   */
  static formatForDisplay(session: ReasoningSession, maxSteps = 5): string {
    if (session.steps.length === 0) return "";

    const lines: string[] = [];
    lines.push(`🧠 Reasoning (${session.totalTokens} tokens)`);
    lines.push("─".repeat(40));

    const showSteps = session.steps.slice(-maxSteps);
    for (const step of showSteps) {
      // Truncate long chunks for display
      const text =
        step.content.length > 200
          ? step.content.slice(0, 200) + "..."
          : step.content;
      lines.push(`  [${step.index}] ${text}`);
    }

    if (session.steps.length > maxSteps) {
      lines.push(
        `  ... ${session.steps.length - maxSteps} more steps (use --verbose to see all)`,
      );
    }

    lines.push("─".repeat(40));
    return lines.join("\n");
  }

  /**
   * Format reasoning as a structured summary (for inclusion in context).
   */
  static formatAsSummary(session: ReasoningSession): string {
    if (session.steps.length === 0) return "";

    const fullText = session.steps.map((s) => s.content).join("\n");
    const summary =
      fullText.length > 2000
        ? fullText.slice(0, 2000) +
          `\n[... ${fullText.length - 2000} more characters]`
        : fullText;

    return `[DeepSeek Reasoning — ${session.totalTokens} tokens]\n${summary}`;
  }
}

// ---------------------------------------------------------------------------
// Context dashboard (1M context utilization)
// ---------------------------------------------------------------------------

export interface ContextDashboard {
  /** Total model context window */
  limit: number;
  /** Tokens used */
  used: number;
  /** Percentage used (0-100) */
  percentUsed: number;
  /** Breakdown */
  breakdown: {
    systemPrompt: number;
    messages: number;
    reasoning: number;
    tools: number;
    repoMap: number;
  };
  /** Remaining tokens */
  remaining: number;
  /** Status */
  status: "green" | "yellow" | "red";
}

export function calculateDashboard(
  model: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string | unknown[] }>,
  reasoningTokens: number,
  repoMapTokens: number,
): ContextDashboard {
  const limit = getDeepSeekContextLimit(model);

  const systemTokens = Math.ceil(systemPrompt.length / 2.5);
  const messageTokens = messages.reduce((sum, m) => {
    const text =
      typeof m.content === "string"
        ? m.content
        : JSON.stringify(m.content);
    return sum + Math.ceil(text.length / 2.5);
  }, 0);
  const toolTokens = Math.ceil(messageTokens * 0.1); // ~10% overhead for tool defs

  const used = systemTokens + messageTokens + reasoningTokens + toolTokens + repoMapTokens;
  const percentUsed = Math.round((used / limit) * 100);

  return {
    limit,
    used,
    percentUsed,
    breakdown: {
      systemPrompt: systemTokens,
      messages: messageTokens,
      reasoning: reasoningTokens,
      tools: toolTokens,
      repoMap: repoMapTokens,
    },
    remaining: limit - used,
    status: percentUsed < 60 ? "green" : percentUsed < 85 ? "yellow" : "red",
  };
}

function getDeepSeekContextLimit(model: string): number {
  if (model.includes("deepseek-r1")) return 1_000_000;
  if (model.includes("deepseek-v3")) return 128_000;
  if (model.includes("deepseek-chat") || model.includes("deepseek-v2"))
    return 128_000;
  // Default: assume 128K (most DeepSeek models)
  return 128_000;
}

/**
 * Format a context dashboard for terminal display.
 */
export function formatDashboard(d: ContextDashboard): string {
  const barLen = 30;
  const filled = Math.round((d.percentUsed / 100) * barLen);
  const empty = barLen - filled;
  const color =
    d.status === "green" ? "green" : d.status === "yellow" ? "yellow" : "red";

  return [
    `Context: ${d.used.toLocaleString()} / ${(d.limit / 1000).toFixed(0)}K tokens (${d.percentUsed}%)`,
    `[${"█".repeat(filled)}${"░".repeat(empty)}] ${color}`,
    `  System:  ${d.breakdown.systemPrompt.toLocaleString().padStart(8)}`,
    `  Messages: ${d.breakdown.messages.toLocaleString().padStart(8)}`,
    `  Reasoning: ${d.breakdown.reasoning.toLocaleString().padStart(6)}`,
    `  Tools:   ${d.breakdown.tools.toLocaleString().padStart(8)}`,
    `  RepoMap: ${d.breakdown.repoMap.toLocaleString().padStart(8)}`,
    `  Remaining: ${d.remaining.toLocaleString()}`,
  ].join("\n");
}
