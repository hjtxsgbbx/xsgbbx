import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import ChatPanel from "./components/ChatPanel.js";
import { FileTree } from "./components/FileTree.js";
import StatusBar from "./components/StatusBar.js";

const EditorPanel = lazy(() => import("./components/EditorPanel.js").then(m => ({ default: m.EditorPanel })));
const TerminalPanel = lazy(() => import("./components/TerminalPanel.js"));
const WelcomeScreen = lazy(() => import("./components/WelcomeScreen.js").then(m => ({ default: m.WelcomeScreen })));
const PermissionDialog = lazy(() => import("./components/PermissionDialog.js"));
const FeedbackPanel = lazy(() => import("./components/FeedbackPanel.js"));

const SuspenseFallback = React.createElement("div", { className: "suspense-loading" }, "Loading...");

function withSuspense(element: React.ReactElement): React.ReactElement {
  return React.createElement(Suspense, { fallback: SuspenseFallback }, element);
}

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

interface DialogState {
  actor: "assistant";
  tool_name: string;
  args: Record<string, unknown>;
  question: string;
  resolve?: (proceed: boolean, reason?: string) => void;
}

interface AppState {
  sessionId: string | null;
  projectPath: string;
  platform: string;
  mode: "default" | "plan" | "act" | "defaultDeny" | "autoApprove" | "sandbox";
  tokens: number;
  tps: number;
  model: string;
  cost: number;
  thinkingState: "idle" | "thinking" | "observing" | "reflecting" | "acting";
  status: string;
  errorMessage?: string;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null; errorInfo: React.ErrorInfo | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, errorInfo);
    try {
      window.electronAPI?.invoke("bridge:log-error", {
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
      });
    } catch {}
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return React.createElement(
        "div",
        { className: "error-boundary" },
        React.createElement("h2", null, "Application Error"),
        React.createElement(
          "pre",
          { style: { color: "var(--accent-red)", fontSize: "13px", maxWidth: "600px", overflow: "auto" } },
          this.state.error?.message || "Unknown error"
        ),
        this.state.errorInfo?.componentStack &&
          React.createElement(
            "details",
            { style: { marginTop: "8px", fontSize: "11px", color: "var(--text-muted)" } },
            React.createElement("summary", null, "Component Stack"),
            React.createElement("pre", null, this.state.errorInfo.componentStack)
          ),
        React.createElement(
          "button",
          {
            className: "btn-retry",
            onClick: this.handleRetry,
          },
          "Try Again"
        )
      );
    }

    return this.props.children;
  }
}

const INITIAL_STATE: AppState = {
  sessionId: null,
  projectPath: "",
  platform: "unknown",
  mode: "default",
  tokens: 0,
  tps: 0,
  model: "",
  cost: 0,
  thinkingState: "idle",
  status: "idle",
};

export const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(INITIAL_STATE);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<{ role: string; content: string; timestamp: string; isStreaming?: boolean }>>([]);
  const [terminalEntries, setTerminalEntries] = useState<Array<{ text: string; type: "info" | "tool" | "result" | "error" }>>([]);
  const [showWelcome, setShowWelcome] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  const api = window.electronAPI;

  const handleOpenProject = useCallback(async () => {
    try {
      const result = await api?.invoke?.("dialog:open-project");
      if (result?.success && result.data) {
        setAppState((prev) => ({ ...prev, projectPath: result.data as string }));

        const sessionResult = await api?.invoke?.("bridge:init-session", result.data);
        if (sessionResult?.success && sessionResult.data) {
          const session = sessionResult.data as { session_id: string };
          setAppState((prev) => ({ ...prev, sessionId: session.session_id }));
          setShowWelcome(false);
        }
      }
    } catch {
      /* silent */
    }
  }, [api]);

  const handleExportSession = useCallback(async () => {
    try {
      const result = await api?.invoke?.("bridge:get-session");
      if (!result?.success || !result.data) return;

      const saveResult = await api?.invoke?.("dialog:save-file", {
        defaultPath: `agent_1-session-${appState.sessionId?.slice(0, 8) || "export"}.json`,
        filters: [{ name: "JSON Files", extensions: ["json"] }],
      });

      if (saveResult?.success && saveResult.data) {
        await api?.invoke?.("bridge:export-session", saveResult.data as string,
          JSON.stringify(result.data, null, 2));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setAppState((prev) => ({ ...prev, status: "error", errorMessage: message }));
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Export failed: ${message}`, timestamp: new Date().toISOString() },
      ]);
    }
  }, [appState.sessionId, api]);

  useEffect(() => {
    if (api?.on) {
      api.on("permission-required", (data: unknown) => {
        const d = data as Record<string, unknown>;
        setDialog({
          actor: "assistant",
          tool_name: d.tool_name as string,
          args: d.args as Record<string, unknown>,
          question: d.question as string,
          resolve: (proceed: boolean, reason?: string) => {
            api?.send?.("permission-response", { proceed, reason });
            setDialog(null);
          },
        });
      });

      api.on("state-change", (data: unknown) => {
        const d = data as { state: string };
        const validStates: AppState["thinkingState"][] = ["idle", "thinking", "observing", "reflecting", "acting"];
        const mappedState = d.state === "delivered" ? "idle" : d.state === "executing" ? "acting" : d.state;
        setAppState((prev) => ({
          ...prev,
          thinkingState: validStates.includes(mappedState as AppState["thinkingState"]) ? (mappedState as AppState["thinkingState"]) : "idle",
          status: d.state === "idle" ? "idle" : (d.state === "thinking" ? "thinking" : "executing"),
        }));
        if (d.state === "compacting") {
          setTerminalEntries((prev) => [...prev, { text: `[${new Date().toLocaleTimeString()}] Context compacted`, type: "info" }]);
        }
      });

      api.on("streaming", (data: unknown) => {
        const d = data as { chunk?: string };
        if (d.chunk) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && last.isStreaming) {
              return [...prev.slice(0, -1), { ...last, content: last.content + d.chunk }];
            }
            return [...prev, { role: "assistant", content: d.chunk!, timestamp: new Date().toISOString(), isStreaming: true }];
          });
        }
      });

      api.on("tool-executing", (data: unknown) => {
        const d = data as { toolName?: string };
        setAppState((prev) => ({ ...prev, thinkingState: "acting", status: "executing" }));
        if (d.toolName) {
          setTerminalEntries((prev) => [...prev, { text: `[${new Date().toLocaleTimeString()}] Executing: ${d.toolName}`, type: "tool" }]);
        }
      });

      api.on("tool-result", (data: unknown) => {
        const d = data as { toolName?: string; success?: boolean };
        setAppState((prev) => ({ ...prev, status: "thinking" }));
        const status = d.success === false ? "failed" : "completed";
        setTerminalEntries((prev) => [...prev, { text: `[${new Date().toLocaleTimeString()}] ${d.toolName || "Tool"} ${status}`, type: d.success === false ? "error" : "result" }]);
      });

      api.on("cost-update", (data: unknown) => {
        const d = data as { totalCost?: number; tokens?: number; tps?: number; model?: string };
        setAppState((prev) => ({
          ...prev,
          cost: d.totalCost ?? prev.cost,
          tokens: d.tokens ?? prev.tokens,
          tps: d.tps ?? prev.tps,
          model: d.model ?? prev.model,
        }));
      });

      api.on("error", (data: unknown) => {
        const message = typeof data === "string" ? data : "An error occurred";
        setAppState((prev) => ({ ...prev, status: "error", errorMessage: message }));
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.isStreaming) {
            return [...prev.slice(0, -1), { ...last, isStreaming: false }];
          }
          return [
            ...prev,
            { role: "assistant", content: `Error: ${message}`, timestamp: new Date().toISOString(), isStreaming: false },
          ];
        });
      });

      api.on("menu:open-project", () => {
        handleOpenProject();
      });

      api.on("menu:export-session", () => {
        handleExportSession();
      });
    }

    return () => {
      api?.removeListener?.("permission-required");
      api?.removeListener?.("state-change");
      api?.removeListener?.("streaming");
      api?.removeListener?.("tool-executing");
      api?.removeListener?.("tool-result");
      api?.removeListener?.("cost-update");
      api?.removeListener?.("error");
      api?.removeListener?.("menu:open-project");
      api?.removeListener?.("menu:export-session");
    };
  }, [api, handleOpenProject, handleExportSession]);

  const handleSendMessage = useCallback(async (text: string, interrupt?: boolean) => {
    if (!text.trim() || !appState.sessionId) return;

    const userMsg = {
      role: "user" as const,
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    setAppState((prev) => ({ ...prev, thinkingState: "thinking", status: "thinking" }));

    try {
      const result = await api?.invoke?.("bridge:query", { text, interrupt: !!interrupt });
      if (result?.success && result.data) {
        const data = result.data as { content?: string };
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.isStreaming) {
            return [...prev.slice(0, -1), { ...last, content: data.content || last.content, isStreaming: false }];
          }
          return [
            ...prev,
            {
              role: "assistant",
              content: data.content || "Done.",
              timestamp: new Date().toISOString(),
              isStreaming: false,
            },
          ];
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${message}`, timestamp: new Date().toISOString(), isStreaming: false },
      ]);
    } finally {
      setAppState((prev) => ({ ...prev, thinkingState: "idle", status: "idle" }));
    }
  }, [appState.sessionId, api]);

  const handleToggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleShowHelp = useCallback(() => {
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content:
          "**agent_1 Desktop Help**\n\n" +
          "- **Open Project**: Select a project directory to begin.\n" +
          "- **Chat**: Type your request and the AI agent will help.\n" +
          "- **File Tree**: Browse and select files to view content.\n" +
          "- **Editor**: View file contents (read-only).\n" +
          "- **Terminal**: See command output and logs.\n" +
          "- **Status Bar**: Shows current mode, tokens used, and agent state.\n" +
          "- **Modes**: /mode to switch between plan/act/default.\n" +
          "- **Export**: Export the current session as JSON.\n",
        timestamp: new Date().toISOString(),
      },
    ]);
  }, []);

  const handleSubmitFeedback = useCallback(
    (data: { category: string; summary: string; details: string }) => {
      const entry = {
        source: "in_app",
        category: data.category,
        severity: data.category === "bug" ? "high" : "medium",
        platform: "desktop" as const,
        summary: data.summary,
        details: data.details,
        metadata: {
          sessionId: appState.sessionId,
          model: appState.model,
          projectPath: appState.projectPath,
          timestamp: new Date().toISOString(),
        },
      };

      try {
        const stored = JSON.parse(localStorage.getItem("agent1_feedback") || "[]");
        stored.push(entry);
        if (stored.length > 100) stored.splice(0, stored.length - 100);
        localStorage.setItem("agent1_feedback", JSON.stringify(stored));
      } catch {}

      api?.send?.("feedback:submit", entry);
    },
    [appState.sessionId, appState.model, appState.projectPath, api]
  );

  if (showWelcome) {
    return React.createElement(
      ErrorBoundary,
      null,
      withSuspense(React.createElement(WelcomeScreen, {
        status: appState.projectPath ? "ready" : "disconnected",
        onOpenProject: handleOpenProject,
        onShowHelp: handleShowHelp,
      }))
    );
  }

  return React.createElement(
    ErrorBoundary,
    null,
    React.createElement(
      "div",
      { className: "app-container" },
      React.createElement(
        "div",
        { className: "app-main" },
        React.createElement(
          "button",
          {
            className: "sidebar-toggle",
            onClick: () => setSidebarOpen(!sidebarOpen),
            "aria-label": "Toggle file explorer",
            tabIndex: 0,
          },
          "\u2630"
        ),
        React.createElement(
          "div",
          {
            className: "sidebar-overlay" + (sidebarOpen ? " visible" : ""),
            onClick: () => setSidebarOpen(false),
            "aria-hidden": "true",
          }
        ),
        React.createElement(
          "nav",
          { className: "sidebar" + (sidebarOpen ? " open" : ""), "aria-label": "File explorer" },
          React.createElement(
            "div",
            { className: "sidebar-header" },
            React.createElement("span", { className: "sidebar-logo-dot", "aria-hidden": "true" }),
            React.createElement("span", { className: "sidebar-logo" }, "agent_1"),
            React.createElement(
              "button",
              {
                className: "theme-toggle-btn",
                style: { marginLeft: "auto" },
                onClick: () => {
                  const next = document.documentElement.getAttribute("data-theme") === "studio" ? "developer" : "studio";
                  document.documentElement.setAttribute("data-theme", next);
                  try { localStorage.setItem("agent1_theme", next); } catch {}
                },
                title: "Switch theme",
                "aria-label": "Switch between Developer and Studio theme",
              },
              "Theme"
            )
          ),
          React.createElement("div", { className: "sidebar-section-label" }, "Explorer"),
          React.createElement(
            "div",
            { className: "sidebar-files" },
            React.createElement(FileTree, {
              projectPath: appState.projectPath,
              expandedFolders,
              selectedFile,
              onFileSelect: setSelectedFile,
              onToggleFolder: handleToggleFolder,
            })
          )
        ),
        React.createElement(
          "main",
          { className: "content-area", "aria-label": "Main content" },
          React.createElement(
            "div",
            { className: "content-split" },
            React.createElement(ChatPanel, {
              messages,
              status: appState.status,
              onSend: handleSendMessage,
              onAbort: () => { api?.invoke?.("bridge:abort"); },
            }),
            withSuspense(React.createElement(EditorPanel, {
              filePath: selectedFile,
              projectPath: appState.projectPath,
            }))
          ),
          withSuspense(React.createElement(TerminalPanel, { projectPath: appState.projectPath, entries: terminalEntries }))
        )
      ),
      React.createElement(StatusBar, {
        sessionId: appState.sessionId,
        projectPath: appState.projectPath,
        mode: appState.mode,
        tokens: appState.tokens,
        tps: appState.tps,
        model: appState.model,
        cost: appState.cost,
        thinkingState: appState.thinkingState,
        onFeedback: () => setShowFeedback(true),
      }),
      dialog &&
        withSuspense(React.createElement(PermissionDialog, {
          actor: dialog.actor,
          toolName: dialog.tool_name,
          toolArgs: dialog.args,
          question: dialog.question,
          onAllow: (reason?: string) => dialog.resolve?.(true, reason),
          onDeny: () => dialog.resolve?.(false),
          onAlways: (reason?: string) => dialog.resolve?.(true, reason ? `always: ${reason}` : "always"),
        })),
      showFeedback &&
        withSuspense(React.createElement(FeedbackPanel, {
          onSubmit: handleSubmitFeedback,
          onClose: () => setShowFeedback(false),
        }))
    )
  );
};
