import { IterationOrchestrator } from "../../src/engine/iteration-orchestrator.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function getOrchestrator(): IterationOrchestrator {
  return new IterationOrchestrator(PROJECT_ROOT);
}

function statusEmoji(status: string): string {
  switch (status) {
    case "done": return "✅";
    case "in_progress": return "🔄";
    case "blocked": return "🚫";
    case "todo": return "⬜";
    case "backlog": return "📋";
    case "cancelled": return "❌";
    default: return "❓";
  }
}

function generateSprintReport(): void {
  const orch = getOrchestrator();
  const active = orch.getActiveIteration();

  if (!active) {
    console.log("No active iteration found. Create and start one first.");
    console.log("  npx tsx scripts/dev/iteration-cli.ts create \"Sprint 1\" \"Goal 1\" \"Goal 2\"");
    return;
  }

  const sprintStart = new Date(active.startDate);
  const sprintEnd = new Date(active.endDate);
  const now = new Date();
  const totalDays = Math.ceil((sprintEnd.getTime() - sprintStart.getTime()) / (1000 * 60 * 60 * 24));
  const elapsedDays = Math.min(totalDays, Math.ceil((now.getTime() - sprintStart.getTime()) / (1000 * 60 * 60 * 24)));
  const remainingDays = Math.max(0, totalDays - elapsedDays);

  const totalSP = active.tasks.reduce((s, t) => s + t.storyPoints, 0);
  const doneSP = active.tasks.filter((t) => t.status === "done").reduce((s, t) => s + t.storyPoints, 0);
  const inProgressSP = active.tasks.filter((t) => t.status === "in_progress").reduce((s, t) => s + t.storyPoints, 0);
  const spPerDay = totalSP / totalDays;

  const doneTasks = active.tasks.filter((t) => t.status === "done");
  const inProgressTasks = active.tasks.filter((t) => t.status === "in_progress");
  const blockedTasks = active.tasks.filter((t) => t.status === "blocked");
  const todoTasks = active.tasks.filter((t) => t.status === "todo");

  const mvpProgress = orch.getMVPProgress(active.id);
  const idealProgress = Math.min(100, Math.round((elapsedDays / totalDays) * 100));
  const actualProgress = totalSP > 0 ? Math.round((doneSP / totalSP) * 100) : 0;

  const doneTasksByDay = new Map<number, number>();
  for (const task of active.tasks) {
    if (task.status === "done" && task.completedAt) {
      const dayIdx = Math.floor((new Date(task.completedAt).getTime() - sprintStart.getTime()) / (1000 * 60 * 60 * 24));
      doneTasksByDay.set(dayIdx, (doneTasksByDay.get(dayIdx) || 0) + task.storyPoints);
    }
  }

  const velocityData: number[] = [];
  let cumDone = 0;
  for (let d = 0; d <= elapsedDays; d++) {
    cumDone += doneTasksByDay.get(d) || 0;
    velocityData.push(cumDone);
  }
  const avgVelocity = velocityData.length > 0 ? velocityData[velocityData.length - 1] / Math.max(elapsedDays, 1) : 0;
  const projectedCompletion = avgVelocity > 0 ? Math.ceil((totalSP - doneSP) / avgVelocity) : Infinity;
  const projectedEndDate = projectedCompletion < Infinity
    ? new Date(now.getTime() + projectedCompletion * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : "N/A";

  const report: string[] = [];

  report.push(`# Sprint ${active.number} Status Report: ${active.name}`);
  report.push("");
  report.push(`**Iteration ID**: ${active.id}`);
  report.push(`**Period**: ${active.startDate.slice(0, 10)} → ${active.endDate.slice(0, 10)}`);
  report.push(`**Status**: ${active.status} | **Phase**: ${active.currentPhase}`);
  report.push(`**Day ${elapsedDays}/${totalDays}** | ${remainingDays} days remaining`);
  report.push("");

  report.push("## Sprint Health Dashboard");
  report.push("");
  report.push("| Metric | Actual | Ideal/Target | Status |");
  report.push("|--------|--------|-------------|--------|");
  report.push(`| Progress | ${actualProgress}% | ${idealProgress}% | ${actualProgress >= idealProgress ? "🟢 On Track" : "🔴 Behind"} |`);
  report.push(`| Story Points Done | ${doneSP}/${totalSP} | ${Math.round(totalSP * elapsedDays / totalDays)} | ${doneSP >= totalSP * elapsedDays / totalDays ? "✅" : "⚠️"} |`);
  report.push(`| MVP Completion | ${mvpProgress.completionPercent}% | ${idealProgress}% | ${mvpProgress.completionPercent >= idealProgress ? "✅" : "⚠️"} |`);
  report.push(`| Blocked Tasks | ${blockedTasks.length} | 0 | ${blockedTasks.length === 0 ? "✅" : "🚫"} |`);
  report.push(`| Avg Velocity | ${avgVelocity.toFixed(1)} SP/day | ${spPerDay.toFixed(1)} SP/day | ${avgVelocity >= spPerDay ? "✅" : "⚠️"} |`);
  report.push(`| Projected Completion | ${projectedEndDate} | ${active.endDate.slice(0, 10)} | ${projectedEndDate <= active.endDate.slice(0, 10) ? "✅" : "🔴"} |`);
  report.push("");

  report.push("## Goals");
  for (const goal of active.goals) {
    report.push(`- [ ] ${goal}`);
  }
  report.push("");

  report.push("## Burndown Data");
  report.push("");
  report.push("| Day | Date | Ideal Remaining | Actual Remaining | Delta | Status |");
  report.push("|-----|------|----------------|-----------------|-------|--------|");

  let cumulativeDone = 0;
  for (let d = 0; d <= totalDays; d++) {
    const date = new Date(sprintStart.getTime() + d * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().slice(0, 10);
    const ideal = Math.max(0, totalSP - spPerDay * d);
    cumulativeDone += (d <= elapsedDays) ? (doneTasksByDay.get(d) || 0) : 0;
    const actual = d <= elapsedDays ? Math.max(0, totalSP - cumulativeDone) : null;
    const delta = actual !== null ? (actual - ideal).toFixed(1) : "-";
    const isFuture = d > elapsedDays;

    let status: string;
    if (isFuture) {
      status = "📅";
    } else if (actual !== null && actual <= ideal) {
      status = "🟢";
    } else {
      status = "🔴";
    }

    if (d % 2 === 0 || d === elapsedDays || d === totalDays || d === 0) {
      report.push(`| ${d + 1} | ${dateStr} | ${ideal.toFixed(1)} | ${actual !== null ? actual.toFixed(1) : "-"} | ${delta} | ${status} |`);
    }
  }
  report.push("");

  report.push("## ASCII Burndown Chart");
  report.push("");
  const chartWidth = 60;
  const chartHeight = 18;
  const grid: string[][] = [];
  for (let y = 0; y < chartHeight; y++) {
    grid.push(new Array(chartWidth).fill(" "));
  }

  for (let x = 0; x < chartWidth; x++) {
    const idealY = Math.round((1 - x / chartWidth) * (chartHeight - 1));
    if (idealY >= 0 && idealY < chartHeight) {
      grid[idealY][x] = "·";
    }
  }

  let cumDoneChart = 0;
  for (let d = 0; d <= elapsedDays; d++) {
    cumDoneChart += doneTasksByDay.get(d) || 0;
    const x = Math.round((d / totalDays) * (chartWidth - 1));
    const actualRatio = 1 - (cumDoneChart / totalSP);
    const y = Math.round(actualRatio * (chartHeight - 1));
    if (x >= 0 && x < chartWidth && y >= 0 && y < chartHeight) {
      grid[y][x] = "█";
    }
  }

  if (avgVelocity > 0 && projectedCompletion < Infinity) {
    for (let d = elapsedDays + 1; d <= Math.min(totalDays, elapsedDays + projectedCompletion); d++) {
      const x = Math.round((d / totalDays) * (chartWidth - 1));
      const projectedSP = doneSP + avgVelocity * (d - elapsedDays);
      const projectedRatio = 1 - Math.min(1, projectedSP / totalSP);
      const y = Math.round(projectedRatio * (chartHeight - 1));
      if (x >= 0 && x < chartWidth && y >= 0 && y < chartHeight) {
        grid[y][x] = "░";
      }
    }
  }

  report.push("```");
  const spLabel = `${totalSP}`;
  report.push(`${spLabel.padStart(4)}SP ┤`);
  for (let y = 0; y < chartHeight; y++) {
    const label = y === 0 ? `${totalSP}SP` : y === chartHeight - 1 ? "   0" : "     ";
    report.push(`${label} │${grid[y].join("")}`);
  }
  report.push(`      └${"─".repeat(chartWidth)}`);
  report.push(`       Day1${" ".repeat(chartWidth - 12)}Day${totalDays}`);
  report.push("");
  report.push("Legend: · Ideal  █ Actual  ░ Projected");
  report.push("```");
  report.push("");

  report.push("## Task Board");
  report.push("");

  if (blockedTasks.length > 0) {
    report.push("### 🚫 Blocked");
    report.push("");
    report.push("| ID | Title | Priority | SP | Assignee | Dependencies |");
    report.push("|----|-------|----------|-----|----------|-------------|");
    for (const t of blockedTasks) {
      report.push(`| ${t.id} | ${t.title.slice(0, 45)} | ${t.priority} | ${t.storyPoints} | ${t.assignee} | ${t.dependencies.join(", ") || "none"} |`);
    }
    report.push("");
  }

  if (inProgressTasks.length > 0) {
    report.push("### 🔄 In Progress");
    report.push("");
    report.push("| ID | Title | Priority | SP | MVP | Assignee |");
    report.push("|----|-------|----------|-----|-----|----------|");
    for (const t of inProgressTasks) {
      report.push(`| ${t.id} | ${t.title.slice(0, 45)} | ${t.priority} | ${t.storyPoints} | ${t.mvp ? "✓" : ""} | ${t.assignee} |`);
    }
    report.push("");
  }

  report.push("### ✅ Completed");
  report.push("");
  if (doneTasks.length > 0) {
    report.push("| ID | Title | Priority | SP | MVP | Assignee | Completed |");
    report.push("|----|-------|----------|-----|-----|----------|-----------|");
    for (const t of doneTasks) {
      const completedDate = t.completedAt ? t.completedAt.slice(0, 10) : "-";
      report.push(`| ${t.id} | ${t.title.slice(0, 40)} | ${t.priority} | ${t.storyPoints} | ${t.mvp ? "✓" : ""} | ${t.assignee} | ${completedDate} |`);
    }
  } else {
    report.push("_No completed tasks yet._");
  }
  report.push("");

  if (todoTasks.length > 0) {
    report.push("### ⬜ Todo (Up Next)");
    report.push("");
    report.push("| ID | Title | Priority | SP | MVP | Assignee |");
    report.push("|----|-------|----------|-----|-----|----------|");
    const sortedTodo = [...todoTasks].sort((a, b) => {
      const pOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
      return (pOrder[a.priority] || 99) - (pOrder[b.priority] || 99);
    });
    for (const t of sortedTodo) {
      report.push(`| ${t.id} | ${t.title.slice(0, 45)} | ${t.priority} | ${t.storyPoints} | ${t.mvp ? "✓" : ""} | ${t.assignee} |`);
    }
    report.push("");
  }

  report.push("## Task Status Distribution");
  report.push("");
  const statusCounts: Record<string, { count: number; sp: number }> = {};
  for (const t of active.tasks) {
    if (!statusCounts[t.status]) statusCounts[t.status] = { count: 0, sp: 0 };
    statusCounts[t.status].count++;
    statusCounts[t.status].sp += t.storyPoints;
  }
  report.push("| Status | Count | Story Points | % of Total |");
  report.push("|--------|-------|-------------|-----------|");
  for (const [status, data] of Object.entries(statusCounts)) {
    const pct = active.tasks.length > 0 ? Math.round((data.count / active.tasks.length) * 100) : 0;
    report.push(`| ${statusEmoji(status)} ${status} | ${data.count} | ${data.sp} | ${pct}% |`);
  }
  report.push("");

  if (active.mvp) {
    report.push("## MVP Progress");
    report.push("");
    report.push(`**${active.mvp.name}**: ${mvpProgress.completionPercent}% (${mvpProgress.completedTasks}/${mvpProgress.totalTasks} tasks)`);
    report.push("");
    if (mvpProgress.remainingTasks.length > 0) {
      report.push("### Remaining MVP Tasks");
      report.push("");
      for (const t of mvpProgress.remainingTasks) {
        report.push(`- ${statusEmoji(t.status)} ${t.priority} **${t.title}** (${t.storyPoints}SP) — ${t.assignee}`);
      }
      report.push("");
    }
  }

  if (active.feedback.length > 0) {
    report.push("## Recent Feedback");
    report.push("");
    const recentFB = active.feedback.filter((f) => {
      const fbDate = new Date(f.timestamp);
      return (now.getTime() - fbDate.getTime()) < 14 * 24 * 60 * 60 * 1000;
    });
    for (const fb of recentFB) {
      const icon = fb.sentiment === "positive" ? "😊" : fb.sentiment === "negative" ? "😞" : "😐";
      report.push(`- ${icon} [${fb.category}] ${fb.content} ${fb.resolved ? "(resolved)" : ""}`);
    }
    report.push("");
  }

  report.push("## Velocity & Forecasting");
  report.push("");
  report.push("| Metric | Value |");
  report.push("|--------|-------|");
  report.push(`| Total Story Points | ${totalSP} |`);
  report.push(`| Completed SP | ${doneSP} |`);
  report.push(`| In Progress SP | ${inProgressSP} |`);
  report.push(`| Remaining SP | ${totalSP - doneSP} |`);
  report.push(`| Average Velocity | ${avgVelocity.toFixed(1)} SP/day |`);
  report.push(`| Required Velocity | ${((totalSP - doneSP) / Math.max(remainingDays, 1)).toFixed(1)} SP/day |`);
  report.push(`| Projected End Date | ${projectedEndDate} |`);
  report.push(`| On-Time Risk | ${projectedEndDate <= active.endDate.slice(0, 10) ? "🟢 Low" : "🔴 High"} |`);
  report.push("");

  report.push("---");
  report.push(`*Generated: ${now.toISOString()} by sprint-burndown.ts*`);

  const reportDir = path.join(PROJECT_ROOT, "docs", "iterations");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `sprint-${active.number}-report.md`);
  fs.writeFileSync(reportPath, report.join("\n"));
  console.log(report.join("\n"));
  console.log(`\nSprint report saved: ${reportPath}`);
}

generateSprintReport();
