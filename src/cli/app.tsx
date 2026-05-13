import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { AppStatus, AppState, H2AEntry, Message, Session, Config, PlatformInfo, PermissionMode, TokenUsage, ToolCall } from "../types/index.js";
import { StatusBar } from "./components/StatusBar.js";
import { InputLine } from "./components/InputLine.js";
import { ThinkingIndicator } from "./components/ThinkingIndicator.js";
import { ToolExecutionView } from "./components/ToolExecutionView.js";
import { PermissionDeniedView } from "./components/PermissionDeniedView.js";
import { ErrorView } from "./components/ErrorView.js";
import { DeliveryView } from "./components/DeliveryView.js";
import { MessageList } from "./components/MessageList.js";
import { ProviderSelect } from "./components/ProviderSelect.js";
import { QueryEngineImpl } from "../core/index.js";

interface AppProps {
  engine: QueryEngineImpl;
  config: Config;
  platform: PlatformInfo;
  projectPath: string;
  projectMemory: string;
  onConfigChange: (config: Config) => void;
  onExit: () => void;
}

export const App: React.FC<AppProps> = ({
  engine,
  config,
  platform,
  projectPath,
  projectMemory,
  onConfigChange,
  onExit,
}) => {
  const { exit } = useApp();
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
  const inputRef = useRef<string>("");

  useEffect(() => {
    if (!engine) return;

    engine.on("thinking", (model: string, attempt: number, tokenUsage: any) => {
      setStatus((prev) => ({
        ...prev,
        state: "thinking",
        modelName: model,
        attempt,
        tokenUsage,
      }));
    });

    engine.on("toolExecuting", (toolName: string, command: string) => {
      setStatus((prev) => ({
        ...prev,
        state: "executing",
        currentTool: `${toolName}: ${command}`,
        progress: 0,
      }));
    });

    engine.on("toolResult", (result: any) => {
      setStatus((prev) => ({
        ...prev,
        progress: 100,
      }));
    });

    engine.on(
      "permissionDenied",
      (reason: string, layer: string, canOverride: boolean) => {
        setStatus((prev) => ({
          ...prev,
          state: "permission_denied",
          errorMessage: `${reason} (${layer}, ${canOverride ? "overrideable" : "non-overrideable"})`,
        }));
      }
    );

    engine.on(
      "requestConfirmation",
      (toolCall: ToolCall, command: string, reason: string) => {
        setStatus((prev) => ({
          ...prev,
          state: "needs_confirmation",
          errorMessage: reason,
          pendingCommand: command,
          pendingToolCall: toolCall,
        }));
      }
    );

    engine.on("compacting", (from: string, to: string) => {
      setStatus((prev) => ({
        ...prev,
        state: "compacting",
        errorMessage: `Context compacted (${from} → ${to} tokens)`,
      }));
    });

    engine.on("maxTurnsReached", () => {
      setStatus((prev) => ({
        ...prev,
        state: "max_turns",
        errorMessage: "Maximum turns (50) reached. Task incomplete.",
      }));
    });

    engine.on("taskCompleted", (files: string[], commitHash?: string) => {
      setStatus((prev) => ({
        ...prev,
        state: "delivered",
        generatedFiles: files,
        commitHash,
      }));
    });

    engine.on("error", (message: string) => {
      setStatus((prev) => ({
        ...prev,
        state: "error",
        errorMessage: message,
      }));
    });

    return () => {
      engine.removeAllListeners();
    };
  }, [engine]);

  const handleSubmit = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      const isInterrupt = text.startsWith(">>");
      const cleanText = isInterrupt ? text.slice(2).trim() : text.trim();

      if (cleanText.startsWith("/")) {
        handleCommand(cleanText);
        return;
      }

      if (isInterrupt && isProcessing) {
        setH2aQueue((prev) => [
          ...prev,
          { text: cleanText, timestamp: new Date().toISOString(), interrupt: true },
        ]);
        return;
      }

      if (status.state === "permission_denied") {
        if (cleanText === "I understand the risk") {
          setStatus((prev) => ({ ...prev, state: "executing" }));
        }
        return;
      }

      if (status.state === "needs_confirmation") {
        if (cleanText.toLowerCase() === "y" || cleanText.toLowerCase() === "yes") {
          setStatus((prev) => ({ ...prev, state: "executing" }));
        } else {
          setStatus((prev) => ({ ...prev, state: "idle" }));
        }
        return;
      }

      if (status.state === "max_turns") {
        if (cleanText.toLowerCase() === "c") {
          setStatus((prev) => ({ ...prev, state: "thinking" }));
        } else {
          setStatus((prev) => ({ ...prev, state: "idle" }));
        }
        return;
      }

      setIsProcessing(true);
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

      const newMessages = [...messages, userMsg];
      setMessages(newMessages);

      try {
        const result = await engine.query(
          { text: cleanText, timestamp: new Date().toISOString() },
          {
            messages: newMessages,
            config,
            platform,
            projectMemory,
          }
        );

        if (result.response.content) {
          const assistantMsg: Message = {
            role: "assistant",
            content: result.response.content,
            timestamp: new Date().toISOString(),
            critical: false,
          };
          setMessages((prev) => [...prev, assistantMsg]);
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
      }
    },
    [messages, config, platform, engine, isProcessing, status.state]
  );

  const handleCommand = useCallback(
    (cmd: string) => {
      switch (cmd) {
        case "/help":
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "Commands:\n" +
                "  /help       - Show this help\n" +
                "  /status     - Show session status\n" +
                "  /clear      - Clear session messages\n" +
                "  /mode       - Cycle: plan → act → default\n" +
                "  /workflow   - List available workflows\n" +
                "  /workflow <n> - Activate a workflow\n" +
                "  /exit       - Exit agent_1\n" +
                "  /export     - Export session data\n" +
                "  >>text      - Interrupt current task",
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
          break;
        case "/mode":
          const modes = ["default", "plan", "act"] as const;
          const currentMode = engine.getMode();
          const currentIdx = modes.indexOf(currentMode);
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
        case "/exit":
          onExit();
          break;
        default:
          break;
      }

      if (cmd.startsWith("/config deny add ")) {
        const pattern = cmd.slice("/config deny add ".length).trim();
        if (pattern) {
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
        }
        return;
      }

      if (cmd.startsWith("/config deny list")) {
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
        return;
      }

      if (cmd.startsWith("/config deny remove ")) {
        const pattern = cmd.slice("/config deny remove ".length).trim();
        if (pattern) {
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
        }
        return;
      }

      return;
    },
    [config, engine, onConfigChange, onExit]
  );

  const handleProviderSelect = useCallback(
    (provider: string) => {
      const newConfig = { ...config, chosen_provider: provider, accept_terms: true };
      onConfigChange(newConfig);
      setStatus((prev) => ({
        ...prev,
        state: "idle",
        provider,
      }));
    },
    [config, onConfigChange]
  );

  if (status.state === "provider_select") {
    return <ProviderSelect onSelect={handleProviderSelect} />;
  }

  return (
    <Box flexDirection="column" paddingX={0}>
      <StatusBar status={status} />

      <MessageList messages={messages} />

      {status.state === "thinking" && (
        <ThinkingIndicator model={status.modelName || "AI"} attempt={status.attempt || 1} tokenUsage={status.tokenUsage} />
      )}

      {status.state === "executing" && (
        <ToolExecutionView
          tool={status.currentTool || ""}
          progress={status.progress || 0}
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