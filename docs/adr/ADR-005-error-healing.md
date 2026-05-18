# ADR-005: 5-Strategy Error Healing

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
