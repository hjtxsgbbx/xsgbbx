import React, { useState } from "react";

interface EditorPanelProps {
  projectPath: string;
  status: string;
}

export default function EditorPanel({ projectPath, status }: EditorPanelProps) {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent] = useState("");

  return React.createElement(
    "div",
    {
      style: {
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-secondary)",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          borderBottom: "1px solid var(--border-color)",
          overflow: "auto",
        },
      },
      activeFile
        ? React.createElement(
            "div",
            {
              style: {
                padding: "6px 12px",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                color: "var(--accent-cyan)",
                borderBottom: "2px solid var(--accent-cyan)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              },
            },
            React.createElement("span", null, "📄"),
            React.createElement("span", null, activeFile),
            React.createElement(
              "span",
              {
                onClick: () => setActiveFile(null),
                style: {
                  cursor: "pointer",
                  fontSize: 14,
                  color: "var(--text-secondary)",
                  marginLeft: 8,
                },
              },
              "×"
            )
          )
        : React.createElement(
            "div",
            {
              style: {
                padding: "6px 12px",
                fontSize: 12,
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono)",
              },
            },
            "No file open"
          )
    ),
    React.createElement(
      "div",
      {
        style: {
          flex: 1,
          overflow: "auto",
          padding: "12px",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          lineHeight: 1.6,
        },
      },
      activeFile
        ? React.createElement(
            "div",
            {
              style: {
                whiteSpace: "pre-wrap",
                color: "var(--text-primary)",
              },
            },
            fileContent ||
              "// File content will be loaded from disk\n// Double-click a file in the explorer to open it here"
          )
        : React.createElement(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--text-secondary)",
                fontSize: 14,
                flexDirection: "column",
                gap: 8,
              },
            },
            React.createElement("div", { style: { fontSize: 32, opacity: 0.3 } }, "📝"),
            React.createElement("div", null, "选择文件以查看和编辑"),
            React.createElement(
              "div",
              { style: { fontSize: 12, opacity: 0.5 } },
              "支持语法高亮 · 差异对比 · 智能补全"
            )
          )
    )
  );
}