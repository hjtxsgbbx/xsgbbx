import { IterationOrchestrator, type IterationRecord, type IterationTask } from "../../src/engine/iteration-orchestrator.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function getOrchestrator(): IterationOrchestrator {
  return new IterationOrchestrator(PROJECT_ROOT);
}

function statusIcon(status: string): string {
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

function priorityBadge(priority: string): string {
  switch (priority) {
    case "P0": return "🔴";
    case "P1": return "🟠";
    case "P2": return "🟡";
    case "P3": return "🟢";
    default: return "⚪";
  }
}

interface StandupHistory {
  date: string;
  actualProgress: number;
  idealProgress: number;
  doneSP: number;
  totalSP: number;
  blockedCount: number;
  mvpPercent: number;
}

function loadStandupHistory(): StandupHistory[] {
  const historyFile = path.join(PROJECT_ROOT, ".github", "standups", "history.json");
  if (!fs.existsSync(historyFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(historyFile, "utf-8"));
  } catch {
    return [];
  }
}

function saveStandupHistory(history: StandupHistory[]): void {
  const historyFile = path.join(PROJECT_ROOT, ".github", "standups", "history.json");
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
}

function generateStandupReport(): void {
  const orch = getOrchestrator();
  const active = orch.getActiveIteration();

  if (!active) {
    console.log("No active iteration found. Create and start one first.");
    return;
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const standupDir = path.join(PROJECT_ROOT, ".github", "standups");
  fs.mkdirSync(standupDir, { recursive: true });

  const allTasks = active.tasks;
  const doneToday = allTasks.filter((t) => {
    if (t.status !== "done" || !t.completedAt) return false;
    return t.completedAt.slice(0, 10) === dateStr;
  });

  const doneYesterday = allTasks.filter((t) => {
    if (t.status !== "done" || !t.completedAt) return false;
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return t.completedAt.slice(0, 10) === yesterday;
  });

  const inProgress = allTasks.filter((t) => t.status === "in_progress");
  const blocked = allTasks.filter((t) => t.status === "blocked");
  const todoTasks = allTasks.filter((t) => t.status === "todo");
  const mvpProgress = orch.getMVPProgress(active.id);

  const totalSP = allTasks.reduce((s, t) => s + t.storyPoints, 0);
  const doneSP = allTasks.filter((t) => t.status === "done").reduce((s, t) => s + t.storyPoints, 0);
  const doneTodaySP = doneToday.reduce((s, t) => s + t.storyPoints, 0);

  const sprintStart = new Date(active.startDate);
  const sprintEnd = new Date(active.endDate);
  const totalDays = Math.ceil((sprintEnd.getTime() - sprintStart.getTime()) / (1000 * 60 * 60 * 24));
  const elapsedDays = Math.ceil((now.getTime() - sprintStart.getTime()) / (1000 * 60 * 60 * 24));
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const idealProgress = Math.min(100, Math.round((elapsedDays / totalDays) * 100));
  const actualProgress = totalSP > 0 ? Math.round((doneSP / totalSP) * 100) : 0;

  const requiredVelocity = remainingDays > 0 ? (totalSP - doneSP) / remainingDays : 0;
  const avgVelocity = elapsedDays > 0 ? doneSP / elapsedDays : 0;

  const history = loadStandupHistory();
  const todayEntry: StandupHistory = {
    date: dateStr,
    actualProgress,
    idealProgress,
    doneSP,
    totalSP,
    blockedCount: blocked.length,
    mvpPercent: mvpProgress.completionPercent,
  };
  const existingIdx = history.findIndex((h) => h.date === dateStr);
  if (existingIdx >= 0) {
    history[existingIdx] = todayEntry;
  } else {
    history.push(todayEntry);
  }
  saveStandupHistory(history);

  const yesterdayEntry = history.length >= 2 ? history[history.length - 2] : null;
  const progressDelta = yesterdayEntry ? actualProgress - yesterdayEntry.actualProgress : 0;
  const spDelta = yesterdayEntry ? doneSP - yesterdayEntry.doneSP : 0;

  const report: string[] = [];
  report.push(`# Daily Standup — ${dateStr}`);
  report.push("");
  report.push(`**Iteration**: #${active.number} ${active.name}`);
  report.push(`**Phase**: ${active.currentPhase}`);
  report.push(`**Day ${elapsedDays}/${totalDays}** | ${remainingDays} days remaining`);
  report.push("");

  report.push("## Sprint Health");
  report.push("");
  report.push("| Metric | Value | Target | Status | Trend |");
  report.push("|--------|-------|--------|--------|-------|");
  report.push(`| Progress | ${actualProgress}% | ${idealProgress}% | ${actualProgress >= idealProgress ? "🟢 On Track" : "🔴 Behind"} | ${progressDelta >= 0 ? "📈" : "📉"} ${progressDelta > 0 ? "+" : ""}${progressDelta}% |`);
  report.push(`| Story Points | ${doneSP}/${totalSP} | ${totalSP} | ${doneSP >= totalSP * (elapsedDays / totalDays) ? "✅" : "⚠️"} | ${spDelta >= 0 ? "📈" : "📉"} ${spDelta > 0 ? "+" : ""}${spDelta}SP today |`);
  report.push(`| MVP Progress | ${mvpProgress.completionPercent}% | 100% | ${mvpProgress.completionPercent >= idealProgress ? "✅" : "⚠️"} | — |`);
  report.push(`| Blocked Tasks | ${blocked.length} | 0 | ${blocked.length === 0 ? "✅" : "🚫"} | — |`);
  report.push(`| Velocity | ${avgVelocity.toFixed(1)} SP/day | ${requiredVelocity.toFixed(1)} SP/day needed | ${avgVelocity >= requiredVelocity ? "✅" : "⚠️"} | — |`);
  report.push("");

  if (history.length > 1) {
    report.push("## Progress Trend (Last 7 Days)");
    report.push("");
    const recentHistory = history.slice(-7);
    const trendWidth = 40;
    const trendHeight = 8;
    const trendGrid: string[][] = [];
    for (let y = 0; y < trendHeight; y++) {
      trendGrid.push(new Array(trendWidth).fill(" "));
    }

    for (let i = 0; i < recentHistory.length; i++) {
      const x = Math.round((i / Math.max(recentHistory.length - 1, 1)) * (trendWidth - 1));
      const idealY = Math.round((1 - recentHistory[i].idealProgress / 100) * (trendHeight - 1));
      const actualY = Math.round((1 - recentHistory[i].actualProgress / 100) * (trendHeight - 1));
      if (idealY >= 0 && idealY < trendHeight) trendGrid[idealY][x] = "·";
      if (actualY >= 0 && actualY < trendHeight) trendGrid[actualY][x] = "█";
    }

    report.push("```");
    report.push("100% ┤");
    for (let y = 0; y < trendHeight; y++) {
      const label = y === 0 ? "100%" : y === trendHeight - 1 ? "  0%" : "     ";
      report.push(`${label} │${trendGrid[y].join("")}`);
    }
    report.push(`     └${"─".repeat(trendWidth)}`);
    const firstDate = recentHistory[0]?.date.slice(5) || "";
    const lastDate = recentHistory[recentHistory.length - 1]?.date.slice(5) || "";
    report.push(`      ${firstDate}${" ".repeat(trendWidth - 12)}${lastDate}`);
    report.push("Legend: · Ideal  █ Actual");
    report.push("```");
    report.push("");
  }

  if (doneToday.length > 0) {
    report.push("## ✅ Completed Today");
    report.push("");
    for (const t of doneToday) {
      report.push(`- ${statusIcon(t.status)} ${priorityBadge(t.priority)} **${t.title}** (${t.storyPoints}SP) — ${t.assignee}`);
    }
    report.push(`**Total: ${doneTodaySP}SP completed today**`);
    report.push("");
  }

  if (doneYesterday.length > 0 && doneToday.length === 0) {
    report.push("## ✅ Completed Yesterday");
    report.push("");
    for (const t of doneYesterday) {
      report.push(`- ${statusIcon(t.status)} ${priorityBadge(t.priority)} **${t.title}** (${t.storyPoints}SP) — ${t.assignee}`);
    }
    report.push("");
  }

  if (inProgress.length > 0) {
    report.push("## 🔄 In Progress");
    report.push("");
    for (const t of inProgress) {
      report.push(`- ${statusIcon(t.status)} ${priorityBadge(t.priority)} **${t.title}** (${t.storyPoints}SP) — ${t.assignee}`);
    }
    report.push("");
  }

  if (blocked.length > 0) {
    report.push("## 🚫 Blockers");
    report.push("");
    for (const t of blocked) {
      report.push(`- **${t.title}** — ${t.assignee} — Dependencies: ${t.dependencies.join(", ") || "none"}`);
      if (t.acceptanceCriteria.length > 0) {
        report.push(`  - Acceptance: ${t.acceptanceCriteria[0]}`);
      }
    }
    report.push("");
    report.push("**Action Required**: Resolve blockers before end of day to maintain sprint velocity.");
    report.push("");
  }

  report.push("## 📋 Up Next (Todo)");
  report.push("");
  const nextUp = todoTasks
    .sort((a, b) => {
      const pOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
      return (pOrder[a.priority] || 99) - (pOrder[b.priority] || 99);
    })
    .slice(0, 5);
  for (const t of nextUp) {
    report.push(`- ${statusIcon(t.status)} ${priorityBadge(t.priority)} ${t.title} (${t.storyPoints}SP) — ${t.assignee}${t.mvp ? " [MVP]" : ""}`);
  }
  if (todoTasks.length > 5) {
    report.push(`- ... and ${todoTasks.length - 5} more`);
  }
  report.push("");

  const recentFeedback = active.feedback.filter((f) => {
    const fbDate = new Date(f.timestamp);
    return (now.getTime() - fbDate.getTime()) < 7 * 24 * 60 * 60 * 1000;
  });
  if (recentFeedback.length > 0) {
    report.push("## Recent Feedback (7 days)");
    report.push("");
    for (const fb of recentFeedback) {
      const sentimentIcon = fb.sentiment === "positive" ? "😊" : fb.sentiment === "negative" ? "😞" : "😐";
      report.push(`- ${sentimentIcon} [${fb.category}] ${fb.content}`);
    }
    report.push("");
  }

  report.push("## Daily Checklist");
  report.push("");
  report.push(`- [ ] Check CI pipeline status (iteration: ${active.id.slice(0, 12)}...)`);
  report.push("- [ ] Review open PRs and code reviews");
  report.push(`- [ ] Update task statuses (${inProgress.length} in progress, ${todoTasks.length} todo)`);
  if (blocked.length > 0) {
    report.push(`- [ ] **Address ${blocked.length} blocker(s)** — priority!`);
  } else {
    report.push("- [ ] Address any blockers (none currently)");
  }
  report.push("- [ ] Note user feedback");
  report.push(`- [ ] Verify velocity on track: ${avgVelocity.toFixed(1)}/${requiredVelocity.toFixed(1)} SP/day`);
  report.push("");

  if (actualProgress < idealProgress) {
    const deficit = idealProgress - actualProgress;
    const additionalSPNeeded = Math.round(totalSP * deficit / 100);
    report.push("## ⚠️ Sprint Risk Alert");
    report.push("");
    report.push(`Sprint is **${deficit}% behind** ideal progress.`);
    report.push(`Need approximately **${additionalSPNeeded} additional SP** to catch up.`);
    report.push(`Recommended: Increase daily velocity to **${requiredVelocity.toFixed(1)} SP/day**.`);
    report.push("");
  }

  report.push("---");
  report.push(`*Generated: ${now.toISOString()} | Iteration: ${active.id}*`);

  const reportPath = path.join(standupDir, `${dateStr}.md`);
  fs.writeFileSync(reportPath, report.join("\n"));
  console.log(report.join("\n"));
  console.log(`\nStandup report saved: ${reportPath}`);

  const notificationFile = path.join(standupDir, "latest-notification.json");
  const notification = {
    date: dateStr,
    iterationId: active.id,
    iterationName: active.name,
    phase: active.currentPhase,
    progress: actualProgress,
    idealProgress,
    onTrack: actualProgress >= idealProgress,
    blockedCount: blocked.length,
    doneTodaySP,
    requiredVelocity: requiredVelocity.toFixed(1),
    avgVelocity: avgVelocity.toFixed(1),
    riskLevel: actualProgress >= idealProgress ? "low" : actualProgress >= idealProgress - 15 ? "medium" : "high",
    generatedAt: now.toISOString(),
  };
  fs.writeFileSync(notificationFile, JSON.stringify(notification, null, 2));
  console.log(`Notification data saved: ${notificationFile}`);
}

function generateBurndown(): void {
  const orch = getOrchestrator();
  const active = orch.getActiveIteration();

  if (!active) {
    console.log("No active iteration found.");
    return;
  }

  const sprintStart = new Date(active.startDate);
  const sprintEnd = new Date(active.endDate);
  const now = new Date();
  const totalDays = Math.ceil((sprintEnd.getTime() - sprintStart.getTime()) / (1000 * 60 * 60 * 24));
  const totalSP = active.tasks.reduce((s, t) => s + t.storyPoints, 0);
  const doneSP = active.tasks.filter((t) => t.status === "done").reduce((s, t) => s + t.storyPoints, 0);
  const spPerDay = totalSP / totalDays;

  const report: string[] = [];
  report.push(`# Burndown Chart — Iteration #${active.number}: ${active.name}`);
  report.push("");
  report.push(`**Total Story Points**: ${totalSP}`);
  report.push(`**Completed**: ${doneSP} SP (${totalSP > 0 ? Math.round((doneSP / totalSP) * 100) : 0}%)`);
  report.push(`**Remaining**: ${totalSP - doneSP} SP`);
  report.push("");

  report.push("## Burndown Data");
  report.push("");
  report.push("| Day | Date | Ideal | Actual | Delta | Status |");
  report.push("|-----|------|-------|--------|-------|--------|");

  const elapsedDays = Math.min(totalDays, Math.ceil((now.getTime() - sprintStart.getTime()) / (1000 * 60 * 60 * 24)));

  const doneTasksByDay = new Map<number, number>();
  for (const task of active.tasks) {
    if (task.status === "done" && task.completedAt) {
      const dayIdx = Math.floor((new Date(task.completedAt).getTime() - sprintStart.getTime()) / (1000 * 60 * 60 * 24));
      doneTasksByDay.set(dayIdx, (doneTasksByDay.get(dayIdx) || 0) + task.storyPoints);
    }
  }

  let cumulativeDone = 0;
  for (let d = 0; d <= totalDays; d++) {
    const date = new Date(sprintStart.getTime() + d * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().slice(0, 10);
    const ideal = Math.max(0, totalSP - spPerDay * d);
    if (d <= elapsedDays) {
      cumulativeDone += doneTasksByDay.get(d) || 0;
    }
    const actual = d <= elapsedDays ? Math.max(0, totalSP - cumulativeDone) : null;
    const delta = actual !== null ? (actual - ideal).toFixed(1) : "-";
    const isAhead = actual !== null && actual <= ideal;
    const status = d > elapsedDays ? "📅" : isAhead ? "🟢" : "🔴";

    if (d % 2 === 0 || d === elapsedDays || d === totalDays) {
      report.push(`| ${d + 1} | ${dateStr} | ${ideal.toFixed(1)} | ${actual !== null ? actual.toFixed(1) : "-"} | ${delta} | ${status} |`);
    }
  }
  report.push("");

  const chartWidth = 50;
  const chartHeight = 15;
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

  for (let d = 0; d <= elapsedDays; d++) {
    const x = Math.round((d / totalDays) * (chartWidth - 1));
    const cumulativeDoneD = [...doneTasksByDay.entries()]
      .filter(([day]) => day <= d)
      .reduce((sum, [, sp]) => sum + sp, 0);
    const actualRatio = 1 - (cumulativeDoneD / totalSP);
    const y = Math.round(actualRatio * (chartHeight - 1));
    if (x >= 0 && x < chartWidth && y >= 0 && y < chartHeight) {
      grid[y][x] = "█";
    }
  }

  report.push("## ASCII Burndown Chart");
  report.push("");
  report.push("```");
  report.push(`${totalSP}SP ┤`);
  for (let y = 0; y < chartHeight; y++) {
    const label = y === 0 ? `${totalSP}SP` : y === chartHeight - 1 ? "   0" : "     ";
    report.push(`${label} │${grid[y].join("")}`);
  }
  report.push(`      └${"─".repeat(chartWidth)}`);
  report.push(`       Day1${" ".repeat(chartWidth - 10)}Day${totalDays}`);
  report.push("```");
  report.push("");

  report.push("## Task Status Distribution");
  report.push("");
  const statusCounts: Record<string, number> = {};
  for (const t of active.tasks) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  }
  report.push("| Status | Count | Story Points |");
  report.push("|--------|-------|-------------|");
  for (const [status, count] of Object.entries(statusCounts)) {
    const sp = active.tasks.filter((t) => t.status === status).reduce((s, t) => s + t.storyPoints, 0);
    report.push(`| ${statusIcon(status)} ${status} | ${count} | ${sp} |`);
  }
  report.push("");

  const burndownDir = path.join(PROJECT_ROOT, "docs", "iterations");
  fs.mkdirSync(burndownDir, { recursive: true });
  const burndownPath = path.join(burndownDir, `burndown-${active.id}.md`);
  fs.writeFileSync(burndownPath, report.join("\n"));
  console.log(report.join("\n"));
  console.log(`\nBurndown report saved: ${burndownPath}`);
}

function generateIterationPlan(): void {
  const orch = getOrchestrator();
  const active = orch.getActiveIteration();

  if (!active) {
    console.log("No active iteration found.");
    return;
  }

  const plan = orch.generateIterationPlan(active.id);
  const planDir = path.join(PROJECT_ROOT, "docs", "iterations");
  fs.mkdirSync(planDir, { recursive: true });
  const planPath = path.join(planDir, `plan-${active.id}.md`);
  fs.writeFileSync(planPath, plan);
  console.log(plan);
  console.log(`\nIteration plan saved: ${planPath}`);
}

const cmd = process.argv[2];
switch (cmd) {
  case "standup":
    generateStandupReport();
    break;
  case "burndown":
    generateBurndown();
    break;
  case "plan":
    generateIterationPlan();
    break;
  default:
    console.log(`
Iteration Reporting CLI
======================

Commands:
  standup     Generate daily standup report with trend analysis
  burndown    Generate sprint burndown chart
  plan        Generate iteration plan document
`);
}
