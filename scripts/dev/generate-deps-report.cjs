const fs = require("fs");
const path = require("path");

const catalog = JSON.parse(fs.readFileSync("project-docs/file-catalog.json", "utf-8"));
const pkgJson = JSON.parse(fs.readFileSync("package.json", "utf-8"));
const desktopPkg = JSON.parse(fs.readFileSync("desktop/package.json", "utf-8"));
const webPkg = JSON.parse(fs.readFileSync("web/package.json", "utf-8"));

const srcFiles = catalog.filter(f =>
  f.relativePath.startsWith("src/") &&
  (f.category === "typescript" || f.category === "typescript_react")
);

const importRegex = /import\s+(?:type\s+)?[^;]*?from\s+["']([^"']+)["']/g;

const moduleInternalDeps = {};
const moduleExternalDeps = {};
const fileDeps = {};

for (const file of srcFiles) {
  try {
    const content = fs.readFileSync(file.relativePath, "utf-8");
    const imports = [];
    let match;
    importRegex.lastIndex = 0;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    const internalImports = imports.filter(i => i.startsWith("."));
    const externalImports = imports.filter(i => !i.startsWith("."));

    const module = file.relativePath.split("/").slice(0, 2).join("/");
    if (!moduleInternalDeps[module]) moduleInternalDeps[module] = new Set();
    if (!moduleExternalDeps[module]) moduleExternalDeps[module] = new Set();

    for (const dep of internalImports) {
      const resolved = resolveImport(dep, file.relativePath);
      if (resolved) {
        const depModule = resolved.split("/").slice(0, 2).join("/");
        if (depModule !== module) {
          moduleInternalDeps[module].add(depModule);
        }
      }
    }

    for (const dep of externalImports) {
      const topLevel = dep.startsWith("@") ? dep.split("/").slice(0, 2).join("/") : dep.split("/")[0];
      moduleExternalDeps[module].add(topLevel);
    }

    fileDeps[file.relativePath] = { internal: internalImports, external: externalImports };
  } catch (e) {
    // skip files that can't be read
  }
}

function resolveImport(importPath, fromFile) {
  const dir = path.dirname(fromFile);
  const resolved = path.normalize(path.join(dir, importPath)).replace(/\\/g, "/");
  return resolved;
}

const serializedInternal = {};
for (const [mod, deps] of Object.entries(moduleInternalDeps)) {
  serializedInternal[mod] = [...deps].sort();
}

const serializedExternal = {};
for (const [mod, deps] of Object.entries(moduleExternalDeps)) {
  serializedExternal[mod] = [...deps].sort();
}

const circularDeps = [];
for (const [modA, depsA] of Object.entries(serializedInternal)) {
  for (const dep of depsA) {
    const depsB = serializedInternal[dep];
    if (depsB && depsB.includes(modA)) {
      const pair = [modA, dep].sort().join(" <-> ");
      if (!circularDeps.includes(pair)) circularDeps.push(pair);
    }
  }
}

const depReport = {
  generatedAt: new Date().toISOString(),
  internalModuleDependencies: serializedInternal,
  externalModuleDependencies: serializedExternal,
  circularDependencies: circularDeps,
  externalDependencies: {
    root: { ...pkgJson.dependencies, ...pkgJson.devDependencies },
    desktop: { ...desktopPkg.dependencies, ...desktopPkg.devDependencies },
    web: { ...webPkg.dependencies, ...webPkg.devDependencies },
  },
  stats: {
    totalSourceFiles: srcFiles.length,
    totalInternalDeps: Object.values(serializedInternal).reduce((sum, deps) => sum + deps.length, 0),
    circularDepCount: circularDeps.length,
    externalDepCount: new Set(Object.values(serializedExternal).flat()).size,
  },
};

fs.writeFileSync("project-docs/dependency-analysis.json", JSON.stringify(depReport, null, 2));

const moduleLOC = {};
for (const file of srcFiles) {
  const module = file.relativePath.split("/").slice(0, 2).join("/");
  moduleLOC[module] = (moduleLOC[module] || 0) + file.linesOfCode;
}

const testFiles = catalog.filter(f => f.relativePath.startsWith("test/"));
const testLOC = {};
for (const file of testFiles) {
  const module = file.relativePath.split("/").slice(0, 2).join("/");
  testLOC[module] = (testLOC[module] || 0) + file.linesOfCode;
}

const vizReport = {
  generatedAt: new Date().toISOString(),
  architectureLayers: {
    presentation: { modules: ["src/cli/", "desktop/renderer/", "web/"], description: "User interface layer" },
    orchestration: { modules: ["src/engine/", "src/planning/"], description: "Agent orchestration and task planning" },
    intelligence: { modules: ["src/intelligence/", "src/compaction/"], description: "NLP, context, and knowledge" },
    tools: { modules: ["src/tools/", "src/pal/"], description: "File operations and platform abstraction" },
    governance: { modules: ["src/permissions/", "src/security/", "src/resilience/"], description: "Security, permissions, and error handling" },
    observability: { modules: ["src/observability/", "src/storage/"], description: "Monitoring, tracing, and persistence" },
    infrastructure: { modules: ["src/infra/", "src/mcp/", "src/api/"], description: "External integrations" },
    foundation: { modules: ["src/types/", "src/common/", "src/core/"], description: "Shared types and utilities" },
  },
  moduleSize: Object.fromEntries(Object.entries(moduleLOC).sort((a, b) => b[1] - a[1])),
  testSize: testLOC,
  dependencyGraph: serializedInternal,
  circularDependencies: circularDeps,
};

fs.writeFileSync("project-docs/structure-visualization.json", JSON.stringify(vizReport, null, 2));

console.log("=== Dependency Analysis ===");
console.log(`Source files: ${depReport.stats.totalSourceFiles}`);
console.log(`Internal module deps: ${depReport.stats.totalInternalDeps}`);
console.log(`Circular deps: ${circularDeps.length}`);
circularDeps.forEach(cd => console.log(`  ⚠ ${cd}`));
console.log(`External dep packages: ${depReport.stats.externalDepCount}`);

console.log("\n=== Module Dependencies ===");
for (const [mod, deps] of Object.entries(serializedInternal).sort()) {
  if (deps.length > 0) {
    console.log(`  ${mod} → ${deps.join(", ")}`);
  }
}

console.log("\n=== Module LOC ===");
for (const [mod, loc] of Object.entries(moduleLOC).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${mod}: ${loc} LOC`);
}

console.log("\n=== External Deps by Module ===");
for (const [mod, deps] of Object.entries(serializedExternal).sort()) {
  if (deps.length > 0) {
    console.log(`  ${mod}: ${deps.join(", ")}`);
  }
}
