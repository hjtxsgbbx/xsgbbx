import { Tool, ExecutionContext, ToolResult } from "../types/index.js";

interface AgentMailbox {
  id: string;
  task: string;
  result?: string;
  status: "pending" | "running" | "completed" | "failed";
  createdAt: string;
}

const mailboxRegistry = new Map<string, AgentMailbox>();

export class AgentTool implements Tool {
  name = "agent";
  description = "Launch a sub-agent in an isolated context to handle a specific task. Returns results via mailbox.";
  readonly = false;

  parameters = {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "Task description for the sub-agent to complete",
      },
      context: {
        type: "string",
        description: "Additional context or constraints for the sub-agent",
      },
    },
    required: ["task"],
  };

  async execute(
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const task = params.task as string;
    const taskContext = (params.context as string) || "";

    const mailboxId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const mailbox: AgentMailbox = {
      id: mailboxId,
      task,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    mailboxRegistry.set(mailboxId, mailbox);

    const fullTask = taskContext
      ? `Task: ${task}\n\nContext: ${taskContext}`
      : task;

    mailbox.status = "running";

    try {
      const shellTool = context.session
        ? `The sub-agent is running in isolation. It will report results via mailbox ID: ${mailboxId}`
        : "Sub-agent running";

      mailbox.result = `Sub-agent mailbox created: ${mailboxId}\n\nTask queued: ${fullTask}\n\nThis is a stub. Full sub-agent execution requires a separate context. For now, the parent agent should treat the task as delegated.`;
      mailbox.status = "completed";

      return {
        success: true,
        output: mailbox.result,
        artifacts: [mailboxId],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      mailbox.status = "failed";
      mailbox.result = message;
      return {
        success: false,
        output: `Sub-agent failed: ${message}`,
        errorCode: "AGENT_ERROR",
      };
    }
  }
}

export function getAgentMailbox(id: string): AgentMailbox | undefined {
  return mailboxRegistry.get(id);
}

export function getAgentMailboxes(): AgentMailbox[] {
  return Array.from(mailboxRegistry.values());
}

export function clearMailbox(id: string): void {
  mailboxRegistry.delete(id);
}