import { IterationOrchestrator, type MVPDefinition } from "../../src/engine/iteration-orchestrator.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function initializeSprint1(): void {
  const orch = new IterationOrchestrator(PROJECT_ROOT);

  const existing = orch.getActiveIteration();
  if (existing) {
    console.log(`Active iteration already exists: #${existing.number} ${existing.name}`);
    console.log(`  ID: ${existing.id}`);
    console.log(`  Phase: ${existing.currentPhase}`);
    console.log(`  Tasks: ${existing.tasks.filter((t) => t.status === "done").length}/${existing.tasks.length} done`);
    return;
  }

  const history = orch.getIterationHistory();
  const sprint1 = history.find((i) => i.number === 1 && i.name === "Core Engine Stabilization");
  if (sprint1 && sprint1.status === "active") {
    console.log(`Sprint 1 already exists and is active: ${sprint1.id}`);
    return;
  }

  console.log("Initializing Sprint 1: Core Engine Stabilization & Iteration Framework");
  console.log("");

  const iter = orch.createIteration({
    name: "Core Engine Stabilization",
    goals: [
      "Stabilize core engine with zero TypeScript compilation errors",
      "Establish structured iteration management framework (IterationOrchestrator)",
      "Implement CI/CD iteration gates for automated quality enforcement",
      "Reduce ESLint warnings to below 50",
      "Achieve 70%+ test coverage on core modules",
    ],
    startDate: "2026-05-17T00:00:00.000Z",
  });

  console.log(`Created iteration: ${iter.id} (#${iter.number})`);

  const mvp: MVPDefinition = {
    id: "mvp-sprint-1",
    name: "Stable Core with Iteration Framework",
    description: "A fully compilable, linted core engine with structured iteration management, enabling repeatable 2-week development cycles with quality gates.",
    features: [
      "IterationOrchestrator: Create, start, advance, close iterations with phase state machine",
      "MVP tracking: Define MVP scope, track completion percentage",
      "Feedback collection: Multi-channel feedback with sentiment analysis",
      "Quality gates: Configurable quality thresholds with blocking/advisory modes",
      "Iteration review: Automated retrospective template generation",
      "CI/CD integration: Iteration gate workflow for PR quality enforcement",
    ],
    successCriteria: [
      "TypeScript compilation: 0 errors",
      "ESLint warnings: < 50",
      "Test pass rate: >= 95%",
      "Code coverage: >= 70% lines",
      "IterationOrchestrator fully functional with CLI",
      "CI/CD iteration gate workflow active",
    ],
    tasks: [
      "TASK-1-001", "TASK-1-002", "TASK-1-003", "TASK-1-004", "TASK-1-005",
      "TASK-1-006", "TASK-1-007", "TASK-1-008", "TASK-1-009", "TASK-1-010",
      "TASK-1-011", "TASK-1-012", "TASK-1-014", "TASK-1-015", "TASK-1-016",
    ],
  };
  orch.defineMVP(iter.id, mvp);
  console.log("MVP defined: Stable Core with Iteration Framework");

  const tasks: Array<{
    title: string;
    priority: "P0" | "P1" | "P2" | "P3";
    status: "done" | "in_progress" | "todo" | "blocked";
    sp: number;
    phase: "requirements" | "design" | "development" | "integration_test" | "feedback" | "review";
    mvp: boolean;
    completedAt?: string;
  }> = [
    { title: "Define iteration cycle structure and phases", priority: "P0", status: "done", sp: 3, phase: "requirements", mvp: true, completedAt: "2026-05-17T10:00:00.000Z" },
    { title: "Define MVP criteria for first iteration", priority: "P0", status: "done", sp: 2, phase: "requirements", mvp: true, completedAt: "2026-05-17T14:00:00.000Z" },
    { title: "Design IterationOrchestrator class hierarchy", priority: "P0", status: "done", sp: 5, phase: "design", mvp: true, completedAt: "2026-05-18T16:00:00.000Z" },
    { title: "Design quality gate evaluation system", priority: "P1", status: "done", sp: 3, phase: "design", mvp: true, completedAt: "2026-05-19T10:00:00.000Z" },
    { title: "Design feedback collection interfaces", priority: "P1", status: "done", sp: 2, phase: "design", mvp: true, completedAt: "2026-05-19T14:00:00.000Z" },
    { title: "Implement IterationOrchestrator with phase state machine", priority: "P0", status: "done", sp: 8, phase: "development", mvp: true, completedAt: "2026-05-20T18:00:00.000Z" },
    { title: "Implement MVP tracking and progress reporting", priority: "P0", status: "done", sp: 5, phase: "development", mvp: true, completedAt: "2026-05-21T16:00:00.000Z" },
    { title: "Implement feedback collection system", priority: "P1", status: "done", sp: 3, phase: "development", mvp: true, completedAt: "2026-05-22T12:00:00.000Z" },
    { title: "Implement quality gate evaluation", priority: "P0", status: "done", sp: 5, phase: "development", mvp: true, completedAt: "2026-05-22T18:00:00.000Z" },
    { title: "Implement iteration plan and retrospective generation", priority: "P1", status: "done", sp: 5, phase: "development", mvp: true, completedAt: "2026-05-23T14:00:00.000Z" },
    { title: "Create iteration CLI management script", priority: "P1", status: "done", sp: 3, phase: "development", mvp: true, completedAt: "2026-05-23T18:00:00.000Z" },
    { title: "Fix all TypeScript compilation errors", priority: "P0", status: "done", sp: 3, phase: "development", mvp: true, completedAt: "2026-05-24T10:00:00.000Z" },
    { title: "Reduce ESLint warnings from 178 to <50", priority: "P1", status: "in_progress", sp: 5, phase: "development", mvp: false },
    { title: "Merge overlapping context management modules", priority: "P0", status: "done", sp: 5, phase: "development", mvp: true, completedAt: "2026-05-24T18:00:00.000Z" },
    { title: "Merge overlapping iteration management modules", priority: "P0", status: "done", sp: 3, phase: "development", mvp: true, completedAt: "2026-05-25T10:00:00.000Z" },
    { title: "Standardize interface design (QueryEngine merge)", priority: "P0", status: "done", sp: 3, phase: "development", mvp: true, completedAt: "2026-05-25T16:00:00.000Z" },
    { title: "Enhance semantic cache with LRU eviction", priority: "P2", status: "done", sp: 3, phase: "development", mvp: false, completedAt: "2026-05-25T18:00:00.000Z" },
    { title: "Write unit tests for IterationOrchestrator", priority: "P0", status: "todo", sp: 5, phase: "integration_test", mvp: true },
    { title: "Verify CI/CD pipeline with iteration gate", priority: "P1", status: "todo", sp: 3, phase: "integration_test", mvp: false },
    { title: "End-to-end iteration lifecycle test", priority: "P1", status: "todo", sp: 5, phase: "integration_test", mvp: false },
  ];

  for (const t of tasks) {
    const task = orch.addTask(iter.id, {
      title: t.title,
      priority: t.priority,
      status: "todo",
      assignee: "team",
      storyPoints: t.sp,
      phase: t.phase,
      dependencies: [],
      mvp: t.mvp,
      acceptanceCriteria: [],
    });

    if (t.status === "done" && t.completedAt) {
      orch.updateTaskStatus(iter.id, task.id, "in_progress");
      orch.updateTaskStatus(iter.id, task.id, "done");
      const taskRef = orch.getIteration(iter.id)?.tasks.find((tt) => tt.id === task.id);
      if (taskRef) {
        taskRef.startedAt = new Date(new Date(t.completedAt).getTime() - 24 * 60 * 60 * 1000).toISOString();
        taskRef.completedAt = t.completedAt;
      }
    } else if (t.status === "in_progress") {
      orch.updateTaskStatus(iter.id, task.id, "in_progress");
    }
  }
  console.log(`Added ${tasks.length} tasks`);

  orch.startIteration(iter.id);
  console.log("Iteration started");

  orch.advancePhase(iter.id);
  orch.advancePhase(iter.id);
  console.log("Advanced to: development phase");

  const feedbacks = [
    { source: "user_survey" as const, sentiment: "positive" as const, content: "Iteration CLI is very intuitive and easy to use", category: "UX" },
    { source: "bug_report" as const, sentiment: "negative" as const, content: "Burndown chart shows incorrect data when tasks are cancelled", category: "Bug" },
    { source: "feature_request" as const, sentiment: "neutral" as const, content: "Would be nice to have Slack integration for standup reports", category: "Feature" },
  ];

  for (const fb of feedbacks) {
    orch.addFeedback(iter.id, {
      ...fb,
      timestamp: new Date().toISOString(),
      resolved: fb.sentiment !== "negative",
    });
  }
  console.log(`Added ${feedbacks.length} feedback entries`);

  const finalIter = orch.getIteration(iter.id)!;
  const mvpProgress = orch.getMVPProgress(iter.id);
  const totalSP = finalIter.tasks.reduce((s, t) => s + t.storyPoints, 0);
  const doneSP = finalIter.tasks.filter((t) => t.status === "done").reduce((s, t) => s + t.storyPoints, 0);

  console.log("");
  console.log("=== Sprint 1 Initialized ===");
  console.log(`  ID: ${finalIter.id}`);
  console.log(`  Phase: ${finalIter.currentPhase}`);
  console.log(`  Period: ${finalIter.startDate.slice(0, 10)} → ${finalIter.endDate.slice(0, 10)}`);
  console.log(`  Tasks: ${finalIter.tasks.filter((t) => t.status === "done").length}/${finalIter.tasks.length} done`);
  console.log(`  Story Points: ${doneSP}/${totalSP} (${Math.round((doneSP / totalSP) * 100)}%)`);
  console.log(`  MVP Progress: ${mvpProgress.completionPercent}%`);
  console.log(`  Feedback: ${finalIter.feedback.length} entries`);
  console.log("");

  const planDir = path.join(PROJECT_ROOT, "docs", "iterations");
  fs.mkdirSync(planDir, { recursive: true });
  const plan = orch.generateIterationPlan(iter.id);
  const planPath = path.join(planDir, `plan-${iter.id}.md`);
  fs.writeFileSync(planPath, plan);
  console.log(`Iteration plan saved: ${planPath}`);
}

initializeSprint1();
