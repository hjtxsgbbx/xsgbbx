/**
 * Agent Orchestrator — sub-agent spawning with memory snapshot, context
 * forking, and result summarization. DeepSeek-optimized.
 *
 * Adapted from Claude Code's AgentTool/ + swarm/ patterns.
 */

import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  model?: string;
  /** If true, can be spawned without user confirmation */
  autonomous?: boolean;
  /** Max turns for this agent type */
  maxTurns?: number;
  /** Context isolation: "workspace" = new git worktree, "fork" = forked messages */
  isolation?: "none" | "fork" | "workspace";
}

export interface AgentMemorySnapshot {
  timestamp: string;
  keyFiles: string[];
  decisions: string[];
  errors: string[];
  context: string;
}

export interface AgentResult {
  agentName: string;
  success: boolean;
  content: string;
  turnCount: number;
  tokensUsed: { input: number; output: number };
  memorySnapshot: AgentMemorySnapshot;
  durationMs: number;
}

export interface AgentSpawnOptions {
  task: string;
  context?: string;
  timeoutMs?: number;
  model?: string;
}

// ---------------------------------------------------------------------------
// Built-in agents (DeepSeek-optimized prompts)
// ---------------------------------------------------------------------------

const BUILT_IN_AGENTS: AgentDefinition[] = [
  {
    name: "explore",
    description: "Search and explore the codebase — find files, grep for patterns, trace imports",
    systemPrompt: `You are a code explorer. Your job is to search the codebase and answer questions about structure, dependencies, and patterns.

Rules:
- Use Read, Grep, Glob, and Bash tools
- Report findings in structured format: file paths, line numbers, summaries
- Be thorough — check multiple naming conventions and locations
- Report nothing found if truly nothing exists (don't guess)
- Respond in under 300 words unless asked for details`,
    allowedTools: ["Read", "Grep", "Glob", "Bash"],
    autonomous: true,
    maxTurns: 10,
    isolation: "fork",
  },
  {
    name: "architect",
    description: "Design system architecture and plan implementation approaches",
    systemPrompt: `You are a software architect. Your job is to design systems, plan refactors, and make technical decisions.

Rules:
- Read existing code before proposing changes
- Consider trade-offs: complexity vs flexibility, performance vs readability
- Propose concrete files, interfaces, and data flow
- Identify risks and dependencies
- Reuse existing patterns and abstractions when possible`,
    allowedTools: ["Read", "Grep", "Glob", "Bash"],
    autonomous: false,
    maxTurns: 15,
    isolation: "fork",
  },
  {
    name: "reviewer",
    description: "Review code for quality, security, bugs, and best practices",
    systemPrompt: `You are a code reviewer. Your job is to find issues in code changes.

Rules:
- Check security first: secrets, injection, auth bypass, path traversal
- Then correctness: logic errors, edge cases, race conditions
- Then quality: naming, function size, nesting depth, error handling
- Report findings with severity (CRITICAL/HIGH/MEDIUM/LOW), file path, and fix
- Don't report style nits that a formatter would catch`,
    allowedTools: ["Read", "Grep", "Glob", "Bash"],
    autonomous: true,
    maxTurns: 12,
    isolation: "fork",
  },
];

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface AgentOrchestratorEvents {
  "agent:spawned": (name: string, task: string) => void;
  "agent:completed": (result: AgentResult) => void;
  "agent:error": (name: string, error: string) => void;
}

export class AgentOrchestrator extends EventEmitter {
  private agents: Map<string, AgentDefinition> = new Map();
  private runningAgents: Map<string, Promise<AgentResult>> = new Map();

  constructor() {
    super();
    // Register built-in agents
    for (const def of BUILT_IN_AGENTS) {
      this.register(def);
    }
  }

  register(def: AgentDefinition): void {
    this.agents.set(def.name, def);
  }

  unregister(name: string): boolean {
    return this.agents.delete(name);
  }

  getAgent(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  listAgents(): AgentDefinition[] {
    return [...this.agents.values()];
  }

  /** Spawn a sub-agent in the background */
  spawn(
    agentName: string,
    options: AgentSpawnOptions,
    queryFn: (
      def: AgentDefinition,
      task: string,
      context?: string,
    ) => Promise<AgentResult>,
  ): { agentName: string; result: Promise<AgentResult> } {
    const def = this.agents.get(agentName);
    if (!def) {
      throw new Error(`Unknown agent: ${agentName}. Available: ${[...this.agents.keys()].join(", ")}`);
    }

    this.emit("agent:spawned", agentName, options.task);

    const result = queryFn(def, options.task, options.context)
      .then((res) => {
        this.runningAgents.delete(agentName);
        this.emit("agent:completed", res);
        return res;
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.runningAgents.delete(agentName);
        this.emit("agent:error", agentName, msg);
        const failResult: AgentResult = {
          agentName,
          success: false,
          content: `Agent error: ${msg}`,
          turnCount: 0,
          tokensUsed: { input: 0, output: 0 },
          memorySnapshot: {
            timestamp: new Date().toISOString(),
            keyFiles: [],
            decisions: [],
            errors: [msg],
            context: "",
          },
          durationMs: 0,
        };
        return failResult;
      });

    this.runningAgents.set(agentName, result);
    return { agentName, result };
  }

  /** Spawn multiple agents in parallel */
  spawnParallel(
    agents: Array<{ name: string; options: AgentSpawnOptions }>,
    queryFn: (
      def: AgentDefinition,
      task: string,
      context?: string,
    ) => Promise<AgentResult>,
  ): Array<{ agentName: string; result: Promise<AgentResult> }> {
    return agents.map(({ name, options }) => this.spawn(name, options, queryFn));
  }

  getRunningAgents(): string[] {
    return [...this.runningAgents.keys()];
  }

  /** Extract a memory snapshot from agent results */
  static createMemorySnapshot(results: AgentResult[]): AgentMemorySnapshot {
    const keyFiles = new Set<string>();
    const decisions: string[] = [];
    const errors: string[] = [];
    const contexts: string[] = [];

    for (const r of results) {
      for (const f of r.memorySnapshot.keyFiles) keyFiles.add(f);
      decisions.push(...r.memorySnapshot.decisions);
      errors.push(...r.memorySnapshot.errors);
      if (r.memorySnapshot.context) contexts.push(r.memorySnapshot.context);
    }

    return {
      timestamp: new Date().toISOString(),
      keyFiles: [...keyFiles],
      decisions: [...new Set(decisions)],
      errors: [...new Set(errors)],
      context: contexts.join("\n---\n"),
    };
  }
}

export const agentOrchestrator = new AgentOrchestrator();
