import { EventEmitter } from "events";
import { type PermissionDecision, type ToolCall, type ExecutionContext } from "../types/index.js";

export interface ApprovalRequest {
  id: string;
  toolCall: ToolCall;
  context: ExecutionContext;
  reason: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  category: string;
  timestamp: string;
  status: "pending" | "approved" | "denied" | "expired" | "escalated";
  response?: ApprovalResponse;
  expiresAt?: string;
}

export interface ApprovalResponse {
  decision: "approved" | "denied" | "escalated";
  reason?: string;
  conditions?: string[];
  alwaysApprove?: boolean;
  respondedAt: string;
  respondedBy: string;
}

export interface ApprovalPolicy {
  category: string;
  autoApprove: boolean;
  maxRiskLevel: "low" | "medium" | "high" | "critical";
  requireReason: boolean;
  timeoutMs: number;
  allowedFor: string[];
}

const DEFAULT_POLICIES: ApprovalPolicy[] = [
  { category: "file_read", autoApprove: true, maxRiskLevel: "low", requireReason: false, timeoutMs: 30000, allowedFor: ["*"] },
  { category: "file_write", autoApprove: false, maxRiskLevel: "medium", requireReason: true, timeoutMs: 60000, allowedFor: ["*"] },
  { category: "shell_command", autoApprove: false, maxRiskLevel: "medium", requireReason: true, timeoutMs: 60000, allowedFor: ["*"] },
  { category: "network", autoApprove: false, maxRiskLevel: "high", requireReason: true, timeoutMs: 120000, allowedFor: ["*"] },
  { category: "destructive", autoApprove: false, maxRiskLevel: "critical", requireReason: true, timeoutMs: 300000, allowedFor: ["admin"] },
];

const TOOL_CATEGORIES: Record<string, string> = {
  read_file: "file_read",
  list_files: "file_read",
  search_files: "file_read",
  grep: "file_read",
  glob: "file_read",
  write_file: "file_write",
  edit_file: "file_write",
  diff_edit: "file_write",
  shell_command: "shell_command",
  git_commit: "file_write",
  git_push: "destructive",
  git_reset: "destructive",
  delete_file: "destructive",
};

const RISK_PATTERNS: Array<{ pattern: RegExp; level: "low" | "medium" | "high" | "critical" }> = [
  { pattern: /rm\s+-rf/i, level: "critical" },
  { pattern: /format\s+[a-z]:/i, level: "critical" },
  { pattern: /del\s+\/[sq]/i, level: "critical" },
  { pattern: /DROP\s+TABLE/i, level: "critical" },
  { pattern: /git\s+push\s+--force/i, level: "high" },
  { pattern: /git\s+reset\s+--hard/i, level: "high" },
  { pattern: /chmod\s+777/i, level: "high" },
  { pattern: /npm\s+publish/i, level: "high" },
  { pattern: /curl.*\|\s*sh/i, level: "high" },
  { pattern: /wget.*\|\s*sh/i, level: "high" },
  { pattern: /write_file|edit_file/i, level: "medium" },
  { pattern: /shell_command/i, level: "medium" },
];

export class ApprovalWorkflow extends EventEmitter {
  private policies: Map<string, ApprovalPolicy> = new Map();
  private pendingRequests: Map<string, ApprovalRequest> = new Map();
  private alwaysApproved: Set<string> = new Set();
  private alwaysDenied: Set<string> = new Set();
  private requestHistory: ApprovalRequest[] = [];
  private maxHistory: number;

  constructor(options?: { maxHistory?: number }) {
    super();
    this.maxHistory = options?.maxHistory || 1000;
    for (const policy of DEFAULT_POLICIES) {
      this.policies.set(policy.category, policy);
    }
  }

  assessRisk(toolCall: ToolCall): "low" | "medium" | "high" | "critical" {
    if (!toolCall || !toolCall.name) return "medium";

    let argsStr = "";
    try {
      argsStr = JSON.stringify(toolCall.arguments || {});
    } catch {
      argsStr = String(toolCall.arguments || "");
    }

    for (const { pattern, level } of RISK_PATTERNS) {
      if (pattern.test(argsStr) || pattern.test(toolCall.name)) {
        return level;
      }
    }

    const category = TOOL_CATEGORIES[toolCall.name] || "shell_command";
    if (category === "file_read") return "low";
    if (category === "file_write") return "medium";
    if (category === "destructive") return "critical";
    return "medium";
  }

  categorize(toolCall: ToolCall): string {
    if (!toolCall || !toolCall.name) return "shell_command";
    return TOOL_CATEGORIES[toolCall.name] || "shell_command";
  }

  async requestApproval(
    toolCall: ToolCall,
    context: ExecutionContext,
    reason: string
  ): Promise<PermissionDecision> {
    if (!toolCall || !toolCall.name) {
      return { allowed: false, reason: "Invalid tool call", layer: "ai_classifier", canOverride: false };
    }
    if (!reason || typeof reason !== "string") {
      reason = "No reason provided";
    }

    const category = this.categorize(toolCall);
    const riskLevel = this.assessRisk(toolCall);
    const policy = this.policies.get(category);

    const toolKey = `${toolCall.name}:${JSON.stringify(toolCall.arguments).slice(0, 100)}`;
    if (this.alwaysApproved.has(toolCall.name) || this.alwaysApproved.has(toolKey)) {
      return { allowed: true, layer: "cache", canOverride: false };
    }
    if (this.alwaysDenied.has(toolCall.name) || this.alwaysDenied.has(toolKey)) {
      return { allowed: false, reason: "Always denied", layer: "cache", canOverride: true };
    }

    if (policy?.autoApprove && this.riskLevelSatisfied(riskLevel, policy.maxRiskLevel)) {
      return { allowed: true, layer: "whitelist", canOverride: false };
    }

    const request: ApprovalRequest = {
      id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      toolCall,
      context,
      reason,
      riskLevel,
      category,
      timestamp: new Date().toISOString(),
      status: "pending",
      expiresAt: policy ? new Date(Date.now() + policy.timeoutMs).toISOString() : undefined,
    };

    this.pendingRequests.set(request.id, request);
    this.emit("approvalRequested", request);

    return {
      allowed: false,
      reason: `Approval required (${riskLevel} risk): ${reason}`,
      layer: "ai_classifier",
      canOverride: true,
      confirmationRequired: true,
    };
  }

  respondToRequest(
    requestId: string,
    decision: "approved" | "denied" | "escalated",
    options?: { reason?: string; conditions?: string[]; alwaysApprove?: boolean; respondedBy?: string }
  ): boolean {
    const request = this.pendingRequests.get(requestId);
    if (!request || request.status !== "pending") return false;

    const response: ApprovalResponse = {
      decision,
      reason: options?.reason,
      conditions: options?.conditions,
      alwaysApprove: options?.alwaysApprove,
      respondedAt: new Date().toISOString(),
      respondedBy: options?.respondedBy || "user",
    };

    request.status = decision === "approved" ? "approved" : decision === "denied" ? "denied" : "escalated";
    request.response = response;

    if (options?.alwaysApprove && decision === "approved") {
      this.alwaysApproved.add(request.toolCall.name);
    }

    this.pendingRequests.delete(requestId);
    this.requestHistory.push(request);

    if (this.requestHistory.length > this.maxHistory) {
      this.requestHistory = this.requestHistory.slice(-Math.floor(this.maxHistory * 0.8));
    }

    this.emit("approvalResponded", request, response);
    return true;
  }

  updatePolicy(category: string, policy: Partial<ApprovalPolicy>): void {
    const existing = this.policies.get(category);
    if (existing) {
      this.policies.set(category, { ...existing, ...policy });
    } else {
      this.policies.set(category, {
        category,
        autoApprove: false,
        maxRiskLevel: "medium",
        requireReason: true,
        timeoutMs: 60000,
        allowedFor: ["*"],
        ...policy,
      });
    }
    this.emit("policyUpdated", category, this.policies.get(category));
  }

  getPendingRequests(): ApprovalRequest[] {
    return [...this.pendingRequests.values()];
  }

  getHistory(filter?: { category?: string; riskLevel?: string; limit?: number }): ApprovalRequest[] {
    let result = [...this.requestHistory];
    if (filter?.category) result = result.filter((r) => r.category === filter.category);
    if (filter?.riskLevel) result = result.filter((r) => r.riskLevel === filter.riskLevel);
    if (filter?.limit) result = result.slice(-filter.limit);
    return result;
  }

  getStats(): {
    totalRequests: number;
    approved: number;
    denied: number;
    escalated: number;
    expired: number;
    avgResponseTimeMs: number;
  } {
    const all = [...this.requestHistory, ...this.pendingRequests.values()];
    const approved = all.filter((r) => r.status === "approved").length;
    const denied = all.filter((r) => r.status === "denied").length;
    const escalated = all.filter((r) => r.status === "escalated").length;
    const expired = all.filter((r) => r.status === "expired").length;

    const responded = all.filter((r): r is typeof r & { response: NonNullable<typeof r.response> } => Boolean(r.response));
    let avgResponseTimeMs = 0;
    if (responded.length > 0) {
      const totalTime = responded.reduce((sum, r) => {
        return sum + (new Date(r.response.respondedAt).getTime() - new Date(r.timestamp).getTime());
      }, 0);
      avgResponseTimeMs = totalTime / responded.length;
    }

    return {
      totalRequests: all.length,
      approved,
      denied,
      escalated,
      expired,
      avgResponseTimeMs,
    };
  }

  clearAlwaysApproved(toolName?: string): void {
    if (toolName) {
      this.alwaysApproved.delete(toolName);
    } else {
      this.alwaysApproved.clear();
    }
  }

  expireRequests(): number {
    const now = Date.now();
    let expired = 0;
    for (const [id, request] of this.pendingRequests) {
      if (request.expiresAt && new Date(request.expiresAt).getTime() < now) {
        request.status = "expired";
        this.requestHistory.push(request);
        this.pendingRequests.delete(id);
        expired++;
      }
    }
    return expired;
  }

  private riskLevelSatisfied(
    actual: "low" | "medium" | "high" | "critical",
    max: "low" | "medium" | "high" | "critical"
  ): boolean {
    const levels = { low: 0, medium: 1, high: 2, critical: 3 };
    return levels[actual] <= levels[max];
  }
}
