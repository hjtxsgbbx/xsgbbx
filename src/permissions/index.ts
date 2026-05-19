export { PermissionPipeline } from "./pipeline.js";
export type { PermissionRuleType, PermissionRule } from "./pipeline.js";
export { AIGuard } from "./ai-guard.js";
export type { AIGuardResult } from "./ai-guard.js";
export { ApprovalWorkflow } from "./approval-workflow.js";
export type { ApprovalRequest, ApprovalResponse, ApprovalPolicy } from "./approval-workflow.js";
export { RBACManager } from "./rbac.js";
export type { Permission, ResourceScope, Resource, PermissionGrant, PermissionCondition, Role, User, AccessCheckResult } from "./rbac.js";

// Bash command security classifier
export {
  classifyBashCommand,
  isBashCommandDenied,
  isBashCommandDangerous,
  isBashCommandAllowed,
  canClassifyBashCommand,
} from "./bash-classifier.js";
export type { ClassifierResult } from "./bash-classifier.js";

// Shell rule matching
export {
  matchWildcardPattern,
  extractCommandPrefix,
  findMatchingRule,
  findAllMatchingRules,
} from "./shell-rule-matching.js";
export type { ShellCommandRule } from "./shell-rule-matching.js";

// Path constraint validation
export {
  isPathOutsideWorkspace,
  isProtectedPath,
  isWriteProtectedPath,
  sanitizePath,
} from "./path-constraint-validator.js";