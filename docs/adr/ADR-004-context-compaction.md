# ADR-004: 4-Level Context Compaction

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
