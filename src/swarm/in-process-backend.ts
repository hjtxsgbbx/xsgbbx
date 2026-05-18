/**
 * In-Process Teammate Backend
 *
 * Implements TeammateExecutor using Node.js AsyncLocalStorage for
 * context isolation between teammates running in the same OS process.
 *
 * Each spawned teammate gets:
 *  - A unique AbortController for lifecycle management
 *  - An AsyncLocalStorage context store for request-scoped state
 *  - A tracked entry in the spawnedTeammates map
 *
 * This is the only backend currently implemented. Future backends
 * (tmux, iTerm2, remote HTTP) would also implement TeammateExecutor.
 */

import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import type {
  TeammateExecutor,
  TeammateSpawnConfig,
  TeammateSpawnResult,
  TeammateMessage,
  TeammateState,
  TeammateStatus,
  QueryRunner,
} from "./types.js";

// ---------------------------------------------------------------------------
// Context Store
// ---------------------------------------------------------------------------

/** Per-teammate context stored in AsyncLocalStorage. */
interface TeammateContext {
  agentId: string;
  teamName: string;
  agentName: string;
  startTime: number;
}

/** AsyncLocalStorage instance shared by all in-process teammates. */
const teammateContextStore = new AsyncLocalStorage<TeammateContext>();

/**
 * Get the current teammate's context from AsyncLocalStorage.
 * Returns undefined if called outside a teammate's execution scope.
 */
export function getCurrentTeammateContext(): TeammateContext | undefined {
  return teammateContextStore.getStore();
}

/**
 * Run a function within a teammate's AsyncLocalStorage context.
 */
export function runInTeammateContext<T>(
  ctx: TeammateContext,
  fn: () => T,
): T {
  return teammateContextStore.run(ctx, fn);
}

// ---------------------------------------------------------------------------
// InProcessBackend
// ---------------------------------------------------------------------------

export class InProcessBackend implements TeammateExecutor {
  /** Map of agentId → live state for all spawned teammates. */
  private spawnedTeammates: Map<string, TeammateState> = new Map();

  // ---- TeammateExecutor implementation ----

  isAvailable(): boolean {
    // In-process backend is always available since it runs in the same
    // Node.js process with no external dependencies.
    return true;
  }

  spawn(config: TeammateSpawnConfig): TeammateSpawnResult {
    const agentId = `teammate_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const controller = new AbortController();

    const state: TeammateState = {
      agentId,
      identity: { ...config.identity },
      status: "spawning" as TeammateStatus,
      startTime: Date.now(),
      controller,
      turnCount: 0,
    };

    this.spawnedTeammates.set(agentId, state);

    // Transition to "running" on next microtask so callers see "spawning"
    // first if they check immediately.
    queueMicrotask(() => {
      const current = this.spawnedTeammates.get(agentId);
      if (current && current.status === "spawning") {
        current.status = "running";
      }
    });

    return {
      success: true,
      agentId,
      abortController: controller,
      taskId: agentId,
    };
  }

  async sendMessage(
    agentId: string,
    message: TeammateMessage,
  ): Promise<void> {
    const state = this.spawnedTeammates.get(agentId);
    if (!state) {
      throw new Error(
        `Teammate not found: ${agentId}. Active: ${[...this.spawnedTeammates.keys()].join(", ") || "(none)"}`,
      );
    }

    // Store the last message for status checking
    state.lastMessage = message;

    // The message delivery is handled by the mailbox system (teammate-mailbox.ts).
    // This method exists so the executor interface is the single entry point;
    // actual persistence is delegated.
  }

  async terminate(agentId: string): Promise<void> {
    const state = this.spawnedTeammates.get(agentId);
    if (!state) return;

    state.status = "terminated";
    state.endTime = Date.now();

    // Give the teammate a chance to finish its current turn.
    // We signal termination but don't force-abort immediately.
    try {
      state.controller.abort();
    } catch {
      // Controller may already be aborted — that's fine.
    }

    // Remove from tracking after a brief grace period for cleanup.
    setTimeout(() => {
      this.spawnedTeammates.delete(agentId);
    }, 100);
  }

  kill(agentId: string): void {
    const state = this.spawnedTeammates.get(agentId);
    if (!state) return;

    state.status = "terminated";
    state.endTime = Date.now();

    try {
      state.controller.abort();
    } catch {
      // Already aborted — no-op.
    }

    this.spawnedTeammates.delete(agentId);
  }

  isActive(agentId: string): boolean {
    const state = this.spawnedTeammates.get(agentId);
    if (!state) return false;

    try {
      return !state.controller.signal.aborted;
    } catch {
      return false;
    }
  }

  getState(agentId: string): TeammateState | undefined {
    return this.spawnedTeammates.get(agentId);
  }

  listTeammates(): TeammateState[] {
    return [...this.spawnedTeammates.values()];
  }

  // ---- Query Loop ----

  /**
   * Run a multi-turn query loop for a spawned teammate.
   *
   * This is the core execution method. It sends the initial prompt to the
   * query runner, then loops: receive response, process tool calls (if any),
   * send follow-up, repeat. The loop exits when:
   *  - The runner returns a final response (no more tool calls needed)
   *  - The AbortController is triggered
   *  - maxTurns is reached
   *
   * @returns The final text output from the teammate.
   */
  async runQueryLoop(
    agentId: string,
    config: TeammateSpawnConfig,
    queryRunner: QueryRunner,
  ): Promise<string> {
    const state = this.spawnedTeammates.get(agentId);
    if (!state) {
      throw new Error(`Teammate not found: ${agentId}`);
    }

    const maxTurns = config.permissions?.maxTurns ?? 20;
    const timeoutMs = config.permissions?.timeoutMs ?? 300_000; // 5 min default
    const signal = state.controller.signal;

    // Create the AsyncLocalStorage context for this teammate
    const ctx: TeammateContext = {
      agentId,
      teamName: config.identity.teamName,
      agentName: config.identity.name,
      startTime: Date.now(),
    };

    return runInTeammateContext(ctx, async () => {
      // Set up timeout
      const timeoutId = timeoutMs > 0
        ? setTimeout(() => {
            state.controller.abort();
          }, timeoutMs)
        : null;

      try {
        state.status = "running";

        // Build the full prompt with teammate system addendum
        const fullPrompt = this.buildPrompt(config);

        let currentInput = fullPrompt;
        let finalOutput = "";

        for (let turn = 0; turn < maxTurns; turn++) {
          if (signal.aborted) {
            finalOutput = "[Teammate terminated]";
            break;
          }

          state.turnCount = turn + 1;

          try {
            const response = await queryRunner(currentInput, signal);
            finalOutput = response;

            // Simple heuristic: if the response doesn't indicate tool use,
            // consider it the final answer.
            // In a full implementation, the query runner would return
            // structured data including tool calls.
            if (!this.looksLikeToolUse(response)) {
              break;
            }

            // For tool-use responses, feed the result back as context
            // and continue the loop so the teammate can process it.
            currentInput = response;
          } catch (err: unknown) {
            if (signal.aborted) {
              finalOutput = "[Teammate terminated by signal]";
              break;
            }
            const msg = err instanceof Error ? err.message : String(err);
            finalOutput = `[Teammate error on turn ${turn + 1}]: ${msg}`;
            state.status = "failed";
            break;
          }
        }

        if (state.turnCount >= maxTurns && state.status === "running") {
          finalOutput +=
            "\n[Max turns reached — teammate loop terminated]";
        }

        state.status = state.status === "failed" ? "failed" : "completed";
        state.endTime = Date.now();
        return finalOutput;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    });
  }

  // ---- Private Helpers ----

  /**
   * Build the full prompt for a teammate, combining the task prompt
   * with any custom system prompt addendum.
   */
  private buildPrompt(config: TeammateSpawnConfig): string {
    const { identity, prompt, systemPrompt, systemPromptMode } = config;

    const header = [
      `[Teammate: ${identity.name}]`,
      `[Team: ${identity.teamName}]`,
      "",
    ].join("\n");

    const footer = [
      "",
      "---",
      `You are teammate "${identity.name}" in team "${identity.teamName}".`,
      "Complete your assigned task and report back.",
      "If you need permission for an action, request it via the permission system.",
    ].join("\n");

    if (!systemPrompt) {
      return `${header}${prompt}${footer}`;
    }

    switch (systemPromptMode ?? "append") {
      case "replace":
        return `${systemPrompt}\n\n${prompt}`;
      case "merge":
        return `${header}${systemPrompt}\n\n---\n\n${prompt}${footer}`;
      case "append":
      default:
        return `${header}${prompt}${footer}\n\n[Additional Instructions]\n${systemPrompt}`;
    }
  }

  /**
   * Crude heuristic to detect if an LLM response contains a tool-use request.
   * In production, tool calls come via structured function-calling responses,
   * not free-text. This is a fallback for plain-text completion backends.
   */
  private looksLikeToolUse(response: string): boolean {
    // Check for JSON tool_use blocks commonly emitted by LLMs
    const toolUsePatterns = [
      /"tool_use"/i,
      /"name":\s*"(read|write|edit|bash|glob|grep|agent)"/i,
      /<tool_call>/i,
      /<function_call>/i,
    ];
    return toolUsePatterns.some((p) => p.test(response));
  }

  // ---- Cleanup ----

  /**
   * Terminate all active teammates. Called during shutdown.
   */
  shutdown(): void {
    for (const [agentId, state] of this.spawnedTeammates) {
      try {
        state.controller.abort();
      } catch {
        // Ignore abort errors during shutdown.
      }
      state.status = "terminated";
      state.endTime = Date.now();
    }
    this.spawnedTeammates.clear();
  }
}

/** Default singleton instance for the application. */
export const inProcessBackend = new InProcessBackend();
