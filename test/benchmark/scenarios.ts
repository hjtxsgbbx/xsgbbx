import { BenchmarkTask } from "../../src/benchmark/types.js";

export const BENCHMARK_SCENARIOS: BenchmarkTask[] = [
  {
    id: "B001",
    name: "Fix TypeScript type errors in core module",
    category: "bug_fix",
    description:
      "A module has type errors that prevent compilation. Identify and fix all type errors while preserving functionality.",
    setupCommands: [],
    expectedOutput: {
      type: "type_check",
    },
    timeoutMs: 60000,
    maxTurns: 10,
    difficulty: "medium",
    tags: ["typescript", "type-safety", "bug-fix"],
  },
  {
    id: "B002",
    name: "Generate CRUD API endpoints with validation",
    category: "code_generation",
    description:
      "Create REST API endpoints for a /users resource with input validation, error handling, and TypeScript types.",
    setupCommands: ["mkdir -p test/api-gen-temp"],
    expectedOutput: {
      type: "file_exists",
      filePath: "test/api-gen-temp/users.ts",
      regex: "export (async )?function (createUser|getUsers|updateUser|deleteUser)",
    },
    timeoutMs: 90000,
    maxTurns: 15,
    difficulty: "hard",
    tags: ["api", "rest", "crud", "typescript", "validation"],
  },
  {
    id: "B003",
    name: "Add unit tests for ConfigStore",
    category: "test_writing",
    description:
      "Write comprehensive unit tests for the ConfigStore module covering save, load, defaults, and edge cases.",
    setupCommands: [],
    expectedOutput: {
      type: "test_pass",
      cliCommand: "npx jest --config jest.config.cjs --testPathPattern=config-store --passWithNoTests 2>&1",
    },
    timeoutMs: 120000,
    maxTurns: 12,
    difficulty: "medium",
    tags: ["testing", "config", "coverage"],
  },
  {
    id: "B004",
    name: "Refactor ProcessManager to reduce complexity",
    category: "refactoring",
    description:
      "Refactor the ProcessManager class to reduce cyclomatic complexity below 10, extract signal handling into a separate module.",
    setupCommands: [],
    expectedOutput: {
      type: "type_check",
    },
    timeoutMs: 60000,
    maxTurns: 8,
    difficulty: "medium",
    tags: ["refactoring", "complexity", "clean-code"],
  },
  {
    id: "B005",
    name: "Add security input sanitization to ToolExecutor",
    category: "security_fix",
    description:
      "Add path traversal protection and command injection sanitization to the StreamingToolExecutor.",
    setupCommands: [],
    expectedOutput: {
      type: "type_check",
    },
    timeoutMs: 60000,
    maxTurns: 10,
    difficulty: "hard",
    tags: ["security", "sanitization", "path-traversal"],
  },
  {
    id: "B006",
    name: "Optimize ContextCompactor for 1000+ messages",
    category: "performance_optimization",
    description:
      "Profile and optimize ContextCompactor to handle 1000+ messages within 100ms while preserving correctness.",
    setupCommands: [],
    expectedOutput: {
      type: "test_pass",
      cliCommand: "npx jest --config jest.config.cjs --testPathPattern=compaction --passWithNoTests 2>&1",
    },
    timeoutMs: 120000,
    maxTurns: 12,
    difficulty: "hard",
    tags: ["performance", "optimization", "compaction"],
  },
  {
    id: "B007",
    name: "Update project dependencies with compatibility check",
    category: "dependency_update",
    description:
      "Update package.json dependencies to latest compatible versions and verify the project builds and tests pass.",
    setupCommands: [],
    expectedOutput: {
      type: "type_check",
    },
    timeoutMs: 120000,
    maxTurns: 8,
    difficulty: "easy",
    tags: ["dependencies", "npm", "compatibility"],
  },
  {
    id: "B008",
    name: "Document AI Provider API interface",
    category: "documentation",
    description:
      "Write JSDoc comments for the AIProvider interface and all implementing classes with usage examples.",
    setupCommands: [],
    expectedOutput: {
      type: "file_exists",
      filePath: "src/api/anthropic-provider.ts",
      regex: "@param|@returns|@example|@throws",
    },
    timeoutMs: 60000,
    maxTurns: 5,
    difficulty: "easy",
    tags: ["documentation", "jsdoc", "api-docs"],
  },
  {
    id: "B009",
    name: "Code review: identify bugs in PR manager",
    category: "code_review",
    description:
      "Review the PRManager class for bugs, security issues, and code smells. List findings with severity and fix suggestions.",
    setupCommands: [],
    expectedOutput: {
      type: "regex_match",
      regex: "bug|issue|vulnerability|improvement|severity",
      cliCommand: "echo 'Review complete: No critical issues found'",
    },
    timeoutMs: 60000,
    maxTurns: 8,
    difficulty: "medium",
    tags: ["code-review", "security", "quality"],
  },
  {
    id: "B010",
    name: "Integrate provider health check into AgentBridge",
    category: "api_integration",
    description:
      "Integrate the provider health check API into AgentBridge to validate provider connectivity on session init.",
    setupCommands: [],
    expectedOutput: {
      type: "type_check",
    },
    timeoutMs: 60000,
    maxTurns: 10,
    difficulty: "medium",
    tags: ["integration", "health-check", "provider"],
  },
  {
    id: "B011",
    name: "Implement session export to Markdown format",
    category: "code_generation",
    description:
      "Implement a session export function that converts session data to well-formatted Markdown with conversation history.",
    setupCommands: [],
    expectedOutput: {
      type: "type_check",
    },
    timeoutMs: 60000,
    maxTurns: 8,
    difficulty: "medium",
    tags: ["export", "markdown", "session", "feature"],
  },
  {
    id: "B012",
    name: "TypeScript strict mode migration",
    category: "refactoring",
    description:
      "Enable TypeScript strict mode across the project and fix all resulting type errors without changing runtime behavior.",
    setupCommands: [],
    expectedOutput: {
      type: "type_check",
    },
    timeoutMs: 120000,
    maxTurns: 20,
    difficulty: "hard",
    tags: ["typescript", "strict", "type-safety", "refactoring"],
  },
];