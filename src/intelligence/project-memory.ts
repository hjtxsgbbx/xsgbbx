import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface ContextFile {
  level: "global" | "project" | "subdirectory" | "memory";
  path: string;
  content: string;
  category?: string;
}

export interface MemoryEntry {
  id: string;
  category: "architecture" | "convention" | "dependency" | "issue" | "config" | "insight" | "preference" | "pattern" | "api_contract" | "test_strategy";
  title: string;
  content: string;
  tags: string[];
  priority: "critical" | "high" | "normal" | "low";
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  source: "auto" | "manual" | "imported";
  verified: boolean;
}

export interface MemoryIndex {
  version: number;
  projectPath: string;
  lastUpdated: string;
  entries: MemoryEntry[];
  autoLoadRules: AutoLoadRule[];
}

export interface AutoLoadRule {
  pattern: string;
  category: MemoryEntry["category"];
  priority: MemoryEntry["priority"];
  description: string;
  enabled: boolean;
}

const MEMORY_DIR = ".agent_1/memory";
const MEMORY_INDEX_FILE = "memory-index.json";
const MEMORY_AUTO_DIR = "auto";
const MEMORY_MANUAL_DIR = "manual";

const memoryCache = new Map<string, { content: string; mtime: number }>();
const _MEMORY_CACHE_TTL = 30_000;

const DEFAULT_AUTO_LOAD_RULES: AutoLoadRule[] = [
  { pattern: "package.json", category: "dependency", priority: "high", description: "Project dependencies and scripts", enabled: true },
  { pattern: "tsconfig.json", category: "config", priority: "high", description: "TypeScript configuration", enabled: true },
  { pattern: ".eslintrc*", category: "convention", priority: "normal", description: "Linting rules and code style", enabled: true },
  { pattern: "README.md", category: "architecture", priority: "high", description: "Project overview and architecture", enabled: true },
  { pattern: ".env.example", category: "config", priority: "normal", description: "Environment variable template", enabled: true },
  { pattern: "jest.config*", category: "test_strategy", priority: "normal", description: "Test configuration", enabled: true },
  { pattern: ".prettierrc*", category: "convention", priority: "low", description: "Code formatting rules", enabled: true },
];

function getFileMtime(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function loadFileIfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    return lines.slice(0, 200).join("\n");
  } catch {
    return null;
  }
}

function getGlobalContextPath(): string {
  const agentDir = path.join(os.homedir(), ".agent_1");
  return path.join(agentDir, "AGENT.md");
}

function getProjectContextPath(projectPath: string): string {
  return path.join(projectPath, ".agent_1.md");
}

function getMemoryDir(projectPath: string): string {
  return path.join(projectPath, MEMORY_DIR);
}

function getMemoryIndexPath(projectPath: string): string {
  return path.join(getMemoryDir(projectPath), MEMORY_INDEX_FILE);
}

function getAllSubdirectoryContexts(projectPath: string): string[] {
  const results: string[] = [];
  try {
    const dirs = findNestedAgentFiles(projectPath, 3);
    for (const dir of dirs) {
      const content = loadFileIfExists(path.join(dir, ".agent_1.md"));
      if (content) {
        const relative = path.relative(projectPath, dir) || ".";
        results.push(`=== SUBDIRECTORY CONTEXT (${relative}/.agent_1.md) ===\n${content}\n=== END ===`);
      }
    }
  } catch {
    // best effort
  }
  return results;
}

function findNestedAgentFiles(dir: string, maxDepth: number, currentDepth = 0): string[] {
  if (currentDepth >= maxDepth) return [];
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") && entry.name !== ".agent_1") continue;
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;

      const fullPath = path.join(dir, entry.name);
      const agentFile = path.join(fullPath, ".agent_1.md");
      if (fs.existsSync(agentFile)) {
        results.push(fullPath);
      }
      results.push(...findNestedAgentFiles(fullPath, maxDepth, currentDepth + 1));
    }
  } catch {
    // best effort
  }
  return results;
}

export function ensureMemoryDirectory(projectPath: string): string {
  const memDir = getMemoryDir(projectPath);
  const autoDir = path.join(memDir, MEMORY_AUTO_DIR);
  const manualDir = path.join(memDir, MEMORY_MANUAL_DIR);

  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
  if (!fs.existsSync(autoDir)) fs.mkdirSync(autoDir, { recursive: true });
  if (!fs.existsSync(manualDir)) fs.mkdirSync(manualDir, { recursive: true });

  return memDir;
}

export function loadMemoryIndex(projectPath: string): MemoryIndex {
  const indexPath = getMemoryIndexPath(projectPath);
  if (fs.existsSync(indexPath)) {
    try {
      return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    } catch {
      // corrupted, recreate
    }
  }

  const index: MemoryIndex = {
    version: 1,
    projectPath,
    lastUpdated: new Date().toISOString(),
    entries: [],
    autoLoadRules: [...DEFAULT_AUTO_LOAD_RULES],
  };

  saveMemoryIndex(projectPath, index);
  return index;
}

export function saveMemoryIndex(projectPath: string, index: MemoryIndex): void {
  ensureMemoryDirectory(projectPath);
  const indexPath = getMemoryIndexPath(projectPath);
  index.lastUpdated = new Date().toISOString();
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

export function addMemoryEntry(projectPath: string, entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">): MemoryEntry {
  const index = loadMemoryIndex(projectPath);
  const newEntry: MemoryEntry = {
    ...entry,
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  index.entries.push(newEntry);
  saveMemoryIndex(projectPath, index);

  const entryPath = path.join(
    getMemoryDir(projectPath),
    entry.source === "auto" ? MEMORY_AUTO_DIR : MEMORY_MANUAL_DIR,
    `${newEntry.id}.json`
  );
  fs.writeFileSync(entryPath, JSON.stringify(newEntry, null, 2), "utf-8");

  return newEntry;
}

export function updateMemoryEntry(projectPath: string, entryId: string, updates: Partial<MemoryEntry>): MemoryEntry | null {
  const index = loadMemoryIndex(projectPath);
  const entry = index.entries.find((e) => e.id === entryId);
  if (!entry) return null;

  Object.assign(entry, updates, { updatedAt: new Date().toISOString() });
  saveMemoryIndex(projectPath, index);
  return entry;
}

export function deleteMemoryEntry(projectPath: string, entryId: string): boolean {
  const index = loadMemoryIndex(projectPath);
  const idx = index.entries.findIndex((e) => e.id === entryId);
  if (idx < 0) return false;

  index.entries.splice(idx, 1);
  saveMemoryIndex(projectPath, index);

  for (const subDir of [MEMORY_AUTO_DIR, MEMORY_MANUAL_DIR]) {
    const entryPath = path.join(getMemoryDir(projectPath), subDir, `${entryId}.json`);
    try { fs.unlinkSync(entryPath); } catch { /* ok */ }
  }
  return true;
}

export function queryMemoryEntries(projectPath: string, filter: {
  category?: MemoryEntry["category"];
  tags?: string[];
  priority?: MemoryEntry["priority"];
  source?: MemoryEntry["source"];
  verified?: boolean;
  search?: string;
  limit?: number;
}): MemoryEntry[] {
  const index = loadMemoryIndex(projectPath);
  let results = index.entries;

  if (filter.category) results = results.filter((e) => e.category === filter.category);
  if (filter.priority) results = results.filter((e) => e.priority === filter.priority);
  if (filter.source) results = results.filter((e) => e.source === filter.source);
  if (filter.verified !== undefined) results = results.filter((e) => e.verified === filter.verified);
  if (filter.tags && filter.tags.length > 0) {
    const tags = filter.tags;
    results = results.filter((e) => tags.some((t) => e.tags.includes(t)));
  }
  if (filter.search) {
    const q = filter.search.toLowerCase();
    results = results.filter((e) =>
      e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q)
    );
  }

  results.sort((a, b) => {
    const pOrder: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
    return (pOrder[a.priority] || 99) - (pOrder[b.priority] || 99);
  });

  return filter.limit ? results.slice(0, filter.limit) : results;
}

export function scanMemoryDirectory(projectPath: string): MemoryEntry[] {
  const memDir = getMemoryDir(projectPath);
  if (!fs.existsSync(memDir)) return [];

  const entries: MemoryEntry[] = [];
  for (const subDir of [MEMORY_AUTO_DIR, MEMORY_MANUAL_DIR]) {
    const dir = path.join(memDir, subDir);
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
        if (entry.id && entry.category && entry.content) {
          entries.push(entry);
        }
      } catch { /* skip corrupted */ }
    }
  }

  return entries;
}

export function autoScanProjectFiles(projectPath: string): MemoryEntry[] {
  const index = loadMemoryIndex(projectPath);
  const newEntries: MemoryEntry[] = [];

  for (const rule of index.autoLoadRules) {
    if (!rule.enabled) continue;

    const files = findFilesByPattern(projectPath, rule.pattern);
    for (const filePath of files) {
      const existing = index.entries.find(
        (e) => e.category === rule.category && e.content.includes(filePath)
      );
      if (existing) continue;

      const content = loadFileIfExists(filePath);
      if (!content) continue;

      const entry = addMemoryEntry(projectPath, {
        category: rule.category,
        title: `${rule.description}: ${path.relative(projectPath, filePath)}`,
        content: content.slice(0, 500),
        tags: [rule.category, "auto-scanned"],
        priority: rule.priority,
        source: "auto",
        verified: false,
      });
      newEntries.push(entry);
    }
  }

  return newEntries;
}

function findFilesByPattern(dir: string, pattern: string): string[] {
  const results: string[] = [];
  const baseName = pattern.replace(/\*/g, "");

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        results.push(...findFilesByPattern(fullPath, pattern));
      } else if (entry.name === baseName || matchGlob(entry.name, pattern)) {
        results.push(fullPath);
      }
    }
  } catch { /* best effort */ }

  return results;
}

function matchGlob(name: string, pattern: string): boolean {
  if (!pattern.includes("*")) return name === pattern;
  const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
  return regex.test(name);
}

export function loadProjectMemory(projectPath: string): string {
  const globalPath = getGlobalContextPath();
  const projectCtxPath = getProjectContextPath(projectPath);
  const cacheKey = projectPath;

  const globalMtime = getFileMtime(globalPath);
  const projectMtime = getFileMtime(projectCtxPath);
  const maxMtime = Math.max(globalMtime, projectMtime);

  const cached = memoryCache.get(cacheKey);
  if (cached && maxMtime > 0 && Math.abs(cached.mtime - maxMtime) < 1) {
    return cached.content;
  }

  const result = loadProjectMemoryUncached(projectPath);

  if (maxMtime > 0) {
    memoryCache.set(cacheKey, { content: result, mtime: maxMtime });
    if (memoryCache.size > 100) {
      const firstKey = memoryCache.keys().next().value;
      if (firstKey !== undefined) memoryCache.delete(firstKey);
    }
  }

  return result;
}

export function invalidateProjectMemoryCache(projectPath?: string): void {
  if (projectPath) {
    memoryCache.delete(projectPath);
  } else {
    memoryCache.clear();
  }
}

function loadProjectMemoryUncached(projectPath: string): string {
  const contexts: ContextFile[] = [];

  const globalContent = loadFileIfExists(getGlobalContextPath());
  if (globalContent) {
    contexts.push({ level: "global", path: getGlobalContextPath(), content: globalContent });
  }

  const projectContent = loadFileIfExists(getProjectContextPath(projectPath));
  if (projectContent) {
    contexts.push({ level: "project", path: getProjectContextPath(projectPath), content: projectContent });
  }

  const memoryEntries = loadStructuredMemory(projectPath);
  if (memoryEntries) {
    contexts.push({ level: "memory", path: getMemoryIndexPath(projectPath), content: memoryEntries, category: "structured" });
  }

  if (contexts.length === 0) return "";

  const parts: string[] = [];
  for (const ctx of contexts) {
    const levelLabel = ctx.level === "global" ? "GLOBAL" : ctx.level === "memory" ? "MEMORY" : "PROJECT";
    parts.push(`=== ${levelLabel} CONTEXT (${path.basename(ctx.path)}) ===\n${ctx.content}\n=== END ===`);
  }

  return parts.join("\n\n");
}

function loadStructuredMemory(projectPath: string): string | null {
  const index = loadMemoryIndex(projectPath);
  if (index.entries.length === 0) return null;

  const lines: string[] = [];
  lines.push(`# Structured Memory (${index.entries.length} entries)`);

  const byCategory = new Map<string, MemoryEntry[]>();
  for (const entry of index.entries) {
    const list = byCategory.get(entry.category) || [];
    list.push(entry);
    byCategory.set(entry.category, list);
  }

  for (const [category, entries] of byCategory) {
    lines.push("");
    lines.push(`## ${category}`);
    for (const entry of entries) {
      const verified = entry.verified ? "✓" : "?";
      lines.push(`- [${verified}] **${entry.title}**: ${entry.content.slice(0, 100)}`);
    }
  }

  return lines.join("\n");
}

export function loadHierarchicalContext(projectPath: string, workingDir?: string): string {
  const parts: string[] = [];

  const globalContent = loadFileIfExists(getGlobalContextPath());
  if (globalContent) {
    parts.push(`=== GLOBAL CONTEXT (~/.agent_1/AGENT.md) ===\n${globalContent}\n=== END ===`);
  }

  const projectContent = loadFileIfExists(getProjectContextPath(projectPath));
  if (projectContent) {
    parts.push(`=== PROJECT CONTEXT (.agent_1.md) ===\n${projectContent}\n=== END ===`);
  }

  if (workingDir && workingDir !== projectPath) {
    const wdContent = loadFileIfExists(path.join(workingDir, ".agent_1.md"));
    if (wdContent && path.resolve(workingDir) !== path.resolve(projectPath)) {
      const relative = path.relative(projectPath, workingDir) || ".";
      parts.push(`=== WORKING DIR CONTEXT (${relative}/.agent_1.md) ===\n${wdContent}\n=== END ===`);
    }
  }

  const structured = loadStructuredMemory(projectPath);
  if (structured) {
    parts.push(`=== STRUCTURED MEMORY (.agent_1/memory/) ===\n${structured}\n=== END ===`);
  }

  return parts.join("\n\n");
}

export function loadAllContext(projectPath: string, workingDir?: string): string {
  const parts: string[] = [];

  const hierarchical = loadHierarchicalContext(projectPath, workingDir);
  if (hierarchical) parts.push(hierarchical);

  const subContexts = getAllSubdirectoryContexts(projectPath);
  for (const ctx of subContexts) {
    parts.push(ctx);
  }

  return parts.join("\n\n");
}

export function ensureProjectMemory(projectPath: string): boolean {
  const memFile = getProjectContextPath(projectPath);
  if (fs.existsSync(memFile)) return true;

  try {
    ensureMemoryDirectory(projectPath);
    fs.writeFileSync(
      memFile,
      `# agent_1 Project Memory\n\n## Project Overview\n\n## Architecture\n\n## Conventions\n\n## Dependencies\n\n## Environment\n\n## Notes\n`,
      "utf-8"
    );
    return true;
  } catch {
    return false;
  }
}

export function ensureGlobalContext(): boolean {
  const globalPath = getGlobalContextPath();
  if (fs.existsSync(globalPath)) return true;

  try {
    const dir = path.dirname(globalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      globalPath,
      `# agent_1 Global Preferences\n\n## Personal Coding Standards\n\n## Preferred Tools\n\n## Environment Preferences\n\n## Notes\n`,
      "utf-8"
    );
    return true;
  } catch {
    return false;
  }
}

export { findNestedAgentFiles };
