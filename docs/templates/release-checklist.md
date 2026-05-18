# Release Checklist — agent_1 v{version}

> Complete all items before tagging and publishing a release.

## 1. Pre-Release Verification

### Code Quality
- [ ] `npm run typecheck` — TypeScript compiles with 0 errors (CLI)
- [ ] `cd desktop && npm run build` — Desktop TypeScript compiles with 0 errors
- [ ] `cd web && npm run build` — Web TypeScript compiles with 0 errors
- [ ] `npm run lint` — ESLint passes with max 5 warnings

### Testing
- [ ] `npm test` — All unit tests pass (target: 100%)
- [ ] `npm run test:integration` — All integration tests pass
- [ ] `npm run test:e2e` — All E2E tests pass
- [ ] `npm run test:benchmark` — Benchmark suite passes
- [ ] `npm run test:coverage` — Coverage meets thresholds

### Benchmark Gate
- [ ] Pass rate >= 60%
- [ ] No regressions from previous release
- [ ] P95 performance within baseline
- [ ] Gate recommendation is "proceed"

### Desktop
- [ ] Desktop launches without crash
- [ ] WebSocket connection to server successful
- [ ] All 7 panels functional (Chat, Editor, FileTree, Permission, Status, Terminal, Welcome)
- [ ] IPC bridge channels functional

### Web
- [ ] Web server starts on port 3099
- [ ] Client HTML loads with 200 OK
- [ ] WebSocket upgrade successful
- [ ] Provider configuration flow works

### CLI
- [ ] Interactive mode (`agent_1`) runs
- [ ] Headless mode (`agent_1 -p "status"`) works
- [ ] Provider selection flow works
- [ ] All built-in commands functional

## 2. Documentation

- [ ] CHANGELOG.md updated with all changes for this version
- [ ] All new features documented in relevant `docs/` files
- [ ] Any ADRs for this release added to `docs/adr/`
- [ ] PR template reflects current checklist

## 3. Version & Tagging

- [ ] `package.json` version bumped
- [ ] `npm run sprint:report` generated for current sprint
- [ ] Git tag created: `git tag -a v{version} -m "Release v{version}"`
- [ ] Release branch merged to `main`

## 4. CI/CD Verification

- [ ] CI pipeline: all 12 stages green
- [ ] Coverage report generated
- [ ] Benchmark report generated
- [ ] Build artifacts created

## 5. Post-Release

- [ ] GitHub Release created with CHANGELOG content
- [ ] Desktop binaries published (if applicable)
- [ ] NPM package published (if applicable)
- [ ] Release announcement sent
- [ ] Monitoring/telemetry verified (if enabled)

## 6. Rollback Plan (if needed)

- [ ] Previous version tag identified: `git tag -l`
- [ ] Rollback procedure documented
- [ ] Database migration rollback tested (if applicable)

---

**Release Owner**: _______
**Date**: _______
**Approvals**: _______