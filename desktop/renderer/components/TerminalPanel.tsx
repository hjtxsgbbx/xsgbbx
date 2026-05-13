import React, { useState } from "react";

interface TerminalPanelProps {
  toolName: string | null;
  progress: number;
  status: string;
}

export default function TerminalPanel({ toolName, progress, status }: TerminalPanelProps) {
  const [output] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  const isExecuting = status === "executing";

  return React.createElement(
    "div",
    {
      style: {
        borderTop: "1px solid var(--border-color)",
        background: "var(--bg-secondary)",
        display: "flex",
        flexDirection: "column",
        maxHeight: collapsed ? 32 : 200,
        transition: "max-height 0.2s",
      },
    },
    React.createElement(
      "div",
      {
        onClick: () => setCollapsed(!collapsed),
        style: {
          display: "flex",
          alignItems: "center",
          padding: "4px 12px",
          fontSize: 11,
          fontWeight: 600,
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
          letterSpacing: 1,
          color: isExecuting ? "var(--accent-cyan)" : "var(--text-secondary)",
          cursor: "pointer",
          userSelect: "none",
          background: isExecuting ? "rgba(0,212,255,0.05)" : "transparent",
        },
      },
      React.createElement(
        "span",
        { style: { marginRight: 8 } },
        collapsed ? "▶" : "▼"
      ),
      React.createElement("span", { style: { marginRight: 8 } }, "Terminal"),
      toolName &&
        React.createElement(
          "span",
          {
            style: {
              color: "var(--accent-yellow)",
              marginRight: 8,
            },
          },
          `Running: ${toolName}`
        ),
      isExecuting &&
        React.createElement(
          "div",
          {
            style: {
              flex: 1,
              height: 3,
              background: "var(--bg-tertiary)",
              borderRadius: 2,
              margin: "0 8px",
              overflow: "hidden",
            },
          },
          React.createElement("div", {
            style: {
              height: "100%",
              width: `${progress}%`,
              background: "linear-gradient(90deg, var(--accent-cyan), var(--accent-green))",
              borderRadius: 2,
              transition: "width 0.3s",
            },
          })
        )
    ),
    !collapsed &&
      React.createElement(
        "div",
        {
          style: {
            flex: 1,
            overflow: "auto",
            padding: "4px 12px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--text-secondary)",
          },
        },
        output.length > 0
          ? output.map((line, i) =>
              React.createElement("div", { key: i }, line)
            )
          : React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  opacity: 0.5,
                },
              },
              React.createElement("span", null, "💻"),
              isExecuting
                ? "Executing command..."
                : "Terminal output will appear here"
            )
      )
  );
}