# Architecture Decision Records (ADR)

This document records significant architectural decisions made during the development of agent_1.

---

## ADR-001: TypeScript ESM + Node.js Runtime

**Status**: Accepted
**Date**: 2025-11-01

### Context
Need to choose a runtime and language for a CLI-first AI coding agent. Requirements:
- Cross-platform (Windows, macOS, Linux)
- Rich ecosystem for HTTP, process management, and filesystem operations
- Strong typing for agent state management
- Fast startup for CLI responsiveness

### Decision
Use **TypeScript compiled to ESM** running on **Node.js 18+**.

### Rationale
- TypeScript provides compile-time safety for complex agent state machines, message types, and tool interfaces
- ESM enables modern import/export syntax and tree-shaking
- Node.js provides built-in support for child processes (shell commands), HTTP(S) clients, and filesystem operations needed for tool execution
- Ink (React for CLI) provides a declarative UI approach compatible with TypeScript

### Consequences
- Build step required (tsc or tsx)
- Cannot run directly as a single binary without bundling
- Windows compatibility requires careful path handling

### Alternatives Considered
- **Rust**: Better performance and single-binary distribution, but slower prototyping cycle for AI SDK integrations
- **Python**: Richer AI/ML ecosystem, but weaker CLI performance and type safety
- **Go**: Excellent cross-compilation, but less mature AI SDK ecosystem

---

## ADR-002: TAOR Agent Loop (Not ReAct)

**Status**: Accepted
**Date**: 2025-11-15

### Context
Agentic AI coding requires an iterative loop: the agent thinks, takes action, observes results, and adjusts. Common patterns include ReAct (Reasoning + Acting) and Plan-Act.

### Decision
Implement the **TAOR loop**: **T**hink → **A**ct → **O**bserve → **R**eflect, with a maximum of 50 turns per session.

### Rationale
- **Think**: Before acting, the agent analyzes the context and decides what action to take
- **Act**: Execute the selected tool (file read/write, shell command, etc.)
- **Observe**: Capture the result of the action (output, exit code, file changes)
- **Reflect**: Evaluate whether the action achieved the intended outcome, adjust strategy

TAOR adds an explicit "Reflect" phase beyond ReAct, enabling the agent to learn from its own execution results within a session.

### Alternatives Considered
- **ReAct**: Simpler but lacks self-reflection, leading to repeated mistakes
- **Plan-Act-Reflect**: Similar but the "Plan" phase implies full upfront planning which doesn't work well for interactive editing

---

## ADR-003: 4-Layer Permission Pipeline

**Status**: Accepted
**Date**: 2025-12-01

### Context
An AI agent executing shell commands and writing files on a user's system poses significant security risks. We need a permission system that balances safety with productivity.

### Decision
Implement a **4-layer permission pipeline**: `denyList → allowList → userConfirm → autoAllow`

| Layer | Priority | Behavior |
|-------|----------|----------|
| denyList | 1 (highest) | Pattern-based blocking of dangerous operations |
| allowList | 2 | Pattern-based auto-approval for known-safe operations |
| userConfirm | 3 | Interactive prompt for undetermined operations |
| autoAllow | 4 (lowest) | Permit operations that haven't matched any rule |

### Rationale
- Most dangerous operations (file system destruction, network exfiltration) are caught at the denyList layer
- Frequent development operations (git status, npm test) are approved at the allowList layer
- Users remain in control through the confirm layer
- Custom rules allow project-specific or personal preferences

### Alternatives Considered
- **Sandboxing only**: Secure but overly restrictive for development workflows
- **User-only confirmation**: Safe but creates excessive friction
- **Auto-approve all**: Fast but irresponsible

---

## ADR-004: 4-Level Context Compaction

**Status**: Accepted
**Date**: 2025-12-15

### Context
AI API calls have token limits. For multi-turn agent sessions, the accumulated context (system prompt, user messages, assistant responses, tool results) may exceed the model's context window.

### Decision
Implement **4-level context compaction** with automatic triggers:

| Level | Trigger | Action |
|-------|---------|--------|
| snip | Token > 60% of budget | Trim redundant lines from tool outputs |
| micro | Idle > 5 minutes | Summarize old message batches |
| collapse | Token > 70% of budget | Replace tool results with summaries |
| auto | Token > 92% of budget | Aggressive truncation with critical message protection |

Messages explicitly marked as `critical: true` are protected from all compaction levels.

### Rationale
- Progressive compaction avoids data loss: redundant lines first, then summarization, then truncation
- Idle-time micro-compaction uses natural pause points to reduce context without blocking the user
- Token budget awareness: 60% triggers snip (non-destructive), 70% triggers collapse, 92% triggers auto (last resort)
- Critical message protection ensures key instructions survive all compaction rounds

---

## ADR-005: 5-Strategy Error Healing

**Status**: Accepted
**Date**: 2026-01-10

### Context
AI agents executing shell commands and file operations encounter various error types: network timeouts, permission denials, syntax errors, process crashes. Simple retry loops are insufficient.

### Decision
Implement a **5-strategy error healing system** with probability-weighted selection:

| Strategy | Weight | Action |
|----------|--------|--------|
| RETRY | 55% | Re-execute the same command (transient errors) |
| INVESTIGATE | 28% | Run diagnostic commands to understand the error |
| FIX | 14% | Attempt to modify the command/arguments to correct the error |
| PIVOT | 2% | Change approach entirely (different tool or method) |
| ASK | 1% | Request user guidance when all strategies fail |

**Constraint**: Maximum 3 retry attempts per failure before escalation to ASK.

### Rationale
- RETRY as the most common strategy (55%): most errors in development are transient (network, file locks)
- INVESTIGATE (28%): Before blindly retrying, understand why the failure occurred
- FIX (14%): Attempt intelligent correction based on investigation results
- PIVOT (2%): Rarely needed but crucial for stubborn problems
- ASK (1%): Final fallback ensures the agent doesn't loop infinitely

---

## ADR-006: Signed CLI Release Binaries

**Status**: Accepted
**Date**: 2026-02-01

### Context
Distributing a CLI tool that executes shell commands on user machines requires establishing trust in the binary's authenticity.

### Decision
Release all CLI binaries with:
1. **SHA-256 checksum** published with each release
2. **Digital signature** using the release signing key
3. **Reproducible build** instructions in the repository
4. Checksum and signature verified by `npm postinstall` script

### Rationale
- SHA-256 checksums prevent supply chain attacks by allowing users to verify binary integrity
- Digital signatures establish provenance and prevent tampering
- Reproducible builds allow independent verification
- npm postinstall verification catches corrupted or tampered packages

---

## ADR-007: Programmable Configuration Extensibility

**Status**: Accepted
**Date**: 2026-03-01

### Context
agent_1 initially used a static JSON configuration file. As features grew (compaction thresholds, AI safety confidence, UI themes, custom permission rules), we needed a more extensible configuration system.

### Decision
Migrate to **programmable TypeScript configuration** with JSON compatibility:

```typescript
// agent_1.config.ts (optional, overrides config.json)
export default {
  permissionRules: [
    { pattern: "npm test", decision: "allow" },
    { pattern: "rm -rf", decision: "deny" },
  ],
  compactionThresholds: {
    snip: 0.7,    // overrides default 0.6
    auto: 0.95,   // overrides default 0.92
  },
};
```

### Rationale
- Maintains backward compatibility with JSON config
- Programmatic config allows conditional logic and dynamic values
- TypeScript provides type checking for configuration values
- Custom permission rules can reference environment variables

---

*Document maintained by the agent_1 architecture team. Last updated: 2026-05-13.*