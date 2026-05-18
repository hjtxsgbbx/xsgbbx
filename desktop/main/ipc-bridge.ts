import { ipcMain, app, BrowserWindow, dialog, IpcMainInvokeEvent } from "electron";
import * as fs from "fs";
import * as path from "path";
import type {
  UserInput,
  PlatformInfo,
  Config,
} from "../../src/types/index.js";
import { QueryEngineImpl } from "../../src/engine/query-engine.js";
import { SessionStore, ConfigStore } from "../../src/storage/index.js";
import { detectPlatform } from "../../src/pal/index.js";
import { loadProjectMemory } from "../../src/intelligence/project-memory.js";
import { FeedbackCollector, FeedbackEntry } from "../../src/observability/feedback-collector.js";

const feedbackCollector = new FeedbackCollector();

const ALLOWED_CONFIG_KEYS = new Set([
  "chosen_provider", "model", "fallback_model", "permission_mode",
  "auto_create_pr", "auto_commit", "accept_terms", "telemetry_enabled",
  "max_turns", "sandbox_mode", "thinking_budget_tokens", "thinking_effort",
  "ui", "compaction_thresholds", "ai_safety_confidence_threshold",
  "auto_approve_tools", "working_dir",
]);

const SENSITIVE_FILE_PATTERNS = [
  /\.env($|\.)/i, /\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i,
  /id_rsa/i, /id_ed25519/i, /id_ecdsa/i, /\.ssh\//i,
  /credentials/i, /\.npmrc$/i, /\.pypirc$/i, /\.netrc$/i,
  /secret/i, /token/i, /password/i,
];

let engine: QueryEngineImpl | null = null;
let currentSession: { session_id: string; meta: Record<string, unknown>; messages: unknown[] } | null = null;
let platform: PlatformInfo | null = null;
let configStore: ConfigStore;

function getConfigStore(): ConfigStore {
  if (!configStore) {
    configStore = new ConfigStore();
  }
  return configStore;
}

function validateConfigValues(updates: Record<string, unknown>): void {
  const VALID_PERMISSION_MODES = new Set(["default", "plan", "defaultDeny", "autoApprove", "sandbox"]);
  const MAX_TURNS = 200;
  const MAX_THINKING_BUDGET = 100000;

  if (updates.permission_mode && !VALID_PERMISSION_MODES.has(updates.permission_mode as string)) {
    throw new Error(`Invalid permission_mode: ${updates.permission_mode}`);
  }
  if (updates.max_turns !== undefined) {
    const val = Number(updates.max_turns);
    if (isNaN(val) || val < 1 || val > MAX_TURNS) {
      throw new Error(`Invalid max_turns: ${updates.max_turns}`);
    }
  }
  if (updates.thinking_budget_tokens !== undefined) {
    const val = Number(updates.thinking_budget_tokens);
    if (isNaN(val) || val < 0 || val > MAX_THINKING_BUDGET) {
      throw new Error(`Invalid thinking_budget_tokens: ${updates.thinking_budget_tokens}`);
    }
  }
}

function validateSender(event: IpcMainInvokeEvent): boolean {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return false;
  const windows = BrowserWindow.getAllWindows();
  return windows.includes(senderWindow);
}

function rejectUnauthorized() {return { success: false, error: "Unauthorized IPC sender" } as const;}

function isPathWithinBase(fullPath: string, basePath: string): boolean {
  const normalizedFull = path.normalize(path.resolve(fullPath)).toLowerCase();
  const normalizedBase = path.normalize(path.resolve(basePath)).toLowerCase();
  return normalizedFull.startsWith(normalizedBase + path.sep) || normalizedFull === normalizedBase;
}

function isSensitiveFile(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  return SENSITIVE_FILE_PATTERNS.some((p) => p.test(normalized));
}

function sanitizeConfigUpdates(updates: Record<string, unknown>): Partial<Config> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (!ALLOWED_CONFIG_KEYS.has(key)) continue;
    sanitized[key] = value;
  }
  return sanitized as Partial<Config>;
}

export function registerIpcHandlers(): void {
  ipcMain.handle("bridge:init-session", async (event, projectPath: string) => {
    if (!validateSender(event)) return rejectUnauthorized();
    try {
      const store = new SessionStore();
      const config = getConfigStore().load();
      const providerName = config.chosen_provider || "anthropic";

      if (!platform) {
        platform = detectPlatform();
      }

      const session = store.create(
        projectPath,
        platform!.os,
        platform!.terminal,
        providerName,
        config.model || "claude-sonnet-4-20250514"
      );

      if (engine) {
        engine.removeAllListeners();
        const costTracker = engine.getCostTracker();
        if (costTracker) costTracker.removeAllListeners();
      }

      engine = new QueryEngineImpl({
        ...config,
        chosen_provider: providerName,
      });
      engine.setSession(session);

      if (config.permission_mode) {
        engine.setPermissionMode(config.permission_mode as "default" | "plan");
      }

      engine.on("streaming", (chunk: string) => {
        broadcastToAll("streaming", { chunk });
      });
      engine.on("toolExecuting", (toolName: string, command: string) => {
        broadcastToAll("tool-executing", { toolName, command });
      });
      engine.on("toolResult", (result: unknown) => {
        broadcastToAll("tool-result", result);
      });
      engine.on("requestConfirmation", (toolCall: unknown, command: string, reason: string) => {
        broadcastToAll("permission-required", { tool_name: (toolCall as Record<string, unknown>)?.name || "unknown", args: toolCall, question: reason });
      });
      engine.on("error", (message: unknown) => {
        broadcastToAll("error", message);
        broadcastToAll("state-change", { state: "idle" });
      });
      const costTracker = engine.getCostTracker();
      if (costTracker) {
        costTracker.on("costUpdate", (metrics: unknown) => {
          broadcastToAll("cost-update", metrics);
        });
      }

      currentSession = session;
      return { success: true, data: session };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle("bridge:query", async (event, input: UserInput) => {
    if (!validateSender(event)) return rejectUnauthorized();
    if (!engine) {return { success: false, error: "No active session" } as const;}

    try {
      broadcastToAll("state-change", { state: "thinking" });

      const sessionMessages = currentSession?.messages || [];
      const projectPath = currentSession?.meta?.project_path || "";
      const result = await engine.query(input, {
        messages: sessionMessages as any[],
        config: getConfigStore().load(),
        platform: platform!,
        projectMemory: projectPath ? loadProjectMemory(projectPath as string) : "",
      });

      broadcastToAll("state-change", { state: "idle" });

      return { success: true, data: result };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      broadcastToAll("error", message);
      return { success: false, error: message };
    }
  });

  ipcMain.handle("bridge:abort", (event) => {
    if (!validateSender(event)) return rejectUnauthorized();
    if (engine) {
      engine.removeAllListeners();
      const costTracker = engine.getCostTracker();
      if (costTracker) costTracker.removeAllListeners();
    }
    engine = null;
    currentSession = null;
    return { success: true };
  });

  ipcMain.handle("bridge:get-session", (event) => {
    if (!validateSender(event)) return rejectUnauthorized();
    return { success: true, data: currentSession };
  });

  ipcMain.handle("bridge:delete-session", (event) => {
    if (!validateSender(event)) return rejectUnauthorized();
    if (engine) {
      engine.abortQuery();
      engine.removeAllListeners();
      const costTracker = engine.getCostTracker();
      if (costTracker) costTracker.removeAllListeners();
      engine = null;
    }
    currentSession = null;
    return { success: true };
  });

  ipcMain.handle("bridge:get-platform", (event) => {
    if (!validateSender(event)) return rejectUnauthorized();
    if (!platform) {platform = detectPlatform();}
    return { success: true, data: platform };
  });

  ipcMain.handle("bridge:get-config", (event) => {
    if (!validateSender(event)) return rejectUnauthorized();
    const config = getConfigStore().load();
    const safeConfig = { ...config };
    if (safeConfig.api_key_ref) {
      safeConfig.api_key_ref = "***";
    }
    if (safeConfig.provider_configs) {
      for (const key of Object.keys(safeConfig.provider_configs)) {
        if (safeConfig.provider_configs[key].api_key) {
          safeConfig.provider_configs[key] = {
            ...safeConfig.provider_configs[key],
            api_key: "***",
          };
        }
      }
    }
    return { success: true, data: safeConfig };
  });

  ipcMain.handle("bridge:update-config", (event, updates: Record<string, unknown>) => {
    if (!validateSender(event)) return rejectUnauthorized();
    try {
      const sanitized = sanitizeConfigUpdates(updates);
      validateConfigValues(sanitized);
      const current = getConfigStore().load();
      getConfigStore().save({ ...current, ...sanitized } as never);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle("bridge:read-file", async (event, filePath: string) => {
    if (!validateSender(event)) return rejectUnauthorized();
    try {
      if (!currentSession) {return { success: false, error: "No active session" };}
      const basePath = currentSession.meta.project_path as string;
      const fullPath = path.resolve(basePath, filePath);

      if (!isPathWithinBase(fullPath, basePath)) {
        return { success: false, error: "Path traversal denied" };
      }

      if (isSensitiveFile(fullPath)) {
        return { success: false, error: "Access to sensitive files is restricted" };
      }

      const content = fs.readFileSync(fullPath, "utf-8");
      return { success: true, data: content };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle("bridge:write-file", async (event, filePath: string, content: string) => {
    if (!validateSender(event)) return rejectUnauthorized();
    try {
      if (!currentSession) {return { success: false, error: "No active session" };}
      const basePath = currentSession.meta.project_path as string;
      const fullPath = path.resolve(basePath, filePath);

      if (!isPathWithinBase(fullPath, basePath)) {
        return { success: false, error: "Path traversal denied" };
      }

      if (isSensitiveFile(fullPath)) {
        return { success: false, error: "Writing to sensitive files is restricted" };
      }

      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(fullPath, content, "utf-8");
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle("bridge:export-session", async (event, filePath: string, content: string) => {
    if (!validateSender(event)) return rejectUnauthorized();
    try {
      if (!filePath || typeof filePath !== "string") {
        return { success: false, error: "Invalid file path" };
      }
      const resolvedPath = path.resolve(filePath);
      const allowedDirs = [
        path.resolve(process.env.USERPROFILE || process.env.HOME || "."),
        path.resolve(path.dirname(app.getPath("userData"))),
      ];
      const isAllowed = allowedDirs.some((dir) => resolvedPath.startsWith(dir + path.sep) || resolvedPath === dir);
      if (!isAllowed) {
        return { success: false, error: "Export path must be within user home or app data directory" };
      }
      if (content && typeof content === "string" && content.length > 50 * 1024 * 1024) {
        return { success: false, error: "Content too large for export (max 50MB)" };
      }
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resolvedPath, content, "utf-8");
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle("bridge:list-files", async (event) => {
    if (!validateSender(event)) return rejectUnauthorized();
    try {
      if (!currentSession) {return { success: false, error: "No active session" };}
      const basePath = currentSession.meta.project_path as string;

      interface TreeNode {
        name: string;
        path: string;
        type: "file" | "folder";
        children?: TreeNode[];
      }

      function scanDir(dir: string, relPath: string, depth: number = 0): TreeNode[] {
        if (depth > 3) return [];
        const nodes: TreeNode[] = [];
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name.startsWith(".")) continue;
            if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;

            const fullPath = path.join(dir, entry.name);
            const relative = relPath ? path.join(relPath, entry.name) : entry.name;

            if (entry.isDirectory()) {
              const children = scanDir(fullPath, relative, depth + 1);
              nodes.push({ name: entry.name, path: relative, type: "folder", children });
            } else {
              nodes.push({ name: entry.name, path: relative, type: "file" });
            }
          }
        } catch {
          /* skip inaccessible dirs */
        }
        return nodes.sort((a, b) => {
          if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      }

      const tree = scanDir(basePath, "");
      return { success: true, data: tree };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle("dialog:open-project", async (event) => {
    if (!validateSender(event)) return rejectUnauthorized();
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Project Directory",
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: "cancelled" };
    }
    return { success: true, data: result.filePaths[0] };
  });

  ipcMain.handle("dialog:save-file", async (event, options: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => {
    if (!validateSender(event)) return rejectUnauthorized();
    const result = await dialog.showSaveDialog({
      defaultPath: options.defaultPath,
      filters: options.filters,
    });
    if (result.canceled) {
      return { success: false, error: "cancelled" };
    }
    return { success: true, data: result.filePath };
  });

  ipcMain.handle("app:get-version", (event) => {
    if (!validateSender(event)) return rejectUnauthorized();
    return { success: true, data: "1.0.0" };
  });

  ipcMain.on("feedback:submit", (event, data: Record<string, unknown>) => {
    if (!validateSender(event)) return;
    try {
      feedbackCollector.submit({
        source: (data.source as FeedbackEntry["source"]) || "in_app",
        category: (data.category as FeedbackEntry["category"]) || "improvement",
        severity: (data.severity as FeedbackEntry["severity"]) || "medium",
        platform: "desktop",
        summary: String(data.summary || ""),
        details: String(data.details || ""),
        metadata: (data.metadata as Record<string, unknown>) || {},
      });
    } catch {}
  });
}

function broadcastToAll(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  });
}

export function destroyBridge(): void {
  engine = null;
  currentSession = null;
}

export function getSessionData() {
  return currentSession || null;
}
