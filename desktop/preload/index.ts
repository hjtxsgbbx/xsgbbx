import { contextBridge, ipcRenderer } from "electron";

export interface ElectronAPI {
  initSession: (projectPath: string) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  sendQuery: (input: { text: string; timestamp: string; interrupt?: boolean }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  abortQuery: () => Promise<{ success: boolean }>;
  getSession: () => Promise<{ success: boolean; data?: unknown }>;
  getPlatform: () => Promise<{ success: boolean; data?: unknown }>;
  getConfig: () => Promise<{ success: boolean; data?: unknown }>;
  updateConfig: (updates: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  openProjectDialog: () => Promise<{ success: boolean; data?: string; error?: string }>;
  saveFileDialog: (options: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{ success: boolean; data?: string; error?: string }>;
  getVersion: () => Promise<string>;
  onStateChange: (callback: (data: { state: string; data?: unknown }) => void) => void;
  onError: (callback: (message: string) => void) => void;
  onMenuEvent: (event: string, callback: () => void) => void;
  removeAllListeners: (channel: string) => void;
}

const electronAPI: ElectronAPI = {
  initSession: (projectPath: string) =>
    ipcRenderer.invoke("bridge:init-session", projectPath),

  sendQuery: (input) => ipcRenderer.invoke("bridge:query", input),

  abortQuery: () => ipcRenderer.invoke("bridge:abort"),

  getSession: () => ipcRenderer.invoke("bridge:get-session"),

  getPlatform: () => ipcRenderer.invoke("bridge:get-platform"),

  getConfig: () => ipcRenderer.invoke("bridge:get-config"),

  updateConfig: (updates) => ipcRenderer.invoke("bridge:update-config", updates),

  openProjectDialog: () => ipcRenderer.invoke("dialog:open-project"),

  saveFileDialog: (options) => ipcRenderer.invoke("dialog:save-file", options),

  getVersion: () => ipcRenderer.invoke("app:get-version"),

  onStateChange: (callback) => {
    ipcRenderer.on("bridge:state-change", (_event, data) => callback(data));
  },

  onError: (callback) => {
    ipcRenderer.on("bridge:error", (_event, message) => callback(message));
  },

  onMenuEvent: (event: string, callback: () => void) => {
    ipcRenderer.on(`menu:${event}`, () => callback());
  },

  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);