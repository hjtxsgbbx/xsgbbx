import { ipcMain, BrowserWindow, dialog, IpcMainInvokeEvent } from "electron";
import { join } from "path";
import { createAgentBridge, AgentBridgeImpl } from "../../src/core/agent-bridge.js";
import type {
  UserInput,
  Session,
  PlatformInfo,
  Config,
} from "../../src/types/index.js";

let bridge: AgentBridgeImpl | null = null;

function getBridge(): AgentBridgeImpl {
  if (!bridge) {
    bridge = createAgentBridge();
  }
  return bridge;
}

function validateSender(event: IpcMainInvokeEvent): boolean {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return false;
  const windows = BrowserWindow.getAllWindows();
  return windows.includes(senderWindow);
}

function rejectUnauthorized(): { success: false; error: string } {
  return { success: false, error: "Unauthorized IPC sender" };
}

export function registerIpcHandlers(): void {
  const bridge = getBridge();

  ipcMain.handle("bridge:init-session", async (event, projectPath: string) => {
    if (!validateSender(event)) return rejectUnauthorized();
    try {
      const session = await bridge.initSession(projectPath, "desktop");
      return { success: true, data: session };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle("bridge:query", async (event, input: UserInput) => {
    if (!validateSender(event)) return rejectUnauthorized();
    try {
      const result = await bridge.invokeQuery(input);
      return { success: true, data: result };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle("bridge:abort", (event) => {
    if (!validateSender(event)) return rejectUnauthorized();
    bridge.abortQuery();
    return { success: true };
  });

  ipcMain.handle("bridge:get-session", (event) => {
    if (!validateSender(event)) return rejectUnauthorized();
    const session = bridge.getCurrentSession();
    return { success: true, data: session };
  });

  ipcMain.handle("bridge:get-platform", (event) => {
    if (!validateSender(event)) return rejectUnauthorized();
    const platform = bridge.getPlatform();
    return { success: true, data: platform };
  });

  ipcMain.handle("bridge:get-config", (event) => {
    if (!validateSender(event)) return rejectUnauthorized();
    const config = bridge.getConfig();
    return { success: true, data: config };
  });

  ipcMain.handle("bridge:update-config", (event, updates: Partial<Config>) => {
    if (!validateSender(event)) return rejectUnauthorized();
    try {
      bridge.updateConfig(updates);
      return { success: true };
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

  bridge.on("stateChange", (state: string, data?: unknown) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("bridge:state-change", { state, data });
    });
  });

  bridge.on("error", (message: string) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("bridge:error", message);
    });
  });

  ipcMain.handle("app:get-version", (event) => {
    if (!validateSender(event)) return rejectUnauthorized();
    return "1.0.0";
  });
}

export function destroyBridge(): void {
  if (bridge) {
    bridge.destroy();
    bridge = null;
  }
}

export function getBridgeInstance(): AgentBridgeImpl {
  return getBridge();
}