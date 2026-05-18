import type { CommandModule } from "./types.js";
import { ensureMemoryDir, loadMemoryIndex, saveMemory, listMemoryFiles, readMemoryFile } from "../intelligence/memory/memory-manager.js";
import type { MemoryType } from "../intelligence/memory/memory-types.js";

const VALID_TYPES: MemoryType[] = ["user", "project", "feedback", "reference"];

const command: CommandModule = {
  name: "/memory",
  aliases: ["/mem"],
  description: "Read/write persistent memory files",
  argumentHint: "[list|read <file>|save <name> <type> <description>]",
  async execute(args, _ctx) {
    const parts = args.split(/\s+/).filter(Boolean);
    const sub = parts[0]?.toLowerCase();

    if (!sub || sub === "list") {
      ensureMemoryDir();
      const index = loadMemoryIndex();
      const files = listMemoryFiles();
      const lines: string[] = ["Memory files:", ""];
      if (index) lines.push(index);
      if (files.length > 0) {
        lines.push("", "Raw file list:");
        for (const f of files) lines.push(`  ${f.split(/[/\\]/).pop()}`);
      }
      if (!index && files.length === 0) lines.push("  No memory files found. Use /memory save to create one.");
      return { success: true, message: lines.join("\n") };
    }

    if (sub === "read") {
      const filename = parts[1];
      if (!filename) return { success: false, message: "Usage: /memory read <filename.md>" };
      const entry = readMemoryFile(filename);
      if (!entry) return { success: false, message: `Memory file not found: ${filename}` };
      const lines = [
        `File: ${entry.file}`,
        `Type: ${entry.type ?? "unknown"}`,
        `Name: ${entry.name ?? "-"}`,
        `Description: ${entry.description ?? "-"}`,
        `Size: ${entry.size} bytes`,
        "",
        entry.content,
      ];
      return { success: true, message: lines.join("\n") };
    }

    if (sub === "save") {
      if (parts.length < 4) {
        return { success: false, message: "Usage: /memory save <filename.md> <type> <name> <description>" };
      }
      const [filename, type, name, ...descParts] = parts.slice(1);
      const description = descParts.join(" ");
      if (!VALID_TYPES.includes(type as MemoryType)) {
        return { success: false, message: `Invalid type: ${type}. Valid: ${VALID_TYPES.join(", ")}` };
      }
      const result = saveMemory(filename!, type as MemoryType, name!, description, "");
      return {
        success: result.ok,
        message: result.ok ? `Memory saved: ${filename}` : `Failed to save: ${result.error}`,
      };
    }

    if (sub === "inject") {
      return {
        success: true,
        prompt: `Manage persistent memory. Based on the current conversation:
1. Identify key facts, decisions, and preferences to save
2. Show existing memories that are relevant
3. Categorize: user profile, project context, feedback, references

Use memory directory format:
- user/*.md, project/*.md, feedback/*.md, reference/*.md`,
        message: "Memory injection prompt sent.",
      };
    }

    return { success: false, message: `Unknown sub-command: ${sub}. Try: list, read, save, inject` };
  },
};
export default command;
