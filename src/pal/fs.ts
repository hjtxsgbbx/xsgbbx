import * as fs from "fs";
import * as path from "path";
import { PlatformInfo } from "../types/index.js";

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function setPermissions(
  filePath: string,
  mode: string,
  platform: PlatformInfo
): void {
  if (platform.os !== "windows") {
    const numericMode = parseInt(mode, 8);
    if (!isNaN(numericMode)) {
      fs.chmodSync(filePath, numericMode);
    }
  }
}

export function readFileSafe(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function writeFileSafe(filePath: string, content: string): boolean {
  try {
    const dir = path.dirname(filePath);
    ensureDir(dir);
    fs.writeFileSync(filePath, content, "utf-8");
    return true;
  } catch {
    return false;
  }
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

export function listFiles(
  dirPath: string,
  pattern?: string
): string[] {
  if (!fs.existsSync(dirPath)) return [];

  const results: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFiles(fullPath, pattern));
    } else if (!pattern || matchGlob(entry.name, pattern)) {
      results.push(fullPath);
    }
  }

  return results;
}

function matchGlob(name: string, pattern: string): boolean {
  const regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`).test(name);
}

export function searchInFile(
  filePath: string,
  pattern: string
): string[] {
  const content = readFileSafe(filePath);
  if (!content) return [];

  const lines = content.split("\n");
  const regex = new RegExp(pattern, "gi");
  return lines
    .map((line, idx) => (regex.test(line) ? `${idx + 1}:${line}` : null))
    .filter((l): l is string => l !== null);
}

export function getProjectFiles(
  projectPath: string,
  ignorePatterns: string[] = ["node_modules", ".git", "dist", ".agent_1"]
): string[] {
  const files: string[] = [];
  if (!fs.existsSync(projectPath)) return files;

  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignorePatterns.includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  };

  walk(projectPath);
  return files;
}