/**
 * File History — snapshot-based checkpointing for file operations.
 *
 * Before every Edit/Write, a backup is created so the user can:
 *   - See what changed (diff)
 *   - Rollback to any previous version
 *   - Audit file modifications across a session
 *
 * Based on Claude Code's fileHistory.ts — simplified for DeepSeek context.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import { join, dirname, basename } from "path";
import { createHash, randomUUID } from "crypto";
import { homedir } from "os";
import { APP_NAME } from "../core/constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileSnapshot {
  /** Snapshot ID (UUID) */
  id: string;
  /** Original file path */
  filePath: string;
  /** Backup file path in the history store */
  backupPath: string;
  /** Message/session ID that triggered this snapshot */
  contextId: string;
  /** File size in bytes at time of snapshot */
  size: number;
  /** Timestamp */
  timestamp: string;
}

export interface FileHistoryState {
  snapshots: FileSnapshot[];
  maxSnapshots: number;
  sequence: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function getHistoryDir(): string {
  const dir = join(homedir(), `.${APP_NAME}`, "file-history");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const MAX_SNAPSHOTS = 100;
let state: FileHistoryState | null = null;

function loadState(): FileHistoryState {
  if (state) return state;
  const statePath = join(getHistoryDir(), "state.json");
  if (existsSync(statePath)) {
    try {
      state = JSON.parse(readFileSync(statePath, "utf-8"));
      return state!;
    } catch { /* ignore */ }
  }
  state = { snapshots: [], maxSnapshots: MAX_SNAPSHOTS, sequence: 0 };
  return state;
}

function saveState(): void {
  const s = loadState();
  writeFileSync(join(getHistoryDir(), "state.json"), JSON.stringify(s, null, 2));
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Create a backup of a file BEFORE editing it.
 * Call this BEFORE modifying the file.
 * @returns The snapshot, or null if the file doesn't exist (new file creation).
 */
export function createSnapshot(filePath: string, contextId?: string): FileSnapshot | null {
  if (!existsSync(filePath)) return null;

  const s = loadState();
  const fileHash = createHash("md5").update(filePath).digest("hex").slice(0, 8);
  const snapshotId = `${Date.now()}-${fileHash}-${s.sequence++}`;
  const backupDir = join(getHistoryDir(), fileHash);
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

  const backupPath = join(backupDir, `${snapshotId}.bak`);
  const stats = statSync(filePath);

  try {
    copyFileSync(filePath, backupPath);
  } catch {
    // Read + write fallback for cross-device copies
    const content = readFileSync(filePath);
    writeFileSync(backupPath, content);
  }

  const snapshot: FileSnapshot = {
    id: snapshotId,
    filePath,
    backupPath,
    contextId: contextId || randomUUID(),
    size: stats.size,
    timestamp: new Date().toISOString(),
  };

  s.snapshots.push(snapshot);

  // Evict oldest when over limit
  while (s.snapshots.length > MAX_SNAPSHOTS) {
    const oldest = s.snapshots.shift()!;
    try { unlinkSync(oldest.backupPath); } catch { /* ignore */ }
  }

  saveState();
  return snapshot;
}

/**
 * Get all snapshots for a specific file, most recent first.
 */
export function getSnapshots(filePath: string): FileSnapshot[] {
  const s = loadState();
  return s.snapshots
    .filter(sn => sn.filePath === filePath)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * Restore a file from a snapshot.
 * @returns true if restored successfully.
 */
export function restoreSnapshot(snapshotId: string): boolean {
  const s = loadState();
  const snapshot = s.snapshots.find(sn => sn.id === snapshotId);
  if (!snapshot || !existsSync(snapshot.backupPath)) return false;

  try {
    const dir = dirname(snapshot.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    copyFileSync(snapshot.backupPath, snapshot.filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compute a simple diff between two snapshots of the same file.
 * Returns lines added and removed.
 */
export function diffSnapshots(from: FileSnapshot, to: FileSnapshot): { added: number; removed: number } | null {
  if (from.filePath !== to.filePath) return null;

  try {
    const fromContent = readFileSync(from.backupPath, "utf-8").split("\n");
    const toContent = readFileSync(to.backupPath, "utf-8").split("\n");

    // Simple LCS-based diff (approximate)
    const longer = fromContent.length > toContent.length ? fromContent : toContent;
    const shorter = fromContent.length > toContent.length ? toContent : fromContent;

    let matches = 0;
    for (const line of shorter) {
      if (longer.includes(line)) matches++;
    }

    const added = Math.max(0, longer.length - matches);
    const removed = Math.max(0, shorter.length - matches);
    return { added, removed };
  } catch {
    return null;
  }
}

/**
 * Get the most recent backup content for a file.
 * Useful for showing "what the file looked like before your edits".
 */
export function getLastBackupContent(filePath: string): string | null {
  const snapshots = getSnapshots(filePath);
  if (snapshots.length === 0) return null;
  try {
    return readFileSync(snapshots[0]!.backupPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Clean up all snapshots for a session.
 */
export function cleanupSession(contextId: string): number {
  const s = loadState();
  const toRemove = s.snapshots.filter(sn => sn.contextId === contextId);
  for (const sn of toRemove) {
    try { unlinkSync(sn.backupPath); } catch { /* ignore */ }
  }
  s.snapshots = s.snapshots.filter(sn => sn.contextId !== contextId);
  saveState();
  return toRemove.length;
}

/**
 * Get summary stats.
 */
export function getHistoryStats(): { totalSnapshots: number; totalFiles: number; oldestTimestamp: string | null } {
  const s = loadState();
  const uniqueFiles = new Set(s.snapshots.map(sn => sn.filePath));
  return {
    totalSnapshots: s.snapshots.length,
    totalFiles: uniqueFiles.size,
    oldestTimestamp: s.snapshots[0]?.timestamp || null,
  };
}

export function isFileHistoryEnabled(): boolean {
  // Can be toggled via env var
  if (process.env.XSGBBX_DISABLE_FILE_HISTORY === "1") return false;
  return true;
}
