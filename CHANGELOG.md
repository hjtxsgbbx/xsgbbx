# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- IterationFramework class for systematic iteration management (requirements, designs, iterations, code reviews, tech debts, feedback reports)
- Requirement priority assessment matrix (businessValue×0.35 + userImpact×0.25 + priorityWeight×0.25 - technicalComplexity×0.1 - effortEstimate×0.05)
- Quality gates: testPassRate≥95%, testCoverage≥80%, avgResponseTime≤500ms, CPU≤70%, Memory≤80%, errorRate≤0.1%
- Design document review workflow with status transitions and comments
- Tech debt tracking with severity-based sorting and resolution tracking
- Iteration summary generation with quality gate pass/fail assessment
- Feedback report generation with user satisfaction, feature usage, and performance metrics
- Data persistence for requirements, iterations, and tech debts (JSON files)
- Event-driven architecture for requirement, design, and iteration lifecycle
- Dockerfile with multi-stage build, non-root user, health check, and resource limits
- docker-compose.yml with CLI and Web services, environment variable injection, and volume persistence
- .dockerignore for optimized Docker builds
- 21 iteration framework unit tests
- 14 LLM Providers (9 cloud + 4 local + 1 custom): Anthropic, OpenAI, Google Gemini, DeepSeek, Mistral, Groq, Together AI, xAI (Grok), Cohere, Ollama, LM Studio, llama.cpp, vLLM, OpenAI Compatible
- LocalProviderScanner: automatic detection and activation of local model runtimes (Ollama, LM Studio, llama.cpp, vLLM) with 30s periodic scanning
- Auto-activation of local providers when no cloud API key is configured
- QueryPerformanceTracker: TTFB, total latency, TPS, memory usage tracking with P50/P95/P99 baselines
- Performance tracking integration in QueryEngine.streamApiCall()
- Desktop ChatPanel virtual scrolling for messages > 30 (overscan buffer, estimated height positioning)
- Desktop sidebar drawer mode for screens < 700px (toggle button, overlay, cubic-bezier animation)
- Desktop terminal panel resize handle styles
- 32 model context window sizes and pricing data entries
- 10 environment variable auto-detection keys (GOOGLE_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, XAI_API_KEY, COHERE_API_KEY)
- LOCAL_PROVIDER_PROBES constant for local runtime probe configuration
- Desktop FeedbackPanel component with category selection (Bug/Feature/Improvement/Praise), local storage, and IPC submission
- Feedback button in Desktop StatusBar with onFeedback callback
- IPC channel `feedback:submit` with FeedbackCollector integration in ipc-bridge
- MCP Protocol upgrade to 2025-06-18 with sampling/createMessage support
- MCPModelPreferences, MCPSamplingMessage, MCPSamplingToolDefinition types
- MCPClient.createSamplingMessage() and supportsSampling() methods
- Slash command parser module (`src/cli/slash-command-parser.ts`) with resolveAlias, parseCommand, getAvailableCommands, getAvailableWorkflows
- New CLI slash commands: /init (/i), /review (/r), /test (/t), /pr (/p)
- Centralized constants module (`src/core/constants.ts`) for APP_VERSION, DEFAULT_MODEL, PROVIDER_DEFAULTS, TIMEOUTS, LIMITS
- 82 new tests: MCP Sampling (30) + Slash Command Parser (52)

### Changed
- AuditLogger and MetricsCollector flush methods now use async I/O (fsp.appendFile) instead of synchronous writes
- Added AuditLogger.flushSync() for test scenarios requiring immediate disk persistence
- Desktop StatusBar now accepts onFeedback prop
- Desktop App.tsx integrates FeedbackPanel with lazy loading and Suspense
- Desktop preload whitelist includes `feedback:submit` channel
- Desktop styles.css includes feedback UI styles with dual-theme support

### Fixed
- 8 test failures caused by async I/O changes in audit-logger and metrics-collector
- AuditLogger integrity tests now properly await flushSync before assertions
- MetricsCollector auto-flush test now waits for async event emission
- Command injection vulnerability in keychain.ts (escapeShellArg/escapeDoubleQuoteArg)

## [1.0.0] - 2026-05-13

### Added
- TAOR Loop (Think→Act→Observe→Reflect) core engine with max 50 turns
- 3-tier Permission Pipeline (deny > ask > allow) with custom rules
- 4-level Context Compaction (snip/micro/collapse/auto) with critical message protection
- 5-strategy Error Healing (RETRY/INVESTIGATE/FIX/PIVOT/ASK)
- PAL (Platform Abstraction Layer) for cross-platform shell/fs/keychain
- AgentBridge for unified CLI/Desktop/Web communication
- MCP (Model Context Protocol) integration with stdio transport
- MCP Tasks Protocol (SEP-1686/2669) with full task lifecycle management
- Git Shadow checkpoint system for safe rollback
- Plan/Act/Default separate system prompts (Cline-inspired)
- Repo Map codebase structure generation (Aider-inspired)
- Circuit Breaker pattern for API resilience
- Result/Either error handling pattern
- Process Manager for child process lifecycle
- Path traversal prevention with workspace boundary checking
- Token budget management with model-specific limits
- Adaptive Thinking (thinking_effort) for Claude 4.6+
- Structured Output (JSON Mode) for API responses
- Streaming response support for Anthropic and OpenAI providers
- Parallel tool execution for read-only operations
- Prompt caching for Claude models
- Environment snapshot capturing git state and project context
- Diff-based file editing with fuzzy matching
- Tool result caching with write invalidation
- Batch mode for background task execution
- Comprehensive audit logging system
- Certificate pinning for API security
- CLI client with Ink/React rendering
- Desktop client (Electron) with sandbox:true + CSP headers
- Web client (WebSocket) with heartbeat + exponential backoff

### Infrastructure
- Git Flow branching strategy (main/develop/feature/hotfix/release)
- 11-stage CI/CD pipeline with cross-platform test matrix
- Pre-commit hooks (TypeScript check + test sanity)
- Commit message validation (Conventional Commits)
- PR template with checklist and label system
- Sprint planning template with burndown tracking
- Retrospective template with action item tracking
- Daily standup template and automation script
- Issue templates (Bug Report, Feature Request, User Feedback)
- CODEOWNERS for automated review assignment
- Jest test infrastructure with 18+ test suites
- ESLint + TypeScript strict mode