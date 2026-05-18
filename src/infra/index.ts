export { ProcessManager, processManager } from "./process-manager.js";
export { GitShadow } from "./git-shadow.js";
export type { ShadowCheckpoint } from "./git-shadow.js";
export { PRManager, createPRManager } from "./pr-manager.js";
export type { PRMetadata, PRResult, PRCommitInfo, PRTemplateConfig } from "./pr-manager.js";
export { AutoCheckpointManager, DEFAULT_CHECKPOINT_POLICY } from "./auto-checkpoint.js";
export type { AutoCheckpointPolicy, AutoCheckpointRecord, CheckpointTrigger } from "./auto-checkpoint.js";
