export interface BenchmarkMetrics {
  passRate: number;
  totalTasks: number;
  passedTasks: number;
  failedTasks: number;

  performance: PerformanceMetrics;
  accuracy: AccuracyMetrics;
  quality: QualityMetrics;
  interaction: InteractionMetrics;
  scalability: ScalabilityMetrics;
}

export interface PerformanceMetrics {
  avgTimeToCompleteMs: number;
  p50TimeMs: number;
  p95TimeMs: number;
  p99TimeMs: number;
  avgTokensPerTask: number;
  avgToolCallsPerTask: number;
  avgTurnsPerTask: number;
}

export interface AccuracyMetrics {
  functionalCorrectnessRate: number;
  testPassRate: number;
  lintPassRate: number;
  typeCheckPassRate: number;
  regressionRate: number;
}

export interface QualityMetrics {
  avgCyclomaticComplexity: number;
  avgCodeDuplicationPercent: number;
  commentToCodeRatio: number;
  lintViolationsPerFile: number;
  typeSafetyScore: number;
}

export interface InteractionMetrics {
  avgUserSatisfactionScore: number;
  clarificationNeededRate: number;
  avgClarificationRounds: number;
  taskAbandonmentRate: number;
  errorRecoveryRate: number;
}

export interface ScalabilityMetrics {
  memoryUsagePeakMb: number;
  memoryUsageAvgMb: number;
  fileCountThreshold: number;
  largeRepoDegradationPercent: number;
  concurrentSessionCapacity: number;
}

export interface BenchmarkTask {
  id: string;
  name: string;
  category: TaskCategory;
  description: string;
  setupCommands: string[];
  expectedOutput: ExpectedOutput;
  timeoutMs: number;
  maxTurns: number;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
}

export type TaskCategory =
  | "code_generation"
  | "bug_fix"
  | "refactoring"
  | "test_writing"
  | "code_review"
  | "documentation"
  | "dependency_update"
  | "security_fix"
  | "performance_optimization"
  | "api_integration";

export interface ExpectedOutput {
  type: "file_exists" | "test_pass" | "regex_match" | "cli_output" | "type_check" | "lint_pass";
  filePath?: string;
  regex?: string;
  testPattern?: string;
  cliCommand?: string;
  expectedExitCode?: number;
}

export interface TaskResult {
  taskId: string;
  taskName: string;
  category: TaskCategory;
  passed: boolean;
  score: number;
  maxScore: number;
  timeTakenMs: number;
  tokensUsed: number;
  toolCalls: number;
  turnsCompleted: number;
  errors: string[];
  warnings: string[];
  details: Record<string, unknown>;
}

export interface BenchmarkRun {
  id: string;
  timestamp: string;
  version: string;
  provider: string;
  model: string;
  totalTasks: number;
  passedTasks: number;
  failedTasks: number;
  metrics: BenchmarkMetrics;
  results: TaskResult[];
  comparison?: IndustryComparison;
}

export interface IndustryComparison {
  benchmark: string;
  agent_1Score: number;
  industryAverage: number;
  industryTopScore: number;
  topAgent: string;
  rank: string;
  percentile: number;
}

export enum BenchmarkStatus {
  PASSED = "PASSED",
  FAILED = "FAILED",
  DEGRADED = "DEGRADED",
  IMPROVED = "IMPROVED",
}

export interface BenchmarkGate {
  previousRun: BenchmarkRun | null;
  currentRun: BenchmarkRun;
  status: BenchmarkStatus;
  regressions: TaskResult[];
  improvements: TaskResult[];
  thresholdBreaches: string[];
  recommendation: "proceed" | "review" | "block";
}

export const INDUSTRY_BENCHMARKS: Record<string, IndustryComparison> = {
  "swe-bench-verified": {
    benchmark: "SWE-bench Verified",
    agent_1Score: 0,
    industryAverage: 0.35,
    industryTopScore: 0.809,
    topAgent: "Claude Opus 4.5",
    rank: "TBD",
    percentile: 0,
  },
  "code-completion": {
    benchmark: "Code Completion Accuracy",
    agent_1Score: 0,
    industryAverage: 0.72,
    industryTopScore: 0.92,
    topAgent: "GitHub Copilot",
    rank: "TBD",
    percentile: 0,
  },
  "task-completion": {
    benchmark: "Task Completion Rate",
    agent_1Score: 0,
    industryAverage: 0.62,
    industryTopScore: 0.88,
    topAgent: "Devin",
    rank: "TBD",
    percentile: 0,
  },
  "code-quality": {
    benchmark: "Code Quality Score",
    agent_1Score: 0,
    industryAverage: 0.75,
    industryTopScore: 0.94,
    topAgent: "Cursor",
    rank: "TBD",
    percentile: 0,
  },
};

export const EVALUATION_RUBRIC = {
  functional_correctness: { weight: 0.35, description: "Does the solution meet all functional requirements?" },
  code_quality: { weight: 0.20, description: "Is the code well-structured, documented, and maintainable?" },
  test_coverage: { weight: 0.15, description: "Are comprehensive tests included?" },
  performance: { weight: 0.15, description: "Is the solution efficient in time and space?" },
  security: { weight: 0.10, description: "Are security best practices followed?" },
  user_experience: { weight: 0.05, description: "Is the interaction smooth and clear?" },
};

export const PERFORMANCE_BASELINE: PerformanceMetrics = {
  avgTimeToCompleteMs: 60000,
  p50TimeMs: 45000,
  p95TimeMs: 120000,
  p99TimeMs: 180000,
  avgTokensPerTask: 8000,
  avgToolCallsPerTask: 12,
  avgTurnsPerTask: 8,
};

export const GATE_THRESHOLDS = {
  minPassRate: 0.60,
  maxRegressionRate: 0.10,
  maxAvgTimeMs: 120000,
  minTestPassRate: 0.80,
  minTypeCheckPassRate: 0.95,
  maxMemoryPeakMb: 512,
};