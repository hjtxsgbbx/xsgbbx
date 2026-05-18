/**
 * MCPService — wraps MCPManager into a service layer.
 * Delegates server lifecycle, tool discovery, resource/prompt listing to mcp/.
 */

import { MCPManager, mcpManager } from "../mcp/index.js";
import type { Tool } from "../types/index.js";
import type {
  MCPServerConfig,
  MCPResourceDefinition,
  MCPPromptDefinition,
} from "../mcp/types.js";
import { debug } from "../observability/debug.js";

export interface MCPServiceConfig {
  manager?: MCPManager;
}

export interface ServerInfo {
  name: string;
  connected: boolean;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  config: MCPServerConfig;
}

export interface AddServerResult {
  serverName: string;
  tools: Tool[];
  success: boolean;
  error?: string;
}

export class MCPService {
  private manager: MCPManager;

  constructor(config: MCPServiceConfig = {}) {
    this.manager = config.manager ?? mcpManager;
  }

  async addServer(config: MCPServerConfig): Promise<AddServerResult> {
    try {
      const tools = await this.manager.addServer(config);
      debug.info("mcp-service", `Added MCP server "${config.name}" with ${tools.length} tools`);
      return { serverName: config.name, tools, success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      debug.warn("mcp-service", `Failed to add MCP server "${config.name}": ${message}`);
      return { serverName: config.name, tools: [], success: false, error: message };
    }
  }

  async removeServer(name: string): Promise<void> {
    debug.info("mcp-service", `Removing MCP server "${name}"`);
    await this.manager.removeServer(name);
  }

  async disconnectAll(): Promise<void> {
    debug.info("mcp-service", "Disconnecting all MCP servers");
    await this.manager.disconnectAll();
  }

  getTools(): Tool[] {
    return this.manager.getAllTools();
  }

  getToolsForServer(serverName: string): Tool[] {
    return this.manager.getToolsForServer(serverName);
  }

  listServers(): string[] {
    return this.manager.getConnectedServerNames();
  }

  listServerDetails(): ServerInfo[] {
    const names = this.manager.getConnectedServerNames();
    return names.map((name) => {
      const tools = this.manager.getToolsForServer(name);
      const resources = this.manager.getResources(name);
      const prompts = this.manager.getPrompts(name);
      return {
        name,
        connected: true,
        toolCount: tools.length,
        resourceCount: resources.length,
        promptCount: prompts.length,
        config: { name, transport: "stdio", enabled: true }, // partial — real config is internal
      };
    });
  }

  getResources(serverName?: string): MCPResourceDefinition[] {
    return this.manager.getResources(serverName);
  }

  async readResource(
    uri: string,
    serverName?: string,
  ): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> {
    return this.manager.readResource(uri, serverName);
  }

  getPrompts(serverName?: string): MCPPromptDefinition[] {
    return this.manager.getPrompts(serverName);
  }

  async getPrompt(
    name: string,
    args?: Record<string, string>,
    serverName?: string,
  ): Promise<{
    description?: string;
    messages: Array<{
      role: "user" | "assistant";
      content: { type: "text" | "image" | "resource"; text?: string; data?: string; mimeType?: string };
    }>;
  }> {
    return this.manager.getPrompt(name, args, serverName);
  }
}
