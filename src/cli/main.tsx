import React, { useState, useEffect } from "react";
import { render } from "ink";
import { App } from "./app.js";
import { detectPlatform } from "../pal/index.js";
import { ConfigStore, SessionStore } from "../storage/index.js";
import { createQueryEngine, QueryEngineImpl, loadProjectMemory } from "../core/index.js";
import { Config, PlatformInfo } from "../types/index.js";
import * as fs from "fs";
import * as path from "path";

interface MainProps {
  config: Config;
  platform: PlatformInfo;
  projectPath: string;
  projectMemory: string;
  onExit: () => void;
}

const MainComponent: React.FC<MainProps> = ({
  config: initialConfig,
  platform,
  projectPath,
  projectMemory,
  onExit,
}) => {
  const [config, setConfig] = useState<Config>(initialConfig);
  const [engine, setEngine] = useState<QueryEngineImpl | null>(null);
  const configStore = new ConfigStore();
  const sessionStore = new SessionStore();

  useEffect(() => {
    if (config.chosen_provider) {
      const eng = createQueryEngine(config.chosen_provider);
      setEngine(eng);

      const lastSessionId = sessionStore.getLastSessionId();
      if (lastSessionId) {
        const session = sessionStore.loadSession(lastSessionId);
        if (session) {
          eng.setSession(session);
        }
      } else {
        const session = sessionStore.create(
          projectPath,
          `${platform.os}`,
          platform.terminal,
          config.chosen_provider,
          config.model
        );
        eng.setSession(session);
      }
    }
  }, [config.chosen_provider]);

  const handleConfigChange = (newConfig: Config) => {
    setConfig(newConfig);
    configStore.save(newConfig);
  };

  if (!engine) {
    return null;
  }

  return (
    <App
      engine={engine}
      config={config}
      platform={platform}
      projectPath={projectPath}
      projectMemory={projectMemory}
      onConfigChange={handleConfigChange}
      onExit={onExit}
    />
  );
};

export function startCLI(options: {
  projectPath?: string;
  headless?: boolean;
  prompt?: string;
}): void {
  const platform = detectPlatform();
  const projectPath = options.projectPath || process.cwd();
  const configStore = new ConfigStore();
  const config = configStore.load();
  const projectMemory = loadProjectMemory(projectPath);

  if (options.headless) {
    headlessMode(config, platform, projectPath, projectMemory, options.prompt);
    return;
  }

  displayWelcome();

  render(
    <MainComponent
      config={config}
      platform={platform}
      projectPath={projectPath}
      projectMemory={projectMemory}
      onExit={() => process.exit(0)}
    />,
    {
      exitOnCtrlC: true,
    }
  );
}

function displayWelcome(): void {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║         🤖 agent_1 v1.0.0                           ║");
  console.log("║    跨平台 AI 编程助手 - CLI MVP                      ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║                                                       ║");
  console.log("║  📋 知情同意声明 / Informed Consent                   ║");
  console.log("║  您的代码片段和指令将被发送至您选择的 AI 提供商       ║");
  console.log("║  (Anthropic 或 OpenAI) 以生成编程建议。                ║");
  console.log("║  所有数据存储于本地 ~/.agent_1/                        ║");
  console.log("║  完整隐私政策见仓库 PRIVACY.md                        ║");
  console.log("║                                                       ║");
  console.log("║  使用本工具即表示您已知情并同意上述数据共享。         ║");
  console.log("║  使用 --accept-terms 跳过此提示                       ║");
  console.log("║                                                       ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  Type /help for commands    |  Ctrl+C to exit         ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("");
}

async function headlessMode(
  config: Config,
  platform: PlatformInfo,
  projectPath: string,
  projectMemory: string,
  prompt?: string
): Promise<void> {
  if (!config.accept_terms) {
    console.log("Error: --accept-terms required for headless mode.");
    process.exit(1);
  }

  const engine = createQueryEngine(config.chosen_provider || "anthropic");

  const input = prompt || process.argv.slice(2).join(" ");
  if (!input) {
    console.log("Error: No input provided for headless mode.");
    process.exit(1);
  }

  const sessionStore = new SessionStore();
  const session = sessionStore.create(
    projectPath,
    platform.os,
    platform.terminal,
    config.chosen_provider,
    config.model
  );
  engine.setSession(session);

  engine.on("thinking", (model: string) => console.log(`[Thinking] ${model}`));
  engine.on("toolExecuting", (tool: string) => console.log(`[Tool] ${tool}`));
  engine.on("error", (msg: string) => console.error(`[Error] ${msg}`));

  try {
    const result = await engine.query(
      { text: input, timestamp: new Date().toISOString() },
      { messages: [], config, platform, projectMemory }
    );
    console.log(result.response.content);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }

  process.exit(0);
}