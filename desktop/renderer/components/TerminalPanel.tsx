import React, { useState, useEffect, useRef } from "react";

interface TerminalEntry {
  text: string;
  type: "info" | "tool" | "result" | "error";
}

interface TerminalPanelProps {
  projectPath: string;
  entries?: TerminalEntry[];
}

export default function TerminalPanel({ projectPath, entries }: TerminalPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current && !collapsed) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [entries, collapsed]);

  const output = entries || [];

  return React.createElement(
    "div",
    {
      className: "terminal-container",
      style: { maxHeight: collapsed ? "28px" : "200px" },
    },
    React.createElement(
      "div",
      {
        onClick: () => setCollapsed(!collapsed),
        className: "terminal-header",
        style: { borderBottom: collapsed ? "none" : "1px solid var(--border-subtle)" },
      },
      React.createElement("span", null, "Terminal ", collapsed ? "▶" : "▼"),
      React.createElement(
        "span",
        { style: { color: "var(--text-muted)" } },
        projectPath || "no project"
      ),
      output.length > 0 && React.createElement(
        "span",
        { style: { marginLeft: "auto", fontSize: "10px", color: "var(--text-muted)" } },
        output.length + " entries"
      )
    ),
    !collapsed &&
      React.createElement(
        "div",
        { className: "terminal-body", ref: bodyRef },
        output.length > 0
          ? output.map((entry, i) =>
              React.createElement("div", {
                key: i,
                className: "terminal-line terminal-" + entry.type,
              }, entry.text)
            )
          : React.createElement(
              "div",
              { className: "terminal-empty" },
              "Ready — project: ",
              projectPath || "none"
            )
      )
  );
}
