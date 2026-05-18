import React, { useState, useCallback, useEffect, useRef } from "react";

interface ExecutionStep {
  id: string;
  agentName: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  progress: number;
  startTime?: string;
  endTime?: string;
  result?: string;
  error?: string;
}

interface ExecutionControlPanelProps {
  planId: string | null;
  planDescription: string;
  steps: ExecutionStep[];
  isExecuting: boolean;
  onPause: () => void;
  onResume: () => void;
  onAbort: () => void;
  onRetry: (stepId: string) => void;
  onSkip: (stepId: string) => void;
}

const STATUS_ICONS: Record<ExecutionStep["status"], string> = {
  pending: "○",
  in_progress: "◉",
  completed: "✓",
  failed: "✗",
};

const STATUS_COLORS: Record<ExecutionStep["status"], string> = {
  pending: "var(--text-muted)",
  in_progress: "var(--accent-cyan)",
  completed: "var(--accent-green)",
  failed: "var(--accent-red)",
};

const AGENT_COLORS: Record<string, string> = {
  researcher: "var(--accent-purple)",
  coder: "var(--accent-cyan)",
  reviewer: "var(--accent-yellow)",
  tester: "var(--accent-green)",
};

export default function ExecutionControlPanel({
  planId,
  planDescription,
  steps,
  isExecuting,
  onPause,
  onResume,
  onAbort,
  onRetry,
  onSkip,
}: ExecutionControlPanelProps) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const completedCount = steps.filter((s) => s.status === "completed").length;
  const failedCount = steps.filter((s) => s.status === "failed").length;
  const overallProgress = steps.length > 0 ? (completedCount / steps.length) * 100 : 0;

  useEffect(() => {
    if (isExecuting) {
      timerRef.current = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isExecuting]);

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleToggleStep = useCallback((stepId: string) => {
    setExpandedStep((prev) => (prev === stepId ? null : stepId));
  }, []);

  if (!planId) {
    return React.createElement(
      "div",
      { className: "exec-control-panel", role: "region", "aria-label": "Execution control" },
      React.createElement(
        "div",
        { className: "exec-control-empty" },
        React.createElement("div", { className: "exec-control-empty-icon", "aria-hidden": "true" }, "⏸"),
        React.createElement("div", null, "No active execution plan")
      )
    );
  }

  return React.createElement(
    "div",
    { className: "exec-control-panel", role: "region", "aria-label": "Execution control" },
    React.createElement(
      "div",
      { className: "exec-control-header" },
      React.createElement("h3", { className: "exec-control-title" }, "Execution Control"),
      React.createElement(
        "div",
        { className: "exec-control-timer" },
        isExecuting ? React.createElement("span", { className: "exec-timer-active" }, formatTime(elapsedTime)) : null
      )
    ),
    React.createElement(
      "div",
      { className: "exec-control-plan-info" },
      React.createElement("div", { className: "exec-plan-desc" }, planDescription),
      React.createElement(
        "div",
        { className: "exec-progress-bar-container" },
        React.createElement("div", {
          className: "exec-progress-bar",
          style: { width: `${overallProgress}%`, background: failedCount > 0 ? "var(--accent-red)" : "var(--gradient-accent)" },
        }),
        React.createElement(
          "span",
          { className: "exec-progress-text" },
          `${completedCount}/${steps.length} steps`
        )
      )
    ),
    React.createElement(
      "div",
      { className: "exec-control-actions" },
      isExecuting
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement(
              "button",
              { className: "btn-exec-control pause", onClick: onPause, "aria-label": "Pause execution" },
              "⏸ Pause"
            ),
            React.createElement(
              "button",
              { className: "btn-exec-control abort", onClick: onAbort, "aria-label": "Abort execution" },
              "⏹ Abort"
            )
          )
        : React.createElement(
            React.Fragment,
            null,
            React.createElement(
              "button",
              { className: "btn-exec-control resume", onClick: onResume, disabled: completedCount === steps.length, "aria-label": "Resume execution" },
              "▶ Resume"
            )
          )
    ),
    React.createElement(
      "div",
      { className: "exec-steps-list", role: "list", "aria-label": "Execution steps" },
      steps.map((step) =>
        React.createElement(
          "div",
          {
            key: step.id,
            className: "exec-step" + (expandedStep === step.id ? " expanded" : ""),
            role: "listitem",
          },
          React.createElement(
            "div",
            {
              className: "exec-step-header",
              onClick: () => handleToggleStep(step.id),
              style: { cursor: "pointer" },
            },
            React.createElement(
              "span",
              { className: "exec-step-icon", style: { color: STATUS_COLORS[step.status] } },
              STATUS_ICONS[step.status]
            ),
            React.createElement(
              "span",
              { className: "exec-step-agent", style: { color: AGENT_COLORS[step.agentName] || "var(--text-secondary)" } },
              step.agentName
            ),
            React.createElement("span", { className: "exec-step-desc" }, step.description),
            step.status === "in_progress" &&
              React.createElement(
                "div",
                { className: "exec-step-spinner", "aria-hidden": "true" },
                React.createElement("span", null),
                React.createElement("span", null),
                React.createElement("span", null)
              ),
            step.status === "failed" &&
              React.createElement(
                "div",
                { className: "exec-step-actions" },
                React.createElement(
                  "button",
                  { className: "btn-step-action retry", onClick: (e: React.MouseEvent) => { e.stopPropagation(); onRetry(step.id); }, "aria-label": "Retry step" },
                  "↻"
                ),
                React.createElement(
                  "button",
                  { className: "btn-step-action skip", onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSkip(step.id); }, "aria-label": "Skip step" },
                  "⏭"
                )
              )
          ),
          expandedStep === step.id &&
            React.createElement(
              "div",
              { className: "exec-step-details" },
              step.startTime &&
                React.createElement(
                  "div",
                  { className: "exec-step-meta" },
                  React.createElement("span", null, `Started: ${new Date(step.startTime).toLocaleTimeString()}`),
                  step.endTime && React.createElement("span", null, `Ended: ${new Date(step.endTime).toLocaleTimeString()}`)
                ),
              step.result &&
                React.createElement(
                  "div",
                  { className: "exec-step-result" },
                  step.result.slice(0, 500)
                ),
              step.error &&
                React.createElement(
                  "div",
                  { className: "exec-step-error" },
                  step.error
                )
            )
        )
      )
    )
  );
}
