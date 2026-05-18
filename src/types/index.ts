export type JSONSchema = {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  description?: string;
  enum?: string[];
  items?: JSONSchema;
};

export type OS = "windows" | "macos" | "linux";
export type Terminal =
  | "powershell_5"
  | "powershell_7"
  | "cmd"
  | "git_bash"
  | "windows_terminal"
  | "terminal_app"
  | "iterm2"
  | "gnome_terminal"
  | "konsole"
  | "unknown";

export interface PlatformInfo {
  os: OS;
  terminal: Terminal;
  shell: string;
  isElevated: boolean;
  homeDir: string;
  tempDir: string;
  nodeVersion: string;
  arch: string;
}

export interface UserInput {
  text: string;
  timestamp: string;
  interrupt?: boolean;
}

export interface AssistantResponse {
  content: string;
  model: string;
  usage?: TokenUsage;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
  limit: number;
  cacheRead?: number;
  cacheCreation?: number;
}

export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "tool_use"
  | "stop_sequence";

export interface QueryResult {
  response: AssistantResponse;
  toolCalls?: ToolCall[];
  stopReason: StopReason;
}

export interface QueryEngine {
  query(input: UserInput, context: SessionContext): Promise<QueryResult>;
  abort(): void;
}

// ---------------------------------------------------------------------------
// Tool System — Extended with Claude Code's buildTool() pattern
// ---------------------------------------------------------------------------

export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  /** @deprecated Use isReadOnly() instead */
  readonly: boolean;
  execute(
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult>;

  // --- Extended methods (Claude Code parity) ---

  /** Whether this tool is read-only. Read-only tools can run concurrently. */
  isReadOnly?(): boolean;

  /** Whether this tool is safe to run concurrently with other tools.
   *  Defaults to isReadOnly(). Only true if the tool has no side-effects
   *  and doesn't depend on the state of other concurrent operations. */
  isConcurrencySafe?(): boolean;

  /** Whether this tool is currently enabled. Can be used to gate feature flags. */
  isEnabled?(): boolean;

  /** Validate input before execution. Return { result: true } or { result: false, message } */
  validateInput?(params: Record<string, unknown>, context: ExecutionContext): Promise<{ result: boolean; message?: string }>;

  /** Get the path this tool operates on (for permission checks) */
  getPath?(params: Record<string, unknown>): string;

  /** Render a tool result for display */
  renderResult?(result: ToolResult): string;

  /** Render a tool error for display */
  renderError?(error: string): string;

  /** Maximum characters in the tool result before truncation */
  maxResultSizeChars?: number;
}

export interface ExecutionContext {
  session: Session;
  platform: PlatformInfo;
  permissionLevel: PermissionDecision;
}

export interface ToolResult {
  success: boolean;
  output: string;
  errorCode?: string;
  artifacts?: string[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type PermissionLayer =
  | "cache"
  | "acceptEdits"
  | "whitelist"
  | "ai_classifier";

export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
  layer: PermissionLayer;
  canOverride: boolean;
  confirmationRequired?: boolean;
}

export type PermissionMode = "default" | "plan" | "defaultDeny" | "autoApprove" | "sandbox";

export type ClientType = "cli" | "desktop" | "web";

export type SessionStatus = "active" | "completed" | "terminated";

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string | ToolCall[];
  timestamp: string;
  critical: boolean;
  tool_id?: string;
  /** DeepSeek V4 requires reasoning_content round-tripped in all subsequent requests */
  reasoning_content?: string;
}

export interface Session {
  session_id: string;
  created_at: string;
  updated_at: string;
  client_type: ClientType;
  status: SessionStatus;
  messages: Message[];
  meta: {
    project_path: string;
    model: string;
    provider: string;
    cost_estimate: number;
    platform: string;
    terminal: string;
  };
}

export interface SessionContext {
  messages: Message[];
  config: Config;
  platform: PlatformInfo;
  projectMemory: string;
  working_dir?: string;
}

export interface CompactionThresholds {
  snip: number;
  collapse: number;
  auto: number;
}

export interface UIConfig {
  color_theme: "dark" | "light";
  compact_mode: boolean;
}

export interface ProviderConfig {
  provider: string;
  base_url: string;
  api_key: string;
  models: string[];
}

export interface Config {
  version: number;
  permission_mode: PermissionMode;
  auto_create_pr: boolean;
  auto_commit: boolean;
  accept_terms: boolean;
  chosen_provider: string;
  session_retention_days: number;
  telemetry_enabled: boolean;
  max_turns: number;
  model: string;
  fallback_model?: string;
  api_key_ref: string;
  ui: UIConfig;
  compaction_thresholds?: CompactionThresholds;
  ai_safety_confidence_threshold?: number;
  mcp_servers?: MCPConfigItem[];
  sandbox_mode?: "off" | "readonly" | "workspace" | "full";
  auto_approve_tools?: string[];
  working_dir?: string;
  thinking_budget_tokens?: number;
  thinking_effort?: "low" | "medium" | "high";
  response_format?: { type: "json_object" };
  provider_configs: Record<string, ProviderConfig>;
  path_permissions?: PathPermission[];
  budget_max_cost_usd?: number;
  budget_max_tokens?: number;
  budget_warning_threshold?: number;
}

export interface PathPermission {
  pattern: string;
  allowRead: boolean;
  allowWrite: boolean;
  allowExecute: boolean;
}

export interface MCPConfigItem {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
}

export interface AuditLogEntry {
  timestamp: string;
  session_id: string;
  action:
    | "tool_exec"
    | "permission_denied"
    | "permission_overridden"
    | "config_change";
  tool_name?: string;
  command_summary?: string;
  decision: "allowed" | "denied" | "overridden";
}

export interface TelemetryEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  session_id: string;
}

export interface AgentBridge {
  invokeQuery(input: UserInput): Promise<QueryResult>;
  onStreamData(callback: (chunk: string) => void): void;
  abortQuery(): void;
}

export type WSMessage =
  | { type: "query"; payload: UserInput; version?: string }
  | { type: "result"; payload: QueryResult; version?: string }
  | { type: "error"; code: number; message: string; version?: string }
  | { type: "init"; version?: string; payload?: { sessionId?: string; share?: boolean } }
  | { type: "state"; version?: string; payload: { state: string; data?: unknown } }
  | { type: "streaming"; version?: string; payload: { chunk: string } }
  | { type: "tool_executing"; version?: string; payload: { toolName: string; args: Record<string, unknown> } }
  | { type: "tool_result"; version?: string; payload: { toolName: string; result: unknown } }
  | { type: "cost_update"; version?: string; payload: unknown }
  | { type: "ping"; version?: string }
  | { type: "pong"; version?: string; payload?: { timestamp: number; sessionId: string | null } };

export type HealStrategy =
  | "RETRY"
  | "INVESTIGATE"
  | "FIX"
  | "PIVOT"
  | "ASK";

export interface HealDecision {
  strategy: HealStrategy;
  modifiedParams?: Record<string, unknown>;
  diagnosticCommand?: string;
  alternativeApproach?: string;
}

export type CompactionLevel = "snip" | "micro" | "collapse" | "auto";

export type AppState =
  | "idle"
  | "thinking"
  | "executing"
  | "permission_denied"
  | "needs_confirmation"
  | "error"
  | "compacting"
  | "max_turns"
  | "delivered"
  | "provider_select";

export interface AppStatus {
  state: AppState;
  projectPath: string;
  provider: string;
  lastSentTimestamp: string;
  currentTool?: string;
  progress?: number;
  tokenUsage?: TokenUsage;
  modelName?: string;
  attempt?: number;
  errorMessage?: string;
  commitHash?: string;
  generatedFiles?: string[];
  pendingCommand?: string;
  pendingToolCall?: ToolCall;
}

export interface H2AEntry {
  text: string;
  timestamp: string;
  interrupt: boolean;
}

export interface CommandAdapterResult {
  command: string;
  shell: string;
  args: string[];
  safe: boolean;
  subCommandCount: number;
}

export interface IDialogueStateMachine {
  processInput(input: UserInput): DialogueTurnResult;
  getCurrentState(): string;
  getCurrentTask(): TaskContextInfo | null;
  getConversationSummary(): string;
  reset(): void;
}

export interface DialogueTurnResult {
  turnId: number;
  intent: { type: string; confidence: number };
  state: string;
}

export interface TaskContextInfo {
  taskId: string;
  description: string;
  state: string;
  createdAt: string;
  updatedAt: string;
}