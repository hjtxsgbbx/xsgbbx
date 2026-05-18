import * as readline from "readline";
import type {
  BridgeMessage,
  BridgeMessageType,
  BridgeTransport,
} from "./types.js";

// ============================================================================
// CLI Transport — Terminal I/O via readline + stdout
// ============================================================================

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
} as const;

function colorize(text: string, code: string, enabled: boolean): string {
  return enabled ? `${code}${text}${ANSI.reset}` : text;
}

const STATE_LABELS: Record<string, string> = {
  thinking: "Thinking",
  compacting: "Compacting",
  "max-turns": "Max Turns",
  "task-completed": "Done",
  "permission-denied": "Permission Denied",
  "provider-select": "Provider",
};

const STATE_COLORS: Record<string, string> = {
  thinking: ANSI.cyan,
  compacting: ANSI.yellow,
  "max-turns": ANSI.yellow,
  "task-completed": ANSI.green,
  "permission-denied": ANSI.red,
  "provider-select": ANSI.magenta,
};

const TOOL_STATUS_COLORS: Record<string, string> = {
  executing: ANSI.cyan,
  success: ANSI.green,
  error: ANSI.red,
};

const TOOL_STATUS_SYMBOLS: Record<string, string> = {
  executing: " ... ",
  success: " ok  ",
  error: " ERR ",
};

export interface CLITransportOptions {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  prompt?: string;
  structuredOutput?: boolean;
  noColor?: boolean;
  header?: string;
}

/**
 * Implements BridgeTransport for a terminal CLI.
 *
 * Input comes from a readline interface (stdin by default).
 * Output goes to stdout formatted with ANSI colors unless `noColor` is set.
 * When `structuredOutput` is true, messages are emitted as JSON lines
 * for programmatic consumers.
 */
export class CLITransport implements BridgeTransport {
  private rl: readline.Interface;
  private handlers: Array<(msg: BridgeMessage) => void> = [];
  private closed = false;
  private readonly colorEnabled: boolean;
  private readonly isStructured: boolean;
  private readonly prompt: string;

  constructor(options: CLITransportOptions) {
    this.colorEnabled = !options.noColor;
    this.isStructured = options.structuredOutput ?? false;
    this.prompt = options.prompt ?? "> ";

    this.rl = readline.createInterface({
      input: options.input,
      output: options.output,
      terminal: true,
      prompt: this.colorEnabled
        ? `${ANSI.dim}${this.prompt}${ANSI.reset}`
        : this.prompt,
    });

    this.rl.on("line", (line: string) => {
      if (this.closed) return;
      const trimmed = line.trim();
      if (trimmed.length === 0) return;

      const isInterrupt = trimmed.startsWith(">>");
      const text = isInterrupt ? trimmed.slice(2).trimStart() : trimmed;

      this.dispatch({
        type: "user-input",
        sessionId: "",
        timestamp: new Date().toISOString(),
        payload: { text: text || trimmed, interrupt: isInterrupt },
      });
    });

    this.rl.on("close", () => {
      this.closed = true;
    });

    if (options.header) {
      this.writeLine(options.header);
    }
  }

  // --- BridgeTransport implementation ---

  send(message: BridgeMessage): void {
    if (this.closed) return;
    if (this.isStructured) {
      this.writeLine(JSON.stringify(message));
      return;
    }
    this.renderHumanReadable(message);
  }

  onMessage(handler: (msg: BridgeMessage) => void): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rl.close();
    this.handlers = [];
  }

  // --- Readline helpers ---

  promptForInput(): void {
    if (this.closed) return;
    this.rl.prompt();
  }

  pauseInput(): void {
    this.rl.pause();
  }

  resumeInput(): void {
    if (this.closed) return;
    this.rl.prompt();
  }

  // --- Private helpers ---

  private dispatch(message: BridgeMessage): void {
    for (const handler of this.handlers) {
      try {
        handler(message);
      } catch {
        // Handler errors should not affect other handlers
      }
    }
  }

  private writeLine(text: string): void {
    process.stdout.write(`${text}\n`);
  }

  private renderHumanReadable(message: BridgeMessage): void {
    switch (message.type) {
      case "assistant-output":
        this.renderAssistantOutput(message);
        break;
      case "tool-execution":
        this.renderToolExecution(message);
        break;
      case "status-update":
        this.renderStatusUpdate(message);
        break;
      case "error":
        this.renderError(message);
        break;
      case "abort":
        this.writeLine(colorize("  Interrupted", ANSI.yellow, this.colorEnabled));
        break;
      case "control":
        // Control messages are internal — no user-facing output
        break;
      default:
        break;
    }
  }

  private renderAssistantOutput(message: BridgeMessage): void {
    const payload = message.payload as {
      content: string;
      model: string;
      streaming?: boolean;
      done: boolean;
    };
    if (!payload) return;

    if (payload.streaming && !payload.done) {
      // Streaming chunk — print inline
      process.stdout.write(payload.content);
    } else if (payload.done) {
      // Final message — add trailing newline and model attribution
      if (payload.content) {
        this.writeLine(payload.content);
      }
      this.writeLine(
        colorize(
          `  [model: ${payload.model}]`,
          ANSI.dim,
          this.colorEnabled,
        ),
      );
    } else {
      this.writeLine(payload.content);
    }
  }

  private renderToolExecution(message: BridgeMessage): void {
    const payload = message.payload as {
      toolName: string;
      status: string;
      output: string;
    };
    if (!payload) return;

    const color = TOOL_STATUS_COLORS[payload.status] ?? ANSI.dim;
    const symbol = TOOL_STATUS_SYMBOLS[payload.status] ?? " ... ";
    const badge = colorize(`[${symbol}]`, color, this.colorEnabled);
    const name = colorize(payload.toolName, ANSI.bold, this.colorEnabled);

    this.writeLine(`${badge} ${name}`);

    if (payload.output && payload.output.trim()) {
      const maxLen = 300;
      const displayOutput =
        payload.output.length > maxLen
          ? payload.output.slice(0, maxLen) +
            colorize("... (truncated)", ANSI.gray, this.colorEnabled)
          : payload.output;
      this.writeLine(
        colorize(`       ${displayOutput}`, ANSI.dim, this.colorEnabled),
      );
    }
  }

  private renderStatusUpdate(message: BridgeMessage): void {
    const payload = message.payload as {
      state: string;
      model?: string;
      attempt?: number;
      detail?: string;
      files?: string[];
    };
    if (!payload) return;

    const label = STATE_LABELS[payload.state] ?? payload.state;
    const color = STATE_COLORS[payload.state] ?? ANSI.dim;
    const attemptStr = payload.attempt ? ` (attempt ${payload.attempt})` : "";
    const modelStr = payload.model ? ` [${payload.model}${attemptStr}]` : "";

    this.writeLine(
      `${colorize("  ●", color, this.colorEnabled)} ${colorize(label, ANSI.bold, this.colorEnabled)}${colorize(modelStr, ANSI.dim, this.colorEnabled)}`,
    );

    if (payload.detail) {
      this.writeLine(colorize(`    ${payload.detail}`, ANSI.dim, this.colorEnabled));
    }
    if (payload.files && payload.files.length > 0) {
      for (const file of payload.files.slice(0, 5)) {
        this.writeLine(
          colorize(`    ${file}`, ANSI.green, this.colorEnabled),
        );
      }
      if (payload.files.length > 5) {
        this.writeLine(
          colorize(
            `    ... and ${payload.files.length - 5} more`,
            ANSI.dim,
            this.colorEnabled,
          ),
        );
      }
    }
  }

  private renderError(message: BridgeMessage): void {
    const payload = message.payload as { message: string; code?: string };
    if (!payload) return;

    const codeLabel = payload.code ? `[${payload.code}] ` : "";
    this.writeLine(
      colorize(
        `  ! ${codeLabel}${payload.message}`,
        ANSI.red,
        this.colorEnabled,
      ),
    );
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a BridgeMessage with the given type and payload.
 * Fills in sessionId and timestamp automatically.
 */
export function makeMessage(
  type: BridgeMessageType,
  sessionId: string,
  payload: unknown,
): BridgeMessage {
  return {
    type,
    sessionId,
    timestamp: new Date().toISOString(),
    payload,
  };
}
