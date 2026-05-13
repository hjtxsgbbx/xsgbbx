# agent_1

> AI-powered coding agent with full control — local-first, privacy-respecting, open-source.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

---

## What is agent_1?

agent_1 is a **local-first AI coding agent** that runs in your terminal. It reads, writes, and edits files; runs shell commands; and interacts with Git — all under your supervision.

Unlike cloud-hosted AI coding tools, agent_1:
- Stores **all data locally** on your machine
- Sends code to AI providers **only when you explicitly ask**
- Shows **exactly what data is being transmitted** in the status bar
- Allows **full data export and deletion** at any time

---

## Quick Start

### Prerequisites
- **Node.js 18+** (LTS recommended)
- **Git** (for shadow branching and PR management)
- An API key from:
  - [Anthropic Console](https://console.anthropic.com/) (Claude models)
  - [OpenAI Platform](https://platform.openai.com/) (GPT models)

### Installation

```bash
# Clone the repository
git clone https://github.com/agent_1/agent_1.git
cd agent_1

# Install dependencies
npm install

# Build the project
npm run build

# Launch agent_1
node dist/src/index.js
```

### First Run

On first run, agent_1 will prompt you to:
1. **Accept the terms** (`--accept-terms`) — acknowledge data sharing with AI providers
2. **Select a provider** — Anthropic (Claude) or OpenAI (GPT)
3. **Enter your API key** — stored securely in your system keychain

```bash
# Quick start with flags
node dist/src/index.js --accept-terms --provider anthropic --api-key sk-ant-xxx
```

---

## Architecture

agent_1 follows a **unified core + platform adaptation** architecture:

```
┌─────────────────────────────────────────────┐
│              CLI (Ink/React)                 │
│  ┌───────────────────────────────────────┐   │
│  │          AgentBridge                   │   │
│  │  ┌─────────────────────────────────┐  │   │
│  │  │       QueryEngine (TAOR)        │  │   │
│  │  │  Think → Act → Observe → Reflect│  │   │
│  │  └─────────────────────────────────┘  │   │
│  │  ┌─────────┐ ┌──────────┐ ┌────────┐ │   │
│  │  │Tools    │ │Permission│ │Security│ │   │
│  │  │Executor │ │Pipeline  │ │Sandbox │ │   │
│  │  └─────────┘ └──────────┘ └────────┘ │   │
│  └───────────────────────────────────────┘   │
│  ┌───────────────────────────────────────┐   │
│  │     PAL (Platform Abstraction Layer)  │   │
│  │    Windows  │  macOS  │  Linux        │   │
│  └───────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### Key Modules

| Module | Path | Purpose |
|--------|------|---------|
| **Query Engine** | `src/core/query-engine.ts` | TAOR agent loop with streaming responses |
| **Agent Bridge** | `src/core/agent-bridge.ts` | Unified interface for CLI/Desktop/Web |
| **Permission Pipeline** | `src/permissions/pipeline.ts` | 4-layer deny→allow→confirm→auto |
| **Context Compaction** | `src/compaction/index.ts` | 4-level progressive compaction |
| **Error Healer** | `src/tools/healer.ts` | 5-strategy error recovery |
| **Git Shadow** | `src/core/git-shadow.ts` | Shadow branch checkpoints with rollback |
| **PR Manager** | `src/core/pr-manager.ts` | Auto-create PR with structured descriptions |
| **Security Sandbox** | `src/security/sandbox.ts` | Command validation and execution sandboxing |
| **Audit Logger** | `src/storage/index.ts` | Tool execution and permission decision tracking |

---

## CLI Commands

```bash
# Start interactive session
agent_1

# Background batch task
agent_1 batch "Fix all TypeScript errors in src/" --project ./my-app

# Show configuration
agent_1 config show

# Update configuration
agent_1 config set auto_create_pr true

# Export all local data
agent_1 export --format json

# Purge all local data
agent_1 purge --all

# Audit log statistics
agent_1 audit stats
agent_1 audit recent 30

# PR management
agent_1 pr preview
agent_1 pr create --base main
agent_1 pr list
```

---

## Features

### TAOR Agent Loop
- **T**hink (analyze context) → **A**ct (execute tool) → **O**bserve (capture result) → **R**eflect (adjust strategy)
- Maximum 50 turns per session
- Streaming responses with real-time progress

### 4-Layer Permission Pipeline
- `denyList` → `allowList` → `userConfirm` → `autoAllow`
- Custom rules per project or globally
- Audit trail for all permission decisions

### Context Compaction
- Auto-detection at 60%, 70%, 92% token usage
- Critical message protection across all levels
- Idle-time micro-compaction

### Error Healing (5 Strategies)
- RETRY (55%) · INVESTIGATE (28%) · FIX (14%) · PIVOT (2%) · ASK (1%)
- Maximum 3 retries per failure

### Cross-Platform
- **Windows**: PowerShell, CMD, WSL
- **macOS**: zsh, bash, keychain
- **Linux**: bash, secret-tool

---

## Configuration

Configuration is stored in `~/.agent_1/config.json`:

```json
{
  "version": 3,
  "chosen_provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "max_turns": 50,
  "permission_mode": "default",
  "auto_create_pr": false,
  "auto_commit": false,
  "accept_terms": false,
  "session_retention_days": 30,
  "telemetry_enabled": false,
  "ui": {
    "color_theme": "default",
    "compact_mode": false
  },
  "compaction_thresholds": {
    "snip": 0.6,
    "micro": 0.3,
    "collapse": 0.7,
    "auto": 0.92
  }
}
```

---

## Security

- **Certificate pinning** for all API calls
- **Keychain storage** for API keys (system credential manager)
- **API key memory zeroing** after use
- **4-layer permission pipeline** before tool execution
- **Path traversal prevention** with workspace boundary checking
- See [PRIVACY.md](PRIVACY.md) for data handling details

---

## Testing

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- test/security-path-guard.test.ts

# Type check
npm run typecheck
```

**Current coverage**: 18 test suites, 210 tests

---

## Documentation

- [Privacy Policy](PRIVACY.md)
- [Architecture Decision Records](ADR.md)
- [License](LICENSE)

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

*agent_1 — your code, your control, your machine.*