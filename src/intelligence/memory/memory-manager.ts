/**
 * Memory Manager — loads, saves, and manages persistent memory.
 * Integrates with the xsgbbx.md loader and the system prompt.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { APP_NAME } from "../../core/constants.js";
import { parseMemoryType, ENTRYPOINT_NAME, buildMemorySystemPrompt } from "./memory-types.js";
import type { MemoryType } from "./memory-types.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function getUserDir(): string {
  return join(homedir(), `.${APP_NAME}`);
}

export function getMemoryDir(): string {
  return join(getUserDir(), "memory");
}

/** Ensure the memory directory and MEMORY.md exist */
export function ensureMemoryDir(): string {
  const dir = getMemoryDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const index = join(dir, ENTRYPOINT_NAME);
  if (!existsSync(index)) {
    writeFileSync(index, "# MEMORY.md\n\nMemory index for xsgbbx.\n\nEach entry links to a memory file in this directory.\n");
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  /** Relative path to the memory file (e.g., "user_role.md") */
  file: string;
  /** Full absolute path */
  absolutePath: string;
  /** Parsed type from frontmatter */
  type?: MemoryType;
  /** Display name from frontmatter */
  name?: string;
  /** One-line description from frontmatter */
  description?: string;
  /** Full content (body after frontmatter) */
  content: string;
  /** File size in bytes */
  size: number;
}

/** Load MEMORY.md index and parse all referenced memory files */
export function loadMemoryIndex(): string | null {
  const memDir = ensureMemoryDir();
  const indexPath = join(memDir, ENTRYPOINT_NAME);

  try {
    const content = readFileSync(indexPath, "utf-8").trim();
    if (!content) return null;
    // Truncation matching Claude Code: 200 lines, 25KB
    const lines = content.split("\n");
    let truncated = lines.length > 200
      ? `${lines.slice(0, 200).join("\n")}\n\n> WARNING: MEMORY.md truncated at 200 lines. Keep index entries concise.`
      : content;
    if (truncated.length > 25_000) {
      truncated = truncated.slice(0, 24_500) + "\n\n> WARNING: MEMORY.md exceeds 25KB. Keep entries short.";
    }
    return truncated;
  } catch {
    return null;
  }
}

/** Read a specific memory file by name */
export function readMemoryFile(filename: string): MemoryEntry | null {
  const memDir = getMemoryDir();
  const absolutePath = join(memDir, filename);

  // Path traversal guard
  if (!absolutePath.startsWith(memDir)) return null;
  if (!existsSync(absolutePath)) return null;

  try {
    const raw = readFileSync(absolutePath, "utf-8");
    const { data, body } = parseFrontmatter(raw);
    return {
      file: filename,
      absolutePath,
      type: parseMemoryType(data.type),
      name: data.name,
      description: data.description,
      content: body,
      size: raw.length,
    };
  } catch {
    return null;
  }
}

/** List all memory files referenced in MEMORY.md */
export function listMemoryFiles(): string[] {
  const memDir = getMemoryDir();
  if (!existsSync(memDir)) return [];

  try {
    return readdirSync(memDir)
      .filter(f => f.endsWith(".md") && f !== ENTRYPOINT_NAME)
      .map(f => join(memDir, f));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Save a memory file and update MEMORY.md index */
export function saveMemory(
  filename: string,
  type: MemoryType,
  name: string,
  description: string,
  content: string
): { ok: boolean; error?: string } {
  const memDir = ensureMemoryDir();
  const filePath = join(memDir, filename);

  // Path traversal guard
  if (!filePath.startsWith(memDir)) {
    return { ok: false, error: "Path traversal denied" };
  }

  try {
    // Write the memory file
    const frontmatter = `---
name: ${name}
description: ${description}
type: ${type}
---
`;
    writeFileSync(filePath, frontmatter + content, "utf-8");

    // Update MEMORY.md index
    const indexPath = join(memDir, ENTRYPOINT_NAME);
    const indexContent = existsSync(indexPath)
      ? readFileSync(indexPath, "utf-8")
      : "# MEMORY.md\n\n";
    const entryLine = `- [${name}](${filename}) — ${description}`;

    // Avoid duplicate entries
    if (!indexContent.includes(`[${name}](${filename})`)) {
      const updated = indexContent.trim() + `\n${entryLine}\n`;
      writeFileSync(indexPath, updated, "utf-8");
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Relevance finding
// ---------------------------------------------------------------------------

/** Find memories relevant to the current context (keyword-based, future: vector) */
export function findRelevantMemories(query: string, maxResults = 5): MemoryEntry[] {
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const files = listMemoryFiles();
  const scored: Array<{ entry: MemoryEntry; score: number }> = [];

  for (const filePath of files) {
    const filename = filePath.split(/[/\\]/).pop()!;
    const entry = readMemoryFile(filename);
    if (!entry) continue;

    let score = 0;
    const searchText = `${entry.name ?? ""} ${entry.description ?? ""} ${entry.content}`.toLowerCase();
    for (const kw of keywords) {
      if (searchText.includes(kw)) score++;
      // Title/description match is weighted higher
      if ((entry.name ?? "").toLowerCase().includes(kw)) score += 3;
      if ((entry.description ?? "").toLowerCase().includes(kw)) score += 2;
    }
    if (score > 0) scored.push({ entry, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.entry);
}

// ---------------------------------------------------------------------------
// System Prompt Integration
// ---------------------------------------------------------------------------

/** Get the full memory system prompt for injection into the system prompt */
export function getMemorySystemPromptSection(): string {
  return buildMemorySystemPrompt(getMemoryDir());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): { data: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };
  const data: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) data[kv[1]!] = kv[2]!.trim();
  }
  return { data, body: match[2]!.trim() };
}
