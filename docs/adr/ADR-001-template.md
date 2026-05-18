# ADR-001: ADR Template

**Status**: ✅ Template
**Date**: 2026-05-14
**Deciders**: agent_1 Team
**Tags**: process, documentation

## Context

All significant architecture and technology decisions must be documented to maintain knowledge continuity across iterations. This ADR defines the template format.

## Decision

Use the following template for all ADRs:

```markdown
# ADR-NNN: [Title]

**Status**: [Proposed | Accepted | Deprecated | Superseded]
**Date**: YYYY-MM-DD
**Deciders**: [Names]
**Tags**: [comma-separated]

## Context
What is the issue we're addressing? What forces are at play?

## Decision
What is the decision we've made? What options were considered?

## Consequences
What becomes easier or harder because of this decision?

## Alternatives Considered
What other options were evaluated and why were they rejected?

## References
Links to related ADRs, issues, or external resources.
```

## Consequences

- Every sprint must produce at least 1 ADR if architecture decisions were made
- ADRs are stored in `docs/adr/` with sequential numbering
- Deprecated ADRs provide a Superseded status pointing to the successor

## References

- Michael Nygard, "Documenting Architecture Decisions"
- ThoughtWorks Technology Radar — ADR section