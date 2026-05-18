import * as fs from "fs";
import * as path from "path";

export interface RepoMapEntry {
  path: string;
  type: "file" | "directory";
  size?: number;
  imports?: string[];
  exports?: string[];
  classes?: string[];
  functions?: string[];
  interfaces?: string[];
  lastModified?: string;
}

export interface RepoMapConfig {
  maxFiles: number;
  maxMapTokens: number;
  excludePatterns: string[];
  includeExtensions: string[];
  maxDepth: number;
}

const DEFAULT_CONFIG: RepoMapConfig = {
  maxFiles: 500,
  maxMapTokens: 4000,
  excludePatterns: [
    "node_modules", "dist", ".git", "__pycache__", ".venv",
    "build", "target", "coverage", ".next", ".cache", ".agent_1",
    "*.min.js", "*.bundle.js", "*.generated.*", "*.lock",
  ],
  includeExtensions: [
    ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs",
    ".java", ".kt", ".swift", ".c", ".cpp", ".h", ".hpp",
    ".rb", ".php", ".cs", ".scala", ".vue", ".svelte",
    ".json", ".yaml", ".yml", ".toml", ".md",
  ],
  maxDepth: 10,
};

function shouldExclude(filePath: string, config: RepoMapConfig): boolean {
  const baseName = path.basename(filePath);
  const relative = filePath;

  for (const pattern of config.excludePatterns) {
    if (pattern.includes("*")) {
      const regex = new RegExp(
        "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
      );
      if (regex.test(baseName)) return true;
    } else {
      if (relative.split(path.sep).includes(pattern)) return true;
    }
  }
  return false;
}

function shouldIncludeFile(filePath: string, config: RepoMapConfig): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return config.includeExtensions.includes(ext);
}

function parseFileExports(filePath: string): {
  imports: string[];
  exports: string[];
  classes: string[];
  functions: string[];
  interfaces: string[];
} {
  const result = {
    imports: [] as string[],
    exports: [] as string[],
    classes: [] as string[],
    functions: [] as string[],
    interfaces: [] as string[],
  };

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      const exportMatch = trimmed.match(
        /export\s+(default\s+)?(class|function|const|interface|type|enum|async\s+function)\s+(\w+)/
      );
      if (exportMatch) {
        result.exports.push(`${exportMatch[2]} ${exportMatch[3]}`);
      }

      const classMatch = trimmed.match(/(?:export\s+)?class\s+(\w+)/);
      if (classMatch && !trimmed.startsWith("//")) {
        result.classes.push(classMatch[1]);
      }

      const funcMatch = trimmed.match(
        /(?:export\s+)?(?:async\s+)?function\s+(\w+)/i
      );
      if (funcMatch && !trimmed.startsWith("//") && !trimmed.includes("interface")) {
        result.functions.push(funcMatch[1]);
      }

      const interfaceMatch = trimmed.match(
        /(?:export\s+)?interface\s+(\w+)/
      );
      if (interfaceMatch && !trimmed.startsWith("//")) {
        result.interfaces.push(interfaceMatch[1]);
      }

      const importMatch = trimmed.match(
        /import\s+(?:{[^}]*}|[\w*\s,]+)\s+from\s+['"]([^'"]+)['"]/
      );
      if (importMatch) {
        result.imports.push(importMatch[1]);
      }
    }
  } catch {
    // Binary or unreadable, skip
  }

  return result;
}

function scanDirectory(
  dir: string,
  config: RepoMapConfig,
  depth: number = 0
): RepoMapEntry[] {
  if (depth > config.maxDepth) return [];
  if (shouldExclude(dir, config)) return [];

  const entries: RepoMapEntry[] = [];
  let files: fs.Dirent[];

  try {
    files = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of files) {
    const fullPath = path.join(dir, entry.name);
    if (shouldExclude(fullPath, config)) continue;

    if (entry.isDirectory()) {
      const subEntries = scanDirectory(fullPath, config, depth + 1);
      if (subEntries.length > 0) {
        entries.push({
          path: fullPath,
          type: "directory",
        });
        entries.push(...subEntries);
      }
    } else if (entry.isFile() && shouldIncludeFile(fullPath, config)) {
      const stats = fs.statSync(fullPath);
      const parsed = parseFileExports(fullPath);

      entries.push({
        path: fullPath,
        type: "file",
        size: stats.size,
        imports: parsed.imports.length > 0 ? parsed.imports : undefined,
        exports: parsed.exports.length > 0 ? parsed.exports : undefined,
        classes: parsed.classes.length > 0 ? parsed.classes : undefined,
        functions: parsed.functions.length > 0 ? parsed.functions : undefined,
        interfaces: parsed.interfaces.length > 0 ? parsed.interfaces : undefined,
        lastModified: stats.mtime.toISOString(),
      });
    }
  }

  return entries;
}

export class RepoMap {
  private config: RepoMapConfig;

  constructor(config?: Partial<RepoMapConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  generateMap(projectPath: string): RepoMapEntry[] {
    return scanDirectory(projectPath, this.config);
  }

  generateMapText(projectPath: string): string {
    const entries = this.generateMap(projectPath);

    if (entries.length === 0) {
      return "(empty project)";
    }

    const lines: string[] = [
      `=== REPOSITORY MAP (${entries.filter(e => e.type === "file").length} files) ===`,
      `Generated: ${new Date().toISOString()}`,
      "",
    ];

    const _dirStack: string[] = [];
    const projectDir = path.resolve(projectPath);

    for (const entry of entries) {
      const relativePath = path.relative(projectDir, entry.path);

      if (entry.type === "directory") {
        const depth = relativePath.split(path.sep).length;
        const indent = "  ".repeat(Math.max(0, depth));
        const dirName = path.basename(entry.path);
        lines.push(`${indent}📁 ${dirName}/`);
        continue;
      }

      const depth = relativePath.split(path.sep).length - 1;
      const indent = "  ".repeat(Math.max(0, depth));
      const fileName = path.basename(entry.path);

      let fileLine = `${indent}📄 ${fileName}`;
      const details: string[] = [];

      if (entry.classes && entry.classes.length > 0) {
        details.push(`C:${entry.classes.join(",")}`);
      }
      if (entry.functions && entry.functions.length > 0) {
        const topFuncs = entry.functions.slice(0, 5);
        details.push(`F:${topFuncs.join(",")}${entry.functions.length > 5 ? "..." : ""}`);
      }
      if (entry.interfaces && entry.interfaces.length > 0) {
        details.push(`I:${entry.interfaces.join(",")}`);
      }
      if (entry.exports && entry.exports.length > 0) {
        const topExports = entry.exports.slice(0, 3);
        details.push(`E:${topExports.join(",")}${entry.exports.length > 3 ? "..." : ""}`);
      }

      if (details.length > 0) {
        fileLine += `  [${details.join(" | ")}]`;
      }

      lines.push(fileLine);
    }

    lines.push("");
    lines.push(
      `--- END REPOSITORY MAP ---\n` +
      `When navigating this codebase, reference file paths relative to project root.\n` +
      `Use grep/glob tools to find specific symbols, and read_file to view contents.`
    );

    return lines.join("\n");
  }

  generateMapJSON(projectPath: string): string {
    const entries = this.generateMap(projectPath);
    return JSON.stringify(
      {
        projectPath,
        generatedAt: new Date().toISOString(),
        totalFiles: entries.filter((e) => e.type === "file").length,
        entries,
      },
      null,
      2
    );
  }

  getConfig(): RepoMapConfig {
    return { ...this.config };
  }
}

export const repoMap = new RepoMap();