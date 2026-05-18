import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { type Tool, type ExecutionContext, type ToolResult } from "../types/index.js";
import { listFiles, searchInFile, readFileSafe } from "../pal/index.js";
import { extractStringParam, extractRequiredStringParam, extractNumberParam } from "../api/utils.js";

const MAX_DIFF_OUTPUT = 8000;
const MAX_FETCH_OUTPUT = 12000;
const FETCH_TIMEOUT_MS = 15000;

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
    _context: ExecutionContext
  ): Promise<ToolResult> {
    const pattern = extractRequiredStringParam(params, "pattern");
    const searchPath = extractStringParam(params, "path", process.cwd());
    const include = extractStringParam(params, "include");

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
    _context: ExecutionContext
  ): Promise<ToolResult> {
    const pattern = extractRequiredStringParam(params, "pattern");
    const basePath = extractStringParam(params, "path", process.cwd());

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
    _context: ExecutionContext
  ): Promise<ToolResult> {
    const filePath = extractRequiredStringParam(params, "file_path");
    const offset = extractNumberParam(params, "offset", 1);
    const limit = extractNumberParam(params, "limit");

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
    _context: ExecutionContext
  ): Promise<ToolResult> {
    const repoPath = extractStringParam(params, "path", process.cwd());
    const count = (extractNumberParam(params, "count", 10)).toString();
    const format = extractStringParam(params, "format", "oneline");

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
    _context: ExecutionContext
  ): Promise<ToolResult> {
    const repoPath = extractStringParam(params, "path", process.cwd());

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
    _context: ExecutionContext
  ): Promise<ToolResult> {
    const dirPath = extractStringParam(params, "path", process.cwd());

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

export class GitDiffTool implements Tool {
  name = "git_diff";
  description = "View git diff for staged changes, unstaged changes, or compare commits/branches";
  readonly = true;

  parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "Repository path" },
      cached: { type: "boolean", description: "Show staged changes only (default: false)" },
      commit: { type: "string", description: "Compare with a specific commit or branch (e.g. HEAD~1, main)" },
      file_path: { type: "string", description: "Show diff for a specific file only" },
      stat: { type: "boolean", description: "Show only diff stat summary (default: false)" },
    },
    required: [],
  };

  async execute(
    params: Record<string, unknown>,
    _context: ExecutionContext
  ): Promise<ToolResult> {
    const repoPath = extractStringParam(params, "path", process.cwd());
    const cached = (params.cached as boolean) || false;
    const commit = extractStringParam(params, "commit");
    const filePath = extractStringParam(params, "file_path");
    const stat = (params.stat as boolean) || false;

    try {
      const args: string[] = [`git`, `-C`, `"${repoPath}"`, `diff`];

      if (cached) {
        args.push(`--cached`);
      }

      if (stat) {
        args.push(`--stat`);
      }

      if (commit) {
        if (cached) {
          args.push(commit);
        } else {
          args.push(commit);
          args.push(`--`);
        }
      }

      if (filePath) {
        args.push(`--`, `"${filePath}"`);
      }

      const command = args.join(" ");
      const result = execSync(command, {
        encoding: "utf-8",
        timeout: 15000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const output = result.trim();
      if (!output) {
        return { success: true, output: "No differences found." };
      }

      if (output.length > MAX_DIFF_OUTPUT) {
        return {
          success: true,
          output: output.slice(0, MAX_DIFF_OUTPUT) + `\n... (truncated, ${output.length} total chars)`,
        };
      }

      return { success: true, output };
    } catch (err: unknown) {
      const execErr = err as { stderr?: string; message?: string };
      const message = execErr.stderr || (err instanceof Error ? err.message : String(err));
      return {
        success: false,
        output: message,
        errorCode: "GIT_DIFF_ERROR",
      };
    }
  }
}

export class WebFetchTool implements Tool {
  name = "web_fetch";
  description = "Fetch content from a URL and return as text";
  readonly = true;

  parameters = {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch" },
      method: { type: "string", description: "HTTP method (GET, POST). Default: GET", enum: ["GET", "POST"] },
      format: { type: "string", description: "Output format: text, json, links. Default: text", enum: ["text", "json", "links"] },
    },
    required: ["url"],
  };

  async execute(
    params: Record<string, unknown>,
    _context: ExecutionContext
  ): Promise<ToolResult> {
    const url = extractRequiredStringParam(params, "url");
    const method = (extractStringParam(params, "method", "GET")).toUpperCase();
    const format = extractStringParam(params, "format", "text");

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          "User-Agent": "Agent1/1.0",
          "Accept": format === "json" ? "application/json" : "text/html,application/xhtml+xml,text/plain",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          output: `HTTP ${response.status} ${response.statusText}`,
          errorCode: "HTTP_ERROR",
        };
      }

      const contentType = response.headers.get("content-type") || "";
      const body = await response.text();

      if (format === "json") {
        try {
          const parsed = JSON.parse(body);
          const formatted = JSON.stringify(parsed, null, 2);
          return {
            success: true,
            output: formatted.length > MAX_FETCH_OUTPUT
              ? formatted.slice(0, MAX_FETCH_OUTPUT) + `\n... (truncated)`
              : formatted,
          };
        } catch {
          return {
            success: true,
            output: body.length > MAX_FETCH_OUTPUT
              ? body.slice(0, MAX_FETCH_OUTPUT) + `\n... (truncated)`
              : body,
          };
        }
      }

      if (format === "links" && (contentType.includes("html") || contentType.includes("text/html"))) {
        const linkRegex = /href=["']([^"']+)["']/gi;
        const links: string[] = [];
        let match;
        while ((match = linkRegex.exec(body)) !== null) {
          links.push(match[1]);
        }
        return {
          success: true,
          output: links.length > 0
            ? `Found ${links.length} links:\n` + links.slice(0, 100).join("\n")
            : "No links found in the page.",
        };
      }

      let output = body;
      if (contentType.includes("html") || contentType.includes("text/html")) {
        output = this.stripHtml(body);
      }

      if (output.length > MAX_FETCH_OUTPUT) {
        output = output.slice(0, MAX_FETCH_OUTPUT) + `\n... (truncated, ${body.length} total chars)`;
      }

      return { success: true, output };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: message,
        errorCode: "FETCH_ERROR",
      };
    }
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<head[\s\S]*?<\/head>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }
}

export class SymbolSearchTool implements Tool {
  name = "symbol_search";
  description = "Search for code symbols (functions, classes, interfaces, types) across the project";
  readonly = true;

  parameters = {
    type: "object",
    properties: {
      query: { type: "string", description: "Symbol name or pattern to search for" },
      path: { type: "string", description: "Directory to search in" },
      kind: {
        type: "string",
        description: "Symbol kind filter: function, class, interface, type, variable, all",
        enum: ["function", "class", "interface", "type", "variable", "all"],
      },
    },
    required: ["query"],
  };

  private static readonly KIND_PATTERNS: Record<string, RegExp[]> = {
    function: [
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
      /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w]+)\s*=>/g,
      /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/g,
    ],
    class: [
      /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g,
      /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)\s+extends/g,
    ],
    interface: [
      /(?:export\s+)?interface\s+(\w+)/g,
    ],
    type: [
      /(?:export\s+)?type\s+(\w+)\s*=/g,
    ],
    variable: [
      /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[=:]/g,
    ],
  };

  async execute(
    params: Record<string, unknown>,
    _context: ExecutionContext
  ): Promise<ToolResult> {
    const query = extractRequiredStringParam(params, "query");
    const searchPath = extractStringParam(params, "path", process.cwd());
    const kind = extractStringParam(params, "kind", "all");

    try {
      if (!fs.existsSync(searchPath)) {
        return { success: false, output: `Path not found: ${searchPath}`, errorCode: "NOT_FOUND" };
      }

      const patterns = kind === "all"
        ? Object.values(SymbolSearchTool.KIND_PATTERNS).flat()
        : SymbolSearchTool.KIND_PATTERNS[kind] || [];

      if (patterns.length === 0) {
        return {
          success: false,
          output: `Unknown symbol kind: ${kind}. Valid: function, class, interface, type, variable, all`,
          errorCode: "INVALID_KIND",
        };
      }

      const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java"];
      const files = listFiles(searchPath).filter((f) =>
        sourceExtensions.some((ext) => f.endsWith(ext))
      );

      if (files.length === 0) {
        return { success: true, output: "No source files found in the directory." };
      }

      const results: { file: string; line: number; kind: string; name: string; raw: string }[] = [];

      for (const file of files) {
        const content = readFileSafe(file);
        if (content === null) continue;

        const lines = content.split("\n");
        for (const pattern of patterns) {
          pattern.lastIndex = 0;
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(line)) !== null) {
              const symbolName = match[1];
              if (symbolName && symbolName.toLowerCase().includes(query.toLowerCase())) {
                const matchedKind = this.inferKindFromPattern(pattern);
                results.push({
                  file: path.relative(searchPath, file),
                  line: i + 1,
                  kind: matchedKind,
                  name: symbolName,
                  raw: line.trim(),
                });
              }
            }
          }
        }
      }

      if (results.length === 0) {
        return {
          success: true,
          output: `No symbols matching "${query}" found${kind !== "all" ? ` (kind: ${kind})` : ""}.`,
        };
      }

      const output = results
        .slice(0, 50)
        .map((r) => `[${r.kind}] ${r.name} â€?${r.file}:${r.line}\n    ${r.raw}`)
        .join("\n\n");

      const suffix = results.length > 50 ? `\n\n... and ${results.length - 50} more results` : "";

      return {
        success: true,
        output: `Found ${results.length} symbol(s) matching "${query}":\n\n${output}${suffix}`,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: message,
        errorCode: "SYMBOL_SEARCH_ERROR",
      };
    }
  }

  private inferKindFromPattern(pattern: RegExp): string {
    const source = pattern.source;
    if (source.includes("function")) return "function";
    if (source.includes("class")) return "class";
    if (source.includes("interface")) return "interface";
    if (source.includes("type")) return "type";
    if (source.includes("const|let|var")) return "variable";
    return "unknown";
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
    new GitDiffTool(),
    new WebFetchTool(),
    new SymbolSearchTool(),
  ];
}