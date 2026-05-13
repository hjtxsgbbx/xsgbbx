import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { Tool, ExecutionContext, ToolResult } from "../types/index.js";
import { listFiles, searchInFile, readFileSafe } from "../pal/index.js";

export class GrepTool implements Tool {
  name = "grep";
  description = "Search for a pattern in files within a directory";
  readonly = true;

  parameters = {
    type: "object",
    properties: {
      pattern: { type: "string", description: "The regex pattern to search for" },
      path: { type: "string", description: "Directory or file path to search in" },
      include: { type: "string", description: "File pattern to include (e.g. *.ts)" },
    },
    required: ["pattern"],
  };

  async execute(
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const pattern = params.pattern as string;
    const searchPath = (params.path as string) || process.cwd();
    const include = params.include as string | undefined;

    try {
      if (!fs.existsSync(searchPath)) {
        return { success: false, output: `Path not found: ${searchPath}`, errorCode: "NOT_FOUND" };
      }

      if (fs.statSync(searchPath).isFile()) {
        const matches = searchInFile(searchPath, pattern);
        return {
          success: true,
          output: matches.length > 0 ? matches.join("\n") : `No matches found for "${pattern}"`,
        };
      }

      const files = listFiles(searchPath, include);
      if (files.length === 0) {
        return {
          success: true,
          output: `No files found matching pattern${include ? ` "${include}"` : ""}`,
        };
      }

      const results: string[] = [];
      for (const file of files) {
        const matches = searchInFile(file, pattern);
        if (matches.length > 0) {
          results.push(`\n--- ${file} ---`);
          results.push(...matches);
        }
      }

      return {
        success: true,
        output: results.length > 0 ? results.join("\n") : `No matches found for "${pattern}"`,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: message,
        errorCode: "GREP_ERROR",
      };
    }
  }
}

export class GlobTool implements Tool {
  name = "glob";
  description = "Find files matching a glob pattern";
  readonly = true;

  parameters = {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern (e.g. **/*.ts)" },
      path: { type: "string", description: "Base directory for the search" },
    },
    required: ["pattern"],
  };

  async execute(
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const pattern = params.pattern as string;
    const basePath = (params.path as string) || process.cwd();

    try {
      const files = listFiles(basePath, pattern);
      return {
        success: true,
        output:
          files.length > 0
            ? `Found ${files.length} files:\n` + files.map((f) => `  ${path.relative(basePath, f)}`).join("\n")
            : `No files found matching pattern "${pattern}"`,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: message,
        errorCode: "GLOB_ERROR",
      };
    }
  }
}

export class ReadFileTool implements Tool {
  name = "read_file";
  description = "Read the contents of a file";
  readonly = true;

  parameters = {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute path to the file" },
      offset: { type: "number", description: "Line number to start reading from" },
      limit: { type: "number", description: "Number of lines to read" },
    },
    required: ["file_path"],
  };

  async execute(
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const filePath = params.file_path as string;
    const offset = (params.offset as number) || 1;
    const limit = params.limit as number | undefined;

    try {
      const content = readFileSafe(filePath);
      if (content === null) {
        return { success: false, output: `File not found: ${filePath}`, errorCode: "NOT_FOUND" };
      }

      const lines = content.split("\n");
      const startIdx = offset - 1;
      const endIdx = limit ? startIdx + limit : lines.length;
      const selectedLines = lines.slice(startIdx, endIdx);

      return {
        success: true,
        output:
          selectedLines
            .map((line, i) => `${startIdx + i + 1}\t${line}`)
            .join("\n") + `\n(Total lines: ${lines.length})`,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: message,
        errorCode: "READ_ERROR",
      };
    }
  }
}

export class GitLogTool implements Tool {
  name = "git_log";
  description = "View git commit log";
  readonly = true;

  parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "Repository path" },
      count: { type: "number", description: "Number of commits to show (default: 10)" },
      format: { type: "string", description: "Output format (oneline, medium, full)" },
    },
    required: [],
  };

  async execute(
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const repoPath = (params.path as string) || process.cwd();
    const count = ((params.count as number) || 10).toString();
    const format = (params.format as string) || "oneline";

    try {
      const result = execSync(
        `git -C "${repoPath}" log --${format} -${count}`,
        { encoding: "utf-8", timeout: 10000 }
      );
      return { success: true, output: result.trim() };
    } catch (err: unknown) {
      const execErr = err as { stderr?: string; message?: string };
      const message = execErr.stderr || (err instanceof Error ? err.message : String(err));
      return {
        success: false,
        output: message,
        errorCode: "GIT_ERROR",
      };
    }
  }
}

export class GitStatusTool implements Tool {
  name = "git_status";
  description = "View current git status";
  readonly = true;

  parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "Repository path" },
    },
    required: [],
  };

  async execute(
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const repoPath = (params.path as string) || process.cwd();

    try {
      const result = execSync(
        `git -C "${repoPath}" status --porcelain`,
        { encoding: "utf-8", timeout: 10000 }
      );
      return {
        success: true,
        output: result.trim() || "Working tree clean",
      };
    } catch (err: unknown) {
      const execErr = err as { stderr?: string; message?: string };
      const message = execErr.stderr || (err instanceof Error ? err.message : String(err));
      return {
        success: false,
        output: message,
        errorCode: "GIT_ERROR",
      };
    }
  }
}

export class LSTool implements Tool {
  name = "ls";
  description = "List files and directories";
  readonly = true;

  parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path to list" },
    },
    required: [],
  };

  async execute(
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const dirPath = (params.path as string) || process.cwd();

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const items = entries.map((e) => {
        const isDir = e.isDirectory();
        const prefix = isDir ? "d" : "f";
        return `[${prefix}] ${e.name}`;
      });

      return {
        success: true,
        output:
          items.length > 0
            ? items.join("\n")
            : "Current directory is empty.",
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: message,
        errorCode: "LS_ERROR",
      };
    }
  }
}

export function createReadOnlyTools(): Tool[] {
  return [
    new GrepTool(),
    new GlobTool(),
    new ReadFileTool(),
    new GitLogTool(),
    new GitStatusTool(),
    new LSTool(),
  ];
}