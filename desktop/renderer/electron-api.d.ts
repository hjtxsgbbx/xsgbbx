interface ElectronAPI {
  invoke(channel: string, ...args: unknown[]): Promise<{ success: boolean; data?: unknown; error?: string }>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, callback: (data: unknown) => void): void;
  removeListener(channel: string): void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};