export type MCPTransport = "stdio" | "http";

export interface MCPCapabilities {
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
  logging?: boolean;
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
  enabled: boolean;
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

export type MCPRequest =
  | MCPInitializeRequest
  | MCPListToolsRequest
  | MCPCallToolRequest
  | MCPTasksCreateRequest
  | MCPTasksGetRequest
  | MCPTasksCancelRequest
  | MCPTasksListRequest
  | MCPTasksResultRequest;

export type MCPResponse =
  | MCPInitializeResponse
  | MCPListToolsResponse
  | MCPCallToolResponse
  | MCPTasksCreateResponse
  | MCPTasksGetResponse
  | MCPTasksCancelResponse
  | MCPTasksListResponse
  | MCPTasksResultResponse
  | MCPErrorResponse;