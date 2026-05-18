import React, { useState, useCallback } from "react";

type FeedbackCategory = "bug" | "feature" | "improvement" | "praise";

interface FeedbackPanelProps {
  onSubmit: (data: { category: FeedbackCategory; summary: string; details: string }) => void;
  onClose: () => void;
}

const CATEGORIES: Array<{ key: FeedbackCategory; label: string }> = [
  { key: "bug", label: "Bug" },
  { key: "feature", label: "Feature" },
  { key: "improvement", label: "Improvement" },
  { key: "praise", label: "Praise" },
];

export default function FeedbackPanel({ onSubmit, onClose }: FeedbackPanelProps) {
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [text, setText] = useState("");

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit({
      category,
      summary: trimmed.slice(0, 200),
      details: trimmed,
    });
    setText("");
    onClose();
  }, [category, text, onSubmit, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  return React.createElement(
    "div",
    { className: "feedback-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Send feedback", onKeyDown: handleKeyDown },
    React.createElement(
      "div",
      { className: "feedback-panel" },
      React.createElement("h3", null, "Send Feedback"),
      React.createElement("p", { className: "feedback-subtitle" }, "Help us improve agent_1. Your feedback is anonymous and stored locally."),
      React.createElement(
        "div",
        { className: "feedback-category-group", role: "radiogroup", "aria-label": "Feedback category" },
        ...CATEGORIES.map((cat) =>
          React.createElement(
            "button",
            {
              key: cat.key,
              className: "feedback-cat-btn" + (category === cat.key ? " active" : ""),
              "data-cat": cat.key,
              role: "radio",
              "aria-checked": category === cat.key ? "true" : "false",
              tabIndex: 0,
              onClick: () => setCategory(cat.key),
            },
            cat.label
          )
        )
      ),
      React.createElement("textarea", {
        className: "feedback-textarea",
        value: text,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value),
        placeholder: "Describe your feedback...",
        "aria-label": "Feedback details",
        autoFocus: true,
      }),
      React.createElement(
        "div",
        { className: "feedback-actions" },
        React.createElement(
          "button",
          { className: "feedback-cancel", onClick: onClose },
          "Cancel"
        ),
        React.createElement(
          "button",
          { className: "feedback-submit", onClick: handleSubmit, disabled: !text.trim() },
          "Submit"
        )
      )
    )
  );
}
