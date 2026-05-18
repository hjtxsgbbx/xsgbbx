// Query subsystem — typed config, dependency injection, budget tracking, stop hooks
export type { QueryConfig } from "./config.js";
export {
  DEFAULT_QUERY_CONFIG,
  resolveQueryConfig,
  queryConfigFromGlobal,
} from "./config.js";
export type { QueryDeps, CreateQueryDepsOptions } from "./deps.js";
export { createQueryDeps, createQueryDepsForSession } from "./deps.js";
export type { TokenBudget, TokenBudgetStatus } from "./token-budget.js";
export {
  calculateTokenBudget,
  isBudgetExceeded,
  getBudgetWarning,
  getBudgetSummary,
} from "./token-budget.js";
export type { StopHookConfig, StopHookResult } from "./stop-hooks.js";
export {
  DEFAULT_STOP_HOOK_CONFIG,
  checkStopHooks,
  executeStopHooks,
} from "./stop-hooks.js";
