{
  "modules": {
    "types": {
      "layer": 0,
      "description": "基础类型定义层，无内部依赖",
      "allowedImports": [],
      "forbiddenImports": [] 
    },
    "common": {
      "layer": 0,
      "description": "公共工具层（Result类型等），无内部依赖",
      "allowedImports": [],
      "forbiddenImports": []
    },
    "pal": {
      "layer": 1,
      "description": "平台抽象层，封装OS差异",
      "allowedImports": ["types"],
      "forbiddenImports": ["core", "api", "tools", "storage", "permissions", "security"]
    },
    "storage": {
      "layer": 2,
      "description": "存储层，管理持久化数据",
      "allowedImports": ["types", "common", "pal"],
      "forbiddenImports": ["core", "api", "tools", "permissions"]
    },
    "security": {
      "layer": 2,
      "description": "安全层，沙箱/路径保护/证书固定",
      "allowedImports": ["types", "common"],
      "forbiddenImports": ["core", "api", "tools", "permissions", "storage"]
    },
    "mcp": {
      "layer": 2,
      "description": "MCP协议客户端层",
      "allowedImports": ["types", "common"],
      "forbiddenImports": ["core", "api", "tools", "permissions", "storage"]
    },
    "compaction": {
      "layer": 2,
      "description": "上下文压缩层",
      "allowedImports": ["types", "common"],
      "forbiddenImports": ["core", "api", "tools", "permissions", "storage"]
    },
    "permissions": {
      "layer": 3,
      "description": "权限决策层，包含AI守卫",
      "allowedImports": ["types", "common", "pal"],
      "forbiddenImports": ["core", "api", "tools"]
    },
    "tools": {
      "layer": 3,
      "description": "工具定义与执行层",
      "allowedImports": ["types", "common", "pal", "security", "permissions", "storage", "mcp"],
      "forbiddenImports": ["core", "api"]
    },
    "api": {
      "layer": 4,
      "description": "AI Provider抽象层",
      "allowedImports": ["types", "common", "tools", "storage"],
      "forbiddenImports": ["core"]
    },
    "core": {
      "layer": 5,
      "description": "核心引擎层，查询引擎/代理桥接/批处理",
      "allowedImports": ["types", "common", "pal", "storage", "security", "permissions", "tools", "api", "compaction", "mcp"],
      "forbiddenImports": []
    }
  },
  "entryPoints": {
    "cli": { "path": "src/index.ts", "allowedImports": ["all"] },
    "web": { "path": "web/server.ts", "allowedImports": ["all"] },
    "desktop": { "path": "desktop/main/index.ts", "allowedImports": ["all"] }
  },
  "namingConventions": {
    "files": "kebab-case",
    "directories": "kebab-case",
    "interfaces": "PascalCase with I prefix optional",
    "types": "PascalCase",
    "constants": "UPPER_SNAKE_CASE",
    "functions": "camelCase",
    "classes": "PascalCase",
    "testFiles": "<module-name>.test.ts"
  },
  "directoryStructure": {
    "src/": "核心源码，按功能域划分子目录",
    "src/types/": "全局类型定义，L0层",
    "src/common/": "公共工具函数，L0层",
    "src/pal/": "平台抽象层，L1层",
    "src/storage/": "持久化存储，L2层",
    "src/security/": "安全相关，L2层",
    "src/mcp/": "MCP协议，L2层",
    "src/compaction/": "上下文压缩，L2层",
    "src/permissions/": "权限决策+AI守卫，L3层",
    "src/tools/": "工具定义与执行，L3层",
    "src/api/": "AI Provider抽象，L4层",
    "src/core/": "核心引擎，L5层",
    "src/cli/": "CLI界面，入口层",
    "test/unit/": "单元测试，镜像src/结构",
    "test/integration/": "集成测试",
    "test/e2e/": "端到端测试",
    "test/benchmark/": "基准测试",
    "desktop/": "Electron桌面端",
    "desktop/main/": "主进程",
    "desktop/preload/": "预加载脚本",
    "desktop/renderer/": "渲染进程（React）",
    "desktop/renderer/components/": "UI组件",
    "desktop/scripts/": "构建脚本",
    "web/": "WebSocket Web端",
    "web/client/": "静态HTML客户端",
    "docs/": "项目文档",
    "docs/adr/": "架构决策记录",
    "docs/templates/": "项目管理模板",
    "scripts/": "CI/CD和开发脚本",
    ".github/": "GitHub配置"
  },
  "iterativeDevelopmentRules": {
    "branchStrategy": "Git Flow: main/develop/feature/release/hotfix",
    "commitConvention": "Conventional Commits: feat|fix|refactor|docs|test|chore",
    "prRequirements": [
      "TypeScript编译通过",
      "单元测试通过",
      "ESLint检查通过",
      "代码审查通过",
      "无循环依赖引入"
    ],
    "iterationCycle": "2周一个Sprint",
    "qualityGates": {
      "preCommit": ["typecheck", "lint", "unit-test"],
      "preMerge": ["full-test-suite", "coverage-threshold"],
      "preRelease": ["e2e-test", "benchmark-gate"]
    }
  },
  "iterationRoadmap": {
    "currentVersion": "1.0.0",
    "competitiveBenchmark": {
      "source": "2026 AI Coding Agent Market Analysis",
      "topProducts": ["Claude Code (SWE-bench 80.9%, ARR $2.5B)", "Cursor (360K users, $29.3B val)", "GitHub Copilot (1.5M subs)", "OpenAI Codex CLI (open-source, 77.3% Terminal-Bench)"],
      "ourScore": "5.5/10",
      "targetScore": "8.0/10",
      "keyGaps": [
        "Single-agent architecture (no planner/executor separation)",
        "Only 2 permission modes vs industry standard 7",
        "Static project memory (no auto-learning)",
        "AgentTool is a stub (no real sub-agent execution)",
        "12 built-in tools vs industry 20+",
        "No LLM-based summarization in compaction",
        "MCP lacks HTTP/SSE transport and resources"
      ]
    },
    "sprintDuration": "2 weeks",
    "sprints": [
      {
        "id": "Sprint-1",
        "name": "Security Hardening & Test Coverage",
        "status": "completed",
        "goals": [
          "Fix sandbox command validation bypass",
          "Fix shell injection vulnerabilities",
          "Fix executor permission confirmation logic",
          "Fix ipc-bridge path traversal and config injection",
          "Add executor and config-store unit tests"
        ],
        "metrics": {
          "testCount": 399,
          "testSuites": 33,
          "securityIssuesFixed": 5,
          "codeQualityScore": "7.0/10"
        }
      },
      {
        "id": "Sprint-2",
        "name": "Dual-Agent Architecture & Permission Expansion",
        "status": "completed",
        "goals": [
          "Implement PlannerAgent (task decomposition, plan generation)",
          "Implement ExecutorAgent (plan execution with healing)",
          "Expand permission modes from 2 to 5 (defaultAllow, defaultDeny, plan, autoApprove, sandbox)",
          "Add path-level permission control",
          "Implement auto-memory system (session-end knowledge extraction)"
        ],
        "targetMetrics": {
          "architectureScore": "7.5/10",
          "permissionModes": 5,
          "autoMemoryEnabled": true
        }
      },
      {
        "id": "Sprint-3",
        "name": "AgentTool Realization & Hook Integration",
        "status": "completed",
        "goals": [
          "Replace AgentTool stub with real sub-agent execution",
          "Integrate Hook system into QueryEngine main loop",
          "Add git_diff, web_fetch, symbol_search tools",
          "Implement LLM-based summarization in compaction",
          "Add MCP HTTP/SSE transport support"
        ],
        "targetMetrics": {
          "toolCount": "18+",
          "hookIntegration": true,
          "compactionQuality": "LLM-based"
        },
        "actualMetrics": {
          "toolCount": 9 (read-only) + 5 (write) + MCP = 14+ base tools",
          "hookIntegration": true,
          "newTools": ["git_diff", "web_fetch", "symbol_search"],
          "mcpTransport": ["stdio", "http", "sse"],
          "mcpFeatures": ["healthCheck", "autoReconnect", "requestTimeout"],
          "testCount": 435,
          "typeCheckPass": true
        }
      },
      {
        "id": "Sprint-4",
        "name": "Cost Transparency & Multi-Client Sync",
        "status": "completed",
        "goals": [
          "Integrate CostTracker into QueryEngine main loop",
          "Add budget hard-limits and cost warnings",
          "Enhance WS protocol (incremental updates, heartbeat, reconnect)",
          "Multi-client session sharing",
          "LLM summarization in compaction (Sprint-3 carryover)"
        ],
        "targetMetrics": {
          "costTransparency": true,
          "wsProtocolVersion": "2.0",
          "testCoverage": "70%+"
        },
        "actualMetrics": {
          "costTransparency": true,
          "costTrackerInQueryEngine": true,
          "budgetHardLimits": true,
          "budgetWarnings": true,
          "wsProtocolVersion": "2.0",
          "wsStreaming": true,
          "wsMultiClient": true,
          "wsHealthEndpoint": true,
          "llmCompaction": true,
          "testCount": 438,
          "typeCheckPass": true
        }
      },
      {
        "id": "Sprint-5",
        "name": "Quality Fixes & Adaptive Optimization",
        "status": "completed",
        "goals": [
          "Fix AgentBridge event forwarding (streaming/toolExecuting/toolResult/costUpdate)",
          "Fix BatchAgent CostTracker isolation",
          "Implement ErrorHealer adaptive strategy selection",
          "Sync architecture documentation"
        ],
        "actualMetrics": {
          "bridgeEventsFixed": 4,
          "batchAgentUnified": true,
          "healerAdaptive": true,
          "testCount": 447,
          "typeCheckPass": true
        }
      },
      {
        "id": "Sprint-6",
        "name": "Frontier Tech Integration & Multi-Agent Enhancement",
        "status": "completed",
        "goals": [
          "Research frontier agent architectures (Claude Agent SDK, VoltAgent, MCP best practices)",
          "Implement parallel sub-agent execution engine",
          "Implement declarative workflow chain engine",
          "Add MCP security enhancements (tool-level permissions)"
        ],
        "actualMetrics": {
          "parallelSubAgents": true,
          "maxConcurrentAgents": 10,
          "workflowChainEngine": true,
          "mcpToolPermissions": true,
          "mcpBlockedTools": true,
          "researchSources": ["Claude Agent SDK", "VoltAgent", "Microsoft MCP Best Practices", "Agentic Architecture Patterns 2025"],
          "testCount": 447,
          "typeCheckPass": true
        }
      }
    ],
    "priorityOrder": [
      "Dual-agent architecture (P0 - core competitiveness)",
      "Permission system expansion (P0 - safety & trust)",
      "Auto-memory system (P0 - cross-session intelligence)",
      "AgentTool realization (P1 - multi-agent coordination)",
      "Tool set expansion (P1 - capability coverage)",
      "LLM summarization (P1 - context quality)",
      "Cost transparency (P2 - user experience)",
      "Multi-client sync (P2 - collaboration)"
    ],
    "versionPlan": {
      "1.1.0": "Sprint-2 completion - Dual-agent, 5 permission modes, auto-memory",
      "1.2.0": "Sprint-3 completion - Real AgentTool, 18+ tools, LLM compaction",
      "2.0.0": "Sprint-4 completion - Cost transparency, multi-client sync"
    }
  }
}
