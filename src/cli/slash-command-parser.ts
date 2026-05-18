export interface ParsedCommand {
  command: string;
  alias?: string;
  type: "builtin" | "prompt" | "workflow" | "unknown";
  prompt?: string;
  workflowName?: string;
}

const ALIAS_MAP: Record<string, string> = {
  "/h": "/help",
  "/s": "/status",
  "/cl": "/clear",
  "/m": "/mode",
  "/w": "/workflow",
  "/q": "/exit",
  "/x": "/exit",
  "/e": "/export",
  "/i": "/init",
  "/r": "/review",
  "/t": "/test",
  "/p": "/pr",
  "/d": "/doctor",
  "/mem": "/memory",
  "/cmp": "/compact",
  "/$": "/cost",
  "/hk": "/hooks",
  "/sk": "/skills",
  "/md": "/model",
};

const BUILTIN_COMMANDS = new Set([
  "/help", "/status", "/clear", "/mode", "/workflow", "/exit", "/export",
  "/doctor", "/memory", "/compact", "/cost", "/resume", "/hooks", "/skills", "/model",
]);

const DOCTOR_PROMPT = `Run a system diagnostic. Check:
1. Node.js version, platform info
2. Git availability and version
3. API key configuration (is provider set, is key valid?)
4. MCP server connectivity
5. Disk space for sessions/logs
6. Project detection (.agent_1.md, CLAUDE.md, package.json)

Report a health score for each category. Flag any issues with suggested fixes.`;

const MEMORY_PROMPT = `Manage persistent memory. Based on the current conversation:
1. Identify key facts, decisions, and preferences to save
2. Show existing memories that are relevant to the current context
3. Categorize: user profile, project context, feedback, references

Use the memory directory format:
- user/*.md for user preferences and knowledge
- project/*.md for project-specific context
- feedback/*.md for corrections and validated approaches
- reference/*.md for external system pointers`;

const COMPACT_PROMPT = `Compact the current conversation context to free token budget.
1. Summarize early messages into a concise form
2. Preserve critical information: decisions, errors, key findings
3. Drop redundant or ephemeral content
4. Keep recent context verbatim

DeepSeek has 1M context, so only compact when truly needed (>85% usage).`;

const COST_PROMPT = `Show cost and token usage for the current session:
1. Total tokens used (input/output)
2. Estimated cost based on model pricing
3. Turn-by-turn breakdown (last 10 turns)
4. Budget status (warning/exceeded)
5. Projected remaining turns at current burn rate`;

const RESUME_PROMPT = `Resume the most recent session. Find and load:
1. The last session with uncompleted work
2. Any pending tasks or TODOs
3. The conversation context leading up to where we left off
Restore the working state so we can continue seamlessly.`;

const PROMPT_COMMANDS: Record<string, string> = {
  "/init":
    "Initialize this project by scanning the codebase and creating a comprehensive .agent_1.md file that documents: 1) Project overview and purpose 2) Architecture and key components 3) Coding conventions and style 4) Dependencies and their roles 5) Build/test/deploy commands 6) Known issues and notes",
  "/review":
    "Perform a thorough code review of the current project. Focus on: 1) Code quality and readability 2) Security vulnerabilities 3) Performance issues 4) Error handling 5) Test coverage gaps 6) Best practices compliance. Provide specific, actionable recommendations with file paths and line references.",
  "/test":
    "Analyze the current codebase and generate comprehensive tests. Focus on: 1) Unit tests for core logic 2) Integration tests for component interactions 3) Edge cases and error scenarios 4) Mock external dependencies appropriately. Follow the project's existing test patterns and conventions.",
  "/pr":
    "Create a pull request from the current changes. Steps: 1) Review all uncommitted changes with git diff 2) Stage relevant changes 3) Write a clear, descriptive commit message following conventional commits format 4) Push to a new branch 5) Create a PR with a detailed description including: summary, changes, testing notes, and any breaking changes.",
  "/doctor": DOCTOR_PROMPT,
  "/memory": MEMORY_PROMPT,
  "/compact": COMPACT_PROMPT,
  "/cost": COST_PROMPT,
  "/resume": RESUME_PROMPT,
};

const WORKFLOW_PROMPTS: Record<string, string> = {
  "create-api": "Create a new REST API endpoint with route, controller, validation, and tests",
  "fix-bug": "Systematically debug and fix a reported bug",
  "refactor": "Refactor code for better quality, performance, and maintainability",
  "add-tests": "Add comprehensive test coverage for existing code",
  "init-project": "Initialize a new project with proper structure and configuration",
  "code-review": "Perform a thorough code review focusing on quality, security, and performance",
};

export function resolveAlias(input: string): string {
  return ALIAS_MAP[input] || input;
}

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { command: trimmed, type: "unknown" };
  }

  const resolved = resolveAlias(trimmed.split(" ")[0]);
  const alias = trimmed !== resolved ? trimmed.split(" ")[0] : undefined;

  if (BUILTIN_COMMANDS.has(resolved)) {
    if (resolved === "/workflow" && trimmed.includes(" ")) {
      const workflowName = trimmed.slice(trimmed.indexOf(" ") + 1).trim();
      const prompt = WORKFLOW_PROMPTS[workflowName];
      if (prompt) {
        return {
          command: resolved,
          alias,
          type: "workflow",
          prompt,
          workflowName,
        };
      }
      return {
        command: resolved,
        alias,
        type: "workflow",
        workflowName,
      };
    }
    return { command: resolved, alias, type: "builtin" };
  }

  if (PROMPT_COMMANDS[resolved]) {
    return {
      command: resolved,
      alias,
      type: "prompt",
      prompt: PROMPT_COMMANDS[resolved],
    };
  }

  return { command: resolved, alias, type: "unknown" };
}

export function getAvailableCommands(): Array<{ command: string; aliases: string[]; description: string }> {
  return [
    { command: "/help", aliases: ["/h"], description: "Show help" },
    { command: "/status", aliases: ["/s"], description: "Show session status" },
    { command: "/clear", aliases: ["/cl"], description: "Clear session messages" },
    { command: "/mode", aliases: ["/m"], description: "Cycle: plan → act → default" },
    { command: "/init", aliases: ["/i"], description: "Initialize project memory (.agent_1.md)" },
    { command: "/review", aliases: ["/r"], description: "Run code review on current project" },
    { command: "/test", aliases: ["/t"], description: "Generate and run tests for current file" },
    { command: "/pr", aliases: ["/p"], description: "Create a pull request from changes" },
    { command: "/workflow", aliases: ["/w"], description: "List available workflows" },
    { command: "/doctor", aliases: ["/d"], description: "System diagnostic and health check" },
    { command: "/memory", aliases: ["/mem"], description: "Manage persistent memory" },
    { command: "/compact", aliases: ["/cmp"], description: "Compact conversation context" },
    { command: "/cost", aliases: ["/$"], description: "Show token usage and cost" },
    { command: "/resume", aliases: [], description: "Resume most recent session" },
    { command: "/hooks", aliases: ["/hk"], description: "Manage hooks configuration" },
    { command: "/skills", aliases: ["/sk"], description: "List available skills" },
    { command: "/model", aliases: ["/md"], description: "Show or switch model" },
    { command: "/exit", aliases: ["/q", "/x"], description: "Exit agent_1" },
    { command: "/export", aliases: ["/e"], description: "Export session data" },
  ];
}

export function getAvailableWorkflows(): string[] {
  return Object.keys(WORKFLOW_PROMPTS);
}
