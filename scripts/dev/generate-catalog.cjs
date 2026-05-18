const fs = require("fs");
const path = require("path");

const CATEGORY_MAP = {
  ".ts": { fileType: "source_code", category: "typescript" },
  ".tsx": { fileType: "source_code", category: "typescript_react" },
  ".js": { fileType: "source_code", category: "javascript" },
  ".jsx": { fileType: "source_code", category: "javascript_react" },
  ".json": { fileType: "configuration", category: "json_config" },
  ".css": { fileType: "static_asset", category: "stylesheet" },
  ".html": { fileType: "static_asset", category: "markup" },
  ".md": { fileType: "documentation", category: "markdown" },
  ".yml": { fileType: "configuration", category: "yaml_config" },
  ".yaml": { fileType: "configuration", category: "yaml_config" },
  ".cjs": { fileType: "configuration", category: "commonjs_config" },
  ".mjs": { fileType: "source_code", category: "esm_javascript" },
  ".sh": { fileType: "script", category: "shell_script" },
  ".ps1": { fileType: "script", category: "powershell_script" },
};

const MODULE_PURPOSES = {
  "src/engine/": { purpose: "Core engine layer", description: "Agent orchestration, task planning, query execution, iteration management, and autonomous development control" },
  "src/intelligence/": { purpose: "NLP and intelligence layer", description: "Natural language instruction parsing, semantic understanding, context awareness, knowledge management, and user preference learning" },
  "src/tools/": { purpose: "Tool system layer", description: "File operations, diff editing, agent tool execution, and tool result management" },
  "src/permissions/": { purpose: "Permission and access control", description: "RBAC management, AI guard, approval workflow, and permission pipeline" },
  "src/security/": { purpose: "Security layer", description: "Certificate pinning, path guarding, sandboxing, and security hooks" },
  "src/resilience/": { purpose: "Resilience and error handling", description: "Circuit breaker, error healing, intelligent recovery, error pattern storage, and global error handler" },
  "src/observability/": { purpose: "Observability layer", description: "Metrics collection, cost tracking, performance monitoring, OpenTelemetry tracing, semantic caching, and session replay" },
  "src/storage/": { purpose: "Storage and persistence", description: "Audit logging, configuration store, and session management" },
  "src/api/": { purpose: "API provider abstraction", description: "Anthropic, OpenAI, and compatible provider implementations with registry and system prompts" },
  "src/planning/": { purpose: "Planning and workflow", description: "Planner agent, batch agent, parallel engine, dialogue state, template and workflow management" },
  "src/pal/": { purpose: "Platform abstraction layer", description: "Cross-platform file system, shell, keychain, and system operations" },
  "src/infra/": { purpose: "Infrastructure layer", description: "Git shadow, auto-checkpoint, PR management, and process management" },
  "src/mcp/": { purpose: "MCP protocol integration", description: "Model Context Protocol client, types, and server management" },
  "src/cli/": { purpose: "CLI interface", description: "Terminal UI components using Ink framework, command palette, and slash command parsing" },
  "src/common/": { purpose: "Shared utilities", description: "Common types, Result pattern implementation" },
  "src/core/": { purpose: "Core constants", description: "Application constants, defaults, and configuration values" },
  "src/compaction/": { purpose: "Context compaction", description: "LLM-based and local context compression for managing token budgets" },
  "src/types/": { purpose: "Type definitions", description: "Central type definitions and interfaces for the entire project" },
  "desktop/": { purpose: "Desktop application (Electron)", description: "Electron main process, preload bridge, and React renderer with visual components" },
  "web/": { purpose: "Web application", description: "Web server and client for browser-based access" },
  "test/": { purpose: "Test suites", description: "Unit, integration, functional, E2E, and benchmark tests" },
  "docs/": { purpose: "Project documentation", description: "Architecture decision records, guides, reports, and templates" },
  "scripts/": { purpose: "Development and CI scripts", description: "CI checks, development utilities, and release automation" },
};

function getFilePurpose(filePath) {
  for (const [prefix, info] of Object.entries(MODULE_PURPOSES)) {
    if (filePath.startsWith(prefix.replace(/\/$/, ""))) return info;
  }
  return { purpose: "Project root", description: "Root configuration and project metadata files" };
}

function detectQualityIssues(filePath, lines, ext) {
  const issues = [];
  if (ext === ".ts" || ext === ".tsx") {
    if (lines > 500) issues.push("LARGE_FILE: exceeds 500 LOC");
    if (lines > 1000) issues.push("VERY_LARGE_FILE: exceeds 1000 LOC");
  }
  if (filePath.includes("test/") && (ext === ".ts" || ext === ".tsx")) {
    if (lines > 800) issues.push("LARGE_TEST_FILE: consider splitting");
  }
  if (filePath.endsWith("index.ts") && lines > 100) {
    issues.push("BARREL_FILE_LARGE: barrel export exceeds 100 lines");
  }
  return issues;
}

const inventoryRaw = JSON.parse(fs.readFileSync("project-docs/file-inventory-raw.json", "utf-8"));
const depRaw = JSON.parse(fs.readFileSync("project-docs/dependency-raw.json", "utf-8"));

const depMap = new Map();
for (const dep of depRaw) depMap.set(dep.path, dep);

const catalog = [];
let totalLOC = 0;
const categoryCounts = {};
const moduleCounts = {};

for (const entry of inventoryRaw) {
  const catInfo = CATEGORY_MAP[entry.ext] || { fileType: "unknown", category: "unknown" };
  const moduleInfo = getFilePurpose(entry.path);
  const deps = depMap.get(entry.path);
  const internalDeps = deps?.internalDeps ? deps.internalDeps.split(",").filter(Boolean) : [];
  const externalDeps = deps?.externalDeps ? deps.externalDeps.split(",").filter(Boolean) : [];
  const qualityIssues = detectQualityIssues(entry.path, entry.lines, entry.ext);

  totalLOC += entry.lines;
  categoryCounts[catInfo.category] = (categoryCounts[catInfo.category] || 0) + 1;

  const moduleKey = entry.path.split("/").slice(0, 2).join("/");
  moduleCounts[moduleKey] = (moduleCounts[moduleKey] || 0) + 1;

  catalog.push({
    fileName: path.basename(entry.path),
    relativePath: entry.path,
    fileType: catInfo.fileType,
    category: catInfo.category,
    primaryPurpose: moduleInfo.purpose,
    description: moduleInfo.description,
    internalDependencies: internalDeps,
    externalDependencies: externalDeps,
    sizeKB: entry.sizeKB,
    linesOfCode: entry.lines,
    lastModified: entry.modified,
    qualityIssues,
  });
}

fs.writeFileSync("project-docs/file-catalog.json", JSON.stringify(catalog, null, 2));

const summary = {
  generatedAt: new Date().toISOString(),
  totalFiles: catalog.length,
  totalLinesOfCode: totalLOC,
  categoryBreakdown: categoryCounts,
  moduleBreakdown: moduleCounts,
  filesWithQualityIssues: catalog.filter(c => c.qualityIssues.length > 0).length,
  qualityIssueTypes: catalog.flatMap(c => c.qualityIssues).reduce((acc, issue) => {
    const type = issue.split(":")[0];
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {}),
};

fs.writeFileSync("project-docs/inventory-summary.json", JSON.stringify(summary, null, 2));

console.log(`Catalog: ${catalog.length} files, ${totalLOC} LOC`);
console.log(`Quality issues: ${summary.filesWithQualityIssues} files`);
console.log(JSON.stringify(categoryCounts, null, 2));
