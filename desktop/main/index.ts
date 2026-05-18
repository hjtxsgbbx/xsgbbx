import { app, BrowserWindow, globalShortcut, nativeTheme, session } from "electron";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { registerIpcHandlers, destroyBridge } from "./ipc-bridge.js";
import { buildAppMenu } from "./menu.js";
import { createTray } from "./tray.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let trayInstance: ReturnType<typeof createTray> | null = null;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "agent_1",
    icon: join(__dirname, "..", "..", "assets", "icon.png"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#080c16" : "#ffffff",
    webPreferences: {
      preload: join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    show: false,
  });

  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  return win;
}

function loadRenderer(win: BrowserWindow): void {
  if (process.env.NODE_ENV === "development") {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(join(__dirname, "..", "renderer", "index.html"));
  }
}

app.whenReady().then(() => {
  nativeTheme.themeSource = "dark";

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self';"
        ],
        "X-Content-Type-Options": ["nosniff"],
        "X-Frame-Options": ["DENY"],
        "X-XSS-Protection": ["1; mode=block"],
        "Referrer-Policy": ["no-referrer"],
      },
    });
  });

  const menu = buildAppMenu();
  menu.setup();

  mainWindow = createMainWindow();
  registerIpcHandlers();
  loadRenderer(mainWindow);

  trayInstance = createTray(mainWindow);

  globalShortcut.register("CommandOrControl+Shift+L", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      loadRenderer(mainWindow);
    } else {
      mainWindow?.show();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  destroyBridge();
  globalShortcut.unregisterAll();
});

app.on("will-quit", () => {
  if (trayInstance) {
    trayInstance.destroy();
  }
});