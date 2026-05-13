import { Tool, ToolResult, JSONSchema, ExecutionContext } from "../types/index.js";
import { MCPClient } from "./client.js";
import { MCPToolDefinition, MCPServerConfig } from "./types.js";

function mcpSchemaToJSONSchema(mcpSchema: MCPToolDefinition["inputSchema"]): JSONSchema {
  const properties: Record<string, JSONSchema> = {};
  if (mcpSchema.properties) {
    for (const [key, value] of Object.entries(mcpSchema.properties)) {
      properties[key] = {
        type: value.type,
        description: value.description,
        enum: value.enum,
      };
    }
  }
  return {
    type: "object",
    properties,
    required: mcpSchema.required,
  };
}

export class MCPToolAdapter implements Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  readonly: boolean;
  private client: MCPClient;
  private mcpDef: MCPToolDefinition;

  constructor(client: MCPClient, def: MCPToolDefinition) {
    this.client = client;
    this.mcpDef = def;
    this.name = `mcp__${def.name}`;
    this.description = `[MCP] ${def.description}`;
    this.parameters = mcpSchemaToJSONSchema(def.inputSchema);
    this.readonly = def.name.toLowerCase().includes("read") ||
      def.name.toLowerCase().includes("get") ||
      def.name.toLowerCase().includes("list") ||
      def.name.toLowerCase().includes("search");
  }

  async execute(params: Record<string, unknown>, _context: ExecutionContext): Promise<ToolResult> {
    try {
      const output = await this.client.callTool(this.mcpDef.name, params);
      return { success: true, output };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: message, errorCode: "MCP_TOOL_ERROR" };
    }
  }
}

export class MCPManager {
  private servers = new Map<string, { config: MCPServerConfig; client: MCPClient }>();
  private adapters = new Map<string, Tool[]>();

  async addServer(config: MCPServerConfig): Promise<Tool[]> {
    if (!config.enabled) return [];

    const client = new MCPClient(config);
    await client.connect();

    const tools = client.getTools();
    const adapters = tools.map(def => new MCPToolAdapter(client, def));

    this.servers.set(config.name, { config, client });
    this.adapters.set(config.name, adapters);

    return adapters;
  }

  getToolsForServer(name: string): Tool[] {
    return this.adapters.get(name) || [];
  }

  getAllTools(): Tool[] {
    const all: Tool[] = [];
    for (const tools of this.adapters.values()) {
      all.push(...tools);
    }
    return all;
  }

  async removeServer(name: string): Promise<void> {
    const entry = this.servers.get(name);
    if (entry) {
      await entry.client.disconnect();
      this.servers.delete(name);
      this.adapters.delete(name);
    }
  }

  async disconnectAll(): Promise<void> {
    const names = [...this.servers.keys()];
    for (const name of names) {
      await this.removeServer(name);
    }
  }

  getConnectedServerNames(): string[] {
    return [...this.servers.keys()];
  }
}

export const mcpManager = new MCPManager();