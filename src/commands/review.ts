import type { CommandModule } from "./types.js";

const REVIEW_PROMPT = `Perform a thorough code review of the current project. Focus on:
1. Code quality and readability
2. Security vulnerabilities (injection, XSS, path traversal, hardcoded secrets)
3. Performance issues (N+1 queries, missing pagination, unbounded loops)
4. Error handling gaps (swallowed errors, missing try/catch, vague messages)
5. Test coverage gaps (untested edge cases, missing integration tests)
6. Best practices compliance (immutability, naming, file organization)

For each issue found, provide:
- File path and line reference
- Severity: CRITICAL | HIGH | MEDIUM | LOW
- Concrete, actionable fix recommendation

Start with a summary table, then detailed findings grouped by severity.`;

const command: CommandModule = {
  name: "/review",
  aliases: ["/r"],
  description: "Run code review on current project",
  argumentHint: "",
  async execute(_args, _ctx) {
    return {
      success: true,
      prompt: REVIEW_PROMPT,
      message: "Starting code review...",
    };
  },
};
export default command;
