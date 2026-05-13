import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import {
  MCPTransport,
  MCPServerConfig,
  MCPInitializeRequest,
  MCPInitializeResponse,
  MCPListToolsRequest,
  MCPListToolsResponse,
  MCPCallToolRequest,
  MCPCallToolResponse,
  MCPToolDefinition,
  MCPTaskStatus,
  MCPTask,
  MCPTaskResult,
  MCPTasksCreateRequest,
  MCPTasksCreateResponse,
  MCPTasksGetRequest,
  MCPTasksGetResponse,
  MCPTasksCancelRequest,
  MCPTasksListRequest,
  MCPTasksListResponse,
  MCPTasksResultRequest,
  MCPTasksResultResponse,
  MCPRequest,
} from "./types.js";

interface MCPClientEvents {
  connected: () => void;
  disconnected: () => void;
  error: (message: string) => void;
  toolsDiscovered: (tools: MCPToolDefinition[]) => void;
}

export class MCPClient extends EventEmitter {
  private config: MCPServerConfig;
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }>();
  private buffer = "";
  private connected = false;
  private tools: MCPToolDefinition[] = [];

  constructor(config: MCPServerConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    if (this.config.transport === "stdio" && this.config.command) {
      return this.connectStdio();
    }

    throw new Error(`Unsupported transport: ${this.config.transport}`);
  }

  private connectStdio(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cmd = this.config.command!;
      const args = this.config.args || [];

      this.process = spawn(cmd, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      this.process.stdout?.on("data", (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        // MCP servers may use stderr for logging
      });

      this.process.on("error", (err) => {
        this.emit("error", `MCP server process error: ${err.message}`);
        reject(err);
      });

      this.process.on("close", (code) => {
        this.connected = false;
        this.emit("disconnected");
        this.processPendingRequests(new Error(`MCP server exited with code ${code}`));
      });

      this.initialize()
        .then(() => {
          this.connected = true;
          this.emit("connected");
          resolve();
        })
        .catch(reject);
    });
  }

  private async initialize(): Promise<void> {
    const initReq: MCPInitializeRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: true },
        clientInfo: {
          name: "agent_1",
          version: "1.0.0",
        },
      },
    };

    const response = await this.sendRequest(initReq) as MCPInitializeResponse;
    if (!response.result) {
      throw new Error("MCP initialize failed: invalid response");
    }

    // Send initialized notification (not a request, no id)
    this.sendRaw({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    // Discover tools
    await this.discoverTools();
  }

  private async discoverTools(): Promise<void> {
    const listReq: MCPListToolsRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "tools/list",
    };

    const response = await this.sendRequest(listReq) as MCPListToolsResponse;
    this.tools = response.result?.tools || [];
    this.emit("toolsDiscovered", this.tools);
  }

  getTools(): MCPToolDefinition[] {
    return [...this.tools];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const callReq: MCPCallToolRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "tools/call",
      params: { name, arguments: args },
    };

    const response = await this.sendRequest(callReq) as MCPCallToolResponse;
    const contents = response.result?.content || [];

    if (response.result?.isError) {
      return `Error: ${contents.map(c => c.text || "").join("\n")}`;
    }

    return contents
      .filter(c => c.type === "text")
      .map(c => c.text || "")
      .join("\n");
  }

  async createTask(
    title: string,
    description?: string
  ): Promise<{ taskId: string; status: MCPTaskStatus }> {
    const createReq: MCPTasksCreateRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "tasks/create",
      params: { title, description },
    };

    const response = await this.sendRequest(createReq) as MCPTasksCreateResponse;
    return response.result;
  }

  async getTask(taskId: string): Promise<MCPTask> {
    const getReq: MCPTasksGetRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "tasks/get",
      params: { taskId },
    };

    const response = await this.sendRequest(getReq) as MCPTasksGetResponse;
    return response.result;
  }

  async cancelTask(taskId: string): Promise<void> {
    const cancelReq: MCPTasksCancelRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "tasks/cancel",
      params: { taskId },
    };

    await this.sendRequest(cancelReq);
  }

  async listTasks(): Promise<MCPTask[]> {
    const listReq: MCPTasksListRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "tasks/list",
    };

    const response = await this.sendRequest(listReq) as MCPTasksListResponse;
    return response.result?.tasks || [];
  }

  async getTaskResult(taskId: string): Promise<MCPTaskResult> {
    const resultReq: MCPTasksResultRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "tasks/result",
      params: { taskId },
    };

    const response = await this.sendRequest(resultReq) as MCPTasksResultResponse;
    return response.result;
  }

  private sendRequest(request: MCPRequest): Promise<unknown> {
    const id = request.id;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.sendRaw(request);
    });
  }

  private sendRaw(message: MCPRequest | Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) {
      throw new Error("MCP connection not ready");
    }
    const data = JSON.stringify(message) + "\n";
    this.process.stdin.write(data);
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        this.handleMessage(message);
      } catch {
        // Ignore non-JSON lines (logging output)
      }
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    if (message.id !== undefined && this.pendingRequests.has(message.id as number)) {
      const pending = this.pendingRequests.get(message.id as number)!;
      this.pendingRequests.delete(message.id as number);

      if (message.error) {
        const err = message.error as { code: number; message: string };
        pending.reject(new Error(`MCP Error ${err.code}: ${err.message}`));
      } else {
        pending.resolve(message);
      }
    }
  }

  private processPendingRequests(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private nextId(): number {
    return ++this.requestId;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.processPendingRequests(new Error("Client disconnected"));

    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.process = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}