# Code Review Checklist

> Use this checklist for every PR review. Check off items as you verify them.

## Functionality
- [ ] Code does what the PR description claims
- [ ] Edge cases are handled correctly
- [ ] Error states are properly managed
- [ ] No race conditions or deadlocks introduced

## Code Quality
- [ ] Code follows project conventions (naming, structure, patterns)
- [ ] No code duplication (DRY principle)
- [ ] Functions are small and focused (single responsibility)
- [ ] No magic numbers or strings — use named constants or config
- [ ] Complex logic is documented with clear comments

## Type Safety (TypeScript)
- [ ] All types are explicit — no unnecessary `any` usage
- [ ] Interfaces/types are exported if consumed externally
- [ ] Generic types are correctly constrained
- [ ] No unsafe type assertions (`as`, `!`) without justification

## Security
- [ ] No hardcoded secrets, API keys, or tokens
- [ ] User input is validated and sanitized
- [ ] File paths are validated against path traversal
- [ ] Shell commands are properly escaped
- [ ] No `eval()` or similar unsafe patterns

## Performance
- [ ] No unnecessary allocations in hot paths
- [ ] Async operations use proper await/error handling
- [ ] No blocking I/O on the main event loop
- [ ] Memory leaks avoided (event listeners cleaned up)

## Testing
- [ ] Unit tests for new public methods
- [ ] Integration tests for new API integrations
- [ ] Negative test cases included (error paths)
- [ ] Benchmark not regressed (check benchmark report)

## Documentation
- [ ] Public API has JSDoc comments
- [ ] README or docs updated if needed
- [ ] ADR created for architecture decisions

## Review Result
- [ ] **APPROVED** — Ready to merge
- [ ] **CHANGES REQUESTED** — See comments below
- [ ] **COMMENTED** — Non-blocking suggestions only

---

Reviewer: _______
Date: _______
Time Spent: _______ min