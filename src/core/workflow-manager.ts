import * as fs from "fs";
import * as path from "path";

export interface Workflow {
  name: string;
  description: string;
  prompt: string;
  category: string;
}

const BUILTIN_WORKFLOWS: Workflow[] = [
  {
    name: "create-api",
    description: "Create a new REST API endpoint",
    category: "web",
    prompt: `Create a new REST API endpoint with the following specifications:
- Framework: Express (Node.js)
- Include input validation
- Include error handling middleware
- Include TypeScript types
- Add appropriate HTTP status codes
- Include basic tests`,
  },
  {
    name: "fix-bug",
    description: "Debug and fix a bug",
    category: "debug",
    prompt: `Help me debug an issue:
1. First, understand the problem by reading relevant files
2. Identify the root cause
3. Propose a fix
4. Implement the fix
5. Verify with tests
6. Explain what was wrong and how you fixed it`,
  },
  {
    name: "refactor",
    description: "Refactor code for better quality",
    category: "quality",
    prompt: `Refactor the specified code with these goals:
1. Improve readability and maintainability
2. Reduce complexity
3. Apply SOLID principles where appropriate
4. Add proper TypeScript types
5. Ensure existing tests pass
6. Do NOT change public API behavior`,
  },
  {
    name: "add-tests",
    description: "Add comprehensive tests",
    category: "quality",
    prompt: `Add comprehensive tests for the specified module:
1. Unit tests for all public functions
2. Edge case coverage
3. Error path testing
4. Mock external dependencies
5. Aim for >80% code coverage
6. Use the existing test framework`,
  },
  {
    name: "init-project",
    description: "Initialize a new project",
    category: "setup",
    prompt: `Initialize a new project with:
1. Package.json with proper dependencies
2. TypeScript configuration
3. Linting setup
4. Git initialization
5. Project structure (src/, test/, etc.)
6. README with setup instructions`,
  },
  {
    name: "code-review",
    description: "Perform a code review",
    category: "quality",
    prompt: `Perform a thorough code review:
1. Check for bugs and edge cases
2. Review error handling
3. Assess code organization
4. Check naming conventions
5. Look for performance issues
6. Verify TypeScript types are correct
7. Provide actionable feedback`,
  },
];

export class WorkflowManager {
  private workflows: Map<string, Workflow> = new Map();
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.loadBuiltins();
    this.loadProjectWorkflows();
  }

  private loadBuiltins(): void {
    for (const wf of BUILTIN_WORKFLOWS) {
      this.workflows.set(wf.name, wf);
    }
  }

  private loadProjectWorkflows(): void {
    const workflowsDir = path.join(this.projectPath, ".agent_1", "workflows");
    if (!fs.existsSync(workflowsDir)) return;

    try {
      const files = fs.readdirSync(workflowsDir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        const content = fs.readFileSync(path.join(workflowsDir, file), "utf-8");
        const name = file.replace(".md", "");

        const descMatch = content.match(/^#\s+(.+)/m);
        const description = descMatch ? descMatch[1] : name;

        const promptStart = content.indexOf("\n\n");
        const prompt = promptStart >= 0 ? content.slice(promptStart).trim() : content;

        this.workflows.set(name, {
          name,
          description,
          prompt,
          category: "custom",
        });
      }
    } catch {
      // best effort
    }
  }

  getWorkflow(name: string): Workflow | undefined {
    return this.workflows.get(name);
  }

  listWorkflows(category?: string): Workflow[] {
    const all = [...this.workflows.values()];
    if (category) {
      return all.filter((w) => w.category === category);
    }
    return all;
  }

  getCategories(): string[] {
    const cats = new Set<string>();
    for (const wf of this.workflows.values()) {
      cats.add(wf.category);
    }
    return [...cats];
  }

  addCustomWorkflow(name: string, description: string, prompt: string): boolean {
    if (this.workflows.has(name)) return false;

    const workflowsDir = path.join(this.projectPath, ".agent_1", "workflows");
    if (!fs.existsSync(workflowsDir)) {
      fs.mkdirSync(workflowsDir, { recursive: true });
    }

    const content = `# ${description}\n\n${prompt}\n`;
    fs.writeFileSync(path.join(workflowsDir, `${name}.md`), content, "utf-8");

    this.workflows.set(name, {
      name,
      description,
      prompt,
      category: "custom",
    });

    return true;
  }
}