import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";

interface ChatPanelProps {
  messages: Array<{ role: string; content: string; timestamp: string; isStreaming?: boolean }>;
  status: string;
  onSend: (text: string, interrupt?: boolean) => void;
  onAbort: () => void;
}

const VIRTUAL_SCROLL_OVERSCAN = 5;
const ESTIMATED_MSG_HEIGHT = 120;

function formatMarkdown(text: string): string {
  let escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  escaped = escaped.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) {
    const langLabel = lang || "code";
    return (
      '<div class="code-block-wrapper"><pre><code>' +
      code.replace(/^\n/, "") +
      '</code></pre></div>'
    );
  });
  escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  escaped = escaped.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  escaped = escaped.replace(/^### (.+)$/gm, "<h4>$1</h4>");
  escaped = escaped.replace(/^## (.+)$/gm, "<h3>$1</h3>");
  escaped = escaped.replace(/^# (.+)$/gm, "<h2>$1</h2>");
  escaped = escaped.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
  escaped = escaped.replace(/^---$/gm, "<hr>");
  escaped = escaped.replace(/\n{2,}/g, "</p><p>");
  escaped = escaped.replace(/\n/g, "<br>");

  return escaped;
}

export default function ChatPanel({ messages, status, onSend, onAbort }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 50]);

  const updateVisibleRange = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || messages.length <= 30) {
      setVisibleRange([0, messages.length]);
      return;
    }

    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;
    const startIndex = Math.max(0, Math.floor(scrollTop / ESTIMATED_MSG_HEIGHT) - VIRTUAL_SCROLL_OVERSCAN);
    const endIndex = Math.min(
      messages.length,
      Math.ceil((scrollTop + viewportHeight) / ESTIMATED_MSG_HEIGHT) + VIRTUAL_SCROLL_OVERSCAN
    );

    setVisibleRange([startIndex, endIndex]);
  }, [messages.length]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || messages.length <= 30) return;

    container.addEventListener("scroll", updateVisibleRange, { passive: true });
    updateVisibleRange();
    return () => container.removeEventListener("scroll", updateVisibleRange);
  }, [messages.length, updateVisibleRange]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (status === "idle") {
      inputRef.current?.focus();
    }
  }, [status]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    const isInterrupt = status === "thinking" || status === "executing";
    onSend(text, isInterrupt);
    setInput("");
  }, [input, status, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopy = useCallback((content: string, idx: number) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    });
  }, []);

  const isProcessing = status === "thinking" || status === "executing";

  const renderMessage = (
    msg: { role: string; content: string; timestamp: string; isStreaming?: boolean },
    index: number
  ) => {
    const isUser = msg.role === "user";
    const time = new Date(msg.timestamp).toLocaleTimeString();
    const isCopied = copiedIdx === index;

    return React.createElement(
      "div",
      { key: index, className: "chat-message" + (isUser ? " user" : ""), role: "article", "aria-label": isUser ? "Your message" : "Assistant response" },
      React.createElement(
        "div",
        { className: "chat-avatar" + (isUser ? " user" : " assistant"), "aria-hidden": "true" },
        isUser ? "U" : "A"
      ),
      React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "chat-bubble" + (isUser ? " user" : " assistant") },
          isUser
            ? React.createElement(
                "div",
                { style: { whiteSpace: "pre-wrap", wordBreak: "break-word" } },
                msg.content
              )
            : React.createElement("div", {
                className: "message-content",
                dangerouslySetInnerHTML: { __html: formatMarkdown(msg.content) + (msg.isStreaming ? '<span class="streaming-cursor"></span>' : '') },
              }),
          React.createElement(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" } },
            React.createElement("span", { className: "chat-time" }, time),
            React.createElement(
              "button",
              {
                className: "msg-copy-btn" + (isCopied ? " copied" : ""),
                onClick: () => handleCopy(msg.content, index),
                title: "Copy message",
                "aria-label": "Copy message to clipboard",
              },
              isCopied ? "Copied" : "Copy"
            )
          )
        )
      )
    );
  };

  return React.createElement(
    "div",
    { className: "chat-container", role: "region", "aria-label": "Chat panel" },
    React.createElement(
      "div",
      { className: "chat-messages", ref: scrollContainerRef, role: "log", "aria-label": "Chat messages", "aria-live": "polite", "aria-relevant": "additions" },
      messages.length === 0
        ? React.createElement(
            "div",
            { className: "chat-empty" },
            React.createElement("div", { className: "chat-empty-icon", "aria-hidden": "true" },
              React.createElement("svg", { className: "icon-svg icon-lg", viewBox: "0 0 24 24" },
                React.createElement("rect", { x: "3", y: "11", width: "18", height: "11", rx: "2", ry: "2" }),
                React.createElement("path", { d: "M7 11V7a5 5 0 0 1 10 0v4" })
              )
            ),
            React.createElement("div", null, "Describe your task and agent_1 will work for you")
          )
        : messages.length <= 30
          ? messages.map((msg, i) => renderMessage(msg, i))
          : React.createElement(
              "div",
              { style: { height: messages.length * ESTIMATED_MSG_HEIGHT, position: "relative" } },
              messages.slice(visibleRange[0], visibleRange[1]).map((msg, i) => {
                const actualIndex = visibleRange[0] + i;
                return React.createElement(
                  "div",
                  { key: actualIndex, style: { position: "absolute", top: actualIndex * ESTIMATED_MSG_HEIGHT, left: 0, right: 0 } },
                  renderMessage(msg, actualIndex)
                );
              })
            ),
      React.createElement("div", { ref: messagesEndRef })
    ),
    isProcessing &&
      React.createElement(
        "div",
        { className: "chat-thinking", role: "status", "aria-live": "assertive" },
        React.createElement(
          "span",
          { className: "chat-thinking-dots", "aria-hidden": "true" },
          React.createElement("span", null),
          React.createElement("span", null),
          React.createElement("span", null)
        ),
        status === "thinking" ? "Thinking..." : "Executing...",
        React.createElement(
          "button",
          { className: "btn-abort-sm", onClick: onAbort, "aria-label": "Abort current task" },
          "Abort"
        )
      ),
    React.createElement(
      "div",
      { className: "chat-input-area", role: "form", "aria-label": "Message input" },
      React.createElement(
        "div",
        { className: "chat-input-row" },
        React.createElement("textarea", {
          ref: inputRef,
          value: input,
          onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) =>
            setInput((e.target as HTMLTextAreaElement).value),
          onKeyDown: handleKeyDown,
          placeholder: isProcessing
            ? ">> Interrupt with new instructions..."
            : "Describe task, e.g.: Create an Express API service...",
          disabled: false,
          rows: 2,
          className: "chat-input" + (isProcessing ? " interrupt" : ""),
          "aria-label": "Message input",
        }),
        React.createElement(
          "button",
          {
            onClick: handleSend,
            disabled: !input.trim(),
            className: "btn-send" + (input.trim() ? " active" : " inactive"),
            "aria-label": isProcessing ? "Send interrupt" : "Send message",
          },
          isProcessing ? ">> Send" : "Send"
        )
      ),
      React.createElement(
        "div",
        {
          "aria-hidden": "true",
          style: {
            display: "flex",
            gap: "12px",
            padding: "4px 2px 0",
            fontSize: "10px",
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
          },
        },
        React.createElement("span", null, "Enter to send"),
        React.createElement("span", null, "Shift+Enter new line")
      )
    )
  );
}
