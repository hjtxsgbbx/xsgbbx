import { type BenchmarkTask, type TaskResult, type ExpectedOutput } from "./types.js";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

export interface RunnerOptions {
  timeoutMs: number;
  projectPath: string;
  verbose: boolean;
  maxTurns: number;
}

const DEFAULT_OPTIONS: RunnerOptions = {
  timeoutMs: 120000,
  projectPath: process.cwd(),
  verbose: false,
  maxTurns: 50,
};

export class BenchmarkRunner {
  private options: RunnerOptions;

  constructor(options?: Partial<RunnerOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async runTasks(tasks: BenchmarkTask[]): Promise<TaskResult[]> {
    const results: TaskResult[] = [];
    for (const task of tasks) {
      this.log(`\n=== Task: ${task.name} (${task.id}) ===`);
      const result = await this.runSingleTask(task);
      results.push(result);
      this.log(`Result: ${result.passed ? "PASS" : "FAIL"} (${result.timeTakenMs}ms)`);
    }
    return results;
  }

  async runSingleTask(task: BenchmarkTask): Promise<TaskResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];
    const details: Record<string, unknown> = {};
    const toolCalls = 0;
    const tokensUsed = 0;
    const turnsCompleted = 0;

    try {
      for (const cmd of task.setupCommands) {
        this.runCommand(cmd, this.options.projectPath);
      }

      const outputResult = await this.verifyOutput(task.expectedOutput, this.options.projectPath);

      details.testPassed = outputResult.passed;
      details.output = outputResult.details;

      if (!outputResult.passed) {
        errors.push(outputResult.error || "Output verification failed");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
    }

    const timeTakenMs = Date.now() - startTime;
    const passed = errors.length === 0;

    let score = 0;
    const maxScore = 100;
    if (passed) score = 100;
    else if (errors.length === 1 && warnings.length > 0) score = 50;
    else score = errors.length > 0 ? 0 : 25;

    return {
      taskId: task.id,
      taskName: task.name,
      category: task.category,
      passed,
      score,
      maxScore,
      timeTakenMs,
      tokensUsed,
      toolCalls,
      turnsCompleted,
      errors,
      warnings,
      details,
    };
  }

  async verifyOutput(
    expected: ExpectedOutput,
    projectPath: string
  ): Promise<{ passed: boolean; details: string; error?: string }> {
    const workspace = projectPath;

    try {
      switch (expected.type) {
        case "file_exists": {
          const fp = path.resolve(workspace, expected.filePath || "");
          if (!fs.existsSync(fp)) {
            return { passed: false, details: `File not found: ${fp}`, error: "FILE_NOT_FOUND" };
          }
          const content = fs.readFileSync(fp, "utf-8");
          if (expected.regex) {
            const re = new RegExp(expected.regex, "m");
            if (!re.test(content)) {
              return { passed: false, details: `Pattern "${expected.regex}" not found in ${fp}`, error: "PATTERN_NOT_FOUND" };
            }
          }
          return { passed: true, details: `File verified: ${fp}` };
        }

        case "test_pass": {
          const cmd = expected.cliCommand || "npx jest";
          const output = this.runCommand(cmd, workspace);
          return {
            passed: !output.toLowerCase().includes("failed") && !output.toLowerCase().includes("error"),
            details: output.slice(0, 500),
          };
        }

        case "regex_match": {
          const pattern = expected.regex || ".*";
          const cmd = expected.cliCommand || "echo test";
          const output = this.runCommand(cmd, workspace);
          const re = new RegExp(pattern, "m");
          return { passed: re.test(output), details: output.slice(0, 500) };
        }

        case "cli_output": {
          const output = this.runCommand(expected.cliCommand || "echo ok", workspace);
          const exitCode = this.getExitCode(expected.cliCommand || "echo ok", workspace);
          const expectedExit = expected.expectedExitCode ?? 0;
          return {
            passed: exitCode === expectedExit,
            details: `Exit code: ${exitCode}, expected: ${expectedExit}. Output: ${output.slice(0, 200)}`,
          };
        }

        case "type_check": {
          try {
            execSync("npx tsc --noEmit", { cwd: workspace, timeout: 30000, stdio: "pipe" });
            return { passed: true, details: "TypeScript type check passed" };
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return { passed: false, details: msg.slice(0, 500), error: "TYPE_CHECK_FAILED" };
          }
        }

        case "lint_pass": {
          try {
            execSync("npx eslint src/ --no-error-on-unmatched-pattern --max-warnings 5", {
              cwd: workspace, timeout: 30000, stdio: "pipe",
            });
            return { passed: true, details: "Lint check passed" };
          } catch {
            return { passed: false, details: "Lint check failed", error: "LINT_FAILED" };
          }
        }

        default:
          return { passed: true, details: "No verification specified" };
      }
    } catch (err: unknown) {
      return { passed: false, details: String(err), error: "VERIFY_EXCEPTION" };
    }
  }

  private runCommand(command: string, cwd: string): string {
    try {
      return execSync(command, {
        cwd,
        timeout: this.options.timeoutMs,
        encoding: "utf-8",
        stdio: "pipe",
      }).toString();
    } catch (e: unknown) {
      const err = e as { stdout?: Buffer; stderr?: Buffer; message?: string };
      return (err.stdout?.toString() || "") + (err.stderr?.toString() || "") + (err.message || "");
    }
  }

  private getExitCode(command: string, cwd: string): number {
    try {
      execSync(command, { cwd, timeout: this.options.timeoutMs, stdio: "pipe" });
      return 0;
    } catch (e: unknown) {
      return (e as { status?: number }).status ?? 1;
    }
  }

  private log(message: string): void {
    if (this.options.verbose) {
      process.stdout.write(message + "\n");
    }
  }
}