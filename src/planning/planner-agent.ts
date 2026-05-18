import { EventEmitter } from "events";
import {
  type UserInput,
  type SessionContext,
  type Config,
} from "../types/index.js";
import { type AIProvider, createProviderFromConfig } from "../api/index.js";
import { type Tool, getAllTools } from "../tools/index.js";
import { repoMap } from "../intelligence/repo-map.js";
import { captureEnvSnapshot, formatEnvSnapshot } from "../observability/env-snapshot.js";
import { apiCircuitBreaker } from "../resilience/circuit-breaker.js";

export interface PlanStep {
  id: string;
  description: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  dependsOn?: string[];
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  result?: string;
}

export interface ExecutionPlan {
  goal: string;
  steps: PlanStep[];
  estimatedComplexity: "low" | "medium" | "high";
  requiresConfirmation: boolean;
  reasoning: string;
}

export class PlannerAgent extends EventEmitter {
  private provider: AIProvider;
  private tools: Tool[];
  private config: Config;
  private cachedRepoMap: string | null = null;

  constructor(config: Config) {
    super();
    this.config = config;
    this.provider = createProviderFromConfig(config);
    this.tools = getAllTools();
  }

  refreshProvider(config: Config): void {
    this.config = config;
    this.provider = createProviderFromConfig(config);
  }

  setRepoMap(repoMapText: string): void {
    this.cachedRepoMap = repoMapText;
  }

  async createPlan(
    input: UserInput,
    context: SessionContext
  ): Promise<ExecutionPlan> {
    const projectPath = context.config.working_dir || process.cwd();

    if (!this.cachedRepoMap) {
      try {
        this.cachedRepoMap = repoMap.generateMapText(projectPath);
      } catch {
        this.cachedRepoMap = null;
      }
    }

    const envSnapshot = captureEnvSnapshot(projectPath, context.platform);
    const envSnapshotText = formatEnvSnapshot(envSnapshot);

    const planPrompt = this.buildPlanPrompt(input, context, envSnapshotText);

    const apiKey = context.config.api_key_ref;
    const model = context.config.model || "claude-sonnet-4-20250514";

    try {
      const stream = await apiCircuitBreaker.call(async () => {
        return this.provider.streamChatCompletion(
          [{ role: "user", content: planPrompt }],
          "You are an expert software engineering planner. Analyze the task and create a structured execution plan.",
          this.tools,
          { ...context.config, model },
          apiKey
        );
      });

      let fullContent = "";
      for await (const event of stream) {
        if (event.type === "text" && event.text) {
          fullContent += event.text;
        }
      }

      return this.parsePlanResponse(fullContent, input.text);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        goal: input.text,
        steps: [
          {
            id: "step-1",
            description: `Execute task directly: ${input.text}`,
            status: "pending",
          },
        ],
        estimatedComplexity: "low",
        requiresConfirmation: false,
        reasoning: `Planning failed (${message}), falling back to direct execution`,
      };
    }
  }

  private buildPlanPrompt(
    input: UserInput,
    context: SessionContext,
    envSnapshotText: string
  ): string {
    const toolSignatures = this.tools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");

    const recentMessages = context.messages.slice(-10);
    const conversationContext = recentMessages
      .map((m) => `${m.role}: ${typeof m.content === "string" ? m.content.slice(0, 500) : JSON.stringify(m.content).slice(0, 500)}`)
      .join("\n");

    return `Analyze the following task and create a structured execution plan.

## Task
${input.text}

## Available Tools
${toolSignatures}

## Project Context
- Platform: ${context.platform.os} (${context.platform.terminal})
- Permission Mode: ${context.config.permission_mode}
- Working Directory: ${context.config.working_dir || "not set"}
${this.cachedRepoMap ? `\n## Project Structure\n${this.cachedRepoMap.slice(0, 3000)}` : ""}
${envSnapshotText ? `\n## Environment\n${envSnapshotText.slice(0, 2000)}` : ""}
${conversationContext ? `\n## Recent Conversation\n${conversationContext}` : ""}

## Instructions
Create a plan with the following structure. Respond with ONLY the plan, no other text:

GOAL: [clear statement of what needs to be accomplished]
COMPLEXITY: [low/medium/high]
REASONING: [why this approach]
CONFIRM: [yes/no - does this require user confirmation before execution?]
STEPS:
1. [description] | tool: [tool_name] | depends: [step_ids or none]
2. [description] | tool: [tool_name] | depends: [step_ids or none]
...

Keep the plan concise (3-7 steps for medium tasks, 1-3 for simple tasks). Each step should map to a specific tool or action.`;
  }

  private parsePlanResponse(content: string, originalInput: string): ExecutionPlan {
    const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);

    let goal = originalInput;
    let complexity: "low" | "medium" | "high" = "medium";
    let reasoning = "";
    let requiresConfirmation = false;
    const steps: PlanStep[] = [];

    for (const line of lines) {
      if (line.startsWith("GOAL:")) {
        goal = line.slice(5).trim();
      } else if (line.startsWith("COMPLEXITY:")) {
        const c = line.slice(11).trim().toLowerCase();
        if (["low", "medium", "high"].includes(c)) {
          complexity = c as "low" | "medium" | "high";
        }
      } else if (line.startsWith("REASONING:")) {
        reasoning = line.slice(10).trim();
      } else if (line.startsWith("CONFIRM:")) {
        requiresConfirmation = line.slice(8).trim().toLowerCase() === "yes";
      } else if (/^\d+\./.test(line)) {
        const stepText = line.replace(/^\d+\.\s*/, "");
        const parts = stepText.split("|").map((p) => p.trim());

        const description = parts[0] || stepText;
        let toolName: string | undefined;
        let dependsOn: string[] = [];

        for (const part of parts.slice(1)) {
          if (part.toLowerCase().startsWith("tool:")) {
            toolName = part.slice(5).trim();
          } else if (part.toLowerCase().startsWith("depends:")) {
            const deps = part.slice(8).trim();
            if (deps.toLowerCase() !== "none") {
              dependsOn = deps.split(/[,\s]+/).filter(Boolean);
            }
          }
        }

        steps.push({
          id: `step-${steps.length + 1}`,
          description,
          toolName,
          dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
          status: "pending",
        });
      }
    }

    if (steps.length === 0) {
      steps.push({
        id: "step-1",
        description: goal,
        status: "pending",
      });
      complexity = "low";
    }

    return {
      goal,
      steps,
      estimatedComplexity: complexity,
      requiresConfirmation,
      reasoning,
    };
  }

  assessComplexity(input: string): "low" | "medium" | "high" {
    const lower = input.toLowerCase();

    const highIndicators = [
      /refactor/i, /restructure/i, /migrate/i, /rewrite/i,
      /architect/i, /redesign/i, /overhaul/i,
      /multiple files/i, /across the codebase/i,
    ];

    const mediumIndicators = [
      /add.*feature/i, /implement/i, /create.*module/i,
      /update.*api/i, /integrate/i, /configure/i,
      /fix.*bug/i, /debug/i,
    ];

    const highCount = highIndicators.filter((p) => p.test(lower)).length;
    const mediumCount = mediumIndicators.filter((p) => p.test(lower)).length;

    if (highCount >= 2 || (highCount >= 1 && mediumCount >= 2)) return "high";
    if (mediumCount >= 2 || highCount >= 1) return "medium";
    return "low";
  }
}
