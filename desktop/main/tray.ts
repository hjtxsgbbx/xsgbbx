import { Tray, Menu, BrowserWindow, nativeImage, app } from "electron";
import { join } from "path";

let tray: Tray | null = null;

export function createTray(mainWindow: BrowserWindow | null) {
  if (tray) {
    tray.destroy();
    tray = null;
  }

  const iconPath = join(__dirname, "..", "..", "assets", "tray-icon.png");
  let trayIcon: Electron.NativeImage;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createEmpty();
    }
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
  tray.setToolTip("agent_1");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Window",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "Toggle Minimize",
      click: () => {
        if (mainWindow?.isVisible()) {
          mainWindow.minimize();
        } else {
          mainWindow?.show();
          mainWindow?.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  return {
    destroy: () => {
      if (tray) {
        tray.destroy();
        tray = null;
      }
    },
    getTray: () => tray,
  };
}