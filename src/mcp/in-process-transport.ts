/**
 * InProcessTransport — run an MCP server within the same Node.js process.
 *
 * Adapted from Claude Code's services/mcp/InProcessTransport.ts.
 * Used for built-in MCP servers (e.g., memory, file-system, project tools)
 * that don't need a separate process.
 */

import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InProcessServer {
  /** Handle a JSON-RPC request and return a response */
  handleRequest(request: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Handle a JSON-RPC notification (no response expected) */
  handleNotification?(notification: Record<string, unknown>): void;
  /** List available tools */
  listTools?(): Array<{
    name: string;
    description: string;
    inputSchema: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  }>;
  /** List available resources */
  listResources?(): Array<{
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
  }>;
  /** List available prompts */
  listPrompts?(): Array<{
    name: string;
    description?: string;
    arguments?: Array<{
      name: string;
      description?: string;
      required?: boolean;
    }>;
  }>;
}

export interface InProcessTransportOptions {
  serverName: string;
  server: InProcessServer;
  /** Tool names to expose (empty = all) */
  allowedTools?: string[];
  /** Tool names to block */
  blockedTools?: string[];
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export class InProcessTransport extends EventEmitter {
  private options: InProcessTransportOptions;
  private connected = false;
  private requestId = 0;

  constructor(options: InProcessTransportOptions) {
    super();
    this.options = options;
  }

  get serverName(): string {
    return this.options.serverName;
  }

  async connect(): Promise<void> {
    // In-process servers just need validation that the server object is valid
    if (!this.options.server || typeof this.options.server.handleRequest !== "function") {
      throw new Error(
        `InProcess MCP server "${this.options.serverName}": server must implement handleRequest()`,
      );
    }
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Send a JSON-RPC request to the in-process server.
   */
  async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) {
      throw new Error(`InProcess MCP server "${this.options.serverName}" not connected`);
    }

    const id = ++this.requestId;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      params: params || {},
    };

    try {
      const response = await this.options.server.handleRequest(request);
      if (response.error) {
        const err = response.error as { code: number; message: string };
        throw new Error(`MCP Error ${err.code}: ${err.message}`);
      }
      return response.result;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith("MCP Error")) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`InProcess MCP server "${this.options.serverName}" error: ${msg}`);
    }
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.connected) return;

    const notification = {
      jsonrpc: "2.0",
      method,
      params: params || {},
    };

    if (this.options.server.handleNotification) {
      this.options.server.handleNotification(notification);
    }
  }

  /**
   * Call a tool on the in-process server.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }> {
    if (this.options.blockedTools?.includes(name)) {
      return {
        content: [{ type: "text", text: `Tool "${name}" is blocked` }],
        isError: true,
      };
    }

    if (
      this.options.allowedTools &&
      this.options.allowedTools.length > 0 &&
      !this.options.allowedTools.includes(name)
    ) {
      return {
        content: [{ type: "text", text: `Tool "${name}" is not in the allowed list` }],
        isError: true,
      };
    }

    const result = await this.sendRequest("tools/call", { name, arguments: args });
    return result as {
      content: Array<{ type: "text"; text: string }>;
      isError?: boolean;
    };
  }

  /**
   * Get tools from the in-process server.
   */
  async listTools(): Promise<
    Array<{
      name: string;
      description: string;
      inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
      };
    }>
  > {
    if (this.options.server.listTools) {
      let tools = this.options.server.listTools();
      if (this.options.allowedTools && this.options.allowedTools.length > 0) {
        tools = tools.filter((t) => this.options.allowedTools!.includes(t.name));
      }
      if (this.options.blockedTools) {
        tools = tools.filter((t) => !this.options.blockedTools!.includes(t.name));
      }
      return tools;
    }

    // Fall back to MCP protocol tools/list
    const result = (await this.sendRequest("tools/list")) as {
      tools: Array<{
        name: string;
        description: string;
        inputSchema: {
          type: "object";
          properties: Record<string, unknown>;
          required?: string[];
        };
      }>;
    };
    return result.tools || [];
  }

  /**
   * Get resources from the in-process server.
   */
  async listResources(): Promise<
    Array<{
      uri: string;
      name: string;
      description?: string;
      mimeType?: string;
    }>
  > {
    if (this.options.server.listResources) {
      return this.options.server.listResources();
    }

    try {
      const result = (await this.sendRequest("resources/list")) as {
        resources: Array<{
          uri: string;
          name: string;
          description?: string;
          mimeType?: string;
        }>;
      };
      return result.resources || [];
    } catch {
      return [];
    }
  }

  /**
   * Get prompts from the in-process server.
   */
  async listPrompts(): Promise<
    Array<{
      name: string;
      description?: string;
      arguments?: Array<{
        name: string;
        description?: string;
        required?: boolean;
      }>;
    }>
  > {
    if (this.options.server.listPrompts) {
      return this.options.server.listPrompts();
    }

    try {
      const result = (await this.sendRequest("prompts/list")) as {
        prompts: Array<{
          name: string;
          description?: string;
          arguments?: Array<{
            name: string;
            description?: string;
            required?: boolean;
          }>;
        }>;
      };
      return result.prompts || [];
    } catch {
      return [];
    }
  }
}
