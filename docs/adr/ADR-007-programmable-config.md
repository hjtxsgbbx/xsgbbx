# ADR-007: Programmable Configuration Extensibility

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
