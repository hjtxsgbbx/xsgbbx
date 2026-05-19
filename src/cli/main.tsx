import React, { useState, useEffect } from "react";
import { render } from "ink";
import { App } from "./app.js";
import { detectPlatform } from "../pal/index.js";
import { ConfigStore, SessionStore } from "../storage/index.js";
import { createQueryEngine, type QueryEngineImpl } from "../engine/index.js";
import { loadProjectMemory } from "../intelligence/index.js";
import { type Config, type PlatformInfo } from "../types/index.js";

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
  const [configStore] = useState(() => new ConfigStore());
  const [sessionStore] = useState(() => new SessionStore());

  useEffect(() => {
    try {
      const cfg = configStore.load();
      setConfig(cfg);

      const hasProvider = !!cfg.chosen_provider;
      if (hasProvider) {
        const eng = createQueryEngine(cfg);
        setEngine(eng);

        // Always start with a fresh session — never restore old messages
        const session = sessionStore.create(
          projectPath,
          `${platform.os}`,
          platform.terminal,
          cfg.chosen_provider,
          cfg.model
        );
        eng.setSession(session);
      }
    } catch (err) {
      console.error("Failed to load config:", err);
    }
  }, []);

  const handleConfigChange = (newConfig: Config) => {
    setConfig(newConfig);
    configStore.save(newConfig);
  };

  return (
    <App
      engine={engine}
      config={config}
      platform={platform}
      projectPath={projectPath}
      projectMemory={projectMemory}
      onConfigChange={handleConfigChange}
      onExit={onExit}
      onEngineReady={(eng) => setEngine(eng)}
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
  console.log("║  📋 数据声明                                          ║");
  console.log("║  您的代码和指令将被发送至 DeepSeek API 服务器          ║");
  console.log("║  所有其他数据存储在本地 ~/.agent_1/                    ║");
  console.log("║                                                       ║");
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

  let engine: QueryEngineImpl;
  try {
    engine = createQueryEngine(config);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to create engine: ${message}`);
    process.exit(1);
  }

  const input = prompt || process.argv.slice(2).filter(a => !a.startsWith("--")).join(" ");
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