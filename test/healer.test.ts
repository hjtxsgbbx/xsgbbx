import { ErrorHealer } from "../src/tools/healer.js";
import { ToolResult } from "../src/types/index.js";

describe("Error Healer", () => {
  const healer = new ErrorHealer();

  test("should retry on first error", () => {
    const result: ToolResult = {
      success: false,
      output: "Command not found",
      errorCode: "127",
    };

    const decision = healer.healError(result, "shell_command", {
      command: "npmm install",
    });
    expect(decision.strategy).toBeDefined();
  });

  test("should ask after max retries", () => {
    const result: ToolResult = {
      success: false,
      output: "Command not found",
      errorCode: "127",
    };

    healer.healError(result, "shell_command", { command: "npmm install" });
    healer.healError(result, "shell_command", { command: "npmm install" });
    healer.healError(result, "shell_command", { command: "npmm install" });
    const decision = healer.healError(result, "shell_command", {
      command: "npmm install",
    });

    expect(decision.strategy).toBe("ASK");
  });

  test("should generate diagnostic command for investigate", () => {
    healer.resetAll();

    const result: ToolResult = {
      success: false,
      output: "Module not found",
      errorCode: "MODULE_NOT_FOUND",
    };

    const decision = healer.healError(result, "shell_command", {
      command: "node index.js",
    });

    expect(decision.strategy).toBeDefined();
    if (decision.strategy === "INVESTIGATE") {
      expect(decision.diagnosticCommand).toBeDefined();
    }
  });

  test("should reset retry counts", () => {
    const result: ToolResult = {
      success: false,
      output: "Command not found",
      errorCode: "127",
    };

    healer.healError(result, "shell_command", { command: "test" });
    healer.resetRetryCount("shell_command", "127");

    const decision = healer.healError(result, "shell_command", {
      command: "test",
    });
    expect(decision.strategy).not.toBe("ASK");
  });
});