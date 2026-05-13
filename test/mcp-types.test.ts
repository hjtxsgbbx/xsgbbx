import {
  MCPTransport,
  MCPCapabilities,
  MCPToolDefinition,
  MCPServerConfig,
  MCPTaskStatus,
  MCPTask,
  MCPTaskResult,
  MCPTasksCreateRequest,
  MCPTasksCreateResponse,
  MCPTasksGetRequest,
  MCPTasksGetResponse,
  MCPTasksCancelRequest,
  MCPTasksCancelResponse,
  MCPTasksListRequest,
  MCPTasksListResponse,
  MCPTasksResultRequest,
  MCPTasksResultResponse,
  MCPRequest,
  MCPResponse,
} from "../src/mcp/types.js";

describe("MCP Types", () => {
  describe("MCPToolDefinition", () => {
    it("should accept valid tool definition", () => {
      const tool: MCPToolDefinition = {
        name: "read_file",
        description: "Read a file from disk",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file",
            },
          },
          required: ["path"],
        },
      };
      expect(tool.name).toBe("read_file");
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.required).toContain("path");
    });

    it("should support optional properties", () => {
      const tool: MCPToolDefinition = {
        name: "simple_tool",
        description: "A tool with no required params",
        inputSchema: {
          type: "object",
          properties: {
            flag: {
              type: "boolean",
              description: "Optional flag",
            },
          },
        },
      };
      expect(tool.inputSchema.required).toBeUndefined();
    });
  });

  describe("MCPServerConfig", () => {
    it("should accept stdio config", () => {
      const config: MCPServerConfig = {
        name: "filesystem",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        enabled: true,
      };
      expect(config.transport).toBe("stdio");
      expect(config.command).toBe("node");
    });

    it("should accept http config", () => {
      const config: MCPServerConfig = {
        name: "remote-api",
        transport: "http",
        url: "http://localhost:8080/mcp",
        enabled: false,
      };
      expect(config.transport).toBe("http");
      expect(config.url).toBe("http://localhost:8080/mcp");
    });
  });

  describe("MCPCapabilities", () => {
    it("should allow partial capabilities", () => {
      const caps: MCPCapabilities = { tools: true };
      expect(caps.tools).toBe(true);
      expect(caps.resources).toBeUndefined();
    });

    it("should allow full capabilities", () => {
      const caps: MCPCapabilities = {
        tools: true,
        resources: true,
        prompts: true,
        logging: false,
      };
      expect(caps.logging).toBe(false);
    });
  });

  describe("MCPTransport", () => {
    it('should be "stdio" or "http"', () => {
      const t1: MCPTransport = "stdio";
      const t2: MCPTransport = "http";
      expect(t1).toBe("stdio");
      expect(t2).toBe("http");
    });
  });

  describe("MCP Tasks Protocol (SEP-1686/2669)", () => {
    describe("MCPTaskStatus", () => {
      it("should support all lifecycle statuses", () => {
        const statuses: MCPTaskStatus[] = [
          "submitted", "working", "input_required", "completed", "failed", "cancelled",
        ];
        expect(statuses).toHaveLength(6);
        statuses.forEach((s) => expect(typeof s).toBe("string"));
      });
    });

    describe("MCPTask", () => {
      it("should create a valid task object", () => {
        const task: MCPTask = {
          taskId: "task-001",
          status: "working",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          title: "Code Review",
          description: "Review PR #42",
          serverName: "github-mcp",
        };
        expect(task.taskId).toBe("task-001");
        expect(task.status).toBe("working");
      });

      it("should support optional fields", () => {
        const task: MCPTask = {
          taskId: "task-002",
          status: "completed",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          result: {
            content: [{ type: "text", text: "All tests passed" }],
            isError: false,
          },
        };
        expect(task.result?.content[0].text).toBe("All tests passed");
        expect(task.title).toBeUndefined();
      });
    });

    describe("MCPTaskResult", () => {
      it("should accept text content", () => {
        const result: MCPTaskResult = {
          content: [{ type: "text", text: "Done" }],
          isError: false,
        };
        expect(result.content[0].type).toBe("text");
      });

      it("should accept image content", () => {
        const result: MCPTaskResult = {
          content: [
            { type: "image", data: "base64...", mimeType: "image/png" },
          ],
        };
        expect(result.content[0].mimeType).toBe("image/png");
      });
    });

    describe("MCPTasksCreateRequest", () => {
      it("should create valid request", () => {
        const req: MCPTasksCreateRequest = {
          jsonrpc: "2.0",
          id: 1,
          method: "tasks/create",
          params: { title: "Build Project", description: "Run build pipeline" },
        };
        expect(req.method).toBe("tasks/create");
        expect(req.params.title).toBe("Build Project");
      });
    });

    describe("MCPTasksCreateResponse", () => {
      it("should parse create response", () => {
        const resp: MCPTasksCreateResponse = {
          jsonrpc: "2.0",
          id: 1,
          result: { taskId: "task-abc", status: "submitted" },
        };
        expect(resp.result.taskId).toBe("task-abc");
        expect(resp.result.status).toBe("submitted");
      });
    });

    describe("MCPTasksGetRequest", () => {
      it("should create valid get request", () => {
        const req: MCPTasksGetRequest = {
          jsonrpc: "2.0",
          id: 2,
          method: "tasks/get",
          params: { taskId: "task-abc" },
        };
        expect(req.method).toBe("tasks/get");
      });
    });

    describe("MCPTasksCancelRequest", () => {
      it("should create valid cancel request", () => {
        const req: MCPTasksCancelRequest = {
          jsonrpc: "2.0",
          id: 3,
          method: "tasks/cancel",
          params: { taskId: "task-abc" },
        };
        expect(req.method).toBe("tasks/cancel");
      });
    });

    describe("MCPTasksListResponse", () => {
      it("should parse list response with tasks", () => {
        const resp: MCPTasksListResponse = {
          jsonrpc: "2.0",
          id: 4,
          result: {
            tasks: [
              {
                taskId: "t1",
                status: "working",
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T01:00:00Z",
              },
              {
                taskId: "t2",
                status: "completed",
                createdAt: "2026-01-02T00:00:00Z",
                updatedAt: "2026-01-02T02:00:00Z",
              },
            ],
          },
        };
        expect(resp.result.tasks).toHaveLength(2);
      });
    });

    describe("MCPRequest union type", () => {
      it("should accept TasksCreateRequest", () => {
        const req: MCPRequest = {
          jsonrpc: "2.0",
          id: 1,
          method: "tasks/create",
          params: { title: "Test" },
        };
        expect(req.method).toBe("tasks/create");
      });

      it("should accept TasksGetRequest", () => {
        const req: MCPRequest = {
          jsonrpc: "2.0",
          id: 2,
          method: "tasks/get",
          params: { taskId: "x" },
        };
        expect(req.method).toBe("tasks/get");
      });

      it("should accept TasksCancelRequest", () => {
        const req: MCPRequest = {
          jsonrpc: "2.0",
          id: 3,
          method: "tasks/cancel",
          params: { taskId: "x" },
        };
        expect(req.method).toBe("tasks/cancel");
      });
    });

    describe("MCPResponse union type", () => {
      it("should accept TasksCreateResponse", () => {
        const resp: MCPResponse = {
          jsonrpc: "2.0",
          id: 1,
          result: { taskId: "x", status: "submitted" },
        };
        expect(resp.result.taskId).toBe("x");
      });

      it("should accept TasksResultResponse", () => {
        const resp: MCPResponse = {
          jsonrpc: "2.0",
          id: 5,
          result: { content: [{ type: "text", text: "OK" }] },
        };
        expect(resp.result.content[0].text).toBe("OK");
      });
    });
  });
});