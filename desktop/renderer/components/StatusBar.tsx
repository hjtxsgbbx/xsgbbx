import React from "react";

interface StatusBarProps {
  sessionId: string | null;
  projectPath: string;
  mode: string;
  tokens: number;
  tps: number;
  model: string;
  cost: number;
  thinkingState: string;
  onFeedback: () => void;
}

export default function StatusBar({
  sessionId,
  projectPath,
  mode,
  tokens,
  tps,
  model,
  cost,
  thinkingState,
  onFeedback,
}: StatusBarProps) {
  return React.createElement(
    "footer",
    { className: "statusbar", role: "contentinfo", "aria-label": "Status bar" },
    React.createElement(
      "div",
      { className: "statusbar-left" },
      React.createElement(
        "span",
        { className: "statusbar-mode" + (mode ? " " + mode : " default"), "aria-label": "Current mode: " + (mode || "default") },
        "Mode: ",
        React.createElement("span", null, mode || "default")
      ),
      React.createElement(
        "span",
        { className: "statusbar-agent", "aria-label": "Agent state: " + (thinkingState || "idle") },
        React.createElement("span", {
          className: "statusbar-agent-dot " + (thinkingState || "idle"),
          "aria-hidden": "true",
        }),
        "Agent: ",
        thinkingState || "idle"
      ),
      React.createElement("span", { "aria-label": "Current model" }, "Model: ", model),
      sessionId &&
        React.createElement(
          "span",
          { style: { color: "var(--text-muted)" }, "aria-label": "Session ID" },
          "Session: ",
          sessionId.slice(0, 8),
          "..."
        )
    ),
    React.createElement(
      "div",
      { className: "statusbar-right" },
      React.createElement("span", { "aria-label": "Tokens used" }, "Tokens: ", tokens.toLocaleString()),
      React.createElement("span", { "aria-label": "Tokens per second" }, "TPS: ", tps.toFixed(1)),
      cost > 0 &&
        React.createElement("span", { "aria-label": "Total cost" }, "Cost: $", cost.toFixed(4)),
      projectPath &&
        React.createElement(
          "span",
          { style: { color: "var(--text-muted)" }, "aria-label": "Project: " + projectPath.split(/[/\\]/).pop() },
          projectPath.split(/[/\\]/).pop()?.slice(0, 20) || ""
        ),
      React.createElement(
        "button",
        {
          className: "feedback-btn",
          onClick: onFeedback,
          "aria-label": "Send feedback",
          tabIndex: 0,
        },
        "Feedback"
      )
    )
  );
}
