import { contextBridge, ipcRenderer } from "electron";

const ALLOWED_CHANNELS = new Set([
  "bridge:init-session",
  "bridge:query",
  "bridge:abort",
  "bridge:get-session",
  "bridge:get-config",
  "bridge:update-config",
  "bridge:write-file",
  "bridge:read-file",
  "bridge:list-files",
  "bridge:export-session",
  "bridge:delete-session",
  "bridge:get-platform",
  "dialog:open-file",
  "dialog:open-project",
  "dialog:save-file",
  "app:get-version",
  "menu:open-project",
  "menu:export-session",
  "permission-required",
  "permission-response",
  "state-change",
  "streaming",
  "tool-executing",
  "tool-result",
  "cost-update",
  "error",
  "feedback:submit",
]);

const ipcListeners = new Map<string, Array<(event: Electron.IpcRendererEvent, ...args: unknown[]) => void>>();

const safeOn = (channel: string, callback: (...args: unknown[]) => void): void => {
  if (!ALLOWED_CHANNELS.has(channel)) return;
  const wrappedCallback = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
  const channelListeners = ipcListeners.get(channel) || [];
  channelListeners.push(wrappedCallback);
  ipcListeners.set(channel, channelListeners);
  ipcRenderer.on(channel, wrappedCallback);
};

const safeRemoveListener = (channel: string): void => {
  const channelListeners = ipcListeners.get(channel);
  if (channelListeners) {
    for (const listener of channelListeners) {
      ipcRenderer.removeListener(channel, listener);
    }
    ipcListeners.delete(channel);
  }
};

contextBridge.exposeInMainWorld("electronAPI", {
  invoke: (channel: string, ...args: unknown[]) => {
    if (!ALLOWED_CHANNELS.has(channel)) return Promise.reject(new Error(`Channel not allowed: ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  send: (channel: string, ...args: unknown[]) => {
    if (!ALLOWED_CHANNELS.has(channel)) return;
    ipcRenderer.send(channel, ...args);
  },

  on: safeOn,

  removeListener: safeRemoveListener,

  removeAllListeners: (): void => {
    for (const [channel] of ipcListeners) {
      safeRemoveListener(channel);
    }
    ipcListeners.clear();
  },
});
