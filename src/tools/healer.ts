import { ToolResult, HealStrategy, HealDecision } from "../types/index.js";

const STRATEGY_WEIGHTS: Record<HealStrategy, number> = {
  RETRY: 55,
  INVESTIGATE: 28,
  FIX: 14,
  PIVOT: 2,
  ASK: 1,
};

const MAX_RETRIES = 3;

const ERROR_FIXES: Record<string, string> = {
  "127": "npmm:npm install",
  "MODULE_NOT_FOUND": "npm install",
  "ENOENT": "npm install",
  "EACCES": "chmod +x",
  "EADDRINUSE": "kill -9 $(lsof -t -i:PORT)",
};

const DIAGNOSTIC_COMMANDS: Record<string, string> = {
  "127": "which COMMAND || where COMMAND",
  "MODULE_NOT_FOUND": "npm list 2>/dev/null || yarn list",
  "ENOENT": "ls -la PARENT_DIR",
  "EACCES": "ls -la FILE_PATH",
  "EADDRINUSE": "lsof -i :PORT || netstat -ano | findstr :PORT",
  "DEFAULT": "echo $PATH && node --version && which npm",
};

export class ErrorHealer {
  private retryCount: Map<string, number> = new Map();

  healError(
    toolResult: ToolResult,
    toolName: string,
    params: Record<string, unknown>
  ): HealDecision {
    const errorCode = toolResult.errorCode || "UNKNOWN";
    const key = `${toolName}:${errorCode}`;
    const currentRetries = this.retryCount.get(key) || 0;

    if (currentRetries >= MAX_RETRIES) {
      return { strategy: "ASK" };
    }

    this.retryCount.set(key, currentRetries + 1);

    const strategy = this.selectStrategy();

    switch (strategy) {
      case "RETRY":
        return { strategy: "RETRY", modifiedParams: params };

      case "INVESTIGATE": {
        const diagCmd = this.getDiagnosticCommand(errorCode, toolName, params);
        return { strategy: "INVESTIGATE", diagnosticCommand: diagCmd };
      }

      case "FIX": {
        const fix = this.getFix(errorCode, toolName, params);
        return {
          strategy: "FIX",
          modifiedParams: { ...params, command: fix },
          alternativeApproach: fix,
        };
      }

      case "PIVOT": {
        const alt = this.getAlternativeApproach(toolName, errorCode);
        return { strategy: "PIVOT", alternativeApproach: alt };
      }

      case "ASK":
      default:
        return { strategy: "ASK" };
    }
  }

  private selectStrategy(): HealStrategy {
    const total = Object.values(STRATEGY_WEIGHTS).reduce((a, b) => a + b, 0);
    let random = Math.random() * total;

    for (const [strategy, weight] of Object.entries(STRATEGY_WEIGHTS)) {
      random -= weight;
      if (random <= 0) {
        return strategy as HealStrategy;
      }
    }

    return "RETRY";
  }

  private getDiagnosticCommand(
    errorCode: string,
    toolName: string,
    params: Record<string, unknown>
  ): string {
    const command = (params.command as string) || toolName;
    const baseCmd = DIAGNOSTIC_COMMANDS[errorCode] || DIAGNOSTIC_COMMANDS["DEFAULT"];

    return baseCmd
      .replace("COMMAND", command.split(" ")[0])
      .replace("PARENT_DIR", ".")
      .replace("FILE_PATH", ".")
      .replace("PORT", "3000");
  }

  private getFix(
    errorCode: string,
    toolName: string,
    params: Record<string, unknown>
  ): string {
    const command = (params.command as string) || "";
    const fixTemplate = ERROR_FIXES[errorCode];

    if (fixTemplate) {
      const [pattern, replacement] = fixTemplate.split(":");
      if (pattern && replacement && command.includes(pattern)) {
        return command.replace(pattern, replacement);
      }
      return replacement;
    }

    if (errorCode.startsWith("EXIT_")) {
      if (command.includes("npm") || command.includes("yarn") || command.includes("pnpm")) {
        return `${command.split(" ")[0]} install`;
      }
    }

    return command;
  }

  private getAlternativeApproach(
    toolName: string,
    errorCode: string
  ): string {
    if (toolName === "shell_command" && errorCode === "127") {
      return "Try using npx for the command or check if package is installed";
    }
    if (errorCode === "MODULE_NOT_FOUND") {
      return "Install the required package and retry";
    }
    return "Consider an alternative approach";
  }

  resetRetryCount(toolName: string, errorCode: string): void {
    const key = `${toolName}:${errorCode}`;
    this.retryCount.delete(key);
  }

  resetAll(): void {
    this.retryCount.clear();
  }
}