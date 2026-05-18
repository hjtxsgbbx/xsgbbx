# ADR-003: SWE-bench Style Benchmark Framework

**Status**: ✅ Accepted
**Date**: 2026-05-14
**Deciders**: agent_1 Team
**Tags**: benchmarking, testing, quality, evaluation

## Context

To compete with industry-leading agent solutions (Claude Code — 80.9% on SWE-bench Verified, Devin — 88% task completion, Cursor — 94% code quality), agent_1 needs a systematic evaluation framework. Ad-hoc testing is insufficient for measuring progress against大厂 standards.

## Decision

Implement a **SWE-bench style benchmark framework** with:

1. **5-dimension evaluation rubric**: Performance, Accuracy, Quality, Interaction, Scalability
2. **12 task scenario suite** covering code_generation, bug_fix, refactoring, test_writing, security_fix, performance_optimization, documentation, code_review, dependency_update, api_integration
3. **6 output verification types**: file_exists, test_pass, regex_match, cli_output, type_check, lint_pass
4. **Gate check system** with regression detection and threshold enforcement
5. **Multi-format reporting**: JSON, JUnit XML, Markdown, HTML

## Consequences

**Positive**:
- Objective, repeatable quality assessment aligned with industry standards
- Regression detection prevents quality degradation between iterations
- JUnit XML output integrates with CI/CD and aggregation tools
- Clear comparison baseline against SWE-bench and other industry benchmarks

**Negative**:
- 12-task suite requires 5-10 minutes per run (CI pipeline overhead)
- Some quality metrics (cyclomatic complexity, code duplication) need external tools
- User satisfaction and interaction quality metrics are simulated, not from real users

## References

- SWE-bench Verified: 500-task human-validated subset
- SWE-bench Pro: 1,865 multi-language tasks
- PRDBench: 50 projects, 1,258 evaluation points
- ProjDevBench: End-to-end project development evaluation