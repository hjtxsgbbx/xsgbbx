import { type GitShadow, type ShadowCheckpoint } from "../infra/git-shadow.js";
import { debug } from "../observability/debug.js";

export type CheckpointTrigger =
  | "tool_write"
  | "turn_complete"
  | "file_count_threshold"
  | "time_interval"
  | "manual";

export interface AutoCheckpointPolicy {
  enabled: boolean;
  onToolWrite: boolean;
  onTurnComplete: boolean;
  fileCountThreshold: number;
  timeIntervalMs: number;
  maxCheckpointsPerSession: number;
  excludedTools: string[];
}

export const DEFAULT_CHECKPOINT_POLICY: AutoCheckpointPolicy = {
  enabled: true,
  onToolWrite: true,
  onTurnComplete: false,
  fileCountThreshold: 5,
  timeIntervalMs: 5 * 60 * 1000,
  maxCheckpointsPerSession: 50,
  excludedTools: ["read_file", "list_directory", "search_files", "grep"],
};

export interface AutoCheckpointRecord {
  checkpoint: ShadowCheckpoint;
  trigger: CheckpointTrigger;
  toolName?: string;
  turnNumber?: number;
}

export class AutoCheckpointManager {
  private gitShadow: GitShadow | null = null;
  private policy: AutoCheckpointPolicy;
  private records: AutoCheckpointRecord[] = [];
  private filesModifiedSinceLastCheckpoint = 0;
  private lastCheckpointTime = 0;
  private currentTurn = 0;

  constructor(policy?: Partial<AutoCheckpointPolicy>) {
    this.policy = { ...DEFAULT_CHECKPOINT_POLICY, ...policy };
  }

  init(gitShadow: GitShadow): void {
    this.gitShadow = gitShadow;
    this.records = [];
    this.filesModifiedSinceLastCheckpoint = 0;
    this.lastCheckpointTime = Date.now();
    this.currentTurn = 0;
  }

  shouldCheckpoint(trigger: CheckpointTrigger, toolName?: string): boolean {
    if (!this.policy.enabled) return false;
    if (!this.gitShadow) return false;
    if (this.records.length >= this.policy.maxCheckpointsPerSession) return false;

    switch (trigger) {
      case "tool_write":
        if (!this.policy.onToolWrite) return false;
        if (toolName && this.policy.excludedTools.includes(toolName)) return false;
        this.filesModifiedSinceLastCheckpoint++;
        if (this.filesModifiedSinceLastCheckpoint >= this.policy.fileCountThreshold) return true;
        return false;

      case "turn_complete":
        return this.policy.onTurnComplete;

      case "time_interval": {
        const elapsed = Date.now() - this.lastCheckpointTime;
        return elapsed >= this.policy.timeIntervalMs;
      }

      case "file_count_threshold":
        return this.filesModifiedSinceLastCheckpoint >= this.policy.fileCountThreshold;

      case "manual":
        return true;

      default:
        return false;
    }
  }

  tryCheckpoint(trigger: CheckpointTrigger, toolName?: string, description?: string): ShadowCheckpoint | null {
    if (!this.shouldCheckpoint(trigger, toolName)) return null;
    return this.createCheckpoint(trigger, toolName, description);
  }

  forceCheckpoint(description: string): ShadowCheckpoint | null {
    return this.createCheckpoint("manual", undefined, description);
  }

  onTurnStart(): void {
    this.currentTurn++;
  }

  onTurnEnd(): void {
    this.tryCheckpoint("turn_complete", undefined, `Turn ${this.currentTurn} complete`);

    if (this.shouldCheckpoint("time_interval")) {
      this.tryCheckpoint("time_interval", undefined, `Time interval checkpoint`);
    }
  }

  onToolExecution(toolName: string, isWrite: boolean): ShadowCheckpoint | null {
    if (!isWrite) return null;
    return this.tryCheckpoint("tool_write", toolName, `After ${toolName}`);
  }

  getRecords(): AutoCheckpointRecord[] {
    return [...this.records];
  }

  getLatestCheckpoint(): ShadowCheckpoint | null {
    if (this.records.length === 0) return null;
    return this.records[this.records.length - 1].checkpoint;
  }

  rollbackTo(trigger?: CheckpointTrigger): boolean {
    if (!this.gitShadow) return false;

    if (trigger) {
      const record = [...this.records].reverse().find((r) => r.trigger === trigger);
      if (!record) return false;
      return this.gitShadow.rollbackToCheckpoint(record.checkpoint.id);
    }

    const latest = this.getLatestCheckpoint();
    if (!latest) return false;
    return this.gitShadow.rollbackToCheckpoint(latest.id);
  }

  rollbackToByIndex(index: number): boolean {
    if (!this.gitShadow) return false;
    if (index < 0 || index >= this.records.length) return false;
    return this.gitShadow.rollbackToCheckpoint(this.records[index].checkpoint.id);
  }

  getPolicy(): AutoCheckpointPolicy {
    return { ...this.policy };
  }

  updatePolicy(updates: Partial<AutoCheckpointPolicy>): void {
    this.policy = { ...this.policy, ...updates };
  }

  getStats(): {
    totalCheckpoints: number;
    byTrigger: Record<CheckpointTrigger, number>;
    filesModifiedSinceLastCheckpoint: number;
    timeSinceLastCheckpointMs: number;
  } {
    const byTrigger: Record<string, number> = {
      tool_write: 0,
      turn_complete: 0,
      file_count_threshold: 0,
      time_interval: 0,
      manual: 0,
    };
    for (const record of this.records) {
      byTrigger[record.trigger] = (byTrigger[record.trigger] || 0) + 1;
    }

    return {
      totalCheckpoints: this.records.length,
      byTrigger: byTrigger as Record<CheckpointTrigger, number>,
      filesModifiedSinceLastCheckpoint: this.filesModifiedSinceLastCheckpoint,
      timeSinceLastCheckpointMs: Date.now() - this.lastCheckpointTime,
    };
  }

  private createCheckpoint(
    trigger: CheckpointTrigger,
    toolName?: string,
    description?: string
  ): ShadowCheckpoint | null {
    if (!this.gitShadow) return null;

    const desc = description || `Auto-checkpoint (${trigger})`;
    const checkpoint = this.gitShadow.saveCheckpoint(desc);

    if (checkpoint) {
      this.records.push({
        checkpoint,
        trigger,
        toolName,
        turnNumber: this.currentTurn,
      });
      this.filesModifiedSinceLastCheckpoint = 0;
      this.lastCheckpointTime = Date.now();
      debug.info("auto-checkpoint", `Created checkpoint ${checkpoint.id} via ${trigger}`);
    }

    return checkpoint;
  }
}
