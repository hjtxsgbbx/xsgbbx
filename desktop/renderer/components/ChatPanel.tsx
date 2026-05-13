import React, { useState, useRef, useEffect } from "react";

interface ChatPanelProps {
  messages: Array<{ role: string; content: string; timestamp: string }>;
  status: string;
  onSend: (text: string, interrupt?: boolean) => void;
  onAbort: () => void;
}

export default function ChatPanel({ messages, status, onSend, onAbort }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (status === "idle") {
      inputRef.current?.focus();
    }
  }, [status]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;

    const isInterrupt =
      status === "thinking" || status === "executing";
    onSend(text, isInterrupt);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderMessage = (msg: { role: string; content: string; timestamp: string }, index: number) => {
    const isUser = msg.role === "user";
    const time = new Date(msg.timestamp).toLocaleTimeString();

    return React.createElement(
      "div",
      {
        key: index,
        style: {
          display: "flex",
          flexDirection: isUser ? "row-reverse" : "row",
          padding: "8px 16px",
          gap: 12,
        },
      },
      React.createElement(
        "div",
        {
          style: {
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: isUser ? "var(--accent-blue)" : "var(--accent-cyan)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            fontWeight: 700,
            color: "#fff",
            flexShrink: 0,
          },
        },
        isUser ? "U" : "A"
      ),
      React.createElement(
        "div",
        {
          style: {
            maxWidth: "70%",
            background: isUser ? "var(--bg-tertiary)" : "var(--bg-secondary)",
            borderRadius: "12px 12px " + (isUser ? "4px 12px" : "12px 4px"),
            padding: "10px 16px",
            fontSize: 14,
            lineHeight: 1.5,
            fontFamily: "var(--font-sans)",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: isUser ? "#fff" : "var(--text-primary)",
            },
          },
          msg.content
        ),
        React.createElement(
          "div",
          {
            style: {
              fontSize: 10,
              color: "var(--text-secondary)",
              marginTop: 4,
              textAlign: isUser ? "right" : "left",
            },
          },
          time
        )
      )
    );
  };

  const isProcessing = status === "thinking" || status === "executing";

  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        flex: 1,
      },
    },
    React.createElement(
      "div",
      {
        style: {
          flex: 1,
          overflow: "auto",
          padding: "8px 0",
        },
      },
      messages.length === 0
        ? React.createElement(
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
            React.createElement("div", { style: { fontSize: 32, opacity: 0.3 } }, "🤖"),
            React.createElement("div", null, "描述您的任务，agent_1 将为您工作")
          )
        : messages.map((msg, i) => renderMessage(msg, i)),
      React.createElement("div", { ref: messagesEndRef })
    ),
    isProcessing &&
      React.createElement(
        "div",
        {
          style: {
            padding: "4px 16px",
            fontSize: 12,
            color: "var(--accent-cyan)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--font-mono)",
          },
        },
        React.createElement(
          "span",
          { className: "thinking-spinner" },
          "◌"
        ),
        status === "thinking" ? "Thinking..." : "Executing...",
        React.createElement(
          "button",
          {
            onClick: onAbort,
            style: {
              marginLeft: "auto",
              padding: "4px 12px",
              fontSize: 12,
              background: "transparent",
              color: "var(--accent-red)",
              border: "1px solid var(--accent-red)",
              borderRadius: 4,
              cursor: "pointer",
            },
          },
          "Abort"
        )
      ),
    React.createElement(
      "div",
      {
        style: {
          padding: "8px 16px 12px 16px",
          borderTop: "1px solid var(--border-color)",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            gap: 8,
            alignItems: "flex-end",
          },
        },
        React.createElement(
          "textarea",
          {
            ref: inputRef,
            value: input,
            onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setInput((e.target as HTMLTextAreaElement).value),
            onKeyDown: handleKeyDown,
            placeholder:
              status === "thinking" || status === "executing"
                ? ">> 输入新指令 (干预模式)..."
                : "描述任务，例如: 创建一个 Express API 服务...",
            disabled: false,
            rows: 2,
            style: {
              flex: 1,
              padding: "8px 12px",
              fontSize: 14,
              fontFamily: "var(--font-sans)",
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-color)",
              borderRadius: 8,
              resize: "none",
              outline: "none",
              lineHeight: 1.5,
            },
          }
        ),
        React.createElement(
          "button",
          {
            onClick: handleSend,
            disabled: !input.trim(),
            style: {
              padding: "8px 20px",
              fontSize: 14,
              fontWeight: 600,
              background: input.trim()
                ? "linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))"
                : "var(--bg-tertiary)",
              color: input.trim() ? "#fff" : "var(--text-secondary)",
              border: "none",
              borderRadius: 8,
              cursor: input.trim() ? "pointer" : "default",
              whiteSpace: "nowrap",
              opacity: input.trim() ? 1 : 0.5,
            },
          },
          status === "thinking" || status === "executing" ? ">> Send" : "Send"
        )
      )
    )
  );
}