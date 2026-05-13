# Contributing to agent_1

## 一、分支策略 (Branching Strategy)

本项目采用 **Git Flow** 分支模型，支持并行开发和代码审查。

### 1.1 主干分支

| 分支 | 用途 | 保护规则 |
|------|------|----------|
| `main` | 生产就绪代码 | 禁止直接推送，仅通过 PR 合并，需 CI 通过 + 1 人审查 |
| `develop` | 集成开发分支 | 禁止直接推送，仅通过 PR 合并，需 CI 通过 |

### 1.2 临时分支

| 分支类型 | 命名规范 | 来源 | 合并目标 | 生命周期 |
|----------|----------|------|----------|----------|
| `feature/*` | `feature/short-description` | `develop` | `develop` | 功能完成后删除 |
| `hotfix/*` | `hotfix/short-description` | `main` | `main` + `develop` | 修复完成后删除 |
| `release/*` | `release/vX.Y.Z` | `develop` | `main` + `develop` | 发布后删除 |
| `chore/*` | `chore/short-description` | `develop` | `develop` | 任务完成后删除 |

### 1.3 分支命名示例

```
feature/adaptive-thinking     # 新功能
feature/semantic-caching      # 新功能
hotfix/circuit-breaker-leak   # 紧急修复
release/v1.2.0               # 发布准备
chore/update-deps             # 依赖更新
```

## 二、开发工作流 (Development Workflow)

### 2.1 功能开发流程

```
1. 从 develop 创建 feature 分支
   git checkout develop
   git pull origin develop
   git checkout -b feature/my-feature

2. 在 feature 分支上开发
   - 遵循 Conventional Commits 规范
   - 编写或更新测试
   - 确保 npm run typecheck 通过
   - 确保 npm test 通过

3. 推送并创建 Pull Request
   git push origin feature/my-feature
   # 在 GitHub 创建 PR → develop

4. 代码审查 (Code Review)
   - 至少 1 位审查者批准
   - CI 全部通过
   - 解决所有审查意见

5. 合并到 develop
   - 使用 Squash and Merge
   - 删除 feature 分支
```

### 2.2 紧急修复流程

```
1. 从 main 创建 hotfix 分支
   git checkout main
   git checkout -b hotfix/critical-fix

2. 修复并提交
   git commit -m "hotfix: fix critical issue"

3. 创建两个 PR
   - hotfix → main (立即部署)
   - hotfix → develop (同步修复)

4. 合并后打 tag
   git tag -a vX.Y.(Z+1) -m "Hotfix release"
```

## 三、提交规范 (Conventional Commits)

### 3.1 提交格式

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### 3.2 Type 类型

| Type | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(mcp): add MCP Tasks Protocol support` |
| `fix` | Bug 修复 | `fix(circuit-breaker): resolve state transition race` |
| `docs` | 文档更新 | `docs(readme): add installation guide` |
| `style` | 代码格式 (不影响逻辑) | `style: apply consistent indentation` |
| `refactor` | 重构 | `refactor(provider): extract thinking config builder` |
| `test` | 测试 | `test(mcp-tasks): add 17 test cases for Tasks Protocol` |
| `chore` | 构建/工具 | `chore(ci): add desktop build job` |
| `perf` | 性能优化 | `perf(cache): add write-based invalidation` |
| `security` | 安全修复 | `security: add certificate pinning` |

### 3.3 Scope 范围

| Scope | 说明 |
|-------|------|
| `core` | 核心引擎 |
| `api` | API Provider |
| `mcp` | MCP 协议 |
| `tools` | 工具系统 |
| `security` | 安全模块 |
| `ui` | 用户界面 |
| `desktop` | Electron 桌面端 |
| `web` | WebSocket 客户端 |
| `test` | 测试基础设施 |
| `ci` | CI/CD |
| `docs` | 文档 |

## 四、代码审查标准 (Code Review Checklist)

### 4.1 必须检查项

- [ ] 代码遵循项目代码风格 (`.editorconfig`)
- [ ] TypeScript 类型安全 (`npm run typecheck` 通过)
- [ ] 所有测试通过 (`npm test`)
- [ ] 新功能有对应的测试覆盖
- [ ] 没有遗留的 `console.log` 或 `TODO`
- [ ] 错误处理使用 `Result/Either` 或 `err instanceof Error`
- [ ] 安全敏感代码有路径遍历检查和注入防护
- [ ] 公共 API 变更更新了类型导出

### 4.2 建议检查项

- [ ] 函数复杂度合理 (单个函数不超过 50 行)
- [ ] 命名清晰且一致
- [ ] 性能敏感的代码有注释说明
- [ ] 新增依赖经过评估 (见技术雷达)

### 4.3 审查意见标签

| 标签 | 含义 |
|------|------|
| `🔴 blocking` | 必须修改后才能合并 |
| `🟡 suggestion` | 建议修改，非强制 |
| `🟢 praise` | 写得好的地方 |
| `🔵 question` | 需要讨论的问题 |

## 五、迭代管理 (Sprint Management)

### 5.1 Sprint 周期

| 阶段 | 时长 | 活动 |
|------|------|------|
| Sprint Planning | Day 1 | 确定 Sprint 目标、拆解任务、估算工时 |
| Daily Standup | 每日 15min | 同步进度、识别阻塞 |
| Mid-Sprint Review | Day 7 | 进度检查、调整优先级 |
| Sprint Review | Day 14 | 演示成果、收集反馈 |
| Sprint Retrospective | Day 14 | 过程改进、经验总结 |

### 5.2 任务管理

使用 GitHub Issues + Projects 管理：
- **Epic**: 大型功能 (跨多个 Sprint)
- **Story**: 用户故事 (单个 Sprint 内)
- **Task**: 具体任务 (1-3 天)
- **Bug**: 缺陷修复

### 5.3 成功指标 (Success Metrics)

| 指标 | 目标 | 测量方式 |
|------|------|----------|
| 测试覆盖率 | ≥ 80% | `jest --coverage` |
| TypeScript 严格模式 | 零宽松 | `tsc --noEmit` |
| CI 通过率 | ≥ 95% | GitHub Actions |
| PR 审查周期 | ≤ 24h | GitHub Insights |
| Sprint 交付率 | ≥ 85% | Sprint Review |
| 代码异味 | ≤ 5/千行 | SonarQube (可选) |

## 六、CI/CD 流水线

### 6.1 流水线阶段

```
Push/PR → TypeCheck → Lint → Test → Build → Artifact
                                    ↓
                           Coverage Report
```

### 6.2 触发条件

| 事件 | 分支 | 执行 |
|------|------|------|
| Push | `main`, `develop` | TypeCheck + Lint + Test + Build |
| Push | `feature/*` | TypeCheck + Test |
| Pull Request | → `main`, `develop` | TypeCheck + Lint + Test + Build |
| Tag `v*` | — | Build + Artifact Upload |

## 七、版本发布 (Release Process)

1. 从 `develop` 创建 `release/vX.Y.Z`
2. 更新 `CHANGELOG.md` 和版本号
3. 创建 PR → `main`
4. 合并后打 `git tag -a vX.Y.Z`
5. GitHub Release 自动生成

---

*最后更新: 2026-05-13 | 维护者: agent_1 team*