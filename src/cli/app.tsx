import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useApp } from "ink";
import { type AppStatus, type H2AEntry, type Message, type Config, type PlatformInfo, type PermissionMode, type TokenUsage, type ToolCall, type ToolResult } from "../types/index.js";
import { StatusBar } from "./components/StatusBar.js";
import { InputLine } from "./components/InputLine.js";
import { ThinkingIndicator } from "./components/ThinkingIndicator.js";
import { ToolExecutionView } from "./components/ToolExecutionView.js";
import { PermissionDeniedView } from "./components/PermissionDeniedView.js";
import { ErrorView } from "./components/ErrorView.js";
import { DeliveryView } from "./components/DeliveryView.js";
import { MessageList } from "./components/MessageList.js";
import { ProviderSelect } from "./components/ProviderSelect.js";
import { type QueryEngineImpl, createQueryEngine } from "../engine/index.js";
import { SessionStore } from "../storage/index.js";

interface AppProps {
  engine: QueryEngineImpl | null;
  config: Config;
  platform: PlatformInfo;
  projectPath: string;
  projectMemory: string;
  onConfigChange: (config: Config) => void;
  onExit: () => void;
  onEngineReady?: (engine: QueryEngineImpl) => void;
}

export const App: React.FC<AppProps> = ({
  engine,
  config,
  platform,
  projectPath,
  projectMemory,
  onConfigChange,
  onExit,
  onEngineReady,
}) => {
  const { exit: _exit } = useApp();
  const [status, setStatus] = useState<AppStatus>({
    state: config.chosen_provider ? "idle" : "provider_select",
    projectPath,
    provider: config.chosen_provider,
    lastSentTimestamp: "",
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [h2aQueue, setH2aQueue] = useState<H2AEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const lastReasoningRef = useRef("");
  const [streamingText, setStreamingText] = useState("");
  const messagesRef = useRef<Message[]>([]);

  messagesRef.current = messages;

  useEffect(() => {
    if (!engine) {
      return;
    }

    const handlers: Record<string, (...args: unknown[]) => void> = {};

    handlers.thinking = (model: unknown, attempt: unknown, tokenUsage: unknown) => {
      setStatus((prev) => ({
        ...prev,
        state: "thinking",
        modelName: model as string,
        attempt: attempt as number,
        tokenUsage: tokenUsage as TokenUsage | undefined,
      }));
      setStreamingText("");
    };

    handlers.toolExecuting = (toolName: unknown, command: unknown) => {
      setStatus((prev) => ({
        ...prev,
        state: "executing",
        currentTool: `${toolName}: ${command}`,
        progress: 0,
      }));
    };

    handlers.toolResult = (result: unknown) => {
      const _tr = result as ToolResult;
      setStatus((prev) => ({
        ...prev,
        progress: 100,
      }));
    };

    handlers.permissionDenied = (reason: unknown, layer: unknown, canOverride: unknown) => {
      setStatus((prev) => ({
        ...prev,
        state: "permission_denied",
        errorMessage: `${reason} (${layer}, ${(canOverride as boolean) ? "overrideable" : "non-overrideable"})`,
      }));
    };

    handlers.requestConfirmation = (toolCall: unknown, command: unknown, reason: unknown) => {
      setStatus((prev) => ({
        ...prev,
        state: "needs_confirmation",
        errorMessage: reason as string,
        pendingCommand: command as string,
        pendingToolCall: toolCall as ToolCall,
      }));
    };

    handlers.compacting = (from: unknown, to: unknown) => {
      setStatus((prev) => ({
        ...prev,
        state: "compacting",
        errorMessage: `Context compacted (${from} → ${to} tokens)`,
      }));
    };

    handlers.maxTurnsReached = () => {
      setStatus((prev) => ({
        ...prev,
        state: "max_turns",
        errorMessage: "Maximum turns (50) reached. Task incomplete.",
      }));
    };

    handlers.taskCompleted = (files: unknown, commitHash: unknown) => {
      setStatus((prev) => ({
        ...prev,
        state: "delivered",
        generatedFiles: files as string[],
        commitHash: commitHash as string | undefined,
      }));
    };

    handlers.error = (message: unknown) => {
      setStatus((prev) => ({
        ...prev,
        state: "error",
        errorMessage: message as string,
      }));
    };

    handlers.progress = (percent: unknown) => {
      setStatus((prev) => ({
        ...prev,
        progress: percent as number,
      }));
    };

    handlers.streaming = (text: unknown) => {
      setStreamingText((prev) => prev + (text as string));
    };

    handlers.reasoning = (text: unknown) => {
      lastReasoningRef.current += (text as string);
    };

    for (const [event, handler] of Object.entries(handlers)) {
      engine.on(event, handler);
    }

    return () => {
      for (const [event, handler] of Object.entries(handlers)) {
        engine.off(event, handler);
      }
    };
  }, [engine]);

  const handleSubmit = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      const isInterrupt = text.startsWith(">>");
      const cleanText = isInterrupt ? text.slice(2).trim() : text.trim();

      if (cleanText.startsWith("/")) {
        setInputValue("");
        handleCommand(cleanText);
        return;
      }

      if (isInterrupt && isProcessing) {
        setInputValue("");
        if (engine) {
          engine.abortQuery();
        }
        setH2aQueue((prev) => [
          ...prev,
          { text: cleanText, timestamp: new Date().toISOString(), interrupt: true },
        ]);
        return;
      }

      if (status.state === "permission_denied") {
        if (cleanText.toLowerCase() === "i understand the risk" || cleanText.toLowerCase() === "yes" || cleanText.toLowerCase() === "y") {
          setInputValue("");
          setStatus((prev) => ({ ...prev, state: "idle" }));
        }
        return;
      }

      if (status.state === "needs_confirmation") {
        if (cleanText.toLowerCase() === "y" || cleanText.toLowerCase() === "yes") {
          setInputValue("");
          setStatus((prev) => ({ ...prev, state: "idle" }));
        } else {
          setInputValue("");
          setStatus((prev) => ({ ...prev, state: "idle", errorMessage: undefined }));
        }
        return;
      }

      if (status.state === "max_turns") {
        if (cleanText.toLowerCase() === "c" || cleanText.toLowerCase() === "continue") {
          setInputValue("");
          setStatus((prev) => ({ ...prev, state: "idle" }));
        } else {
          setInputValue("");
          setStatus((prev) => ({ ...prev, state: "idle", errorMessage: undefined }));
        }
        return;
      }

      setIsProcessing(true);
      setStreamingText("");
      lastReasoningRef.current = "";
      setStatus((prev) => ({
        ...prev,
        state: "thinking",
        lastSentTimestamp: new Date().toISOString(),
      }));

      const userMsg: Message = {
        role: "user",
        content: cleanText,
        timestamp: new Date().toISOString(),
        critical: cleanText.startsWith("/mark"),
      };

      setInputValue("");

      setMessages((prev) => {
        const updated = [...prev, userMsg];
        messagesRef.current = updated;
        return updated;
      });

      try {
        if (!engine) {
          setStatus((prev) => ({ ...prev, state: "error", errorMessage: "Engine not initialized. Please select a provider first." }));
          return;
        }
        const currentMessages = [...messagesRef.current];
        const result = await engine.query(
          { text: cleanText, timestamp: new Date().toISOString() },
          {
            messages: currentMessages,
            config,
            platform,
            projectMemory,
          }
        );

        if (result.response.content) {
          const reasoningText = lastReasoningRef.current;
          lastReasoningRef.current = "";
          const assistantMsg: Message = {
            role: "assistant",
            content: result.response.content,
            timestamp: new Date().toISOString(),
            critical: false,
            reasoning_content: reasoningText || "",
          };
          setMessages((prev) => {
            const updated = [...prev, assistantMsg];
            messagesRef.current = updated;
            return updated;
          });
        }

        if (result.stopReason === "end_turn") {
          setStatus((prev) => ({
            ...prev,
            state: config.auto_commit ? "delivered" : "idle",
          }));
        } else if (result.stopReason === "stop_sequence") {
          setStatus((prev) => ({ ...prev, state: "idle" }));
        } else {
          setStatus((prev) => ({ ...prev, state: "idle" }));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus((prev) => ({
          ...prev,
          state: "error",
          errorMessage: message,
        }));
      } finally {
        setIsProcessing(false);
        setStreamingText("");
      }
    },
    [config, platform, engine, isProcessing, status.state]
  );

  const handleCommand = useCallback(
    (cmd: string) => {
      const aliasMap: Record<string, string> = {
        "/h": "/help",
        "/s": "/status",
        "/cl": "/clear",
        "/m": "/mode",
        "/w": "/workflow",
        "/q": "/exit",
        "/x": "/exit",
        "/e": "/export",
        "/i": "/init",
        "/r": "/review",
        "/t": "/test",
        "/p": "/pr",
        "/d": "/doctor",
        "/mem": "/memory",
        "/cmp": "/compact",
        "/$": "/cost",
        "/md": "/model",
      };
      // Resolve alias first, then dispatch
      const cmdParts = cmd.split(/\s+/);
      const baseCmd = cmdParts[0] || cmd;
      const resolvedBase = aliasMap[baseCmd] || baseCmd;
      const resolvedCmd = cmd.replace(baseCmd, resolvedBase);

      switch (resolvedCmd.split(/\s+/)[0] || resolvedCmd) {
        case "/help":
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "Commands:\n" +
                "  /help  (/h)   - Show this help\n" +
                "  /status (/s)  - Show session status\n" +
                "  /clear (/cl)  - Clear session messages\n" +
                "  /mode (/m)    - Cycle: plan → act → default\n" +
                "  /init (/i)    - Initialize project memory (.agent_1.md)\n" +
                "  /review (/r)  - Run code review on current project\n" +
                "  /test (/t)    - Generate and run tests for current file\n" +
                "  /pr (/p)      - Create a pull request from changes\n" +
                "  /model (/md)  - Show or switch model\n" +
                "  /doctor (/d)  - Run system diagnostic\n" +
                "  /cost (/$)    - Show token usage and cost\n" +
                "  /exit (/q,/x) - Exit agent_1\n" +
                "  >>text        - Interrupt current task",
              timestamp: new Date().toISOString(),
              critical: false,
            },
          ]);
          break;
        case "/status":
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `Provider: ${config.chosen_provider}\nModel: ${config.model}\nMode: ${config.permission_mode}\nTurns: ${config.max_turns}\nAuto-commit: ${config.auto_commit}\nAuto-PR: ${config.auto_create_pr}`,
              timestamp: new Date().toISOString(),
              critical: false,
            },
          ]);
          break;
        case "/clear":
          setMessages([]);
          messagesRef.current = [];
          break;
        case "/mode": {
          if (!engine) {
            setMessages((prev) => [...prev, { role: "assistant", content: "Engine not initialized. Please select a provider first.", timestamp: new Date().toISOString(), critical: false }]);
            break;
          }
          const modes = ["default", "plan", "act"] as const;
          const currentMode = engine.getMode();
          const currentIdx = modes.indexOf(currentMode as "default" | "plan" | "act");
          const nextMode = modes[(currentIdx + 1) % modes.length];
          engine.setMode(nextMode);
          const updatedConfig: Config = { ...config, permission_mode: (nextMode === "plan" ? "plan" : "default") as PermissionMode };
          onConfigChange(updatedConfig);
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `Switched to **${nextMode.toUpperCase()} MODE**.\n${
                nextMode === "plan" ? "- Analysis and planning only. No tools will be executed." :
                nextMode === "act" ? "- Full execution mode. All tools available to execute the plan." :
                "- Default mode. Both planning and execution are available."
              }`,
              timestamp: new Date().toISOString(),
              critical: false,
            },
          ]);
          break;
        }
        case "/workflow":
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "Workflows:\n\n" +
                "  /workflow create-api    - Create a new REST API endpoint\n" +
                "  /workflow fix-bug       - Debug and fix a bug\n" +
                "  /workflow refactor      - Refactor code for better quality\n" +
                "  /workflow add-tests     - Add comprehensive tests\n" +
                "  /workflow init-project  - Initialize a new project\n" +
                "  /workflow code-review   - Perform a code review\n" +
                "\nUsage: Type /workflow <name> to activate a workflow. This will inject a structured prompt to guide the agent.",
              timestamp: new Date().toISOString(),
              critical: false,
            },
          ]);
          break;
        case "/init":
          handleSubmit("Initialize this project by scanning the codebase and creating a comprehensive .agent_1.md file that documents: 1) Project overview and purpose 2) Architecture and key components 3) Coding conventions and style 4) Dependencies and their roles 5) Build/test/deploy commands 6) Known issues and notes");
          break;
        case "/review":
          handleSubmit("Perform a thorough code review of the current project. Focus on: 1) Code quality and readability 2) Security vulnerabilities 3) Performance issues 4) Error handling 5) Test coverage gaps 6) Best practices compliance. Provide specific, actionable recommendations with file paths and line references.");
          break;
        case "/test":
          handleSubmit("Analyze the current codebase and generate comprehensive tests. Focus on: 1) Unit tests for core logic 2) Integration tests for component interactions 3) Edge cases and error scenarios 4) Mock external dependencies appropriately. Follow the project's existing test patterns and conventions.");
          break;
        case "/pr":
          handleSubmit("Create a pull request from the current changes. Steps: 1) Review all uncommitted changes with git diff 2) Stage relevant changes 3) Write a clear, descriptive commit message following conventional commits format 4) Push to a new branch 5) Create a PR with a detailed description including: summary, changes, testing notes, and any breaking changes.");
          break;
        case "/model": {
          const rest = cmd.slice("/model".length).trim();
          if (rest) {
            onConfigChange({ ...config, model: rest });
            setMessages((prev) => [...prev, { role: "assistant", content: `Model switched to: ${rest}`, timestamp: new Date().toISOString(), critical: false }]);
          } else {
            setMessages((prev) => [...prev, { role: "assistant", content: `Current model: ${config.model}\nAvailable: deepseek-v4-pro, deepseek-v4-flash`, timestamp: new Date().toISOString(), critical: false }]);
          }
          break;
        }
        case "/exit":
          onExit();
          break;
        default:
          if (resolvedCmd.startsWith("/workflow ")) {
            const workflowName = cmd.slice("/workflow ".length).trim();
            const workflows: Record<string, string> = {
              "create-api": "Create a new REST API endpoint with route, controller, validation, and tests",
              "fix-bug": "Systematically debug and fix a reported bug",
              "refactor": "Refactor code for better quality, performance, and maintainability",
              "add-tests": "Add comprehensive test coverage for existing code",
              "init-project": "Initialize a new project with proper structure and configuration",
              "code-review": "Perform a thorough code review focusing on quality, security, and performance",
            };
            const workflowPrompt = workflows[workflowName];
            if (workflowPrompt) {
              handleSubmit(workflowPrompt);
            } else {
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: `Unknown workflow: "${workflowName}". Available: ${Object.keys(workflows).join(", ")}`,
                  timestamp: new Date().toISOString(),
                  critical: false,
                },
              ]);
            }
          } else if (cmd === "/export") {
            try {
              const store = new SessionStore();
              const data = JSON.stringify({ messages, config, exportedAt: new Date().toISOString() }, null, 2);
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: `Session exported successfully. ${messages.length} messages, ${(data.length / 1024).toFixed(1)}KB`,
                  timestamp: new Date().toISOString(),
                  critical: false,
                },
              ]);
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              setStatus((prev) => ({ ...prev, state: "error", errorMessage: `Export failed: ${message}` }));
            }
          } else {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `Unknown command: ${cmd}. Type /help for available commands.`,
                timestamp: new Date().toISOString(),
                critical: false,
              },
            ]);
          }
          break;
      }

      if (cmd.startsWith("/config deny add ")) {
        const pattern = cmd.slice("/config deny add ".length).trim();
        if (pattern && engine) {
          try {
            engine.getPermissionPipeline().addDenyPattern(pattern);
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `Deny pattern added: "${pattern}"`,
                timestamp: new Date().toISOString(),
                critical: false,
              },
            ]);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setStatus((prev) => ({ ...prev, state: "error", errorMessage: message }));
          }
        }
        return;
      }

      if (cmd.startsWith("/config deny list")) {
        if (!engine) {
          setMessages((prev) => [...prev, { role: "assistant", content: "Engine not initialized.", timestamp: new Date().toISOString(), critical: false }]);
          return;
        }
        try {
          const patterns = engine.getPermissionPipeline().getDenyPatterns();
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                patterns.length > 0
                  ? `Custom deny patterns:\n${patterns.map((p) => `  - ${p}`).join("\n")}`
                  : "No custom deny patterns configured.",
              timestamp: new Date().toISOString(),
              critical: false,
            },
          ]);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          setStatus((prev) => ({ ...prev, state: "error", errorMessage: message }));
        }
        return;
      }

      if (cmd.startsWith("/config deny remove ")) {
        const pattern = cmd.slice("/config deny remove ".length).trim();
        if (pattern && engine) {
          try {
            const removed = engine.getPermissionPipeline().removeDenyPattern(pattern);
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: removed ? `Deny pattern removed: "${pattern}"` : `Pattern not found: "${pattern}"`,
                timestamp: new Date().toISOString(),
                critical: false,
              },
            ]);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setStatus((prev) => ({ ...prev, state: "error", errorMessage: message }));
          }
        }
        return;
      }

      return;
    },
    [config, engine, onConfigChange, onExit]
  );

  const handleProviderSelect = useCallback(
    (provider: string, customConfig?: Partial<Config>) => {
      const newConfig = { ...config, ...customConfig, chosen_provider: provider, accept_terms: true };
      onConfigChange(newConfig);
      if (engine) {
        try {
          engine.refreshProvider(newConfig);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          setStatus((prev) => ({ ...prev, state: "error", errorMessage: message }));
          return;
        }
      } else {
        try {
          const newEngine = createQueryEngine(newConfig);
          onEngineReady?.(newEngine);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          setStatus((prev) => ({ ...prev, state: "error", errorMessage: message }));
          return;
        }
      }
      setStatus((prev) => ({
        ...prev,
        state: "idle",
        provider,
      }));
    },
    [config, engine, onConfigChange, onEngineReady]
  );

  if (status.state === "provider_select") {
    return <ProviderSelect config={config} onSelect={handleProviderSelect} />;
  }

  return (
    <Box flexDirection="column" paddingX={0}>
      <StatusBar status={status} />

      <MessageList messages={messages} />

      {status.state === "thinking" && streamingText && (
        <Box marginLeft={2}>
          <Text color="gray">{streamingText.slice(-200)}</Text>
        </Box>
      )}

      {status.state === "thinking" && (
        <ThinkingIndicator model={status.modelName || "AI"} attempt={status.attempt ?? 1} tokenUsage={status.tokenUsage} />
      )}

      {status.state === "executing" && (
        <ToolExecutionView
          tool={status.currentTool || ""}
          progress={status.progress ?? 0}
        />
      )}

      {status.state === "permission_denied" && (
        <PermissionDeniedView message={status.errorMessage || ""} />
      )}

      {status.state === "needs_confirmation" && (
        <Box flexDirection="column">
          <Text color="yellow">⚠ {status.errorMessage}</Text>
          <Text dimColor>[?] Execute "{status.pendingCommand}" anyway? (y/N) _</Text>
        </Box>
      )}

      {status.state === "error" && (
        <ErrorView message={status.errorMessage || ""} />
      )}

      {status.state === "compacting" && (
        <Text color="blue">ℹ {status.errorMessage}</Text>
      )}

      {status.state === "max_turns" && (
        <Box flexDirection="column">
          <Text color="yellow">⚠ {status.errorMessage}</Text>
          <Text dimColor>[?] Continue with 20 more turns, or stop? (c/s)</Text>
        </Box>
      )}

      {status.state === "delivered" && (
        <DeliveryView
          files={status.generatedFiles}
          commitHash={status.commitHash}
        />
      )}

      {!isProcessing && status.state !== "permission_denied" && status.state !== "max_turns" && status.state !== "needs_confirmation" && (
        <InputLine
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
        />
      )}
    </Box>
  );
};
