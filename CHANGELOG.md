# Changelog

All notable changes to agent_1 will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-05-13

### Added
- **Core CLI Agent** with TAOR Loop (Think→Act→Observe→Reflect), max 50 turns
- **3-tier Permission Pipeline**: deny > ask > allow with custom rules
- **4-level Context Compaction**: snip / micro / collapse / auto
- **5-strategy Error Healing**: RETRY → INVESTIGATE → FIX → PIVOT → ASK
- **PAL (Platform Abstraction Layer)**: cross-platform shell/fs/keychain
- **AgentBridge**: unified CLI/Desktop/Web communication
- **MCP (Model Context Protocol)** integration with stdio transport
- **Git Shadow Checkpoint** system for safe rollback
- **Plan/Act/Default** separate system prompts
- **Repo Map** codebase structure generation (Aider-inspired)
- **Circuit Breaker** pattern for API resilience
- **Result/Either** error handling pattern
- **Process Manager** for child process lifecycle
- **Path traversal prevention** with workspace boundary checking
- **Token budget management** with model-specific limits
- **Electron desktop client** with sandbox + CSP security headers
- **WebSocket web client** with heartbeat + exponential backoff reconnection
- **Streaming responses** for Anthropic and OpenAI providers
- **Parallel tool execution** for read-only operations
- **Prompt caching** for Claude models with ephemeral markers
- **Environment snapshot** capturing git state and project context
- **Diff-based file editing** with fuzzy matching
- **Tool result caching** with write invalidation
- **Batch Mode** for background task execution
- **PR workflow automation** with Conventional Commits
- **Audit logging** for all tool executions and permission changes
- **Certificate pinning** for API security
- **Adaptive Thinking** (thinking_effort) for Claude 4+
- **MCP Tasks Protocol** (SEP-1686/2669): task lifecycle management
- **Structured Output** (JSON Mode) support

### Infrastructure
- **CI/CD Pipeline**: 6-stage GitHub Actions workflow
  - Quick Quality Gates (TypeCheck + Lint)
  - Cross-platform Test Matrix (ubuntu/windows/macos × Node 18/20/22)
  - Build + CLI verification
  - Desktop build + artifact upload
  - Web build + artifact upload
  - Pipeline status summary
- **Git Flow branching strategy** (main/develop/feature/hotfix/release)
- **Pre-commit hooks**: TypeCheck + Test + debug detection
- **Commit-msg hooks**: Conventional Commits validation
- **PR Template** with pre-merge checklist
- **Sprint management templates**, retrospective templates
- **Technical radar** (ADOPT/TRIAL/ASSESS/HOLD quadrants)
- **Technology selection reports** with A/B evaluation and performance data

### Documentation
- README.md, PRIVACY.md, ADR.md
- CONTRIBUTING.md (branch strategy, commit conventions, code review)
- TECH_RADAR.md (bi-weekly technology trends)
- TECH_SELECTION_REPORT.md (technology evaluation with benchmarks)
- IMPLEMENTATION_DOC.md (change logs, deployment guides)
- PROJECT_MANAGEMENT.md (sprint cycles, quality gates, feedback loops)

### Tests
- **225 tests** across **18 test suites**
- Coverage: MCP types, provider, healer, compaction, permissions, PAL,
  result, circuit breaker, process manager, audit logger, PR manager,
  token counter, cost tracker, env snapshot, diff edit, tool cache,
  security path guard, security sandbox

---

*Last updated: 2026-05-13*