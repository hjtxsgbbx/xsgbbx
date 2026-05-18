import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";

interface SyntaxIssue {
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
  ruleId?: string;
  suggestion?: string;
}

interface SyntaxFeedbackProps {
  code: string;
  language: string;
  filePath?: string;
  onApplySuggestion?: (line: number, suggestion: string) => void;
}

interface ParsedFeedback {
  issues: SyntaxIssue[];
  stats: {
    errors: number;
    warnings: number;
    infos: number;
    totalLines: number;
  };
}

const SEVERITY_ICONS: Record<SyntaxIssue["severity"], string> = {
  error: "✗",
  warning: "⚠",
  info: "ℹ",
};

const SEVERITY_COLORS: Record<SyntaxIssue["severity"], string> = {
  error: "var(--accent-red)",
  warning: "var(--accent-yellow)",
  info: "var(--accent-blue)",
};

function performSyntaxCheck(code: string, language: string): ParsedFeedback {
  const issues: SyntaxIssue[] = [];
  const lines = code.split("\n");

  if (language === "typescript" || language === "javascript") {
    const openBraces: number[] = [];
    const openParens: number[] = [];
    const openBrackets: number[] = [];
    let inString: string | null = null;
    let inTemplate = false;
    let inComment = false;
    let inBlockComment = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (inBlockComment) {
        if (line.includes("*/")) {
          inBlockComment = false;
        }
        continue;
      }

      if (trimmed.startsWith("//")) continue;

      if (trimmed.startsWith("/*")) {
        if (!trimmed.includes("*/")) {
          inBlockComment = true;
        }
        continue;
      }

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        const nextChar = line[j + 1];

        if (inString) {
          if (char === "\\") { j++; continue; }
          if (char === inString) inString = null;
          continue;
        }

        if (inTemplate) {
          if (char === "\\") { j++; continue; }
          if (char === "`") inTemplate = false;
          continue;
        }

        if (char === '"' || char === "'") { inString = char; continue; }
        if (char === "`") { inTemplate = true; continue; }
        if (char === "/" && nextChar === "/") break;

        if (char === "{") openBraces.push(i);
        if (char === "}") {
          if (openBraces.length === 0) {
            issues.push({
              line: i + 1,
              column: j + 1,
              severity: "error",
              message: "Unexpected closing brace",
              suggestion: "Remove the extra '}' or check for missing opening brace",
            });
          } else {
            openBraces.pop();
          }
        }
        if (char === "(") openParens.push(i);
        if (char === ")") {
          if (openParens.length === 0) {
            issues.push({
              line: i + 1,
              column: j + 1,
              severity: "error",
              message: "Unexpected closing parenthesis",
            });
          } else {
            openParens.pop();
          }
        }
        if (char === "[") openBrackets.push(i);
        if (char === "]") {
          if (openBrackets.length === 0) {
            issues.push({
              line: i + 1,
              column: j + 1,
              severity: "error",
              message: "Unexpected closing bracket",
            });
          } else {
            openBrackets.pop();
          }
        }
      }

      if (trimmed.endsWith(";") && trimmed.startsWith("if ") && !trimmed.includes("{")) {
        issues.push({
          line: i + 1,
          column: trimmed.length,
          severity: "warning",
          message: "Semicolon after if condition may be unintentional",
          suggestion: "Add braces or remove semicolon",
        });
      }

      if (trimmed.includes("==") && !trimmed.includes("===") && !trimmed.includes("!==")) {
        issues.push({
          line: i + 1,
          column: line.indexOf("==") + 1,
          severity: "warning",
          message: "Use '===' instead of '==' for strict equality",
          ruleId: "eqeqeq",
          suggestion: "Replace '==' with '==='",
        });
      }

      if (trimmed.includes("console.log")) {
        issues.push({
          line: i + 1,
          column: line.indexOf("console.log") + 1,
          severity: "info",
          message: "Unexpected console.log",
          ruleId: "no-console",
        });
      }

      if (/var\s+/.test(trimmed)) {
        issues.push({
          line: i + 1,
          column: line.indexOf("var") + 1,
          severity: "warning",
          message: "Use 'let' or 'const' instead of 'var'",
          ruleId: "no-var",
          suggestion: "Replace 'var' with 'const' or 'let'",
        });
      }
    }

    for (const lineNum of openBraces) {
      issues.push({
        line: lineNum + 1,
        column: 1,
        severity: "error",
        message: "Unclosed brace",
        suggestion: "Add closing '}'",
      });
    }
    for (const lineNum of openParens) {
      issues.push({
        line: lineNum + 1,
        column: 1,
        severity: "error",
        message: "Unclosed parenthesis",
        suggestion: "Add closing ')'",
      });
    }
  }

  if (language === "python") {
    let prevIndent = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      const indent = line.length - line.trimStart().length;
      if (indent % 4 !== 0 && indent > 0) {
        issues.push({
          line: i + 1,
          column: 1,
          severity: "warning",
          message: "Inconsistent indentation (use 4 spaces)",
          suggestion: "Fix indentation to use multiples of 4 spaces",
        });
      }

      if (trimmed.includes("print ") && !trimmed.includes("print(")) {
        issues.push({
          line: i + 1,
          column: 1,
          severity: "warning",
          message: "Use print() function (Python 3 syntax)",
          suggestion: "Use print() instead of print statement",
        });
      }

      prevIndent = indent;
    }
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;

  return {
    issues: issues.sort((a, b) => a.line - b.line),
    stats: { errors, warnings, infos, totalLines: lines.length },
  };
}

export function SyntaxFeedback({ code, language, filePath, onApplySuggestion }: SyntaxFeedbackProps) {
  const [selectedIssue, setSelectedIssue] = useState<number | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<SyntaxIssue["severity"] | "all">("all");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [feedback, setFeedback] = useState<ParsedFeedback>(() => performSyntaxCheck(code, language));

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setFeedback(performSyntaxCheck(code, language));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [code, language]);

  const filteredIssues = useMemo(() => {
    if (filterSeverity === "all") return feedback.issues;
    return feedback.issues.filter((i) => i.severity === filterSeverity);
  }, [feedback.issues, filterSeverity]);

  const handleApplySuggestion = useCallback(
    (issue: SyntaxIssue) => {
      if (issue.suggestion && onApplySuggestion) {
        onApplySuggestion(issue.line, issue.suggestion);
      }
    },
    [onApplySuggestion]
  );

  const overallStatus = feedback.stats.errors > 0 ? "error" : feedback.stats.warnings > 0 ? "warning" : "clean";

  return React.createElement(
    "div",
    { className: "syntax-feedback", role: "region", "aria-label": "Syntax feedback" },
    React.createElement(
      "div",
      { className: "syntax-feedback-header" },
      React.createElement(
        "div",
        { className: "syntax-status " + overallStatus },
        overallStatus === "error"
          ? "✗ Errors found"
          : overallStatus === "warning"
            ? "⚠ Warnings found"
            : "✓ No issues"
      ),
      React.createElement(
        "div",
        { className: "syntax-stats" },
        feedback.stats.errors > 0 &&
          React.createElement("span", { className: "stat-error" }, `${feedback.stats.errors} errors`),
        feedback.stats.warnings > 0 &&
          React.createElement("span", { className: "stat-warning" }, `${feedback.stats.warnings} warnings`),
        feedback.stats.infos > 0 &&
          React.createElement("span", { className: "stat-info" }, `${feedback.stats.infos} info`),
        React.createElement("span", { className: "stat-lines" }, `${feedback.stats.totalLines} lines`)
      )
    ),
    React.createElement(
      "div",
      { className: "syntax-filter-bar" },
      ["all", "error", "warning", "info"].map((sev) =>
        React.createElement(
          "button",
          {
            key: sev,
            className: "btn-syntax-filter" + (filterSeverity === sev ? " active" : ""),
            onClick: () => setFilterSeverity(sev as SyntaxIssue["severity"] | "all"),
            "aria-label": `Filter ${sev}`,
          },
          sev === "all" ? "All" : sev.charAt(0).toUpperCase() + sev.slice(1)
        )
      )
    ),
    React.createElement(
      "div",
      { className: "syntax-issues-list", role: "list" },
      filteredIssues.length === 0
        ? React.createElement(
            "div",
            { className: "syntax-no-issues" },
            filterSeverity === "all" ? "No syntax issues found" : `No ${filterSeverity}s found`
          )
        : filteredIssues.map((issue, index) =>
            React.createElement(
              "div",
              {
                key: index,
                className: "syntax-issue" + (selectedIssue === index ? " selected" : ""),
                onClick: () => setSelectedIssue(selectedIssue === index ? null : index),
                role: "listitem",
              },
              React.createElement(
                "div",
                { className: "syntax-issue-header" },
                React.createElement(
                  "span",
                  { className: "syntax-issue-icon", style: { color: SEVERITY_COLORS[issue.severity] } },
                  SEVERITY_ICONS[issue.severity]
                ),
                React.createElement(
                  "span",
                  { className: "syntax-issue-location" },
                  `Ln ${issue.line}, Col ${issue.column}`
                ),
                issue.ruleId &&
                  React.createElement("span", { className: "syntax-issue-rule" }, issue.ruleId)
              ),
              React.createElement("div", { className: "syntax-issue-message" }, issue.message),
              selectedIssue === index &&
                React.createElement(
                  "div",
                  { className: "syntax-issue-detail" },
                  issue.suggestion &&
                    React.createElement(
                      "div",
                      { className: "syntax-issue-suggestion" },
                      React.createElement("span", null, "Suggestion: "),
                      React.createElement("span", null, issue.suggestion),
                      onApplySuggestion &&
                        React.createElement(
                          "button",
                          {
                            className: "btn-apply-suggestion",
                            onClick: (e: React.MouseEvent) => {
                              e.stopPropagation();
                              handleApplySuggestion(issue);
                            },
                          },
                          "Apply"
                        )
                    )
                )
            )
          )
    )
  );
}

export default SyntaxFeedback;
