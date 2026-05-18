import { EventEmitter } from "events";
import { debug } from "../observability/debug.js";

export interface FileOperation {
  id: string;
  type: "create" | "edit" | "delete" | "rename" | "move";
  filePath: string;
  timestamp: string;
  operator: string;
  beforeContent: string | null;
  afterContent: string | null;
  description: string;
  metadata: Record<string, string>;
}

export interface FileVersion {
  version: number;
  filePath: string;
  content: string;
  timestamp: string;
  operator: string;
  operationId: string;
  description: string;
}

export interface FileAuditEntry {
  id: string;
  operation: FileOperation["type"];
  filePath: string;
  operator: string;
  timestamp: string;
  result: "success" | "failure" | "denied";
  details: string;
  contentHash: string;
}

export class FileOperationManager extends EventEmitter {
  private undoStack: FileOperation[] = [];
  private redoStack: FileOperation[] = [];
  private versions: Map<string, FileVersion[]> = new Map();
  private auditLog: FileAuditEntry[] = [];
  private maxUndoLevels = 50;
  private maxVersionsPerFile = 20;
  private fileContents: Map<string, string> = new Map();
  private fileLocks: Map<string, { lockedBy: string; lockedAt: string }> = new Map();

  recordOperation(operation: Omit<FileOperation, "id" | "timestamp">): string {
    const id = `op-${Date.now()}-${this.undoStack.length}`;
    const fullOp: FileOperation = {
      ...operation,
      id,
      timestamp: new Date().toISOString(),
    };

    this.undoStack.push(fullOp);
    if (this.undoStack.length > this.maxUndoLevels) {
      this.undoStack.shift();
    }

    this.redoStack = [];

    if (operation.afterContent !== null) {
      this.fileContents.set(operation.filePath, operation.afterContent);
    }

    this.addVersion({
      version: (this.versions.get(operation.filePath)?.length || 0) + 1,
      filePath: operation.filePath,
      content: operation.afterContent || "",
      timestamp: fullOp.timestamp,
      operator: operation.operator,
      operationId: id,
      description: operation.description,
    });

    this.addAuditEntry({
      id: `audit-${Date.now()}`,
      operation: operation.type,
      filePath: operation.filePath,
      operator: operation.operator,
      timestamp: fullOp.timestamp,
      result: "success",
      details: operation.description,
      contentHash: this.hashContent(operation.afterContent || ""),
    });

    this.emit("operationRecorded", fullOp);
    debug.info("file-ops", `${operation.type} ${operation.filePath} by ${operation.operator}`);
    return id;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): FileOperation | null {
    if (this.undoStack.length === 0) return null;
    const operation = this.undoStack.pop();
    if (!operation) return null;
    this.redoStack.push(operation);

    if (operation.beforeContent !== null) {
      this.fileContents.set(operation.filePath, operation.beforeContent);
    }

    this.emit("undo", operation);
    debug.info("file-ops", `Undo: ${operation.type} ${operation.filePath}`);
    return operation;
  }

  redo(): FileOperation | null {
    if (this.redoStack.length === 0) return null;
    const operation = this.redoStack.pop();
    if (!operation) return null;
    this.undoStack.push(operation);

    if (operation.afterContent !== null) {
      this.fileContents.set(operation.filePath, operation.afterContent);
    }

    this.emit("redo", operation);
    debug.info("file-ops", `Redo: ${operation.type} ${operation.filePath}`);
    return operation;
  }

  getUndoStack(): FileOperation[] {
    return [...this.undoStack];
  }

  getRedoStack(): FileOperation[] {
    return [...this.redoStack];
  }

  private addVersion(version: Omit<FileVersion, never>): void {
    const versions = this.versions.get(version.filePath) || [];
    versions.push(version as FileVersion);
    if (versions.length > this.maxVersionsPerFile) {
      versions.shift();
    }
    this.versions.set(version.filePath, versions as FileVersion[]);
  }

  getVersions(filePath: string): FileVersion[] {
    return this.versions.get(filePath) || [];
  }

  getVersion(filePath: string, version: number): FileVersion | null {
    const versions = this.versions.get(filePath) || [];
    return versions.find((v) => v.version === version) || null;
  }

  getLatestVersion(filePath: string): FileVersion | null {
    const versions = this.versions.get(filePath) || [];
    return versions.length > 0 ? versions[versions.length - 1] : null;
  }

  getFileContent(filePath: string): string | null {
    return this.fileContents.get(filePath) || null;
  }

  setFileContent(filePath: string, content: string): void {
    this.fileContents.set(filePath, content);
  }

  lockFile(filePath: string, operator: string): boolean {
    const existing = this.fileLocks.get(filePath);
    if (existing && existing.lockedBy !== operator) {
      return false;
    }
    this.fileLocks.set(filePath, { lockedBy: operator, lockedAt: new Date().toISOString() });
    this.emit("fileLocked", filePath, operator);
    return true;
  }

  unlockFile(filePath: string, operator: string): boolean {
    const existing = this.fileLocks.get(filePath);
    if (!existing || existing.lockedBy !== operator) {
      return false;
    }
    this.fileLocks.delete(filePath);
    this.emit("fileUnlocked", filePath, operator);
    return true;
  }

  isFileLocked(filePath: string): boolean {
    return this.fileLocks.has(filePath);
  }

  getFileLock(filePath: string): { lockedBy: string; lockedAt: string } | null {
    return this.fileLocks.get(filePath) || null;
  }

  private addAuditEntry(entry: Omit<FileAuditEntry, never>): void {
    this.auditLog.push(entry as FileAuditEntry);
  }

  getAuditLog(filters?: { filePath?: string; operator?: string; operation?: FileOperation["type"]; startTime?: string; endTime?: string }): FileAuditEntry[] {
    let result = [...this.auditLog];
    if (filters?.filePath) result = result.filter((e) => e.filePath === filters.filePath);
    if (filters?.operator) result = result.filter((e) => e.operator === filters.operator);
    if (filters?.operation) result = result.filter((e) => e.operation === filters.operation);
    if (filters?.startTime) result = result.filter((e) => e.timestamp >= (filters.startTime ?? ""));
    if (filters?.endTime) result = result.filter((e) => e.timestamp <= (filters.endTime ?? ""));
    return result;
  }

  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, "0");
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.versions.clear();
    this.auditLog = [];
    this.fileContents.clear();
    this.fileLocks.clear();
  }
}
