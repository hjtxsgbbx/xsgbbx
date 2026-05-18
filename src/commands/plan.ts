import type { CommandModule } from "./types.js";

const PLAN_PROMPT = `Restate the requirements, assess risks, and create a step-by-step implementation plan.
1. Restate what we're building and why
2. Identify dependencies and potential risks
3. Break down into phases with clear deliverables
4. Estimate effort for each phase
5. Define acceptance criteria

Do NOT write any code yet. Present the plan for user confirmation before proceeding.`;

const command: CommandModule = {
  name: "/plan",
  aliases: [],
  description: "Create step-by-step implementation plan",
  argumentHint: "[task description]",
  async execute(args, _ctx) {
    const prompt = args ? `${PLAN_PROMPT}\n\nTask: ${args}` : PLAN_PROMPT;
    return {
      success: true,
      prompt,
      message: "Creating plan...",
    };
  },
};
export default command;
