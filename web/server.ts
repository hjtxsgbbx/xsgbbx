import { WebSocketServer, WebSocket } from "ws";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFileSync, existsSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { createAgentBridge, AgentBridgeImpl } from "../src/core/agent-bridge.js";
import type { UserInput, WSMessage } from "../src/types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.AGENT_1_PORT || "3099", 10);
const HOST = process.env.AGENT_1_HOST || "127.0.0.1";
const PROJECT_PATH = process.env.AGENT_1_PROJECT || process.cwd();

interface ClientState {
  ws: WebSocket;
  bridge: AgentBridgeImpl;
  sessionId: string | null;
  authenticated: boolean;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

const clientStates = new Map<WebSocket, ClientState>();

function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  const clientDir = join(__dirname, "client");

  if (!existsSync(clientDir)) {
    return false;
  }

  let urlPath = req.url || "/";
  if (urlPath === "/" || urlPath === "") {
    urlPath = "/index.html";
  }

  const filePath = join(clientDir, urlPath);

  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const data = readFileSync(filePath);

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-XSS-Protection": "1; mode=block",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:;",
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function startServer(): void {
  const httpServer = createServer((req, res) => {
    if (serveStatic(req, res)) {
      return;
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("agent_1 WebSocket Server - connect via ws://");
  });

  const HEARTBEAT_INTERVAL = 30000;

  const wss = new WebSocketServer({ server: httpServer, maxPayload: 1048576 });

  const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
      const alive = (ws as WebSocket & { isAlive?: boolean }).isAlive;
      if (alive === false) {
        ws.terminate();
        return;
      }
      (ws as WebSocket & { isAlive?: boolean }).isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL);

  wss.on("close", () => {
    clearInterval(heartbeatTimer);
  });

  wss.on("connection", (ws: WebSocket) => {
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;

    ws.on("pong", () => {
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    });

    console.log(`[agent_1-web] Client connected (total: ${wss.clients.size})`);

    const bridge = createAgentBridge();
    const clientState: ClientState = {
      ws,
      bridge,
      sessionId: null,
      authenticated: false,
    };
    clientStates.set(ws, clientState);

    bridge.initSession(PROJECT_PATH, "web").then((session) => {
      clientState.sessionId = session.session_id;
      clientState.authenticated = true;

      const welcomeMsg: WSMessage = {
        type: "result",
        payload: {
          response: {
            content: `Welcome to agent_1 Web Client\nSession: ${session.session_id.slice(0, 8)}...\nProject: ${PROJECT_PATH}\nType your task to begin.`,
            model: "web-client",
          },
          stopReason: "end_turn",
        },
      };
      ws.send(JSON.stringify(welcomeMsg));
    });

    bridge.on("stateChange", (state: string, data?: unknown) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "result",
            payload: {
              response: {
                content: `[${state}] ${data ? JSON.stringify(data) : ""}`,
                model: "state",
              },
              stopReason: "tool_use",
            },
          })
        );
      }
    });

    bridge.on("error", (message: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        const errMsg: WSMessage = {
          type: "error",
          code: 500,
          message,
        };
        ws.send(JSON.stringify(errMsg));
      }
    });

    ws.on("message", async (data: Buffer) => {
      try {
        const message: WSMessage = JSON.parse(data.toString());

        switch (message.type) {
          case "query": {
            const input: UserInput = {
              ...message.payload,
              timestamp: new Date().toISOString(),
            };

            try {
              const result = await bridge.invokeQuery(input);
              const resultMsg: WSMessage = {
                type: "result",
                payload: result,
              };
              ws.send(JSON.stringify(resultMsg));
            } catch (err: unknown) {
              const errMessage =
                err instanceof Error ? err.message : String(err);
              const errMsg: WSMessage = {
                type: "error",
                code: 500,
                message: errMessage,
              };
              ws.send(JSON.stringify(errMsg));
            }
            break;
          }

          case "result":
            bridge.handleWSMessage(message);
            break;

          case "error":
            bridge.handleWSMessage(message);
            break;
        }
      } catch {
        const errMsg: WSMessage = {
          type: "error",
          code: 400,
          message: "Invalid message format. Expected JSON with type field.",
        };
        ws.send(JSON.stringify(errMsg));
      }
    });

    ws.on("close", () => {
      console.log(`[agent_1-web] Client disconnected`);
      bridge.destroy();
      clientStates.delete(ws);
    });

    ws.on("error", (err) => {
      console.error(`[agent_1-web] WebSocket error: ${err.message}`);
      bridge.destroy();
      clientStates.delete(ws);
    });
  });

  httpServer.listen(PORT, HOST, () => {
    console.log(`\n  ╔══════════════════════════════════════════════════════╗`);
    console.log(`  ║         agent_1 Web Server v1.0.0                    ║`);
    console.log(`  ╠══════════════════════════════════════════════════════╣`);
    console.log(`  ║  HTTP   → http://${HOST}:${PORT}                          ║`);
    console.log(`  ║  WS     → ws://${HOST}:${PORT}                            ║`);
    console.log(`  ║  Project → ${PROJECT_PATH.slice(0, 38).padEnd(38)} ║`);
    console.log(`  ╚══════════════════════════════════════════════════════╝\n`);
    console.log(`  Open http://${HOST}:${PORT} in your browser to start.\n`);
  });
}

startServer();