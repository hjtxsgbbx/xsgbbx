import { type BenchmarkRun, type BenchmarkGate, type TaskResult } from "./types.js";
import * as fs from "fs";
import * as path from "path";

export interface ReportOptions {
  outputDir: string;
  format: "json" | "junit" | "markdown" | "html" | "all";
  includeComparison: boolean;
}

const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  outputDir: path.join(process.cwd(), "benchmark-results"),
  format: "all",
  includeComparison: true,
};

export class BenchmarkReporter {
  private options: ReportOptions;

  constructor(options?: Partial<ReportOptions>) {
    this.options = { ...DEFAULT_REPORT_OPTIONS, ...options };
    fs.mkdirSync(this.options.outputDir, { recursive: true });
  }

  generate(run: BenchmarkRun, gate?: BenchmarkGate): void {
    const baseName = `benchmark-${run.id}-${new Date().toISOString().slice(0, 10)}`;

    const formats = this.options.format === "all"
      ? ["json", "junit", "markdown", "html"]
      : [this.options.format];

    if (formats.includes("json")) this.writeJson(run, gate, baseName);
    if (formats.includes("junit")) this.writeJUnit(run, baseName);
    if (formats.includes("markdown")) this.writeMarkdown(run, gate, baseName);
    if (formats.includes("html")) this.writeHtml(run, gate, baseName);
  }

  private writeJson(run: BenchmarkRun, gate: BenchmarkGate | undefined, baseName: string): void {
    const report = { run, gate: gate || null, generatedAt: new Date().toISOString() };
    fs.writeFileSync(
      path.join(this.options.outputDir, `${baseName}.json`),
      JSON.stringify(report, null, 2)
    );
  }

  private writeJUnit(run: BenchmarkRun, baseName: string): void {
    const suites: string[] = [];
    const byCategory = new Map<string, TaskResult[]>();

    for (const r of run.results) {
      const existing = byCategory.get(r.category) || [];
      existing.push(r);
      byCategory.set(r.category, existing);
    }

    for (const [category, results] of byCategory) {
      const failures = results.filter((r) => !r.passed).length;
      const skipped = 0;
      const time = results.reduce((s, r) => s + r.timeTakenMs / 1000, 0);

      let testCases = "";
      for (const r of results) {
        testCases += `
      <testcase name="${escXml(r.taskName)}" classname="benchmark.${escXml(category)}" time="${(r.timeTakenMs / 1000).toFixed(3)}">
        ${r.passed ? "" : `<failure message="${escXml(r.errors.join("; "))}">${escXml(r.details.output as string || "")}</failure>`}
      </testcase>`;
      }

      suites.push(`
  <testsuite name="benchmark.${escXml(category)}" tests="${results.length}" failures="${failures}" skipped="${skipped}" time="${time.toFixed(3)}">
    ${testCases}
  </testsuite>`);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="agent_1 Benchmark" tests="${run.totalTasks}" failures="${run.failedTasks}" time="0">
  ${suites.join("")}
</testsuites>`;

    fs.writeFileSync(path.join(this.options.outputDir, `${baseName}.xml`), xml);
  }

  private writeMarkdown(run: BenchmarkRun, gate: BenchmarkGate | undefined, baseName: string): void {
    const m = run.metrics;
    const gateLine = gate
      ? `| **Gate Status** | \`${gate.status}\` | ${gate.recommendation.toUpperCase()} |\n| **Regressions** | ${gate.regressions.length} | ${gate.regressions.length > 0 ? "⚠" : "✅"} |\n| **Improvements** | ${gate.improvements.length} | ${gate.improvements.length > 0 ? "↑" : "—"} |`
      : "";

    let resultsTable = "";
    for (const r of run.results) {
      resultsTable += `| ${r.taskId} | ${r.taskName} | ${r.category} | ${r.passed ? "✅ PASS" : "❌ FAIL"} | ${r.score}/${r.maxScore} | ${r.timeTakenMs}ms | ${r.tokensUsed} |\n`;
    }

    const md = `# agent_1 Benchmark Report

**Run**: ${run.id}
**Version**: ${run.version}
**Provider**: ${run.provider} / ${run.model}
**Date**: ${run.timestamp}

## Summary

| Metric | Value |
|--------|-------|
| Total Tasks | ${run.totalTasks} |
| Passed | ${run.passedTasks} |
| Failed | ${run.failedTasks} |
| Pass Rate | ${(run.metrics.passRate * 100).toFixed(1)}% |
${gateLine}
## Performance

| Metric | Value |
|--------|-------|
| Avg Time | ${m.performance.avgTimeToCompleteMs}ms |
| P50 | ${m.performance.p50TimeMs}ms |
| P95 | ${m.performance.p95TimeMs}ms |
| P99 | ${m.performance.p99TimeMs}ms |
| Avg Tokens | ${m.performance.avgTokensPerTask} |
| Avg Tool Calls | ${m.performance.avgToolCallsPerTask} |
| Avg Turns | ${m.performance.avgTurnsPerTask} |

## Accuracy

| Metric | Value |
|--------|-------|
| Functional Correctness | ${(m.accuracy.functionalCorrectnessRate * 100).toFixed(1)}% |
| Test Pass Rate | ${(m.accuracy.testPassRate * 100).toFixed(1)}% |
| Lint Pass Rate | ${(m.accuracy.lintPassRate * 100).toFixed(1)}% |
| Type Check Pass | ${(m.accuracy.typeCheckPassRate * 100).toFixed(1)}% |
| Regression Rate | ${(m.accuracy.regressionRate * 100).toFixed(1)}% |

## Results

| ID | Task | Category | Status | Score | Time | Tokens |
|----|------|----------|--------|-------|------|--------|
${resultsTable}
## Threshold Breaches

${gate?.thresholdBreaches?.map((b) => `- ⚠ ${b}`).join("\n") || "None"}

---
*Generated by agent_1 Benchmark System*
`;
    fs.writeFileSync(path.join(this.options.outputDir, `${baseName}.md`), md);
  }

  private writeHtml(run: BenchmarkRun, gate: BenchmarkGate | undefined, baseName: string): void {
    const resultsHtml = run.results.map((r) =>
      `<tr class="${r.passed ? "pass" : "fail"}"><td>${r.taskId}</td><td>${r.taskName}</td><td>${r.passed ? "✅ PASS" : "❌ FAIL"}</td></tr>`
    ).join("");

    const gateStatus = gate ? `<p>Gate: <strong>${gate.status}</strong> — Recommendation: <strong>${gate.recommendation.toUpperCase()}</strong></p>` : "";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>agent_1 Benchmark — ${run.id}</title>
  <style>
    body { font-family: system-ui; max-width: 900px; margin: 40px auto; background: #1a1a2e; color: #eee; }
    h1 { color: #00d4ff; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 8px 12px; border: 1px solid #333; text-align: left; }
    th { background: #16213e; }
    tr.pass { background: rgba(0,255,136,0.05); }
    tr.fail { background: rgba(255,68,68,0.05); }
    .metric { font-family: monospace; font-size: 1.2em; color: #0f0; }
  </style>
</head>
<body>
  <h1>agent_1 Benchmark Report</h1>
  <p>Run: ${run.id} | Version: ${run.version} | Date: ${run.timestamp}</p>
  <p>Pass Rate: <span class="metric">${(run.metrics.passRate * 100).toFixed(1)}%</span> (${run.passedTasks}/${run.totalTasks})</p>
  ${gateStatus}
  <table>
    <tr><th>ID</th><th>Task</th><th>Result</th></tr>
    ${resultsHtml}
  </table>
  <p><em>Generated by agent_1 Benchmark System</em></p>
</body>
</html>`;

    fs.writeFileSync(path.join(this.options.outputDir, `${baseName}.html`), html);
  }
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}