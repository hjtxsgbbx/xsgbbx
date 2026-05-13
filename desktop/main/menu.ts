import { Menu, BrowserWindow, app, shell } from "electron";

export function buildAppMenu() {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Project...",
          accelerator: "CmdOrCtrl+O",
          click: (_menuItem, browserWindow) => {
            browserWindow?.webContents.send("menu:open-project");
          },
        },
        {
          label: "Export Session...",
          accelerator: "CmdOrCtrl+Shift+E",
          click: (_menuItem, browserWindow) => {
            browserWindow?.webContents.send("menu:export-session");
          },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [
              { type: "separator" as const },
              { role: "front" as const },
              { type: "separator" as const },
              { role: "window" as const },
            ]
          : [{ role: "close" }]),
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Documentation",
          click: () => shell.openExternal("https://agent1.dev/docs"),
        },
        {
          label: "Report Issue",
          click: () =>
            shell.openExternal("https://github.com/agent1/agent_1/issues"),
        },
        { type: "separator" },
        {
          label: "About agent_1",
          click: () => {
            dialog.showMessageBox({
              title: "About agent_1",
              message: "agent_1 v1.0.0",
              detail: "跨平台 AI 编程助手 - Electron 桌面客户端",
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);

  return {
    setup: () => {
      Menu.setApplicationMenu(menu);
    },
    getMenu: () => menu,
  };
}

import { dialog } from "electron";