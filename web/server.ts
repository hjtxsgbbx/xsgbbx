/**
 * xsgbbx web server — serves static UI + WebSocket chat API
 */
import { WebSocketServer, WebSocket } from "ws";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFileSync, existsSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.XSGBBX_PORT || "3099", 10);
const HOST = process.env.XSGBBX_HOST || "127.0.0.1";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// ---- Static file serving ----
function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  const clientDir = join(__dirname, "client");
  if (!existsSync(clientDir)) return false;

  let urlPath = req.url || "/";
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";
  const filePath = join(clientDir, urlPath);

  if (!existsSync(filePath) || filePath.includes("..")) {
    res.writeHead(404);
    res.end("Not found");
    return true;
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const content = readFileSync(filePath);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(content);
  return true;
}

// ---- WebSocket ----
interface ClientState {
  ws: WebSocket;
  connectedAt: string;
}

const clients = new Map<WebSocket, ClientState>();

function setupWebSocket(wss: WebSocketServer): void {
  wss.on("connection", (ws: WebSocket) => {
    const state: ClientState = {
      ws,
      connectedAt: new Date().toISOString(),
    };
    clients.set(ws, state);
    console.log(`[ws] Client connected (${clients.size} active)`);

    ws.send(JSON.stringify({
      type: "connected",
      message: "Connected to xsgbbx web server",
      timestamp: state.connectedAt,
    }));

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        console.log(`[ws] Message:`, msg.type || "unknown");

        // Echo back for now — replace with real query engine later
        ws.send(JSON.stringify({
          type: "response",
          content: `Received: ${msg.content || msg.type || "empty"}`,
          timestamp: new Date().toISOString(),
        }));
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`[ws] Client disconnected (${clients.active} active)`);
    });
  });
}

// ---- Start ----
const server = createServer((req, res) => {
  if (!serveStatic(req, res)) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html>
<html><head><title>xsgbbx</title><meta charset="utf-8"></head>
<body style="font-family:monospace;padding:2rem;background:#1a1a2e;color:#e0e0e0">
  <h1>xsgbbx</h1>
  <p>Web UI not built. Run <code>npm run web:build</code> to build the client.</p>
  <p>Or use the CLI: <code>npx xsgbbx</code></p>
  <pre>${JSON.stringify({ status: "ok", clients: clients.size }, null, 2)}</pre>
</body></html>`);
  }
});

const wss = new WebSocketServer({ server });
setupWebSocket(wss);

server.listen(PORT, HOST, () => {
  console.log(`\n  xsgbbx web server`);
  console.log(`  http://${HOST}:${PORT}\n`);
});
