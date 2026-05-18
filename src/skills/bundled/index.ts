/**
 * Bundled skills for agent_1 — DeepSeek-optimized.
 *
 * Each skill is a slash-command that expands into a detailed system prompt.
 * Optimized for DeepSeek: concise prompts, explicit instructions,
 * no Anthropic-specific concepts (prompt caching, thinking budget, etc.).
 */

import { registerBundledSkill } from "../bundled-skills.js";

// ============================================================================
// /code-review
// ============================================================================

function registerCodeReview(): void {
  registerBundledSkill({
    name: "code-review",
    description: "Review code for quality, security, and maintainability",
    aliases: ["review", "cr"],
    argumentHint: "[path or focus area]",
    allowedTools: ["Read", "Grep", "Glob", "Bash"],
    async getPromptForCommand(args) {
      return [
        {
          type: "text",
          text: `Perform a thorough code review${args ? ` focusing on: ${args}` : ""}.

## Review checklist
1. **Security**: SQL injection, XSS, hardcoded secrets, path traversal, auth bypass, CSRF
2. **Correctness**: logic errors, edge cases, null/undefined handling, race conditions
3. **Quality**: naming clarity, function size (<50 lines), file cohesion (<800 lines), nesting depth (<4 levels)
4. **Error handling**: explicit error propagation, no swallowed errors, user-friendly messages
5. **Performance**: N+1 queries, missing pagination, unnecessary allocations, sync blocking
6. **Test coverage**: identify untested paths, suggest test cases

## Output format
For each issue found:
- **Severity**: CRITICAL | HIGH | MEDIUM | LOW
- **File**: path + line
- **Issue**: what's wrong
- **Fix**: concrete code suggestion
- **Test**: how to verify the fix

Focus on actionable findings. Skip style nits that a formatter would catch.`,
        },
      ];
    },
  });
}

// ============================================================================
// /plan
// ============================================================================

function registerPlan(): void {
  registerBundledSkill({
    name: "plan",
    description: "Create an implementation plan before writing code",
    aliases: ["design"],
    argumentHint: "[feature description]",
    allowedTools: ["Read", "Grep", "Glob", "Bash"],
    async getPromptForCommand(args) {
      return [
        {
          type: "text",
          text: `Create a step-by-step implementation plan${args ? ` for: ${args}` : " for the requested feature"}.

## Before planning
1. Explore existing code: Read relevant files, Grep for related patterns, Glob for file structure
2. Identify existing abstractions to reuse
3. Map data flow and dependencies

## Plan structure
1. **Architecture overview** — what changes, what stays, component diagram (ASCII)
2. **Files to create/modify** — each with rationale
3. **Data flow** — inputs → processing → outputs
4. **Dependencies** — what must be done first, what can be parallel
5. **Risks** — what could go wrong, mitigation
6. **Test strategy** — what to test at each layer

## Rules
- Prefer editing existing files over creating new ones
- No half-finished abstractions — three similar lines > premature abstraction
- Default to no comments — only explain WHY, never WHAT
- No feature flags or backward-compat shims`,
        },
      ];
    },
  });
}

// ============================================================================
// /tdd
// ============================================================================

function registerTdd(): void {
  registerBundledSkill({
    name: "tdd",
    description: "Write tests first, then implement (test-driven development)",
    aliases: ["test-first"],
    argumentHint: "[function or module to test]",
    allowedTools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
    async getPromptForCommand(args) {
      return [
        {
          type: "text",
          text: `Follow test-driven development${args ? ` for: ${args}` : ""}.

## Workflow
1. **RED** — Write a failing test first
   - Use the project's existing test framework
   - Follow existing test patterns and conventions
   - Test one behavior per test case
   - Use AAA pattern: Arrange → Act → Assert
   - Name tests descriptively: "returns empty array when no results match"

2. **GREEN** — Write minimal code to pass the test
   - Only implement what the test needs
   - Don't add features the test doesn't cover

3. **REFACTOR** — Improve the code
   - Remove duplication
   - Improve naming
   - Keep tests passing

4. **VERIFY** — Check coverage
   - Run the full test suite
   - Target 80%+ coverage for new code
   - Check for edge cases: null, empty, boundary values

## Rules
- Never modify tests to match broken implementation
- Mock external dependencies (API, DB, FS) but NOT the code under test
- Integration tests must hit real dependencies where practical`,
        },
      ];
    },
  });
}

// ============================================================================
// /security-review
// ============================================================================

function registerSecurityReview(): void {
  registerBundledSkill({
    name: "security-review",
    description: "Security audit — secrets, injection, auth, OWASP Top 10",
    aliases: ["security", "sec"],
    argumentHint: "[path or module]",
    allowedTools: ["Read", "Grep", "Glob", "Bash"],
    async getPromptForCommand(args) {
      return [
        {
          type: "text",
          text: `Perform a security audit${args ? ` of: ${args}` : " of the current changes"}.

## Audit checklist (OWASP Top 10 + common)

### Secrets
- Pattern search: \`sk-\`, \`ghp_\`, \`AKIA\`, \`Bearer\`, \`password\`, \`secret\`, \`token\`
- Check for hardcoded API keys, JWT secrets, database passwords
- Verify .env.example exists without real values

### Injection
- SQL: any string concatenation in queries? Use parameterized queries
- Command: any user input passed to exec/spawn? Use argument arrays
- Path: any user-controlled file paths? Validate with allowlist

### Auth & Session
- Rate limiting on login endpoints
- Session token rotation on privilege change
- CSRF protection on state-changing endpoints

### Data Exposure
- Error messages: do they leak stack traces, paths, or internal state?
- Logging: are PII or credentials logged?
- Response size: any unbounded queries?

### Input Validation
- Validate at system boundaries
- Schema-based validation, not ad-hoc checks
- Fail fast with clear errors

## Output
For each finding: severity (CRITICAL/HIGH/MEDIUM/LOW), location, description, fix, and verification.`,
        },
      ];
    },
  });
}

// ============================================================================
// /explain
// ============================================================================

function registerExplain(): void {
  registerBundledSkill({
    name: "explain",
    description: "Explain how code works — architecture, data flow, key decisions",
    aliases: ["what", "why"],
    argumentHint: "[file, function, or concept]",
    allowedTools: ["Read", "Grep", "Glob"],
    async getPromptForCommand(args) {
      return [
        {
          type: "text",
          text: `Explain the code${args ? `: ${args}` : "base"}.

## What to cover
1. **Purpose**: what problem does this solve?
2. **Architecture**: how do the pieces fit together?
3. **Data flow**: what travels through the system?
4. **Key decisions**: why was it built this way? (trade-offs, constraints)
5. **Dependencies**: what does it depend on? what depends on it?

## Style
- Start with a one-sentence summary
- Use concrete examples, not abstract descriptions
- Point to specific files and line numbers
- Mention gotchas or non-obvious behavior
- Keep it tight — prefer short paragraphs`,
        },
      ];
    },
  });
}

// ============================================================================
// /simplify
// ============================================================================

function registerSimplify(): void {
  registerBundledSkill({
    name: "simplify",
    description: "Refactor code for clarity — reduce complexity, improve naming",
    aliases: ["refactor", "clean"],
    argumentHint: "[file or module to simplify]",
    allowedTools: ["Read", "Write", "Edit", "Bash", "Grep"],
    async getPromptForCommand(args) {
      return [
        {
          type: "text",
          text: `Simplify the code${args ? ` in: ${args}` : ""} while preserving behavior.

## Goals
1. **Reduce complexity**: extract helpers, flatten nesting, early returns
2. **Improve naming**: make intent obvious at call sites
3. **Remove dead code**: unused imports, unreachable branches, stale comments
4. **Consolidate duplicates**: three similar blocks → one parameterized function
5. **Shrink files**: split >800 line modules by responsibility

## What NOT to do
- Don't change behavior — this is a refactor, not a feature
- Don't add abstractions "for the future" (YAGNI)
- Don't add comments that describe WHAT the code does
- Don't rename public APIs without checking all call sites

## Verification
- Run existing tests before and after
- If no tests exist, note this but don't create them now
- Git diff should show only structural changes, no logic changes`,
        },
      ];
    },
  });
}

// ============================================================================
// /debug
// ============================================================================

function registerDebug(): void {
  registerBundledSkill({
    name: "debug",
    description: "Systematic debugging — reproduce, isolate, fix, verify",
    aliases: ["fix", "bug"],
    argumentHint: "[bug description or error message]",
    allowedTools: [
      "Read", "Write", "Edit", "Bash", "Grep", "Glob",
    ],
    async getPromptForCommand(args) {
      return [
        {
          type: "text",
          text: `Debug systematically${args ? `: ${args}` : " the reported issue"}.

## Process
1. **Reproduce**: can you trigger the bug? document exact steps
2. **Isolate**: bisect to find the exact change or condition that causes it
3. **Understand**: trace the code path — what should happen vs what does happen
4. **Fix**: minimal change that resolves the root cause
5. **Verify**: confirm fix works, check for regressions

## Common patterns to check
- Null/undefined access (missing guards)
- Async race conditions (missing await, wrong order)
- State mutation surprises (shared mutable state)
- Error swallowing (empty catch blocks)
- Type coercion bugs (== vs ===, falsy checks)
- Off-by-one errors (loop boundaries, slice indices)
- Environment differences (paths, env vars, platform)

## Output
- Root cause (one sentence)
- Fix (minimal code change)
- Prevention (how to catch this earlier next time)`,
        },
      ];
    },
  });
}

// ============================================================================
// /init-project
// ============================================================================

function registerInitProject(): void {
  registerBundledSkill({
    name: "init-project",
    description: "Initialize a project by creating .agent_1.md with full context",
    aliases: ["init", "setup"],
    argumentHint: "[project path — defaults to current directory]",
    allowedTools: ["Read", "Write", "Bash", "Grep", "Glob"],
    async getPromptForCommand(_args) {
      return [
        {
          type: "text",
          text: `Initialize this project by scanning the codebase and creating a comprehensive .agent_1.md file.

## What to document
1. **Project overview**: purpose, tech stack, key dependencies
2. **Architecture**: directory structure, key modules and their roles, data flow
3. **Entry points**: main files, build config, test config
4. **Coding conventions**: naming, file organization, error handling patterns
5. **Commands**: build, test, lint, format, deploy
6. **Environment**: required env vars, services, tools
7. **Gotchas**: known tricky areas, constraints, unwritten rules

## Format
- Write to .agent_1.md in the project root
- Use concise bullet points, not essays
- Include exact commands the model should run
- Reference specific files with brief descriptions
- Keep it under 200 lines — it's a cheat sheet, not a novel`,
        },
      ];
    },
  });
}

// ============================================================================
// Init all
// ============================================================================

export function initBundledSkills(): void {
  registerCodeReview();
  registerPlan();
  registerTdd();
  registerSecurityReview();
  registerExplain();
  registerSimplify();
  registerDebug();
  registerInitProject();
}
