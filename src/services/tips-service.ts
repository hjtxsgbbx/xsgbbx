/**
 * TipsService — contextual tips for agent_1 users. Tracks seen tips
 * in-memory and surfaces relevant unseen tips by context keyword.
 */

export interface Tip {
  id: string;
  text: string;
  context: string;
  priority: number;
}

export interface TipsServiceConfig {
  seen?: string[];
}

const BUILT_IN_TIPS: Tip[] = [
  {
    id: "tip-01",
    text: "Use /review before committing to catch issues early with the code-reviewer agent.",
    context: "review",
    priority: 10,
  },
  {
    id: "tip-02",
    text: "DeepSeek R1 has a 1M token context window — you can fit entire codebases in a single conversation.",
    context: "model",
    priority: 10,
  },
  {
    id: "tip-03",
    text: "Run /compact to free up context window space when the conversation gets long. Session memory compaction is automatic for repeated patterns.",
    context: "compact",
    priority: 9,
  },
  {
    id: "tip-04",
    text: "MCP servers extend agent_1 with external tools. Add servers in settings.json under mcp_servers.",
    context: "mcp",
    priority: 9,
  },
  {
    id: "tip-05",
    text: "Use /plan for complex multi-file changes — the planner agent creates a step-by-step implementation plan before touching code.",
    context: "plan",
    priority: 8,
  },
  {
    id: "tip-06",
    text: "agent_1 supports 15+ LLM providers. Switch with /model or set chosen_provider in config. Local options include Ollama, LM Studio, llama.cpp, and vLLM.",
    context: "model",
    priority: 8,
  },
  {
    id: "tip-07",
    text: "Security-first: agent_1 validates all tool calls through a permission pipeline. Use sandbox mode for untrusted code execution.",
    context: "security",
    priority: 7,
  },
  {
    id: "tip-08",
    text: "Auto-compact preserves your most recent conversation turns while summarizing older context. DeepSeek models trigger compact at 85% usage.",
    context: "compact",
    priority: 7,
  },
  {
    id: "tip-09",
    text: "Agent orchestration: launch multiple agents with split-role analysis for complex problems — each agent reviews from a different perspective.",
    context: "agent",
    priority: 6,
  },
  {
    id: "tip-10",
    text: "Session memory persists across restarts in ~/.agent_1/sessions/. Use /resume-session to pick up where you left off.",
    context: "session",
    priority: 6,
  },
];

export class TipsService {
  private seen: Set<string>;

  constructor(config: TipsServiceConfig = {}) {
    this.seen = new Set(config.seen ?? []);
  }

  getTip(context: string): Tip | null {
    const lower = context.toLowerCase();

    const matches = BUILT_IN_TIPS.filter((t) => lower.includes(t.context));
    if (matches.length === 0) return null;

    // Prefer unseen tips
    const unseen = matches.filter((t) => !this.seen.has(t.id));
    if (unseen.length > 0) {
      return this.highestPriority(unseen);
    }

    // All seen — return highest priority seen tip
    return this.highestPriority(matches);
  }

  getUnseen(): Tip[] {
    return BUILT_IN_TIPS.filter((t) => !this.seen.has(t.id));
  }

  getAll(): Tip[] {
    return [...BUILT_IN_TIPS].sort((a, b) => b.priority - a.priority);
  }

  markSeen(tipId: string): void {
    this.seen.add(tipId);
  }

  markAllSeen(): void {
    for (const tip of BUILT_IN_TIPS) {
      this.seen.add(tip.id);
    }
  }

  isSeen(tipId: string): boolean {
    return this.seen.has(tipId);
  }

  resetSeen(): void {
    this.seen.clear();
  }

  getSeenIds(): string[] {
    return [...this.seen].sort();
  }

  unseenCount(): number {
    return this.getUnseen().length;
  }

  private highestPriority(tips: Tip[]): Tip | null {
    if (tips.length === 0) return null;
    return tips.reduce((best, t) => (t.priority > best.priority ? t : best));
  }
}
