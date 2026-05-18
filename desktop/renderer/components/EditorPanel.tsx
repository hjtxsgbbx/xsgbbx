import React, { useState, useEffect, useCallback } from "react";

interface EditorPanelProps {
  filePath: string | null;
  projectPath: string;
}

export const EditorPanel: React.FC<EditorPanelProps> = ({ filePath, projectPath }) => {
  const [fileContent, setFileContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");

  const loadFile = useCallback(async () => {
    if (!filePath) {
      setFileContent("");
      setFileName("");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI?.invoke("bridge:read-file", filePath);
      if (result?.success && typeof result.data === "string") {
        setFileContent(result.data);
        setFileName(
          filePath.split("/").pop() || filePath.split("\\").pop() || filePath
        );
      } else {
        setError(result?.error || "Failed to read file");
        setFileContent("");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setFileContent("");
    } finally {
      setLoading(false);
    }
  }, [filePath]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  if (!filePath) {
    return React.createElement(
      "div",
      { className: "editor-empty" },
      React.createElement("div", { className: "editor-empty-icon" },
        React.createElement("svg", { className: "icon-svg icon-lg", viewBox: "0 0 24 24" },
          React.createElement("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }),
          React.createElement("polyline", { points: "14 2 14 8 20 8" }),
          React.createElement("line", { x1: "16", y1: "13", x2: "8", y2: "13" }),
          React.createElement("line", { x1: "16", y1: "17", x2: "8", y2: "17" }),
          React.createElement("polyline", { points: "10 9 9 9 8 9" })
        )
      ),
      React.createElement("div", null, "Select a file to view its content")
    );
  }

  return React.createElement(
    "div",
    { className: "editor-container" },
    React.createElement(
      "div",
      { className: "editor-header" },
      React.createElement("span", null,
        React.createElement("svg", { className: "icon-svg", viewBox: "0 0 24 24", style: { marginRight: "6px", verticalAlign: "-2px" } },
          React.createElement("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }),
          React.createElement("polyline", { points: "14 2 14 8 20 8" })
        ),
        fileName
      ),
    ),
    loading
      ? React.createElement("div", { className: "editor-empty" }, "Loading file...")
      : error
        ? React.createElement(
            "div",
            { className: "editor-empty", style: { color: "var(--accent-red)" } },
            error
          )
        : React.createElement(
            "pre",
            { className: "editor-content" },
            fileContent || "(empty file)"
          )
  );
};