# Branch Protection Rules

## Branch Strategy

```
main
  ├── develop
  │     ├── feat/{description}       (feature branches)
  │     ├── fix/{description}        (bug fix branches)
  │     ├── refactor/{description}   (refactoring branches)
  │     ├── docs/{description}       (documentation branches)
  │     └── chore/{description}      (maintenance branches)
  └── release/v{version}             (release branches)
```

## Branch Naming Convention

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feat/` | New features | `feat/streaming-response` |
| `fix/` | Bug fixes | `fix/ipc-bridge-type-mismatch` |
| `refactor/` | Code restructuring | `refactor/process-manager-signals` |
| `perf/` | Performance improvements | `perf/compaction-optimization` |
| `test/` | Test additions | `test/benchmark-coverage` |
| `docs/` | Documentation | `docs/api-reference` |
| `build/` | Build/CI changes | `build/electron-builder-config` |
| `chore/` | Maintenance | `chore/update-dependencies` |
| `release/` | Release preparation | `release/v1.0.0` |

## Protection Rules (GitHub Settings)

### `main` branch
- [ ] Require pull request before merging: **YES**
- [ ] Require approvals: **1**
- [ ] Dismiss stale approvals: **YES**
- [ ] Require status checks to pass: **YES**
  - [ ] `quick-checks`
  - [ ] `unit-test` (all 9 matrix variants)
  - [ ] `benchmark-gate`
  - [ ] `coverage-gate`
- [ ] Require conversation resolution: **YES**
- [ ] Require signed commits: **YES**
- [ ] Require linear history: **YES**
- [ ] Do not allow bypass: **Administrators included**
- [ ] Delete head branch after merge: **YES**

### `develop` branch
- [ ] Require pull request before merging: **YES**
- [ ] Require approvals: **1**
- [ ] Require status checks to pass: **YES**
  - [ ] `quick-checks`
- [ ] Delete head branch after merge: **YES**

## Commit Convention

All commits must follow **Conventional Commits** format (enforced by `commit-msg` hook):

```
type(scope): subject

[optional body]
```

### Types
- `feat`: New feature (MINOR version bump)
- `fix`: Bug fix (PATCH version bump)
- `docs`: Documentation only
- `style`: Formatting, semicolons (no code change)
- `refactor`: Code restructuring (no behavior change)
- `perf`: Performance improvement
- `test`: Adding missing tests
- `build`: Build system, dependencies
- `ci`: CI/CD configuration
- `chore`: Maintenance tasks
- `revert`: Reverting a previous commit

### Scopes
`core`, `api`, `tools`, `cli`, `desktop`, `web`, `storage`, `permissions`, `security`, `pipeline`, `benchmark`

## Merge Strategy

- **Squash merge**: For `feat/`, `fix/`, `refactor/`, `perf/`, `test/`, `docs/` branches
- **Recursive merge**: For `release/` branches
- **Rebase**: Not used (maintains merge history)