import { randomUUID } from "crypto";
import { AgentBridge } from "./agent-bridge.js";
import { CLITransport } from "./cli-transport.js";
import type {
  BridgeConfig,
  BridgeTransport,
  TransportKind,
} from "./types.js";
import { createQueryEngine, type QueryEngineImpl } from "../engine/index.js";
import { ConfigStore } from "../storage/index.js";
import type { Config } from "../types/index.js";

// ============================================================================
// Bridge Factory
// ============================================================================

export { AgentBridge } from "./agent-bridge.js";
export { CLITransport } from "./cli-transport.js";
export { makeMessage } from "./cli-transport.js";
export type {
  BridgeMessage,
  BridgeMessageType,
  BridgeTransport,
  BridgeConfig,
  TransportKind,
  UserInputPayload,
  AssistantOutputPayload,
  ToolExecutionPayload,
  StatusUpdatePayload,
  ErrorPayload,
  AbortPayload,
  ControlPayload,
} from "./types.js";

export interface CreateBridgeOptions {
  /** Project working directory. Defaults to process.cwd(). */
  projectPath?: string;
  /** Transport kind. Determines which transport implementation is created. */
  transport?: TransportKind;
  /** When true, output structured JSON (one object per line) to stdout. */
  structuredOutput?: boolean;
  /** When true, disable all ANSI color/styling in CLI output. */
  noColor?: boolean;
  /** When true, skip interactive prompts (headless mode). */
  noInteractive?: boolean;
  /** Optional initial prompt for headless / SDK mode. */
  initialPrompt?: string;
  /** WebSocket server port. Defaults to 3099. Only used for "websocket" transport. */
  websocketPort?: number;
  /** Optional session ID. Auto-generated if not provided. */
  sessionId?: string;
  /** Optional engine config override. Loaded from ConfigStore if not provided. */
  config?: Config;
}

export interface BridgeInstance {
  bridge: AgentBridge;
  transport: BridgeTransport;
  config: BridgeConfig;
}

/**
 * Create a fully wired AgentBridge with the appropriate transport.
 *
 * This is the primary factory function. It handles:
 * 1. Loading or accepting configuration
 * 2. Creating the correct transport for the requested kind
 * 3. Instantiating the QueryEngine
 * 4. Wiring everything together via AgentBridge
 *
 * Usage:
 *
 * ```typescript
 * // CLI mode (default)
 * const { bridge } = createBridge();
 * await bridge.start();
 *
 * // SDK / programmatic mode
 * const { bridge } = createBridge({
 *   transport: "sdk",
 *   noInteractive: true,
 *   initialPrompt: "Fix the lint errors in src/",
 * });
 * await bridge.start();
 * ```
 */
export function createBridge(options: CreateBridgeOptions = {}): BridgeInstance {
  const projectPath = options.projectPath ?? process.cwd();
  const transportKind = options.transport ?? "cli";
  const structuredOutput = options.structuredOutput ?? false;
  const noColor =
    options.noColor ??
    (process.env.AGENT_1_NO_COLOR === "true" ||
      process.env.NO_COLOR !== undefined);
  const noInteractive = options.noInteractive ?? false;
  const sessionId =
    options.sessionId ?? randomUUID().replace(/-/g, "").slice(0, 16);
  const websocketPort = options.websocketPort ?? 3099;

  // Load config
  const configStore = new ConfigStore();
  const appConfig = options.config ?? configStore.load();

  const bridgeConfig: BridgeConfig = {
    sessionId,
    projectPath,
    transport: transportKind,
    websocketPort,
    structuredOutput,
    noColor,
    noInteractive,
    initialPrompt: options.initialPrompt,
  };

  // Create engine
  const engine = createQueryEngine(appConfig);

  // Create transport
  const transport = createTransport(transportKind, bridgeConfig);

  // Wire bridge
  const bridge = new AgentBridge(engine, transport, bridgeConfig);

  return { bridge, transport, config: bridgeConfig };
}

// ============================================================================
// Transport factory (internal)
// ============================================================================

function createTransport(
  kind: TransportKind,
  config: BridgeConfig,
): BridgeTransport {
  switch (kind) {
    case "cli":
      return new CLITransport({
        input: process.stdin,
        output: process.stdout,
        prompt: "> ",
        structuredOutput: config.structuredOutput,
        noColor: config.noColor,
      });

    case "websocket":
      // WebSocket transport is not implemented in this version.
      // Falls back to a CLI transport with a warning.
      console.warn(
        "[bridge] WebSocket transport not yet implemented. Falling back to CLI.",
      );
      return new CLITransport({
        input: process.stdin,
        output: process.stdout,
        prompt: "> ",
        structuredOutput: config.structuredOutput,
        noColor: config.noColor,
      });

    case "sdk":
      // SDK transport: uses CLI transport but in structured (JSON-line) mode
      // and non-interactive — the SDK caller handles I/O externally.
      return new CLITransport({
        input: process.stdin,
        output: process.stdout,
        prompt: "",
        structuredOutput: true,
        noColor: true,
      });

    default:
      throw new Error(`Unknown transport kind: ${kind}`);
  }
}
