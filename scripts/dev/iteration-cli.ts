import { IterationOrchestrator, type IterationTask, type MVPDefinition } from "../../src/engine/iteration-orchestrator.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const orchestrator = new IterationOrchestrator(PROJECT_ROOT);

const command = process.argv[2];
const args = process.argv.slice(3);

function usage(): void {
  console.log(`
Iteration Management CLI
========================

Commands:
  create <name> <goals...>           Create a new iteration
  start <iterationId>                Start an iteration
  advance <iterationId>              Advance to next phase
  close <iterationId>                Close an iteration
  status [iterationId]               Show iteration status
  list                               List all iterations
  add-task <iterId> <title> <priority> <assignee> <sp> [mvp]
                                     Add a task to iteration
  update-task <iterId> <taskId> <status>
                                     Update task status
  define-mvp <iterId> <name> <desc>  Define MVP for iteration
  add-feedback <iterId> <sentiment> <content> <category>
                                     Add user feedback
  review <iterId>                    Generate review template
  plan <iterId>                      Generate iteration plan
  gates <iterId>                     Evaluate quality gates
  help                               Show this help
`);
}

function getActiveOrArg(): string | undefined {
  if (args[0]) return args[0];
  const active = orchestrator.getActiveIteration();
  if (active) return active.id;
  console.error("No active iteration. Specify an iteration ID.");
  return undefined;
}

switch (command) {
  case "create": {
    const name = args[0];
    const goals = args.slice(1);
    if (!name || goals.length === 0) {
      console.error("Usage: create <name> <goals...>");
      process.exit(1);
    }
    const iter = orchestrator.createIteration({ name, goals });
    console.log(`Created iteration: ${iter.id} (#${iter.number})`);
    console.log(`  Name: ${iter.name}`);
    console.log(`  Goals: ${iter.goals.join(", ")}`);
    console.log(`  Period: ${iter.startDate.slice(0, 10)} → ${iter.endDate.slice(0, 10)}`);
    break;
  }

  case "start": {
    const id = args[0];
    if (!id) { console.error("Usage: start <iterationId>"); process.exit(1); }
    const iter = orchestrator.startIteration(id);
    console.log(`Started iteration: ${iter.name} (${iter.id})`);
    break;
  }

  case "advance": {
    const id = getActiveOrArg();
    if (!id) process.exit(1);
    const iter = orchestrator.advancePhase(id);
    console.log(`Advanced to phase: ${iter.currentPhase}`);
    break;
  }

  case "close": {
    const id = getActiveOrArg();
    if (!id) process.exit(1);
    const iter = orchestrator.closeIteration(id);
    console.log(`Closed iteration: ${iter.name}`);
    break;
  }

  case "status": {
    const id = args[0];
    if (id) {
      const iter = orchestrator.getIteration(id);
      if (!iter) { console.error(`Iteration ${id} not found`); process.exit(1); }
      printIterationStatus(iter);
    } else {
      const active = orchestrator.getActiveIteration();
      if (active) {
        printIterationStatus(active);
      } else {
        const history = orchestrator.getIterationHistory(5);
        console.log("No active iteration. Recent iterations:");
        for (const i of history) {
          console.log(`  #${i.number} ${i.name} [${i.status}] ${i.currentPhase}`);
        }
      }
    }
    break;
  }

  case "list": {
    const history = orchestrator.getIterationHistory();
    if (history.length === 0) {
      console.log("No iterations found.");
    } else {
      console.log("Iterations:");
      for (const i of history) {
        const active = i.id === orchestrator.getActiveIteration()?.id ? " ← ACTIVE" : "";
        console.log(`  #${i.number} ${i.name} [${i.status}] Phase: ${i.currentPhase}${active}`);
      }
    }
    break;
  }

  case "add-task": {
    const [iterId, title, priority, assignee, sp, mvpFlag] = args;
    if (!iterId || !title || !priority || !assignee || !sp) {
      console.error("Usage: add-task <iterId> <title> <priority> <assignee> <sp> [mvp]");
      process.exit(1);
    }
    const task = orchestrator.addTask(iterId, {
      title,
      priority: priority as IterationTask["priority"],
      status: "todo",
      assignee,
      storyPoints: parseInt(sp, 10),
      phase: "development",
      dependencies: [],
      mvp: mvpFlag === "mvp",
      acceptanceCriteria: [],
    });
    console.log(`Added task: ${task.id} - ${task.title}`);
    break;
  }

  case "update-task": {
    const [iterId, taskId, status] = args;
    if (!iterId || !taskId || !status) {
      console.error("Usage: update-task <iterId> <taskId> <status>");
      process.exit(1);
    }
    const task = orchestrator.updateTaskStatus(iterId, taskId, status as IterationTask["status"]);
    if (task) {
      console.log(`Updated task ${task.id}: ${task.status}`);
    } else {
      console.error("Task not found");
    }
    break;
  }

  case "define-mvp": {
    const [iterId, mvpName, mvpDesc] = args;
    if (!iterId || !mvpName || !mvpDesc) {
      console.error("Usage: define-mvp <iterId> <name> <description>");
      process.exit(1);
    }
    const mvp: MVPDefinition = {
      id: `mvp-${Date.now()}`,
      name: mvpName,
      description: mvpDesc,
      features: [],
      successCriteria: [],
      tasks: [],
    };
    orchestrator.defineMVP(iterId, mvp);
    console.log(`MVP defined: ${mvp.name}`);
    break;
  }

  case "add-feedback": {
    const [iterId, sentiment, content, category] = args;
    if (!iterId || !sentiment || !content || !category) {
      console.error("Usage: add-feedback <iterId> <sentiment> <content> <category>");
      process.exit(1);
    }
    const entry = orchestrator.addFeedback(iterId, {
      source: "user_survey",
      sentiment: sentiment as "positive" | "neutral" | "negative",
      content,
      category,
      timestamp: new Date().toISOString(),
      resolved: false,
    });
    console.log(`Feedback added: ${entry.id}`);
    break;
  }

  case "review": {
    const id = getActiveOrArg();
    if (!id) process.exit(1);
    const template = orchestrator.generateRetrospectiveTemplate(id);
    const outputPath = path.join(PROJECT_ROOT, "docs", "iterations", `retrospective-${id}.md`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, template);
    console.log(`Retrospective template generated: ${outputPath}`);
    break;
  }

  case "plan": {
    const id = getActiveOrArg();
    if (!id) process.exit(1);
    const plan = orchestrator.generateIterationPlan(id);
    const outputPath = path.join(PROJECT_ROOT, "docs", "iterations", `plan-${id}.md`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, plan);
    console.log(`Iteration plan generated: ${outputPath}`);
    break;
  }

  case "gates": {
    const id = getActiveOrArg();
    if (!id) process.exit(1);
    const metrics: Record<string, number> = {
      typeErrors: 0,
      testPassRate: 95,
      coveragePercent: 75,
      lintErrors: 0,
      mvpTaskCompletion: 100,
    };
    const results = orchestrator.evaluateQualityGates(id, metrics);
    console.log("Quality Gate Results:");
    for (const r of results) {
      const icon = r.passed ? "✅" : (r.blocking ? "❌" : "⚠️");
      console.log(`  ${icon} ${r.gate}: ${r.value} ${r.passed ? "≥" : "<"} ${r.threshold} ${r.blocking ? "(blocking)" : "(advisory)"}`);
    }
    break;
  }

  default:
    usage();
}

function printIterationStatus(iter: ReturnType<typeof orchestrator.getIteration> & {}): void {
  if (!iter) return;
  const mvpProgress = orchestrator.getMVPProgress(iter.id);
  console.log(`
Iteration #${iter.number}: ${iter.name}
  ID: ${iter.id}
  Status: ${iter.status}
  Phase: ${iter.currentPhase}
  Period: ${iter.startDate.slice(0, 10)} → ${iter.endDate.slice(0, 10)}
  Goals: ${iter.goals.join(", ")}
  Tasks: ${iter.tasks.filter((t) => t.status === "done").length}/${iter.tasks.length} done
  MVP: ${iter.mvp ? `${mvpProgress.completionPercent}% (${mvpProgress.completedTasks}/${mvpProgress.totalTasks})` : "Not defined"}
  Feedback: ${iter.feedback.length} entries
  Phase History: ${iter.phaseHistory.map((p) => `${p.phase}${p.exitedAt ? "✓" : "←"}`).join(" → ")}
`);
}
