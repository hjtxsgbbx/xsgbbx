import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { APP_VERSION } from "../core/constants.js";
import {
  type MCPServerConfig,
  type MCPCapabilities,
  type MCPInitializeRequest,
  type MCPInitializeResponse,
  type MCPListToolsRequest,
  type MCPListToolsResponse,
  type MCPCallToolRequest,
  type MCPCallToolResponse,
  type MCPToolDefinition,
  type MCPTaskStatus,
  type MCPTask,
  type MCPTaskResult,
  type MCPTasksCreateRequest,
  type MCPTasksCreateResponse,
  type MCPTasksGetRequest,
  type MCPTasksGetResponse,
  type MCPTasksCancelRequest,
  type MCPListResourcesRequest,
  type MCPListResourcesResponse,
  type MCPReadResourceRequest,
  type MCPReadResourceResponse,
  type MCPResourceDefinition,
  type MCPListPromptsRequest,
  type MCPListPromptsResponse,
  type MCPGetPromptRequest,
  type MCPGetPromptResponse,
  type MCPPromptDefinition,
  type MCPTasksListRequest,
  type MCPTasksListResponse,
  type MCPTasksResultRequest,
  type MCPTasksResultResponse,
  type MCPRequest,
  type MCPSamplingCreateMessageRequest,
  type MCPSamplingCreateMessageResponse,
  type MCPSamplingMessage,
  type MCPModelPreferences,
} from "./types.js";
import { debug } from "../observability/debug.js";

const DEFAULT_RECONNECT_MAX_RETRIES = 5;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1000;
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 30000;
const HTTP_TIMEOUT_MS = 15000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class MCPClient extends EventEmitter {
  private config: MCPServerConfig;
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private buffer = "";
  private connected = false;
  private tools: MCPToolDefinition[] = [];
  private resources: MCPResourceDefinition[] = [];
  private prompts: MCPPromptDefinition[] = [];
  private serverCapabilities: MCPCapabilities = {};

  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private healthCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private sseController: AbortController | null = null;
  private messageEndpoint: string | null = null;
  private sessionId: string | null = null;
  private intentionallyDisconnected = false;
  private toolCallCounts = new Map<string, number>();

  constructor(config: MCPServerConfig) {
    super();
    this.config = config;
  }

  isToolAllowed(toolName: string): boolean {
    if (this.config.blockedTools && this.config.blockedTools.includes(toolName)) {
      return false;
    }
    if (this.config.allowedTools && this.config.allowedTools.length > 0) {
      return this.config.allowedTools.includes(toolName);
    }
    return true;
  }

  private checkToolPermission(toolName: string): { allowed: boolean; reason?: string } {
    if (!this.isToolAllowed(toolName)) {
      return { allowed: false, reason: `Tool "${toolName}" is blocked or not in allowed list for server "${this.config.name}"` };
    }

    const callCount = this.toolCallCounts.get(toolName) || 0;
    this.toolCallCounts.set(toolName, callCount + 1);

    return { allowed: true };
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.intentionallyDisconnected = false;

    if (this.config.transport === "stdio" && this.config.command) {
      return this.connectStdio();
    }

    if (this.config.transport === "http" || this.config.transport === "sse") {
      return this.connectHttpSSE();
    }

    throw new Error(`Unsupported transport: ${this.config.transport}`);
  }

  private connectStdio(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.config.command) {
        reject(new Error("MCP stdio transport requires a command"));
        return;
      }
      const cmd = this.config.command;
      const args = this.config.args || [];

      this.process = spawn(cmd, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      this.process.stdout?.on("data", (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr?.on("data", () => {});

      this.process.on("error", (err) => {
        this.emit("error", `MCP server process error: ${err.message}`);
        reject(err);
      });

      this.process.on("close", (code) => {
        const wasConnected = this.connected;
        this.connected = false;
        this.emit("disconnected");
        this.processPendingRequests(new Error(`MCP server exited with code ${code}`));

        if (wasConnected && this.shouldReconnect()) {
          this.scheduleReconnect();
        }
      });

      this.initialize()
        .then(() => {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.emit("connected");
          this.startHealthCheck();
          resolve();
        })
        .catch(reject);
    });
  }

  private async connectHttpSSE(): Promise<void> {
    const baseUrl = this.config.url;
    if (!baseUrl) {
      throw new Error("HTTP/SSE transport requires a url in config");
    }

    this.sseController = new AbortController();

    try {
      const sseUrl = baseUrl.endsWith("/sse") ? baseUrl : `${baseUrl}/sse`;

      const headers: Record<string, string> = {
        "Accept": "text/event-stream",
        ...this.config.headers,
      };

      const response = await fetch(sseUrl, {
        method: "GET",
        headers,
        signal: this.sseController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("SSE connection failed: no readable stream");
      }

      const sseTextDecoder = new TextDecoder();
      let sseBuffer = "";

      const processSSEStream = async () => {
        try {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += sseTextDecoder.decode(value, { stream: true });
            const lines = sseBuffer.split("\n");
            sseBuffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("event: endpoint")) {
                continue;
              }
              if (line.startsWith("data: ")) {
                const data = line.slice(6).trim();
                if (data.startsWith("/")) {
                  this.messageEndpoint = new URL(data, baseUrl).href;
                } else if (data.startsWith("http")) {
                  this.messageEndpoint = data;
                } else {
                  try {
                    const message = JSON.parse(data);
                    this.handleMessage(message);
                  } catch {
                    // ignore non-JSON SSE data
                  }
                }
              }
              if (line.startsWith("session:")) {
                this.sessionId = line.slice(8).trim();
              }
            }
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") return;
          const wasConnected = this.connected;
          this.connected = false;
          this.emit("disconnected");
          this.processPendingRequests(
            new Error(`SSE stream error: ${err instanceof Error ? err.message : String(err)}`)
          );
          if (wasConnected && this.shouldReconnect()) {
            this.scheduleReconnect();
          }
        }
      };

      processSSEStream();

      await this.waitForMessageEndpoint();

      await this.initialize();

      this.connected = true;
      this.reconnectAttempts = 0;
      this.emit("connected");
      this.startHealthCheck();
    } catch (err) {
      this.connected = false;
      throw err;
    }
  }

  private waitForMessageEndpoint(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for SSE message endpoint"));
      }, 10000);

      const check = () => {
        if (this.messageEndpoint) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  private async initialize(): Promise<void> {
    const initReq: MCPInitializeRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
      capabilities: { tools: true, sampling: { tools: true }, roots: true },
        clientInfo: {
          name: "agent_1",
          version: APP_VERSION,
        },
      },
    };

    const response = (await this.sendRequest(initReq)) as MCPInitializeResponse;
    if (!response.result) {
      throw new Error("MCP initialize failed: invalid response");
    }

    this.serverCapabilities = response.result.capabilities || {};

    this.sendRaw({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    await this.discoverTools();

    if (this.serverCapabilities.resources) {
      await this.discoverResources();
    }
    if (this.serverCapabilities.prompts) {
      await this.discoverPrompts();
    }
  }

  private async discoverTools(): Promise<void> {
    const listReq: MCPListToolsRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "tools/list",
    };

    const response = (await this.sendRequest(listReq)) as MCPListToolsResponse;
    this.tools = response.result?.tools || [];
    this.emit("toolsDiscovered", this.tools);
  }

  getTools(): MCPToolDefinition[] {
    return [...this.tools];
  }

  getResources(): MCPResourceDefinition[] {
    return [...this.resources];
  }

  getPrompts(): MCPPromptDefinition[] {
    return [...this.prompts];
  }

  getCapabilities(): MCPCapabilities {
    return { ...this.serverCapabilities };
  }

  private async discoverResources(): Promise<void> {
    try {
      const listReq: MCPListResourcesRequest = {
        jsonrpc: "2.0",
        id: this.nextId(),
        method: "resources/list",
      };

      const response = (await this.sendRequest(listReq)) as MCPListResourcesResponse;
      this.resources = response.result?.resources || [];
      this.emit("resourcesDiscovered", this.resources);
    } catch (err: unknown) {
      debug.warn("mcp-client", "Resource discovery failed", err);
      this.resources = [];
    }
  }

  private async discoverPrompts(): Promise<void> {
    try {
      const listReq: MCPListPromptsRequest = {
        jsonrpc: "2.0",
        id: this.nextId(),
        method: "prompts/list",
      };

      const response = (await this.sendRequest(listReq)) as MCPListPromptsResponse;
      this.prompts = response.result?.prompts || [];
      this.emit("promptsDiscovered", this.prompts);
    } catch (err: unknown) {
      debug.warn("mcp-client", "Prompt discovery failed", err);
      this.prompts = [];
    }
  }

  async readResource(uri: string): Promise<MCPReadResourceResponse["result"]> {
    if (!this.connected) {
      throw new Error("Client not connected");
    }

    const readReq: MCPReadResourceRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "resources/read",
      params: { uri },
    };

    const response = (await this.sendRequest(readReq)) as MCPReadResourceResponse;
    return response.result;
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<MCPGetPromptResponse["result"]> {
    if (!this.connected) {
      throw new Error("Client not connected");
    }

    const getReq: MCPGetPromptRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "prompts/get",
      params: { name, arguments: args },
    };

    const response = (await this.sendRequest(getReq)) as MCPGetPromptResponse;
    return response.result;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const permission = this.checkToolPermission(name);
    if (!permission.allowed) {
      return `Error: ${permission.reason}`;
    }

    const callReq: MCPCallToolRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "tools/call",
      params: { name, arguments: args },
    };

    const response = (await this.sendRequest(callReq)) as MCPCallToolResponse;
    const contents = response.result?.content || [];

    if (response.result?.isError) {
      return `Error: ${contents
        .map((c) => c.text || "")
        .join("\n")}`;
    }

    return contents
      .filter((c) => c.type === "text")
      .map((c) => c.text || "")
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

    const response = (await this.sendRequest(createReq)) as MCPTasksCreateResponse;
    return response.result;
  }

  async getTask(taskId: string): Promise<MCPTask> {
    const getReq: MCPTasksGetRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "tasks/get",
      params: { taskId },
    };

    const response = (await this.sendRequest(getReq)) as MCPTasksGetResponse;
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

    const response = (await this.sendRequest(listReq)) as MCPTasksListResponse;
    return response.result?.tasks || [];
  }

  async getTaskResult(taskId: string): Promise<MCPTaskResult> {
    const resultReq: MCPTasksResultRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "tasks/result",
      params: { taskId },
    };

    const response = (await this.sendRequest(resultReq)) as MCPTasksResultResponse;
    return response.result;
  }

  private sendRequest(request: MCPRequest): Promise<unknown> {
    const id = request.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${id} timed out`));
      }, HTTP_TIMEOUT_MS);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.sendRaw(request);
    });
  }

  private sendRaw(message: MCPRequest | Record<string, unknown>): void {
    if (this.config.transport === "stdio") {
      if (!this.process?.stdin?.writable) {
        throw new Error("MCP stdio connection not ready");
      }
      const data = JSON.stringify(message) + "\n";
      this.process.stdin.write(data);
    } else {
      this.sendHttpMessage(message as Record<string, unknown>);
    }
  }

  private sendHttpMessage(message: Record<string, unknown>): void {
    const endpoint = this.messageEndpoint || this.config.url;
    if (!endpoint) {
      throw new Error("MCP HTTP connection not ready: no message endpoint");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
    }).catch((err) => {
      this.emit("error", `HTTP send failed: ${err.message}`);
    });
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
        // Ignore non-JSON lines
      }
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    const msgId = message.id as number | undefined;
    if (msgId !== undefined && this.pendingRequests.has(msgId)) {
      const pending = this.pendingRequests.get(msgId);
      this.pendingRequests.delete(msgId);

      if (!pending) return;

      if (pending.timer) {
        clearTimeout(pending.timer);
      }

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
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private nextId(): number {
    return ++this.requestId;
  }

  async createSamplingMessage(
    messages: MCPSamplingMessage[],
    options?: {
      modelPreferences?: MCPModelPreferences;
      systemPrompt?: string;
      includeContext?: "none" | "thisServer" | "allServers";
      temperature?: number;
      maxTokens?: number;
      stopSequences?: string[];
    }
  ): Promise<MCPSamplingCreateMessageResponse["result"]> {
    if (!this.connected) {
      throw new Error("Client not connected");
    }

    const serverCap = this.serverCapabilities as Record<string, unknown>;
    if (!serverCap?.sampling) {
      throw new Error("Server does not support sampling");
    }

    const req: MCPSamplingCreateMessageRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "sampling/createMessage",
      params: {
        messages,
        maxTokens: options?.maxTokens ?? 4096,
        ...(options?.modelPreferences ? { modelPreferences: options.modelPreferences } : {}),
        ...(options?.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
        ...(options?.includeContext ? { includeContext: options.includeContext } : {}),
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options?.stopSequences ? { stopSequences: options.stopSequences } : {}),
      },
    };

    const response = (await this.sendRequest(req)) as MCPSamplingCreateMessageResponse;
    return response.result;
  }

  supportsSampling(): boolean {
    const serverCap = this.serverCapabilities as Record<string, unknown>;
    return !!serverCap?.sampling;
  }

  private shouldReconnect(): boolean {
    if (this.intentionallyDisconnected) return false;
    if (this.config.reconnect === false) return false;
    const maxRetries = this.config.reconnectMaxRetries ?? DEFAULT_RECONNECT_MAX_RETRIES;
    return this.reconnectAttempts < maxRetries;
  }

  private scheduleReconnect(): void {
    const baseDelay = this.config.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
    const maxRetries = this.config.reconnectMaxRetries ?? DEFAULT_RECONNECT_MAX_RETRIES;
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), 30000);

    this.reconnectAttempts++;
    this.emit("reconnecting", this.reconnectAttempts, maxRetries);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit("error", `Reconnect attempt ${this.reconnectAttempts} failed: ${message}`);

        if (this.shouldReconnect()) {
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();
    const interval = this.config.healthCheckIntervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS;

    this.healthCheckTimer = setInterval(async () => {
      const healthy = await this.checkHealth();
      this.emit("healthCheck", healthy);

      if (!healthy && this.connected) {
        this.connected = false;
        this.emit("disconnected");

        if (this.shouldReconnect()) {
          this.scheduleReconnect();
        }
      }
    }, interval);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private async checkHealth(): Promise<boolean> {
    if (this.config.transport === "stdio") {
      return this.process !== null && !this.process.killed;
    }

    if ((this.config.transport === "http" || this.config.transport === "sse") && this.config.url) {
      try {
        const healthUrl = new URL("/health", this.config.url).href;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(healthUrl, {
          method: "GET",
          signal: controller.signal,
          headers: this.config.headers,
        });

        clearTimeout(timeoutId);
        return response.ok;
      } catch (err) {
        debug.warn("mcp-client", "Health check failed", err);
        return false;
      }
    }

    return this.connected;
  }

  async disconnect(): Promise<void> {
    this.intentionallyDisconnected = true;
    this.connected = false;
    this.stopHealthCheck();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.processPendingRequests(new Error("Client disconnected"));

    if (this.sseController) {
      this.sseController.abort();
      this.sseController = null;
    }

    this.messageEndpoint = null;
    this.sessionId = null;

    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.process = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }
}
