export { QueryEngineImpl, createQueryEngine } from "../engine/index.js";
export type { QueryEngineEvents } from "../engine/index.js";
export { PlannerAgent } from "../planning/index.js";
export type { PlanStep, ExecutionPlan } from "../planning/index.js";
export { loadProjectMemory, loadHierarchicalContext, loadAllContext, } from "../intelligence/index.js";
export { RepoMap, repoMap } from "../intelligence/index.js";
export type { RepoMapEntry, RepoMapConfig } from "../intelligence/index.js";
export { CircuitBreaker, apiCircuitBreaker, CircuitBreakerOpenError } from "../resilience/index.js";
export type { CircuitState, CircuitBreakerConfig } from "../resilience/index.js";
export { CostTracker } from "../observability/index.js";
export type { SessionMetrics, CostEstimate } from "../observability/index.js";
export { captureEnvSnapshot, formatEnvSnapshot } from "../observability/index.js";
export type { EnvSnapshot } from "../observability/index.js";
export { calculateBudget, shouldCompact, TokenBudgetExceededError, getModelLimit, estimateTokens, } from "../observability/index.js";
export type { TokenBudget } from "../observability/index.js";
export { AIGuard } from "../permissions/index.js";
export type { AIGuardResult } from "../permissions/index.js";
export { PermissionPipeline } from "../permissions/index.js";
export type { PermissionRuleType, PermissionRule } from "../permissions/index.js";
export { ApprovalWorkflow } from "../permissions/index.js";
export type { ApprovalRequest, ApprovalResponse, ApprovalPolicy } from "../permissions/index.js";
export { AuditLogger, TelemetryLogger } from "../storage/index.js";
export { MCPManager, MCPToolAdapter, mcpManager } from "../mcp/index.js";
export type { MCPResourceDefinition, MCPPromptDefinition } from "../mcp/index.js";

// Hooks
export { AsyncHookRegistry } from "../hooks/index.js";
export type { HookEvent, HookCommand, HookHttp, HookPrompt, HookConfig, HookContext, HookResult, HooksSettings, } from "../hooks/index.js";
export { HooksConfigManager } from "../hooks/index.js";

// Skills
export { initBundledSkills, getAllSkills, getSkillByName, loadDiskSkills, } from "../skills/index.js";
export type { BundledSkillDefinition, SkillCommand } from "../skills/index.js";

// Keybindings
export { loadMergedBindings, loadDefaultBindings, loadUserBindings, resolveBinding, getBindingHelp, validateBindings, } from "../keybindings/index.js";
export type { Keybinding, KeybindingSet } from "../keybindings/index.js";

// Shell safety
export { analyzeCommand, needsConfirmation, isBlocked, getSafetyReport, } from "../shell/index.js";
export type { SafetySeverity, SafetyResult } from "../shell/index.js";

// Vim mode
export { VimEngine } from "../vim/index.js";
export type { VimMode, VimState, CursorState, VimActionResult } from "../vim/index.js";

// Agent orchestration
export { AgentOrchestrator, agentOrchestrator } from "../tools/agent-orchestrator.js";
export type {
  AgentDefinition,
  AgentMemorySnapshot,
  AgentResult,
  AgentSpawnOptions,
} from "../tools/agent-orchestrator.js";

// Plugins
export {
  loadPlugins,
  getPlugin,
  importPlugin,
  getPluginHooks,
  validatePlugin,
} from "../plugins/index.js";
export type {
  PluginManifest,
  LoadedPlugin,
  PluginValidationResult,
} from "../plugins/index.js";

// DeepSeek innovations
export {
  ReasoningCollector,
  calculateDashboard,
  formatDashboard,
  ModelRouter,
  modelRouter,
} from "../deepseek/index.js";
export type {
  ReasoningStep,
  ReasoningSession,
  ContextDashboard,
  ModelEndpoint,
  ModelCapability,
  RoutingDecision,
  TaskProfile,
} from "../deepseek/index.js";

// Terminal UI components
export {
  DiffView,
  parseUnifiedDiff,
  StatusBar,
  MarkdownRenderer,
} from "../components/index.js";
export type {
  DiffLine,
  DiffViewProps,
  StatusBarProps,
  MarkdownRendererProps,
} from "../components/index.js";
