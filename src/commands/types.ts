import type { QueryEngineImpl } from "../engine/query-engine.js";
import type { Config, Session } from "../types/index.js";

export interface CommandContext {
  engine: QueryEngineImpl;
  config: Config;
  session: Session | null;
  projectPath: string;
  platform: { os: string; terminal: string };
  /** Output text directly to the transport (CLI/user-facing). */
  output: (text: string) => void;
  /** Whether a query is currently in-flight. */
  getPendingResponse: () => boolean;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  /** If set, this prompt text is injected as a user query to the engine. */
  prompt?: string;
  /** If true, the session should exit. */
  stopSession?: boolean;
}

export interface CommandModule {
  readonly name: string;
  readonly aliases: string[];
  readonly description: string;
  readonly argumentHint: string;
  execute(args: string, context: CommandContext): Promise<CommandResult>;
}
