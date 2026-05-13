import React, { useState, useRef, useEffect } from "react";

interface WelcomeScreenProps {
  onOpenProject: () => void;
}

export default function WelcomeScreen({ onOpenProject }: WelcomeScreenProps) {
  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
      },
    },
    React.createElement(
      "div",
      { style: { textAlign: "center", maxWidth: 600, padding: 40 } },
      React.createElement(
        "div",
        {
          style: {
            fontSize: 64,
            fontWeight: 700,
            color: "var(--accent-cyan)",
            marginBottom: 16,
            fontFamily: "var(--font-mono)",
          },
        },
        "agent_1"
      ),
      React.createElement(
        "p",
        { style: { fontSize: 18, color: "var(--text-secondary)", marginBottom: 8 } },
        "跨平台 AI 编程助手"
      ),
      React.createElement(
        "p",
        { style: { fontSize: 14, color: "var(--text-secondary)", marginBottom: 32, lineHeight: 1.6 } },
        "agent_1 是您的智能编程伙伴。打开项目目录后，\n您可以用自然语言描述任务，agent_1 将自动完成代码开发、测试与交付。"
      ),
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            gap: 16,
            justifyContent: "center",
          },
        },
        React.createElement(
          "button",
          {
            onClick: onOpenProject,
            style: {
              padding: "12px 32px",
              fontSize: 16,
              fontWeight: 600,
              background: "linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              transition: "transform 0.15s",
            },
            onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.05)";
            },
            onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
            },
          },
          "打开项目"
        ),
        React.createElement(
          "button",
          {
            onClick: onOpenProject,
            style: {
              padding: "12px 32px",
              fontSize: 16,
              fontWeight: 600,
              background: "transparent",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: 8,
              cursor: "pointer",
              transition: "all 0.15s",
            },
            onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.style.borderColor = "var(--accent-cyan)";
              btn.style.color = "var(--accent-cyan)";
            },
            onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.style.borderColor = "var(--border-color)";
              btn.style.color = "var(--text-secondary)";
            },
          },
          "使用帮助"
        )
      ),
      React.createElement(
        "div",
        {
          style: {
            marginTop: 48,
            padding: 16,
            borderTop: "1px solid var(--border-color)",
            fontSize: 12,
            color: "var(--text-secondary)",
            textAlign: "center",
          },
        },
        "agent_1 v1.0.0 · Electron Desktop · 数据仅在您主动请求时发送至 AI 提供商"
      )
    )
  );
}