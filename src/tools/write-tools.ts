import * as fs from "fs";
import * as path from "path";
import { type Tool, type ExecutionContext, type ToolResult } from "../types/index.js";
import { shellExec, validateShellCommand } from "../pal/index.js";
import { createReadOnlyTools } from "./read-tools.js";
import { resolveSafePath } from "../security/path-guard.js";
import { sandbox } from "../security/sandbox.js";
import { applyEdit } from "./diff-edit.js";
import { extractStringParam, extractRequiredStringParam } from "../api/utils.js";

export class EditFileTool implements Tool {
  name = "edit_file";
  description = "Edit a file by replacing a search string with a new string";
  readonly = false;

  parameters = {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute path to the file to edit" },
      old_str: { type: "string", description: "The text to replace" },
      new_str: { type: "string", description: "The text to replace it with" },
    },
    required: ["file_path", "old_str", "new_str"],
  };

  async execute(
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const filePath = params.file_path as string;
    const oldStr = params.old_str as string;
    const newStr = params.new_str as string;

    if (!filePath || typeof filePath !== "string" || filePath.trim().length === 0) {
      return {
        success: false,
        output: "file_path is required and must be a non-empty string.",
        errorCode: "INVALID_ARGS",
      };
    }

    const workspace = context.session.meta.project_path || process.cwd();
    const { resolvedPath, safe, reason } = resolveSafePath(filePath, workspace);
    if (!safe) {
      return { success: false, output: `Path denied: ${reason}`, errorCode: "PATH_TRAVERSAL" };
    }

    try {
      if (!fs.existsSync(resolvedPath)) {
        return {
          success: false,
          output: `File not found: ${resolvedPath}`,
          errorCode: "NOT_FOUND",
        };
      }

      const content = fs.readFileSync(resolvedPath, "utf-8");
      const editResult = applyEdit(content, oldStr, newStr);

      if (!editResult.applied) {
        return {
          success: false,
          output: `${editResult.output}\nFile: ${resolvedPath}`,
          errorCode: "NO_MATCH",
        };
      }

      fs.writeFileSync(resolvedPath, editResult.applied
        ? content.replace(oldStr, newStr)
        : content, "utf-8");

      if (editResult.applied) {
        const newContent = fs.readFileSync(resolvedPath, "utf-8");
        const actualNew = newContent.indexOf(newStr) >= 0;
        if (!actualNew) {
          fs.writeFileSync(resolvedPath, content, "utf-8");
          return {
            success: false,
            output: `Edit verification failed. ${editResult.output} The replacement was not found in the result. File unchanged.`,
            errorCode: "VERIFY_FAILED",
          };
        }
      }

      return {
        success: true,
        output: `${editResult.output}\nFile: ${resolvedPath}. Replaced ${oldStr.length} -> ${newStr.length} chars.`,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: message,
        errorCode: "EDIT_ERROR",
      };
    }
  }
}

export class WriteFileTool implements Tool {
  name = "write_file";
  description = "Create a new file or overwrite an existing file";
  readonly = false;

  parameters = {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute path to the file to write" },
      content: { type: "string", description: "Content to write to the file" },
    },
    required: ["file_path", "content"],
  };

  async execute(
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const filePath = params.file_path as string;
    const content = params.content as string;

    if (!filePath || typeof filePath !== "string" || filePath.trim().length === 0) {
      return {
        success: false,
        output: "file_path is required and must be a non-empty string.",
        errorCode: "INVALID_ARGS",
      };
    }

    const workspace = context.session.meta.project_path || process.cwd();
    const { resolvedPath, safe, reason } = resolveSafePath(filePath, workspace);
    if (!safe) {
      return { success: false, output: `Path denied: ${reason}`, errorCode: "PATH_TRAVERSAL" };
    }

    try {
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(resolvedPath, content, "utf-8");

      return {
        success: true,
        output: `Successfully wrote ${content.length} characters to ${resolvedPath}.`,
        artifacts: [resolvedPath],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: message,
        errorCode: "WRITE_ERROR",
      };
    }
  }
}

export class ShellCommandTool implements Tool {
  name = "shell_command";
  description = "Execute a shell command";
  readonly = false;

  parameters = {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to execute" },
      cwd: { type: "string", description: "Working directory for the command" },
    },
    required: ["command"],
  };

  async execute(
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const command = extractRequiredStringParam(params, "command");
    const cwd = extractStringParam(params, "cwd");

    if (!command || typeof command !== "string" || command.trim().length === 0) {
      return {
        success: false,
        output: "Command is required and must be a non-empty string.",
        errorCode: "INVALID_COMMAND",
      };
    }

    const validation = validateShellCommand(command);
    if (!validation.valid) {
      return {
        success: false,
        output: `Command rejected: ${validation.reason}`,
        errorCode: "INVALID_COMMAND",
      };
    }

    if (context.permissionLevel.allowed === false) {
      return {
        success: false,
        output: `Permission denied: ${context.permissionLevel.reason}`,
        errorCode: "PERMISSION_DENIED",
      };
    }

    try {
      const tieredTimeout = sandbox.getTieredTimeout(command);
      const result = await shellExec(command, context.platform, { cwd, timeout: tieredTimeout });

      if (result.exitCode !== 0) {
        return {
          success: false,
          output: `Command failed (exit code ${result.exitCode}):\n${result.stderr || result.stdout}`,
          errorCode: `EXIT_${result.exitCode}`,
        };
      }

      return {
        success: true,
        output: result.stdout || "Command executed successfully (no output).",
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: message,
        errorCode: "EXEC_ERROR",
      };
    }
  }
}

export class GitCommitTool implements Tool {
  name = "git_commit";
  description = "Stage all changes and create a git commit";
  readonly = false;

  parameters = {
    type: "object",
    properties: {
      message: { type: "string", description: "Commit message" },
      path: { type: "string", description: "Repository path" },
    },
    required: ["message"],
  };

  async execute(
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const message = params.message as string;
    const repoPath = (params.path as string) || process.cwd();

    try {
      const addResult = await shellExec(
        `git -C "${repoPath}" add -A`,
        context.platform
      );

      if (addResult.exitCode !== 0) {
        return {
          success: false,
          output: `git add failed: ${addResult.stderr}`,
          errorCode: "GIT_ADD_ERROR",
        };
      }

      const commitResult = await shellExec(
        `git -C "${repoPath}" commit -m "${message.replace(/"/g, '\\"')}"`,
        context.platform
      );

      if (commitResult.exitCode !== 0) {
        const nothingToCommit =
          commitResult.stdout.includes("nothing to commit") ||
          commitResult.stderr.includes("nothing to commit");
        if (nothingToCommit) {
          return {
            success: true,
            output: "Nothing to commit. Working tree clean.",
          };
        }
        return {
          success: false,
          output: `git commit failed: ${commitResult.stderr}`,
          errorCode: "GIT_COMMIT_ERROR",
        };
      }

      const hash = extractCommitHash(commitResult.stdout);
      return {
        success: true,
        output: commitResult.stdout.trim(),
        artifacts: hash ? [hash] : undefined,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: message,
        errorCode: "GIT_ERROR",
      };
    }
  }
}

export class GitPushTool implements Tool {
  name = "git_push";
  description = "Push commits to remote and optionally create a PR";
  readonly = false;

  parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "Repository path" },
      create_pr: { type: "boolean", description: "Create a PR after push" },
    },
    required: [],
  };

  async execute(
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const repoPath = extractStringParam(params, "path", process.cwd());

    try {
      const pushResult = await shellExec(
        `git -C "${repoPath}" push`,
        context.platform
      );

      if (pushResult.exitCode !== 0) {
        return {
          success: false,
          output: `Push failed: ${pushResult.stderr}`,
          errorCode: "GIT_PUSH_ERROR",
        };
      }

      return {
        success: true,
        output: pushResult.stdout.trim(),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: message,
        errorCode: "GIT_ERROR",
      };
    }
  }
}

function extractCommitHash(output: string): string | null {
  const match = output.match(/\[[\w-]+ ([a-f0-9]+)\]/);
  return match ? match[1] : null;
}

export function createWriteTools(): Tool[] {
  return [
    new EditFileTool(),
    new WriteFileTool(),
    new ShellCommandTool(),
    new GitCommitTool(),
    new GitPushTool(),
  ];
}

export function getAllTools(): Tool[] {
  return [
    ...createReadOnlyTools(),
    new EditFileTool(),
    new WriteFileTool(),
    new ShellCommandTool(),
    new GitCommitTool(),
    new GitPushTool(),
  ];
}