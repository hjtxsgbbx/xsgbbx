export type MCPTransport = "stdio" | "http" | "sse";

export interface MCPCapabilities {
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
  logging?: boolean;
  sampling?: {
    tools?: boolean;
    context?: boolean;
  };
  roots?: boolean;
}

export interface MCPModelPreferences {
  hints?: Array<{
    name?: string;
  }>;
  costPriority?: number;
  intelligencePriority?: number;
  speedPriority?: number;
}

export interface MCPSamplingMessage {
  role: "user" | "assistant";
  content: {
    type: "text" | "image" | "audio";
    text?: string;
    data?: string;
    mimeType?: string;
  } | Array<{
    type: "text" | "image" | "audio";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
}

export interface MCPSamplingToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPSamplingCreateMessageRequest {
  jsonrpc: "2.0";
  id: number;
  method: "sampling/createMessage";
  params: {
    messages: MCPSamplingMessage[];
    modelPreferences?: MCPModelPreferences;
    systemPrompt?: string;
    includeContext?: "none" | "thisServer" | "allServers";
    temperature?: number;
    maxTokens: number;
    stopSequences?: string[];
    tools?: MCPSamplingToolDefinition[];
    toolChoice?: { mode: "auto" | "none" | "required" } | { mode: "specific"; name: string };
  };
}

export interface MCPSamplingCreateMessageResponse {
  jsonrpc: "2.0";
  id: number;
  result: {
    role: "assistant";
    content: {
      type: "text" | "image" | "audio";
      text?: string;
      data?: string;
      mimeType?: string;
    } | Array<{
      type: "text" | "tool_use";
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
    model: string;
    stopReason: "endTurn" | "toolUse" | "stopSequence" | "maxTokens";
  };
}

export interface MCPInitializeRequest {
  jsonrpc: "2.0";
  id: number;
  method: "initialize";
  params: {
    protocolVersion: string;
    capabilities: MCPCapabilities;
    clientInfo: {
      name: string;
      version: string;
    };
  };
}

export interface MCPInitializeResponse {
  jsonrpc: "2.0";
  id: number;
  result: {
    protocolVersion: string;
    capabilities: MCPCapabilities;
    serverInfo: {
      name: string;
      version: string;
    };
  };
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
    }>;
    required?: string[];
  };
}

export interface MCPListToolsRequest {
  jsonrpc: "2.0";
  id: number;
  method: "tools/list";
  params?: Record<string, unknown>;
}

export interface MCPListToolsResponse {
  jsonrpc: "2.0";
  id: number;
  result: {
    tools: MCPToolDefinition[];
  };
}

export interface MCPCallToolRequest {
  jsonrpc: "2.0";
  id: number;
  method: "tools/call";
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface MCPCallToolResponse {
  jsonrpc: "2.0";
  id: number;
  result: {
    content: Array<{
      type: "text" | "image" | "resource";
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
    isError?: boolean;
  };
}

export interface MCPErrorResponse {
  jsonrpc: "2.0";
  id: number;
  error: {
    code: number;
    message: string;
  };
}

export interface MCPServerConfig {
  name: string;
  transport: MCPTransport;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  reconnect?: boolean;
  reconnectMaxRetries?: number;
  reconnectBaseDelayMs?: number;
  healthCheckIntervalMs?: number;
  allowedTools?: string[];
  blockedTools?: string[];
  requireApproval?: boolean;
  maxResponseSize?: number;
  requestTimeoutMs?: number;
}

export interface MCPToolPermission {
  toolName: string;
  allowed: boolean;
  requireApproval: boolean;
  maxCallsPerSession?: number;
}

export type MCPTaskStatus = "submitted" | "working" | "input_required" | "completed" | "failed" | "cancelled";

export interface MCPTask {
  taskId: string;
  status: MCPTaskStatus;
  createdAt: string;
  updatedAt: string;
  title?: string;
  description?: string;
  serverName?: string;
  result?: MCPTaskResult;
}

export interface MCPTaskResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export interface MCPTasksCreateRequest {
  jsonrpc: "2.0";
  id: number;
  method: "tasks/create";
  params: {
    title?: string;
    description?: string;
    initial_content?: MCPTaskResult;
  };
}

export interface MCPTasksCreateResponse {
  jsonrpc: "2.0";
  id: number;
  result: {
    taskId: string;
    status: MCPTaskStatus;
  };
}

export interface MCPTasksGetRequest {
  jsonrpc: "2.0";
  id: number;
  method: "tasks/get";
  params: {
    taskId: string;
  };
}

export interface MCPTasksGetResponse {
  jsonrpc: "2.0";
  id: number;
  result: MCPTask;
}

export interface MCPTasksCancelRequest {
  jsonrpc: "2.0";
  id: number;
  method: "tasks/cancel";
  params: {
    taskId: string;
  };
}

export interface MCPTasksCancelResponse {
  jsonrpc: "2.0";
  id: number;
  result: {
    taskId: string;
    status: "cancelled";
  };
}

export interface MCPTasksListRequest {
  jsonrpc: "2.0";
  id: number;
  method: "tasks/list";
  params?: Record<string, unknown>;
}

export interface MCPTasksListResponse {
  jsonrpc: "2.0";
  id: number;
  result: {
    tasks: MCPTask[];
  };
}

export interface MCPTasksResultRequest {
  jsonrpc: "2.0";
  id: number;
  method: "tasks/result";
  params: {
    taskId: string;
  };
}

export interface MCPTasksResultResponse {
  jsonrpc: "2.0";
  id: number;
  result: MCPTaskResult;
}

export interface MCPResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPListResourcesRequest {
  jsonrpc: "2.0";
  id: number;
  method: "resources/list";
  params?: Record<string, unknown>;
}

export interface MCPListResourcesResponse {
  jsonrpc: "2.0";
  id: number;
  result: {
    resources: MCPResourceDefinition[];
  };
}

export interface MCPReadResourceRequest {
  jsonrpc: "2.0";
  id: number;
  method: "resources/read";
  params: {
    uri: string;
  };
}

export interface MCPReadResourceResponse {
  jsonrpc: "2.0";
  id: number;
  result: {
    contents: Array<{
      uri: string;
      mimeType?: string;
      text?: string;
      blob?: string;
    }>;
  };
}

export interface MCPPromptDefinition {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface MCPListPromptsRequest {
  jsonrpc: "2.0";
  id: number;
  method: "prompts/list";
  params?: Record<string, unknown>;
}

export interface MCPListPromptsResponse {
  jsonrpc: "2.0";
  id: number;
  result: {
    prompts: MCPPromptDefinition[];
  };
}

export interface MCPGetPromptRequest {
  jsonrpc: "2.0";
  id: number;
  method: "prompts/get";
  params: {
    name: string;
    arguments?: Record<string, string>;
  };
}

export interface MCPGetPromptResponse {
  jsonrpc: "2.0";
  id: number;
  result: {
    description?: string;
    messages: Array<{
      role: "user" | "assistant";
      content: {
        type: "text" | "image" | "resource";
        text?: string;
        data?: string;
        mimeType?: string;
      };
    }>;
  };
}

export type MCPRequest =
  | MCPInitializeRequest
  | MCPListToolsRequest
  | MCPCallToolRequest
  | MCPTasksCreateRequest
  | MCPTasksGetRequest
  | MCPTasksCancelRequest
  | MCPTasksListRequest
  | MCPTasksResultRequest
  | MCPListResourcesRequest
  | MCPReadResourceRequest
  | MCPListPromptsRequest
  | MCPGetPromptRequest
  | MCPSamplingCreateMessageRequest;

export type MCPResponse =
  | MCPInitializeResponse
  | MCPListToolsResponse
  | MCPCallToolResponse
  | MCPTasksCreateResponse
  | MCPTasksGetResponse
  | MCPTasksCancelResponse
  | MCPTasksListResponse
  | MCPTasksResultResponse
  | MCPListResourcesResponse
  | MCPReadResourceResponse
  | MCPListPromptsResponse
  | MCPGetPromptResponse
  | MCPErrorResponse;