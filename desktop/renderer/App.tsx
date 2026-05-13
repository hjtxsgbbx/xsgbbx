import React, { useState, useEffect, useCallback } from "react";
import ChatPanel from "./components/ChatPanel.js";
import FileTree from "./components/FileTree.js";
import EditorPanel from "./components/EditorPanel.js";
import TerminalPanel from "./components/TerminalPanel.js";
import StatusBar from "./components/StatusBar.js";
import PermissionDialog from "./components/PermissionDialog.js";
import WelcomeScreen from "./components/WelcomeScreen.js";
import type { ElectronAPI } from "../preload/index.js";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export interface AppState {
  status: "welcome" | "idle" | "thinking" | "executing" | "permission_denied" | "needs_confirmation" | "error" | "compacting" | "delivered";
  projectPath: string | null;
  provider: string;
  sessionId: string | null;
  lastSentTimestamp: string;
  currentTool: string | null;
  progress: number;
  tokenUsage: { input: number; output: number; total: number; limit: number } | null;
  modelName: string;
  errorMessage: string | null;
  commitHash: string | null;
  generatedFiles: string[];
  pendingConfirmation: { reason: string; command: string } | null;
}

export default function App() {
  const [appState, setAppState] = useState<AppState>({
    status: "welcome",
    projectPath: null,
    provider: "anthropic",
    sessionId: null,
    lastSentTimestamp: "",
    currentTool: null,
    progress: 0,
    tokenUsage: null,
    modelName: "",
    errorMessage: null,
    commitHash: null,
    generatedFiles: [],
    pendingConfirmation: null,
  });

  const [messages, setMessages] = useState<Array<{ role: string; content: string; timestamp: string }>>([]);
  const [showFileTree, setShowFileTree] = useState(true);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.onStateChange((data) => {
      const { state, data: payload } = data;
      switch (state) {
        case "thinking":
          setAppState((prev) => ({
            ...prev,
            status: "thinking",
            modelName: (payload as { model?: string })?.model || prev.modelName,
            tokenUsage: (payload as { usage?: AppState["tokenUsage"] })?.usage || prev.tokenUsage,
          }));
          break;
        case "executing":
          setAppState((prev) => ({
            ...prev,
            status: "executing",
            currentTool: (payload as { toolName?: string })?.toolName || null,
          }));
          break;
        case "tool_result":
          setAppState((prev) => ({
            ...prev,
            status: "idle",
          }));
          break;
        case "permission_denied":
          setAppState((prev) => ({
            ...prev,
            status: "permission_denied",
            pendingConfirmation: payload as AppState["pendingConfirmation"],
          }));
          break;
        case "needs_confirmation":
          setAppState((prev) => ({
            ...prev,
            status: "needs_confirmation",
            pendingConfirmation: payload as AppState["pendingConfirmation"],
          }));
          break;
        case "compacting":
          setAppState((prev) => ({ ...prev, status: "compacting" }));
          break;
        case "progress":
          setAppState((prev) => ({
            ...prev,
            progress: (payload as { percent?: number })?.percent || 0,
          }));
          break;
        case "error":
          setAppState((prev) => ({
            ...prev,
            status: "error",
            errorMessage: (payload as { message?: string })?.message || "Unknown error",
          }));
          break;
      }
    });

    api.onError((message) => {
      setAppState((prev) => ({ ...prev, status: "error", errorMessage: message }));
    });

    api.onMenuEvent("open-project", () => handleOpenProject());
    api.onMenuEvent("export-session", () => handleExportSession());

    return () => {
      api.removeAllListeners("bridge:state-change");
      api.removeAllListeners("bridge:error");
      api.removeAllListeners("menu:open-project");
      api.removeAllListeners("menu:export-session");
    };
  }, []);

  const handleOpenProject = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;

    const result = await api.openProjectDialog();
    if (result.success && result.data) {
      const sessionResult = await api.initSession(result.data);
      if (sessionResult.success) {
        const session = sessionResult.data as { session_id: string; meta: { provider: string } };
        setAppState((prev) => ({
          ...prev,
          status: "idle",
          projectPath: result.data!,
          sessionId: session.session_id,
          provider: session.meta.provider,
          lastSentTimestamp: new Date().toISOString(),
        }));
      }
    }
  }, []);

  const handleExportSession = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;

    const result = await api.saveFileDialog({
      defaultPath: `agent_1_session_${Date.now()}.json`,
      filters: [{ name: "JSON Files", extensions: ["json"] }],
    });

    if (result.success && result.data) {
      const session = await api.getSession();
    }
  }, []);

  const handleSendMessage = useCallback(
    async (text: string, interrupt?: boolean) => {
      const api = window.electronAPI;
      if (!api) return;

      const userMsg = {
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setAppState((prev) => ({
        ...prev,
        status: "thinking",
        lastSentTimestamp: new Date().toISOString(),
      }));

      const result = await api.sendQuery({
        text,
        timestamp: new Date().toISOString(),
        interrupt,
      });

      if (result.success && result.data) {
        const queryResult = result.data as {
          response: { content: string; model: string };
          stopReason: string;
        };

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: queryResult.response.content,
            timestamp: new Date().toISOString(),
          },
        ]);

        setAppState((prev) => ({
          ...prev,
          status: queryResult.stopReason === "end_turn" ? "delivered" : "idle",
        }));
      } else {
        setAppState((prev) => ({
          ...prev,
          status: "error",
          errorMessage: result.error || "Query failed",
        }));
      }
    },
    []
  );

  const handleConfirmation = useCallback(
    async (confirmed: boolean) => {
      if (confirmed) {
        await handleSendMessage("I understand the risk - proceed with the operation", true);
      }
      setAppState((prev) => ({
        ...prev,
        status: "idle",
        pendingConfirmation: null,
      }));
    },
    [handleSendMessage]
  );

  if (appState.status === "welcome") {
    return React.createElement(WelcomeScreen, { onOpenProject: handleOpenProject });
  }

  return React.createElement(
    "div",
    { style: { display: "flex", flexDirection: "column", height: "100vh" } },
    React.createElement(
      "div",
      { style: { display: "flex", flex: 1, overflow: "hidden" } },
      showFileTree &&
        React.createElement(
          "div",
          {
            style: {
              width: 260,
              borderRight: "1px solid var(--border-color)",
              overflow: "auto",
            },
          },
          React.createElement(FileTree, {
            projectPath: appState.projectPath || "",
            onFileSelect: (filePath: string) => {
              setAppState((prev) => ({ ...prev }));
            },
          })
        ),
      React.createElement(
        "div",
        { style: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" } },
        React.createElement(
          "div",
          { style: { flex: 1, display: "flex", overflow: "hidden" } },
          React.createElement(
            "div",
            { style: { flex: 1, display: "flex", flexDirection: "column" } },
            React.createElement(
              "div",
              { style: { flex: 1, overflow: "auto" } },
              React.createElement(ChatPanel, {
                messages,
                status: appState.status,
                onSend: handleSendMessage,
                onAbort: () => window.electronAPI?.abortQuery(),
              })
            ),
            React.createElement(TerminalPanel, {
              toolName: appState.currentTool,
              progress: appState.progress,
              status: appState.status,
            })
          ),
          React.createElement(
            "div",
            {
              style: {
                width: appState.status === "thinking" || appState.status === "executing" ? 0 : "50%",
                borderLeft: "1px solid var(--border-color)",
                overflow: "hidden",
              },
            },
            React.createElement(EditorPanel, {
              projectPath: appState.projectPath || "",
              status: appState.status,
            })
          )
        )
      )
    ),
    React.createElement(StatusBar, {
      provider: appState.provider,
      projectPath: appState.projectPath || "",
      lastSent: appState.lastSentTimestamp,
      modelName: appState.modelName,
      tokenUsage: appState.tokenUsage,
      onToggleFileTree: () => setShowFileTree((prev) => !prev),
    }),
    (appState.status === "permission_denied" || appState.status === "needs_confirmation") &&
      appState.pendingConfirmation &&
      React.createElement(PermissionDialog, {
        reason: appState.pendingConfirmation.reason,
        command: appState.pendingConfirmation.command,
        canOverride: appState.status === "permission_denied",
        onConfirm: () => handleConfirmation(true),
        onCancel: () => handleConfirmation(false),
      })
  );
}