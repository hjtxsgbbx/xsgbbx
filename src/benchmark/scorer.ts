import {
  type TaskResult,
  type BenchmarkRun,
  type BenchmarkMetrics,
  type PerformanceMetrics,
  type AccuracyMetrics,
  type QualityMetrics,
  type InteractionMetrics,
  type ScalabilityMetrics,
  type BenchmarkGate,
  BenchmarkStatus,
  GATE_THRESHOLDS,
  PERFORMANCE_BASELINE,
  EVALUATION_RUBRIC,
} from "./types.js";

export class BenchmarkScorer {
  private baseline: PerformanceMetrics;

  constructor(baseline?: PerformanceMetrics) {
    this.baseline = baseline || PERFORMANCE_BASELINE;
  }

  scoreRun(
    runId: string,
    version: string,
    provider: string,
    model: string,
    results: TaskResult[]
  ): BenchmarkRun {
    const passedTasks = results.filter((r) => r.passed);
    const failedTasks = results.filter((r) => !r.passed);

    const metrics: BenchmarkMetrics = {
      passRate: results.length > 0 ? passedTasks.length / results.length : 0,
      totalTasks: results.length,
      passedTasks: passedTasks.length,
      failedTasks: failedTasks.length,
      performance: this.scorePerformance(results),
      accuracy: this.scoreAccuracy(results),
      quality: this.scoreQuality(results),
      interaction: this.scoreInteraction(results),
      scalability: this.scoreScalability(results),
    };

    return {
      id: runId,
      timestamp: new Date().toISOString(),
      version,
      provider,
      model,
      totalTasks: results.length,
      passedTasks: passedTasks.length,
      failedTasks: failedTasks.length,
      metrics,
      results,
    };
  }

  private scorePerformance(results: TaskResult[]): PerformanceMetrics {
    if (results.length === 0) return { ...PERFORMANCE_BASELINE, avgTimeToCompleteMs: 0, avgTokensPerTask: 0, avgToolCallsPerTask: 0, avgTurnsPerTask: 0 };

    const times = results.map((r) => r.timeTakenMs).sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length * 0.5)];
    const p95 = times[Math.floor(times.length * 0.95)];
    const p99 = times[Math.floor(times.length * 0.99)];

    const totalTokens = results.reduce((s, r) => s + r.tokensUsed, 0);
    const totalToolCalls = results.reduce((s, r) => s + r.toolCalls, 0);
    const totalTurns = results.reduce((s, r) => s + r.turnsCompleted, 0);

    return {
      avgTimeToCompleteMs: Math.round(totalMs(results) / results.length),
      p50TimeMs: p50 || 0,
      p95TimeMs: p95 || 0,
      p99TimeMs: p99 || 0,
      avgTokensPerTask: Math.round(totalTokens / results.length),
      avgToolCallsPerTask: Math.round((totalToolCalls / results.length) * 10) / 10,
      avgTurnsPerTask: Math.round((totalTurns / results.length) * 10) / 10,
    };
  }

  private scoreAccuracy(results: TaskResult[]): AccuracyMetrics {
    if (results.length === 0) return { functionalCorrectnessRate: 0, testPassRate: 0, lintPassRate: 0, typeCheckPassRate: 0, regressionRate: 0 };

    const functionalCorrect = results.filter((r) => r.passed).length;
    const testPass = results.filter((r) => (r.details.testPassed as boolean) === true).length;
    const lintPass = results.filter((r) => (r.details.lintPassed as boolean) !== false).length;
    const typeCheckPass = results.filter((r) => (r.details.typeCheckPassed as boolean) !== false).length;
    const regressions = results.filter((r) => (r.details.regressionCount as number) > 0).length;

    return {
      functionalCorrectnessRate: functionalCorrect / results.length,
      testPassRate: testPass / results.length,
      lintPassRate: lintPass / results.length,
      typeCheckPassRate: typeCheckPass / results.length,
      regressionRate: regressions / results.length,
    };
  }

  private scoreQuality(results: TaskResult[]): QualityMetrics {
    const complexities = results.map((r) => (r.details.cyclomaticComplexity as number) || 0).filter((c) => c > 0);
    const duplications = results.map((r) => (r.details.codeDuplicationPercent as number) || 0).filter((d) => d > 0);
    const lintViolations = results.map((r) => (r.details.lintViolations as number) || 0);

    return {
      avgCyclomaticComplexity: complexities.length > 0
        ? Math.round((complexities.reduce((a, b) => a + b, 0) / complexities.length) * 10) / 10
        : 0,
      avgCodeDuplicationPercent: duplications.length > 0
        ? Math.round((duplications.reduce((a, b) => a + b, 0) / duplications.length) * 10) / 10
        : 0,
      commentToCodeRatio: 0,
      lintViolationsPerFile: lintViolations.reduce((a, b) => a + b, 0),
      typeSafetyScore: 0.9,
    };
  }

  private scoreInteraction(results: TaskResult[]): InteractionMetrics {
    const abandonments = results.filter((r) => (r.details.abandoned as boolean) === true).length;

    return {
      avgUserSatisfactionScore: 0,
      clarificationNeededRate: 0,
      avgClarificationRounds: 0,
      taskAbandonmentRate: results.length > 0 ? abandonments / results.length : 0,
      errorRecoveryRate: 0,
    };
  }

  private scoreScalability(_results: TaskResult[]): ScalabilityMetrics {
    return {
      memoryUsagePeakMb: 0,
      memoryUsageAvgMb: 0,
      fileCountThreshold: 1000,
      largeRepoDegradationPercent: 0,
      concurrentSessionCapacity: 4,
    };
  }

  gateCheck(currentRun: BenchmarkRun, previousRun: BenchmarkRun | null): BenchmarkGate {
    const regressions: TaskResult[] = [];
    const improvements: TaskResult[] = [];
    const thresholdBreaches: string[] = [];

    if (previousRun) {
      const currResults = new Map(currentRun.results.map((r) => [r.taskId, r]));

      for (const prev of previousRun.results) {
        const curr = currResults.get(prev.taskId);
        if (prev.passed && curr && !curr.passed) {
          regressions.push(curr);
        }
        if (!prev.passed && curr && curr.passed) {
          improvements.push(curr);
        }
      }
    }

    if (currentRun.metrics.accuracy.regressionRate > GATE_THRESHOLDS.maxRegressionRate) {
      thresholdBreaches.push(`Regression rate ${formatRate(currentRun.metrics.accuracy.regressionRate)} exceeds limit ${formatRate(GATE_THRESHOLDS.maxRegressionRate)}`);
    }

    if (currentRun.metrics.passRate < GATE_THRESHOLDS.minPassRate) {
      thresholdBreaches.push(`Pass rate ${formatRate(currentRun.metrics.passRate)} below minimum ${formatRate(GATE_THRESHOLDS.minPassRate)}`);
    }

    if (currentRun.metrics.performance.avgTimeToCompleteMs > GATE_THRESHOLDS.maxAvgTimeMs) {
      thresholdBreaches.push(`Avg time ${currentRun.metrics.performance.avgTimeToCompleteMs}ms exceeds limit ${GATE_THRESHOLDS.maxAvgTimeMs}ms`);
    }

    const status = regressions.length > 0
      ? (regressions.length > 2 ? BenchmarkStatus.DEGRADED : BenchmarkStatus.FAILED)
      : improvements.length > 3
        ? BenchmarkStatus.IMPROVED
        : benchmarkStatusFromPassRate(currentRun.metrics.passRate);

    let recommendation: "proceed" | "review" | "block";
    if (status === BenchmarkStatus.PASSED || status === BenchmarkStatus.IMPROVED) {
      recommendation = "proceed";
    } else if (status === BenchmarkStatus.DEGRADED) {
      recommendation = "review";
    } else {
      recommendation = regressions.length > 1 ? "block" : "review";
    }

    return { previousRun, currentRun, status, regressions, improvements, thresholdBreaches, recommendation };
  }

  rubricScore(result: TaskResult): number {
    let score = 0;

    if (result.passed) score += EVALUATION_RUBRIC.functional_correctness.weight;
    if ((result.details.testPassed as boolean) === true) score += EVALUATION_RUBRIC.test_coverage.weight;
    if ((result.details.codeQualityScore as number) >= 0.7) score += EVALUATION_RUBRIC.code_quality.weight;
    if (result.timeTakenMs < 60000) score += EVALUATION_RUBRIC.performance.weight;
    if ((result.details.securityScore as number) >= 0.8) score += EVALUATION_RUBRIC.security.weight;

    return Math.round(score * 100) / 100;
  }
}

function totalMs(results: TaskResult[]): number {
  return results.reduce((s, r) => s + r.timeTakenMs, 0);
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function benchmarkStatusFromPassRate(rate: number): BenchmarkStatus {
  if (rate >= GATE_THRESHOLDS.minPassRate) return BenchmarkStatus.PASSED;
  if (rate >= GATE_THRESHOLDS.minPassRate * 0.7) return BenchmarkStatus.FAILED;
  return BenchmarkStatus.DEGRADED;
}

export const benchmarkScorer = new BenchmarkScorer();