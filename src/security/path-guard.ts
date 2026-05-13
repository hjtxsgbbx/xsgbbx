import * as path from "path";

export function resolveSafePath(
  filePath: string,
  workspaceDir: string
): { resolvedPath: string; safe: boolean; reason?: string } {
  if (!filePath || filePath.trim().length === 0) {
    return { resolvedPath: "", safe: false, reason: "Empty file path" };
  }

  if (filePath.includes("\0")) {
    return { resolvedPath: "", safe: false, reason: "Null byte in path" };
  }

  const normalized = path.normalize(filePath);

  const dangerousSegments = ["..\\..\\..", "../../..", "~", "/etc/passwd", "C:\\Windows\\System32"];
  for (const seg of dangerousSegments) {
    if (normalized.toLowerCase().includes(seg.toLowerCase())) {
      return { resolvedPath: "", safe: false, reason: `Path contains dangerous segment: ${seg}` };
    }
  }

  if (!path.isAbsolute(normalized)) {
    const resolved = path.resolve(workspaceDir, normalized);
    if (!resolved.startsWith(path.resolve(workspaceDir))) {
      return { resolvedPath: "", safe: false, reason: "Path traversal detected: resolved path outside workspace" };
    }
    return { resolvedPath: resolved, safe: true };
  }

  const resolved = path.resolve(normalized);
  const workspace = path.resolve(workspaceDir);

  if (!resolved.startsWith(workspace)) {
    const relative = path.relative(workspace, resolved);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return {
        resolvedPath: resolved,
        safe: false,
        reason: `Path traversal denied: "${filePath}" resolves outside workspace "${workspace}"`,
      };
    }
  }

  return { resolvedPath: resolved, safe: true };
}

export function isInWorkspace(filePath: string, workspaceDir: string): boolean {
  try {
    const resolved = path.resolve(filePath);
    const workspace = path.resolve(workspaceDir);
    return resolved.startsWith(workspace);
  } catch {
    return false;
  }
}

export function sanitizeFilePath(filePath: string): string {
  let sanitized = filePath
    .replace(/[\x00-\x1F]/g, "")
    .replace(/[<>:"|?*]/g, "_");

  sanitized = path.normalize(sanitized);

  if (sanitized.length > 260) {
    const ext = path.extname(sanitized);
    const base = path.basename(sanitized, ext);
    sanitized = path.join(
      path.dirname(sanitized),
      base.slice(0, 200) + ext
    );
  }

  return sanitized;
}

export function enumerateDangerousPaths(workspaceDir: string): string[] {
  const workspace = path.resolve(workspaceDir);
  return [
    path.join(workspace, "..", "..", "etc", "passwd"),
    path.join(workspace, "..", "..", "..", "root", ".ssh"),
    "C:\\Windows\\System32\\drivers\\etc\\hosts",
    "/etc/crontab",
    path.join(workspace, "node_modules", ".bin", "..", "..", "..", ".env"),
  ];
}