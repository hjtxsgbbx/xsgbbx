import React, { useState } from "react";

interface PermissionDialogProps {
  actor: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  question: string;
  onAllow: (reason?: string) => void;
  onDeny: () => void;
  onAlways: (reason?: string) => void;
}

export default function PermissionDialog({
  actor,
  toolName,
  toolArgs,
  question,
  onAllow,
  onDeny,
  onAlways,
}: PermissionDialogProps) {
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);

  return React.createElement(
    "div",
    { className: "permission-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Permission request for " + toolName },
    React.createElement(
      "div",
      { className: "permission-dialog", role: "document" },
      React.createElement("h3", null, "Permission Required"),
      React.createElement(
        "div",
        { style: { marginBottom: "16px" } },
        React.createElement("p", null, question),
        React.createElement("span", { className: "permission-tool" }, "Tool: ", toolName)
      ),
      React.createElement(
        "div",
        { className: "permission-actions" },
        React.createElement(
          "button",
          {
            className: "btn-permission btn-permission-reason",
            onClick: () => setShowReason(!showReason),
            "aria-label": showReason ? "Hide reason input" : "Add a reason for your decision",
            "aria-expanded": showReason,
          },
          showReason ? "Hide Reason" : "Add Reason"
        ),
        React.createElement(
          "button",
          { className: "btn-permission btn-permission-deny", onClick: () => onDeny(), "aria-label": "Deny permission" },
          "Deny"
        ),
        React.createElement(
          "button",
          {
            className: "btn-permission btn-permission-allow",
            onClick: () => onAllow(reason || undefined),
            "aria-label": "Allow permission once",
          },
          "Allow Once"
        ),
        React.createElement(
          "button",
          {
            className: "btn-permission btn-permission-always",
            onClick: () => onAlways(reason || undefined),
            "aria-label": "Always allow this tool",
          },
          "Always Allow"
        )
      ),
      showReason &&
        React.createElement("input", {
          type: "text",
          value: reason,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            setReason(e.target.value),
          placeholder: "Reason for override...",
          className: "permission-reason-input",
          "aria-label": "Reason for permission override",
        })
    )
  );
}