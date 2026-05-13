import React from "react";

interface StatusBarProps {
  provider: string;
  projectPath: string;
  lastSent: string;
  modelName: string;
  tokenUsage: { input: number; output: number; total: number; limit: number } | null;
  onToggleFileTree: () => void;
}

export default function StatusBar({
  provider,
  projectPath,
  lastSent,
  modelName,
  tokenUsage,
  onToggleFileTree,
}: StatusBarProps) {
  const timeSince =
    lastSent && lastSent.length > 0
      ? Math.round((Date.now() - new Date(lastSent).getTime()) / 1000) + "s 前"
      : "--";

  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        padding: "4px 12px",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        background: "var(--bg-primary)",
        borderTop: "1px solid var(--border-color)",
        gap: 16,
        color: "var(--text-secondary)",
        minHeight: 28,
      },
    },
    React.createElement(
      "span",
      {
        onClick: onToggleFileTree,
        style: {
          cursor: "pointer",
          color: "var(--accent-cyan)",
          fontWeight: 600,
        },
      },
      "☰"
    ),
    projectPath &&
      React.createElement(
        "span",
        { style: { display: "flex", alignItems: "center", gap: 4 } },
        "📁",
        React.createElement(
          "span",
          {
            style: {
              maxWidth: 200,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            },
          },
          projectPath.split(/[/\\]/).pop() || projectPath
        )
      ),
    React.createElement(
      "span",
      { style: { display: "flex", alignItems: "center", gap: 4 } },
      "📡",
      "发送至",
      React.createElement(
        "span",
        { style: { color: "var(--accent-cyan)", fontWeight: 600 } },
        provider === "anthropic" ? "Anthropic" : "OpenAI"
      ),
      "|",
      React.createElement("span", null, `上次: ${timeSince}`)
    ),
    modelName &&
      React.createElement("span", null, "🤖 " + modelName),
    tokenUsage &&
      React.createElement(
        "span",
        { style: { color: "var(--accent-yellow)" } },
        `Tok: ${tokenUsage.total}/${tokenUsage.limit}`
      ),
    React.createElement("div", { style: { flex: 1 } }),
    React.createElement(
      "span",
      { style: { color: "var(--accent-green)" } },
      "agent_1 v1.0.0"
    )
  );
}