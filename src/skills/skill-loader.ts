/**
 * Load user-defined skills from disk directories.
 *
 * Searches ~/.agent_1/skills/ and <project>/.agent_1/skills/ for SKILL.md
 * files. Each SKILL.md contains frontmatter (name, description, allowed_tools)
 * and a markdown body that becomes the skill prompt.
 */

import { readdirSync, existsSync, readFileSync, statSync } from "fs";
import { join, basename, dirname } from "path";
import { homedir } from "os";
import type { SkillCommand } from "./bundled-skills.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiskSkill {
  name: string;
  description: string;
  path: string;
  body: string;
  allowedTools: string[];
  userInvocable: boolean;
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, unknown> = {};
  const lines = match[1]!.split("\n");
  let currentKey = "";

  for (const line of lines) {
    const kv = line.match(/^(\w[\w_-]*):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1]!;
      const val = kv[2]!.trim();
      // Parse YAML list: [a, b, c]
      if (val.startsWith("[") && val.endsWith("]")) {
        frontmatter[currentKey] = val
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""));
      } else {
        frontmatter[currentKey] = val.replace(/^["']|["']$/g, "");
      }
    } else if (currentKey && line.startsWith("  - ")) {
      const item = line.slice(4).trim().replace(/^["']|["']$/g, "");
      const existing = frontmatter[currentKey];
      if (Array.isArray(existing)) {
        existing.push(item);
      } else {
        frontmatter[currentKey] = [item];
      }
    }
  }

  return { frontmatter, body: match[2] || "" };
}

// ---------------------------------------------------------------------------
// Skill discovery
// ---------------------------------------------------------------------------

function getSkillDirs(): string[] {
  const dirs: string[] = [];
  const globalDir = join(homedir(), ".agent_1", "skills");
  if (existsSync(globalDir)) dirs.push(globalDir);

  const projectDir = join(process.cwd(), ".agent_1", "skills");
  if (existsSync(projectDir)) dirs.push(projectDir);

  return dirs;
}

function discoverSkillsInDir(dir: string): DiskSkill[] {
  const skills: DiskSkill[] = [];

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const mdPath = join(fullPath, "SKILL.md");

      if (statSync(fullPath).isDirectory() && existsSync(mdPath)) {
        try {
          const content = readFileSync(mdPath, "utf-8");
          const { frontmatter, body } = parseFrontmatter(content);

          skills.push({
            name:
              (frontmatter.name as string) ||
              basename(entry).replace(/[_-]/g, "-"),
            description:
              (frontmatter.description as string) ||
              `Skill from ${entry}`,
            path: fullPath,
            body: body.trim(),
            allowedTools: Array.isArray(frontmatter.allowed_tools)
              ? (frontmatter.allowed_tools as string[])
              : [],
            userInvocable: frontmatter.user_invocable !== false,
          });
        } catch {
          // Skip malformed skills
        }
      }
    }
  } catch {
    // Directory read failed — skip
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Conversion to SkillCommand
// ---------------------------------------------------------------------------

function diskSkillToCommand(skill: DiskSkill): SkillCommand {
  return {
    type: "prompt" as const,
    name: skill.name,
    description: skill.description,
    allowedTools: skill.allowedTools,
    userInvocable: skill.userInvocable,
    source: "bundled" as const,
    loadedFrom: skill.path,
    isHidden: false,
    async getPromptForCommand(args: string) {
      const parts: string[] = [];
      parts.push(`Base directory: ${skill.path}\n`);
      parts.push(skill.body);
      if (args) {
        parts.push(`\n## User Request\n\n${args}`);
      }
      return [{ type: "text" as const, text: parts.join("\n\n") }];
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let cachedDiskSkills: SkillCommand[] | null = null;

export function loadDiskSkills(): SkillCommand[] {
  if (cachedDiskSkills) return cachedDiskSkills;
  const dirs = getSkillDirs();
  const all: SkillCommand[] = [];
  for (const dir of dirs) {
    const skills = discoverSkillsInDir(dir);
    all.push(...skills.map(diskSkillToCommand));
  }
  cachedDiskSkills = all;
  return all;
}

export function invalidateDiskSkills(): void {
  cachedDiskSkills = null;
}

/**
 * Get all available skills: bundled + disk-based.
 * Bundled skills take precedence (same-name disk skills are hidden).
 */
export function getAllSkills(): SkillCommand[] {
  const { getBundledSkills } =
    require("./bundled-skills.js") as typeof import("./bundled-skills.js");
  const bundled = getBundledSkills();
  const disk = loadDiskSkills();
  const bundledNames = new Set(bundled.map((s) => s.name));

  const merged: SkillCommand[] = [...bundled];
  for (const skill of disk) {
    if (!bundledNames.has(skill.name)) {
      merged.push(skill);
    }
  }
  return merged;
}

export function getSkillByName(name: string): SkillCommand | undefined {
  return getAllSkills().find(
    (s) =>
      s.name === name ||
      s.aliases?.includes(name)
  );
}
