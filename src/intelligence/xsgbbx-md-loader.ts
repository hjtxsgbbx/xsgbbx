/**
 * xsgbbx.md Loader — the Harness entrypoint.
 *
 * Based on Claude Code's claudemd.ts (1479 lines), simplified for DeepSeek.
 *
 * Loading priority (lowest → highest, later overrides earlier):
 *   1. Managed:  system-wide instructions (e.g., /etc/xsgbbx/xsgbbx.md)
 *   2. User:     ~/.xsgbbx/xsgbbx.md
 *   3. Project:  xsgbbx.md in project root, .xsgbbx/xsgbbx.md,
 *                .xsgbbx/rules/*.md
 *   4. Local:    xsgbbx.local.md (gitignored, private per-user)
 *
 * Features:
 *   - @path directive for file inclusion
 *   - Frontmatter `paths:` for glob-scoped rules
 *   - MEMORY.md index loading
 *   - .xsgbbxignore support
 *   - HTML comment stripping
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname, relative, isAbsolute, resolve, basename, sep } from "path";
import { homedir } from "os";
import { APP_NAME, FILE_NAMES } from "../core/constants.js";
import { ensureMemoryDir, loadMemoryIndex as loadMemoryMdIndex } from "./memory/memory-manager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryFile {
  path: string;
  type: MemoryType;
  content: string;
  /** The file that included this one (for @path resolution) */
  includer?: string;
  /** Glob patterns this rule applies to */
  globs?: string[];
}

export interface XsgbbxMdLoadResult {
  /** All loaded memory files, in priority order */
  files: MemoryFile[];
  /** MEMORY.md content (persistent memory index) */
  memoryIndex: string | null;
  /** Total character count (for token estimation) */
  totalChars: number;
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function getUserDir(): string {
  return join(homedir(), `.${APP_NAME}`);
}

function getManagedDir(): string {
  // Windows: C:\ProgramData\xsgbbx, Unix: /etc/xsgbbx
  return process.platform === "win32"
    ? join(process.env.ProgramData || "C:\\ProgramData", APP_NAME)
    : join("/etc", APP_NAME);
}

function findProjectRoots(cwd: string): string[] {
  const roots: string[] = [];
  let current = cwd;
  const homeRoot = homedir();
  // Walk up from cwd to filesystem root, collecting all dirs
  while (current && current !== dirname(current) && current !== homeRoot) {
    roots.push(current);
    current = dirname(current);
  }
  // Don't traverse into home
  if (current === homeRoot) {
    roots.push(homeRoot);
  }
  return roots;
}

// ---------------------------------------------------------------------------
// File utilities
// ---------------------------------------------------------------------------

function safeReadFile(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/** Strip HTML comments <!-- ... --> from content */
function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, "");
}

/** Parse frontmatter. Returns { data, body } or null */
function parseFrontmatter(content: string): { data: Record<string, string>; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const data: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) data[kv[1]!] = kv[2]!.trim();
  }
  return { data, body: match[2]!.trim() };
}

// ---------------------------------------------------------------------------
// @path resolution
// ---------------------------------------------------------------------------

const TEXT_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".xml", ".csv",
  ".html", ".htm", ".css", ".scss", ".sass", ".less",
  ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".sh", ".bash", ".zsh",
  ".sql", ".graphql", ".proto", ".vue", ".svelte", ".env", ".ini", ".cfg", ".conf",
]);

function resolveAtPath(atRef: string, baseDir: string): string | null {
  // @/absolute/path → absolute
  if (atRef.startsWith("/")) return atRef;
  // @~/path → home relative
  if (atRef.startsWith("~")) return join(homedir(), atRef.slice(1));
  // @./path or @path → relative to baseDir
  const relPath = atRef.startsWith("./") ? atRef.slice(2) : atRef;
  const resolved = resolve(baseDir, relPath);
  // Only allow text files
  const ext = resolved.split(".").pop();
  if (ext && !TEXT_EXTENSIONS.has(`.${ext}`)) return null;
  return resolved;
}

/**
 * Resolve @path directives in content, loading included files.
 * Returns the expanded content with includes inlined, plus the list of loaded memory files.
 */
function resolveIncludes(
  content: string,
  basePath: string,
  includerFile: string,
  visited: Set<string>
): { expanded: string; includes: MemoryFile[] } {
  const includes: MemoryFile[] = [];
  let expanded = content;

  // Match @path references (non-greedy, word boundary)
  const atRegex = /@([~]?[\/]?[\w./-]+)/g;
  let match;
  while ((match = atRegex.exec(content)) !== null) {
    const atRef = match[1]!;
    const resolved = resolveAtPath(atRef, dirname(basePath));
    if (!resolved) continue;
    if (visited.has(resolved)) continue; // circular reference
    if (resolved === basePath) continue; // self-reference
    visited.add(resolved);

    const included = safeReadFile(resolved);
    if (included) {
      const cleaned = stripHtmlComments(included);
      const parsed = parseFrontmatter(cleaned);
      const body = parsed ? parsed.body : cleaned;
      expanded = expanded.replace(match[0], `\n<!-- @${atRef} -->\n${body}\n<!-- /@${atRef} -->\n`);
      includes.push({
        path: resolved,
        type: "reference",
        content: body,
        includer: includerFile,
        globs: parsed?.data?.paths ? parsed.data.paths.split(",").map(s => s.trim()) : undefined,
      });
    }
  }

  return { expanded, includes };
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

interface DiscoveredFile {
  path: string;
  type: MemoryType;
  priority: number; // higher = loaded later (closer to user)
  globs?: string[];
}

function discoverXsgbbxMdFiles(cwd: string): DiscoveredFile[] {
  const results: DiscoveredFile[] = [];

  // 1. Managed (priority 1)
  const managedDir = getManagedDir();
  const managedFile = join(managedDir, FILE_NAMES.ENTRYPOINT);
  if (existsSync(managedFile)) {
    results.push({ path: managedFile, type: "project", priority: 1 });
  }

  // 2. User (priority 2)
  const userDir = getUserDir();
  const userFile = join(userDir, FILE_NAMES.ENTRYPOINT);
  if (existsSync(userFile)) {
    results.push({ path: userFile, type: "user", priority: 2 });
  }

  // 3. User rules (priority 2.5)
  const userRulesDir = join(userDir, FILE_NAMES.RULES_DIR);
  if (existsSync(userRulesDir)) {
    try {
      const ruleFiles = (readdirSync(userRulesDir, { recursive: true }) as string[])
        .filter((f: string) => f.endsWith(".md"))
        .map((f: string) => join(userRulesDir, f));
      for (const rf of ruleFiles) {
        results.push({ path: rf, type: "user", priority: 2 });
      }
    } catch { /* ignore */ }
  }

  // 4. Project files — walk up from cwd (priority 3+ based on depth)
  const roots = findProjectRoots(cwd);
  let projPrio = 3;
  for (const root of roots) {
    // xsgbbx.md at project root
    const projFile = join(root, FILE_NAMES.ENTRYPOINT);
    if (existsSync(projFile)) {
      results.push({ path: projFile, type: "project", priority: projPrio });
    }
    // .xsgbbx/xsgbbx.md
    const dotXsgbbxFile = join(root, `.${APP_NAME}`, FILE_NAMES.ENTRYPOINT);
    if (existsSync(dotXsgbbxFile)) {
      results.push({ path: dotXsgbbxFile, type: "project", priority: projPrio });
    }
    // .xsgbbx/rules/*.md
    const rulesDir = join(root, `.${APP_NAME}`, FILE_NAMES.RULES_DIR);
    if (existsSync(rulesDir)) {
      try {
        const ruleFiles = (readdirSync(rulesDir, { recursive: true }) as string[])
          .filter((f: string) => f.endsWith(".md"))
          .map((f: string) => join(rulesDir, f));
        for (const rf of ruleFiles) {
          results.push({ path: rf, type: "project", priority: projPrio + 0.1 });
        }
      } catch { /* ignore */ }
    }
    // xsgbbx.local.md (private, gitignored)
    const localFile = join(root, `${APP_NAME}.local.md`);
    if (existsSync(localFile)) {
      results.push({ path: localFile, type: "project", priority: projPrio + 0.5 });
    }
    projPrio++;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

/** Load MEMORY.md content from the user's memory directory */
function loadMemoryIndex(): string | null {
  ensureMemoryDir(); // ensure dir + MEMORY.md exist
  return loadMemoryMdIndex();
}

/**
 * Load all xsgbbx.md files, resolve includes, and return assembled memory.
 * This is the single entrypoint called by the query engine before building
 * the system prompt.
 */
export function loadXsgbbxMd(cwd: string): XsgbbxMdLoadResult {
  const discovered = discoverXsgbbxMdFiles(cwd);

  // Sort by priority (lower → higher), then load
  discovered.sort((a, b) => a.priority - b.priority);

  const visited = new Set<string>();
  const files: MemoryFile[] = [];
  let totalChars = 0;

  for (const disc of discovered) {
    const rawContent = safeReadFile(disc.path);
    if (!rawContent) continue;
    if (visited.has(disc.path)) continue;
    visited.add(disc.path);

    const noHtml = stripHtmlComments(rawContent);
    const parsed = parseFrontmatter(noHtml);
    const content = parsed ? parsed.body : noHtml;

    // Resolve @path includes
    const { expanded, includes } = resolveIncludes(content, disc.path, disc.path, visited);
    files.push({
      path: disc.path,
      type: disc.type,
      content: expanded,
      globs: parsed?.data?.paths
        ? parsed.data.paths.split(",").map(s => s.trim())
        : disc.globs,
    });

    // Add included files
    for (const inc of includes) {
      if (!visited.has(inc.path)) {
        visited.add(inc.path);
        files.push(inc);
      }
    }

    totalChars += expanded.length;
  }

  // Load MEMORY.md
  const memoryIndex = loadMemoryIndex();

  return { files, memoryIndex, totalChars };
}

/**
 * Build the context text from loaded xsgbbx.md files.
 * Formats them as system prompt sections.
 */
export function formatXsgbbxMdContext(result: XsgbbxMdLoadResult): string {
  const sections: string[] = [];

  if (result.memoryIndex) {
    sections.push(`# Persistent Memory (MEMORY.md)
The following is your persistent memory index. Each entry links to a detailed file in the memory directory:

${result.memoryIndex}`);
  }

  if (result.files.length > 0) {
    const fileList = result.files
      .map(f => `- **\`${f.path}\`**${f.globs ? ` (paths: ${f.globs.join(", ")})` : ""}`)
      .join("\n");

    // Truncate loaded content to avoid drowning the model in rules.
    const MAX_TOTAL_CHARS = 2000;
    let totalUsed = 0;
    const truncatedFiles: string[] = [];
    for (const f of result.files) {
      if (totalUsed >= MAX_TOTAL_CHARS) break;
      const maxForFile = Math.min(f.content.length, MAX_TOTAL_CHARS - totalUsed);
      const content = maxForFile < f.content.length
        ? f.content.slice(0, maxForFile) + `\n[... ${f.content.length - maxForFile} more chars truncated]`
        : f.content;
      truncatedFiles.push(`## ${f.path}\n\n${content}`);
      totalUsed += content.length;
    }

    sections.push(`# Project Instructions
The following files were loaded from your project. Their instructions apply. Only the most relevant portions are shown:

${fileList}

${truncatedFiles.join("\n\n---\n\n")}

${totalUsed >= MAX_TOTAL_CHARS ? `\n[Additional files omitted — ${result.files.length - truncatedFiles.length} files, ${Math.max(0, result.totalChars - MAX_TOTAL_CHARS)} characters truncated]` : ""}`);
  }

  return sections.join("\n\n");
}

export { getManagedDir, getUserDir };
