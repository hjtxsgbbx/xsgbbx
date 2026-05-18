# agent_1 项目管理手册

---

## 一、迭代开发流程总览

```
┌──────────────────────────────────────────────────────────────────┐
│               agent_1 结构化持续迭代开发流程 (2-4 周)               │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────┐│
│  │ 需求分析  │→│   设计   │→│   编码   │→│   测试   │→│ 部署 ││
│  │ Day 1-3  │  │ Day 3-5  │  │ Day 5-11 │  │Day 11-13│  │Day14││
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └─────┘│
│       ↓             ↓             ↓             ↓           ↓    │
│  • 用户反馈   • 技术方案    • 功能开发   • 单元测试   • CI/CD  │
│  • 竞品分析   • 架构设计    • 代码审查   • 集成测试   • 版本发布│
│  • 需求优先级  • API 设计    • 文档编写   • E2E 测试   • 监控   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  持续活动: Daily Standup (15min) | 代码审查 | CI/CD 监控   │   │
│  │  里程碑: Sprint Review + Retrospective | 可工作增量交付     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 二、五阶段迭代开发详解

### 2.1 阶段一：需求分析 (Day 1-3)

| 活动 | 产出 | 参与人 | 工具 |
|------|------|--------|------|
| 用户反馈收集 | 反馈汇总报告 | 全员 | GitHub Issues (`user_feedback` 模板) |
| 竞品与市场分析 | 竞品对比表 | 技术负责人 | 联网搜索 + TECH_RADAR |
| Stakeholder 需求对齐 | 优先级排序 Backlog | Sprint 负责人 | Sprint 规划会议 |
| 需求拆解与估算 | Story Points 分配 | 全员 | SPRINT_TEMPLATE.md |
| 可行性技术调研 | 技术预研报告 | 技术负责人 | TECH_SELECTION_REPORT.md |

**交付物:**
- Sprint Backlog (优先级排序)
- 用户反馈汇总报告
- 技术预研报告 (如有新技术引入)

### 2.2 阶段二：设计 (Day 3-5)

| 活动 | 产出 | 参与人 | 工具 |
|------|------|--------|------|
| 技术方案设计 | 设计文档 | 技术负责人 | Markdown + Mermaid |
| 架构评审 | 架构决策记录 (ADR) | 全员 | 架构评审会议 |
| API / 接口设计 | API 契约 | 功能开发者 | TypeScript 类型定义 |
| 数据模型设计 | 数据模型文档 | 功能开发者 | TypeScript interfaces |
| 原型验证 | 原型代码 | 功能开发者 | 分支开发 |

**交付物:**
- 技术设计文档
- 架构决策记录 (ADR)
- API 类型定义草案
- 原型验证分支

### 2.3 阶段三：编码 (Day 5-11)

| 活动 | 产出 | 参与人 | 工具 |
|------|------|--------|------|
| 功能开发 | 功能代码 | 功能开发者 | feature/* 分支 |
| 单元测试编写 | 测试代码 | 功能开发者 | Jest (TDD 优先) |
| Daily Code Review | 审查意见 | 全员 | GitHub PR Review |
| 文档同步更新 | 更新文档 | 功能开发者 | README / CHANGELOG |
| 中期进度审查 | Mid-Sprint 报告 | Sprint 负责人 | Mid-Sprint Review |

**编码规范:**
- TDD (Test-Driven Development): 先写测试，再写实现
- Conventional Commits 规范
- 所有公开 API 必须标注 JSDoc 类型
- 单函数不超过 50 行 (复杂逻辑除外)

**交付物:**
- 功能代码 (feature 分支)
- 单元测试 (> 80% 覆盖率)
- 更新后的文档

### 2.4 阶段四：测试 (Day 11-13)

| 活动 | 产出 | 参与人 | 工具 |
|------|------|--------|------|
| 集成测试 | 集成测试用例 | 功能开发者 | Jest (integration/) |
| 端到端测试 | E2E 测试用例 | QA / 开发者 | Jest (e2e/) |
| 性能回归测试 | 性能对比报告 | 技术负责人 | 基准测试 |
| 跨平台验证 | 兼容性报告 | CI/CD | GitHub Actions Matrix |
| 安全审查 | 安全审计报告 | 安全负责人 | CodeQL + 手动审查 |
| Bug 修复 | 修复提交 | 全员 | GitHub Issues |

**交付物:**
- 集成测试 + E2E 测试通过
- CI/CD 流水线全部绿色
- 性能对比数据 (如有性能变更)
- 安全审查通过

### 2.5 阶段五：部署 (Day 14)

| 活动 | 产出 | 参与人 | 工具 |
|------|------|--------|------|
| 代码冻结 | release 分支 | 发布负责人 | `scripts/release.sh` |
| Staging 部署验证 | Staging 环境测试 | 全员 | CI/CD `deploy-staging` |
| Production 部署 | 生产发布 | 发布负责人 | CI/CD `deploy-production` |
| 版本 Tag | Git Tag | 发布负责人 | `git tag -a vX.Y.Z` |
| Sprint Review | 演示 + 反馈 | 全员 + Stakeholders | Sprint Review 会议 |
| Sprint Retrospective | 回顾纪要 | 全员 | RETROSPECTIVE_TEMPLATE.md |
| Backlog Refinement | 下期 Backlog | 技术负责人 | SPRINT_TEMPLATE.md |

**交付物:**
- 可工作的产品增量
- GitHub Release
- Sprint Review 演示
- Retrospective 纪要
- 下期 Sprint Backlog 草案

---

## 三、迭代周期与节奏

### 3.1 两周 Sprint 日历

| 星期 | 活动 | 时长 | 参与人 |
|------|------|------|--------|
| **周一** | Sprint 规划会议 | 1h | 全员 |
| **周一~周五** | Daily Standup | 15min | 全员 |
| **周三** | 中期审查 (Mid-Sprint) | 30min | 技术负责人 |
| **第二周周五** | Sprint Review | 1h | 全员 + Stakeholders |
| **第二周周五** | Sprint Retrospective | 45min | 全员 |
| **第二周周五** | Backlog Refinement | 30min | 技术负责人 |

### 3.2 四周 Sprint 日历 (大型迭代)

| 星期 | 活动 | 时长 | 参与人 |
|------|------|------|--------|
| **第一周周一** | Sprint 规划 + 需求分析 | 2h | 全员 |
| **第一周周三** | 技术方案评审 | 1h | 技术负责人 |
| **第一周周五** | 设计冻结 (Design Freeze) | — | 全员 |
| **第二、三周** | 编码 + 持续审查 | — | 全员 |
| **第三周周五** | 代码冻结 (Code Freeze) | — | 全员 |
| **第四周周一~三** | 集中测试 + Bug 修复 | — | 全员 |
| **第四周周四** | 部署验证 | 1h | 发布负责人 |
| **第四周周五** | Review + Retrospective | 2h | 全员 + Stakeholders |

### 3.3 月度会议

| 会议 | 频率 | 内容 |
|------|------|------|
| **月度架构评审** | 每月 1 次 | 技术债务评估、架构演进路线 |
| **月度 Stakeholder 同步** | 每月 1 次 | 优先级调整、新需求收集、满意度调查 |
| **月度技术雷达更新** | 每月 2 次 | 前沿技术趋势评估、技术选型决策 |

---

## 四、每日站会机制

### 4.1 站会规则

| 规则 | 说明 |
|------|------|
| 时长 | 严格 15 分钟 |
| 频率 | 每个工作日 |
| 时间 | 固定时间 (建议 9:30 AM) |
| 站位 | 站立进行 (保持高效) |
| 内容 | 三个问题：昨日完成 / 今日计划 / 阻塞项 |

### 4.2 站会模板

使用 `npm run standup` 自动生成每日站会记录，模板位于 [.github/DAILY_STANDUP.md](.github/DAILY_STANDUP.md)。

### 4.3 阻塞项处理流程

```
发现阻塞 → 站会标注 → 指定负责人 → 4h 内给出方案
                                    ↓
                    无法解决 → 升级到 Sprint 负责人 → 调整 Sprint 计划
```

---

## 五、版本控制与分支管理

### 5.1 仓库结构

```
agent_1/
├── .github/
│   ├── workflows/ci.yml          # CI/CD 流水线 (11 阶段)
│   ├── PULL_REQUEST_TEMPLATE.md  # PR 模板
│   ├── SPRINT_TEMPLATE.md        # Sprint 规划模板
│   ├── RETROSPECTIVE_TEMPLATE.md # 回顾会议模板
│   ├── DAILY_STANDUP.md          # 每日站会模板
│   ├── CODEOWNERS                # 代码审查自动分配
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md         # Bug 报告模板
│   │   ├── feature_request.md    # 功能请求模板
│   │   └── user_feedback.md      # 用户反馈模板
│   └── standups/                 # 站会记录归档
├── .husky/
│   ├── pre-commit                # 提交前检查
│   └── commit-msg                # 提交信息规范
├── scripts/
│   ├── daily-standup.sh          # 每日站会生成器
│   ├── pre-review-check.sh       # 代码审查预检
│   └── release.sh                # 版本发布助手
├── src/                          # 源代码
├── test/
│   ├── integration/              # 集成测试
│   ├── e2e/                      # 端到端测试
│   └── *.test.ts                 # 单元测试
├── desktop/                      # Electron 桌面端
├── web/                          # WebSocket 客户端
├── CONTRIBUTING.md               # 贡献指南
├── CHANGELOG.md                  # 变更日志
├── TECH_RADAR.md                 # 技术雷达图
├── TECH_SELECTION_REPORT.md      # 技术选型报告
└── PROJECT_MANAGEMENT.md         # 本文件
```

### 5.2 分支生命周期

```
main  ─────────────────────●──────●─── (tags: v1.0.0, v1.1.0)
                            ↑      ↑
develop ────●───●───●───●───┼──────┼───
            ↑   ↑   ↑   ↑   ↑      ↑
            │   │   │   │   │      │
feature/A ──┘   │   │   │   │      │
feature/B ──────┘   │   │   │      │
feature/C ──────────┘   │   │      │
hotfix/X ────────────────┘   │      │
release/v1.0 ────────────────┘      │
release/v1.1 ───────────────────────┘
```

### 5.3 合并策略

| 分支关系 | 合并方式 | 原因 |
|----------|----------|------|
| `feature/*` → `develop` | Squash and Merge | 保持 develop 历史清晰 |
| `develop` → `main` | Merge Commit | 保留完整发布历史 |
| `hotfix/*` → `main` | Squash and Merge | 紧急修复原子化 |
| `release/*` → `main` | Merge Commit | 发布里程碑 |

---

## 六、代码审查制度

### 6.1 审查流程

```
开发者提交 PR → 自动分配审查者 (CODEOWNERS) → CI 自动检查
                                                    ↓
                                              审查者 Review
                                                    ↓
                                    ┌── 通过 → 合并
                                    │
                                    └── 修改 → 开发者修复 → 重新审查
```

### 6.2 审查检查清单

| 类别 | 检查项 | 阻断级别 |
|------|--------|----------|
| **类型安全** | `tsc --noEmit` 通过 | 🔴 阻断 |
| **测试** | 所有测试通过 | 🔴 阻断 |
| **测试** | 新功能有测试覆盖 | 🔴 阻断 |
| **代码风格** | 遵循 `.editorconfig` | 🟡 建议 |
| **安全性** | 无路径遍历 / 注入漏洞 | 🔴 阻断 |
| **安全性** | 无硬编码密钥 / 敏感信息 | 🔴 阻断 |
| **错误处理** | 使用 `Result/Either` 模式 | 🟡 建议 |
| **命名** | 清晰且一致 | 🟡 建议 |
| **复杂度** | 单函数 ≤ 50 行 | 🟡 建议 |
| **遗留代码** | 无 `console.log` / `TODO` | 🟡 建议 |
| **文档** | 公共 API 有 JSDoc | 🟡 建议 |
| **性能** | 无明显性能问题 | 🟡 建议 |

### 6.3 审查意见标签

| 标签 | 含义 |
|------|------|
| `🔴 blocking` | 必须修改后才能合并 |
| `🟡 suggestion` | 建议修改，非强制 |
| `🟢 praise` | 写得好的地方 |
| `🔵 question` | 需要讨论的问题 |

### 6.4 审查预检脚本

提交 PR 前运行 `bash scripts/pre-review-check.sh` 自动执行：
- TypeScript 类型检查
- ESLint 检查
- 单元测试 / 集成测试 / E2E 测试
- 覆盖率门禁
- console.log 检测
- TODO/FIXME 检测

---

## 七、自动化测试策略

### 7.1 测试金字塔

```
        ┌──────┐
        │ E2E  │  ← 关键用户流程 (CLI 完整交互)
       ┌┴──────┴┐
       │ 集成测试 │  ← 模块间协作 (TAOR Loop, Permission Pipeline)
      ┌┴────────┴┐
      │  单元测试  │  ← 每个模块独立测试 (80%+ 覆盖率)
     └───────────┘
```

### 7.2 测试分层

| 层级 | 命令 | 覆盖范围 | 运行频率 |
|------|------|----------|----------|
| 单元测试 | `npm run test:unit` | 所有 src/ 模块 | 每次 commit |
| 集成测试 | `npm run test:integration` | TAOR Loop, Permissions, MCP | 每次 PR |
| E2E 测试 | `npm run test:e2e` | CLI 工作流, 错误恢复 | 每次 PR |
| 覆盖率 | `npm run test:coverage` | 全量覆盖率报告 | 每次 PR |

### 7.3 测试数量统计

| 测试套件 | 文件数 | 说明 |
|----------|--------|------|
| 单元测试 | 18+ | API, MCP, Permissions, Healer, Compaction 等 |
| 集成测试 | 2 | TAOR Loop 完整流程, Permission Pipeline |
| E2E 测试 | 2 | CLI 工作流, Error Healing 5-strategy |

---

## 八、CI/CD 流水线

### 8.1 完整流水线 (11 阶段)

```
代码提交 (Push/PR)
  │
  ├── Stage 1: Quick Quality Gates (TypeScript + Lint)
  │     └── ✓ 通过后进入 Stage 2
  │
  ├── Stage 2: Unit Tests (ubuntu/windows/macos × Node 18/20/22)
  │     └── ✓ 通过后并行执行 Stage 3 + Stage 4
  │
  ├── Stage 3: Integration Tests ──┐
  ├── Stage 4: E2E Tests        ──┤
  │     └── ✓ 全部通过后进入 Stage 5 │
  │                                │
  ├── Stage 5: Coverage Gate      │
  │     └── ✓ 覆盖率 ≥ 60%        │
  │                                │
  ├── Stage 6: Build               │
  │     └── ✓ 构建成功             │
  │                                │
  ├── Stage 7: Desktop Build (仅 main/develop)
  ├── Stage 8: Web Build     (仅 main/develop)
  │                                │
  ├── Stage 9:  Deploy Staging (develop → staging)
  ├── Stage 10: Deploy Production (main → production)
  ├── Stage 11: Create Release (main + release commit → GitHub Release)
  │
  └── Pipeline Status Report
```

### 8.2 触发条件

| 事件 | 分支 | 执行阶段 |
|------|------|----------|
| Push | `main`, `develop` | Stage 1-11 (全部) |
| Pull Request | → `main`, `develop` | Stage 1-8 (不含 Deploy/Release) |
| Scheduled (周一 8AM) | `develop` | Stage 1-5 (质量检查) |

### 8.3 部署环境

| 环境 | 分支 | 触发条件 | 用途 |
|------|------|----------|------|
| `staging` | `develop` | Push 自动 | 集成验证 |
| `production` | `main` | Push 自动 | 生产发布 |

---

## 九、质量标准

| 指标 | 阻断阈值 | 警告阈值 | 目标 |
|------|----------|----------|------|
| TypeScript 错误 | > 0 阻断 | — | 0 |
| 测试失败 | > 0 阻断 | — | 0 |
| 测试覆盖率 | < 60% 阻断 | < 80% 警告 | ≥ 80% |
| Lint 错误 | > 0 警告 | — | 0 |
| CI 通过率 | — | < 95% 警告 | ≥ 95% |
| PR 审查周期 | — | > 48h 警告 | ≤ 24h |
| Sprint 交付率 | — | < 85% 警告 | ≥ 85% |

---

## 十、用户反馈循环

### 10.1 反馈收集渠道

| 渠道 | 频率 | 模板 | 处理流程 |
|------|------|------|----------|
| GitHub Issues (user_feedback) | 持续 | `ISSUE_TEMPLATE/user_feedback.md` | 标签分类 → Sprint Planning |
| Sprint Review 演示 | 每 2 周 | 现场收集 | 即时记录 → Backlog |
| Stakeholder 月度同步 | 每月 | 会议纪要 | 优先级调整 → 路线图更新 |
| 用户满意度调查 | 每月 | NPS 评分 | 量化分析 → 改进计划 |

### 10.2 反馈处理流程

```
用户反馈提交 (GitHub Issue / 演示 / 调查)
      ↓
标签分类: feedback / bug / enhancement
      ↓
优先级评估: P0 (阻断) / P1 (高) / P2 (中) / P3 (低)
      ↓
┌── P0 → 立即创建 hotfix
├── P1 → 当前 Sprint 纳入
├── P2 → 下期 Sprint 规划
└── P3 → Backlog 待定
      ↓
处理后回复反馈者 → 关闭 Issue
```

### 10.3 反馈响应 SLA

| 优先级 | 首次响应 | 解决时间 |
|--------|----------|----------|
| P0 阻断 | ≤ 4h | ≤ 24h |
| P1 高 | ≤ 24h | ≤ 当前 Sprint |
| P2 中 | ≤ 48h | ≤ 下期 Sprint |
| P3 低 | ≤ 1 周 | 按 Backlog 排期 |

---

## 十一、文档管理规范

### 11.1 必要文档

| 文档 | 更新频率 | 负责人 |
|------|----------|--------|
| `README.md` | 每次功能变更 | 功能开发者 |
| `CONTRIBUTING.md` | 流程变更时 | 技术负责人 |
| `CHANGELOG.md` | 每次发布 | 发布负责人 |
| `TECH_RADAR.md` | 每 2 周 | 技术负责人 |
| `IMPLEMENTATION_DOC.md` | 每 Sprint | Sprint 负责人 |
| `TECH_SELECTION_REPORT.md` | 新技术引入时 | 调研负责人 |
| `PROJECT_MANAGEMENT.md` | 流程变更时 | Sprint 负责人 |

### 11.2 文档版本化

- 所有文档与代码同仓库管理
- 文档变更走相同的 PR + Review 流程
- 技术文档标注最后更新日期

---

## 十二、成功度量体系

### 12.1 交付效率

| KPI | 计算方式 | 目标 |
|-----|----------|------|
| Sprint 交付率 | 已完成 Story Points / 计划 Story Points | ≥ 85% |
| 需求到上线周期 | Issue 创建到 PR 合并的天数 | ≤ 14 天 |
| PR 审查周期 | PR 创建到合并的小时数 | ≤ 24h |
| 部署频率 | 生产部署次数 / Sprint | ≥ 1 |

### 12.2 代码质量

| KPI | 计算方式 | 目标 |
|-----|----------|------|
| 测试覆盖率 | 覆盖行数 / 总行数 | ≥ 80% |
| CI 通过率 | 通过次数 / 总运行次数 | ≥ 95% |
| TypeScript 严格模式 | strict: true | 100% |
| 代码异味 | ESLint warnings / 千行 | ≤ 5 |

### 12.3 技术演进

| KPI | 计算方式 | 目标 |
|-----|----------|------|
| 技术雷达更新频率 | TECH_RADAR.md 更新次数 | ≥ 2 次/月 |
| 技术调研完成率 | 完成调研 / 计划调研 | ≥ 80% |
| 新技术采纳周期 | ASSESS → ADOPT 的 Sprint 数 | ≤ 2 |

### 12.4 用户满意度

| KPI | 计算方式 | 目标 |
|-----|----------|------|
| NPS 评分 | 月度用户调查 | ≥ 50 |
| Bug 修复率 | 当月修复 / 当月报告 | ≥ 90% |
| 反馈响应时间 | 反馈提交到首次响应 | ≤ 24h (P1+) |

---

## 十三、紧急响应流程

### 13.1 生产故障 (P0)

```
1. 故障发现 (监控/用户报告)
2. 创建 hotfix 分支 (从 main)
3. 修复 + 测试 (加速审查)
4. 合并 → main (立即部署)
5. 反向合并 → develop (同步修复)
6. Post-mortem 分析 (24h 内)
```

### 13.2 Sprint 中途变更

```
1. 变更请求提出
2. 影响评估 (是否影响 Sprint 目标)
3. 决策:
   - 紧急 → Swap (替换同规模任务)
   - 重要 → 下期 Sprint 优先
   - 一般 → Backlog
```

---

## 十四、快速命令参考

| 命令 | 用途 |
|------|------|
| `npm run standup` | 生成本日站会记录 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 代码检查 |
| `npm run lint:fix` | 自动修复 ESLint 问题 |
| `npm test` | 运行全部测试 |
| `npm run test:unit` | 仅运行单元测试 |
| `npm run test:integration` | 仅运行集成测试 |
| `npm run test:e2e` | 仅运行 E2E 测试 |
| `npm run test:coverage` | 运行测试 + 覆盖率报告 |
| `bash scripts/pre-review-check.sh` | PR 提交前预检 |
| `bash scripts/release.sh 1.1.0` | 创建版本发布 |

---

*文档版本: 2.0 | 最后更新: 2026-05-13 | 维护者: agent_1 team*