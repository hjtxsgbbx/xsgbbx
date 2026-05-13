import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface ContextFile {
  level: "global" | "project" | "subdirectory";
  path: string;
  content: string;
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

export function loadProjectMemory(projectPath: string): string {
  const contexts: ContextFile[] = [];

  const globalContent = loadFileIfExists(getGlobalContextPath());
  if (globalContent) {
    contexts.push({ level: "global", path: getGlobalContextPath(), content: globalContent });
  }

  const projectContent = loadFileIfExists(getProjectContextPath(projectPath));
  if (projectContent) {
    contexts.push({ level: "project", path: getProjectContextPath(projectPath), content: projectContent });
  }

  if (contexts.length === 0) return "";

  const parts: string[] = [];
  for (const ctx of contexts) {
    const levelLabel = ctx.level === "global" ? "GLOBAL" : "PROJECT";
    parts.push(`=== ${levelLabel} CONTEXT (${path.basename(ctx.path)}) ===\n${ctx.content}\n=== END ===`);
  }

  return parts.join("\n\n");
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