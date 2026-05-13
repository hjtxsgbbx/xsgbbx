import React, { useState } from "react";

interface PermissionDialogProps {
  reason: string;
  command: string;
  canOverride: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function PermissionDialog({
  reason,
  command,
  canOverride,
  onConfirm,
  onCancel,
}: PermissionDialogProps) {
  const [overrideText, setOverrideText] = useState("");
  const [showOverride, setShowOverride] = useState(false);

  return React.createElement(
    "div",
    {
      style: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      },
    },
    React.createElement(
      "div",
      {
        style: {
          background: "var(--bg-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: 12,
          maxWidth: 520,
          width: "90%",
          overflow: "hidden",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          },
        },
        React.createElement(
          "span",
          { style: { fontSize: 20 } },
          canOverride ? "⚠️" : "🚫"
        ),
        React.createElement(
          "span",
          {
            style: {
              fontSize: 15,
              fontWeight: 700,
              color: canOverride ? "var(--accent-yellow)" : "var(--accent-red)",
            },
          },
          canOverride ? "Permission Required" : "Permission Denied"
        )
      ),
      React.createElement(
        "div",
        { style: { padding: "16px 20px" } },
        React.createElement(
          "div",
          {
            style: {
              fontSize: 13,
              lineHeight: 1.6,
              marginBottom: 12,
            },
          },
          React.createElement(
            "strong",
            { style: { color: "var(--accent-red)" } },
            "Command: "
          ),
          React.createElement(
            "code",
            {
              style: {
                background: "var(--bg-secondary)",
                padding: "2px 8px",
                borderRadius: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                wordBreak: "break-all",
              },
            },
            command
          )
        ),
        React.createElement(
          "div",
          {
            style: {
              background: canOverride
                ? "rgba(255,187,51,0.1)"
                : "rgba(255,68,68,0.1)",
              border: `1px solid ${canOverride ? "var(--accent-yellow)" : "var(--accent-red)"}`,
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              lineHeight: 1.5,
            },
          },
          React.createElement(
            "strong",
            null,
            canOverride ? "Reason: " : "Blocked: "
          ),
          reason
        ),
        canOverride &&
          React.createElement(
            "div",
            { style: { marginTop: 12 } },
            React.createElement(
              "p",
              {
                style: {
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  marginBottom: 8,
                },
              },
              "This permission denial can be overridden. To proceed, you must explicitly confirm you understand the risks."
            ),
            !showOverride
              ? React.createElement(
                  "button",
                  {
                    onClick: () => setShowOverride(true),
                    style: {
                      padding: "8px 16px",
                      fontSize: 13,
                      fontWeight: 600,
                      background: "var(--bg-tertiary)",
                      color: "var(--accent-yellow)",
                      border: "1px solid var(--accent-yellow)",
                      borderRadius: 6,
                      cursor: "pointer",
                    },
                  },
                  "I want to override"
                )
              : React.createElement(
                  "div",
                  { style: { marginTop: 8 } },
                  React.createElement(
                    "p",
                    {
                      style: {
                        fontSize: 12,
                        color: "var(--text-secondary)",
                        marginBottom: 8,
                      },
                    },
                    'Type "I understand the risk" to confirm override:'
                  ),
                  React.createElement(
                    "textarea",
                    {
                      value: overrideText,
                      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) =>
                        setOverrideText((e.target as HTMLTextAreaElement).value),
                      placeholder: "I understand the risk",
                      style: {
                        width: "100%",
                        padding: "8px 12px",
                        fontSize: 13,
                        fontFamily: "var(--font-mono)",
                        background: "var(--bg-secondary)",
                        color: "var(--text-primary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: 6,
                        resize: "none",
                        outline: "none",
                        height: 36,
                      },
                    }
                  ),
                  React.createElement(
                    "div",
                    {
                      style: {
                        display: "flex",
                        gap: 8,
                        marginTop: 8,
                      },
                    },
                    React.createElement(
                      "button",
                      {
                        onClick: onConfirm,
                        disabled: overrideText !== "I understand the risk",
                        style: {
                          padding: "8px 20px",
                          fontSize: 13,
                          fontWeight: 600,
                          background:
                            overrideText === "I understand the risk"
                              ? "linear-gradient(135deg, var(--accent-red), #ff6600)"
                              : "var(--bg-tertiary)",
                          color:
                            overrideText === "I understand the risk"
                              ? "#fff"
                              : "var(--text-secondary)",
                          border: "none",
                          borderRadius: 6,
                          cursor:
                            overrideText === "I understand the risk"
                              ? "pointer"
                              : "default",
                          opacity:
                            overrideText === "I understand the risk" ? 1 : 0.5,
                        },
                      },
                      "Override & Execute"
                    ),
                    React.createElement(
                      "button",
                      {
                        onClick: onCancel,
                        style: {
                          padding: "8px 20px",
                          fontSize: 13,
                          background: "var(--bg-secondary)",
                          color: "var(--text-secondary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: 6,
                          cursor: "pointer",
                        },
                      },
                      "Cancel"
                    )
                  )
                )
          )
      ),
      React.createElement(
        "div",
        {
          style: {
            padding: "12px 20px",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            borderTop: "1px solid var(--border-color)",
          },
        },
        !canOverride &&
          React.createElement(
            "button",
            {
              onClick: onCancel,
              style: {
                padding: "8px 24px",
                fontSize: 14,
                fontWeight: 600,
                background: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              },
            },
            "OK, I understand"
          )
      )
    )
  );
}