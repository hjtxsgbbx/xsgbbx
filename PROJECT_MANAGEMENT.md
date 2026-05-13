# agent_1 项目管理手册

---

## 一、迭代开发流程总览

```
┌─────────────────────────────────────────────────────────────┐
│                    agent_1 持续迭代开发流程                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐ │
│  │ 技术调研  │ → │ 方案评估  │ → │ 原型验证  │ → │ 集成测试  │ │
│  │ Day 1-2  │   │ Day 3-4  │   │ Day 5-10 │   │ Day 11-13│ │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘ │
│       ↓              ↓              ↓              ↓        │
│  联网搜索        A/B 对比      Coding + UT    CI + E2E      │
│  行业趋势       可行性评估      单元测试      跨平台验证       │
│  竞品分析       社区验证       性能测试      回归测试        │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Day 14: Sprint Review + Retrospective    │  │
│  │  交付物: 技术选型报告 + 实施文档 + 性能对比数据 + 回顾纪要  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、迭代周期与节奏

### 2.1 两周 Sprint 日历

| 星期 | 活动 | 时长 | 参与人 |
|------|------|------|--------|
| **周一** | Sprint 规划会议 | 1h | 全员 |
| **周一~周五** | Daily Standup | 15min | 全员 |
| **周三** | 中期审查 (Mid-Sprint) | 30min | 技术负责人 |
| **第二周周五** | Sprint Review | 1h | 全员 + Stakeholders |
| **第二周周五** | Sprint Retrospective | 45min | 全员 |
| **第二周周五** | Backlog Refinement | 30min | 技术负责人 |

### 2.2 月度会议

| 会议 | 频率 | 内容 |
|------|------|------|
| **月度架构评审** | 每月 1 次 | 技术债务评估、架构演进路线 |
| **月度 Stakeholder 同步** | 每月 1 次 | 优先级调整、新需求收集、满意度调查 |
| **月度技术雷达更新** | 每月 2 次 | 前沿技术趋势评估、技术选型决策 |

---

## 三、版本控制与分支管理

### 3.1 仓库结构

```
agent_1/
├── .github/
│   ├── workflows/ci.yml          # CI/CD 流水线
│   ├── PULL_REQUEST_TEMPLATE.md  # PR 模板
│   ├── SPRINT_TEMPLATE.md        # Sprint 规划
│   └── RETROSPECTIVE_TEMPLATE.md # 回顾会议
├── .husky/
│   ├── pre-commit                # 提交前检查
│   └── commit-msg                # 提交信息规范
├── src/                          # 源代码
├── test/                         # 测试
├── desktop/                      # Electron 桌面端
├── web/                          # WebSocket 客户端
├── CONTRIBUTING.md               # 贡献指南 (分支策略)
├── TECH_RADAR.md                 # 技术雷达图
├── TECH_SELECTION_REPORT.md      # 技术选型报告
├── IMPLEMENTATION_DOC.md         # 实施文档
└── PROJECT_MANAGEMENT.md         # 本文件
```

### 3.2 分支生命周期

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

### 3.3 合并策略

| 分支关系 | 合并方式 | 原因 |
|----------|----------|------|
| `feature/*` → `develop` | Squash and Merge | 保持 develop 历史清晰 |
| `develop` → `main` | Merge Commit | 保留完整发布历史 |
| `hotfix/*` → `main` | Squash and Merge | 紧急修复原子化 |
| `release/*` → `main` | Merge Commit | 发布里程碑 |

---

## 四、代码质量门禁

### 4.1 Pre-Commit (本地)

```
git commit 前自动执行:
  1. tsc --noEmit      (TypeScript 编译)
  2. jest (相关测试)    (增量测试)
  3. console.log 检查  (调试代码检测)
```

### 4.2 CI Pipeline (远程)

```
PR 提交后自动执行:
  Stage 1: Quick Quality Gates
    ├── tsc --noEmit
    └── npm run lint

  Stage 2: Test Matrix (9 jobs)
    ├── ubuntu × Node 18/20/22
    ├── windows × Node 18/20/22
    └── macos   × Node 18/20/22

  Stage 3: Build
    ├── tsc (完整构建)
    └── CLI 启动验证

  Stage 4: Desktop Build  (仅 main/develop)
  Stage 5: Web Build      (仅 main/develop)
  Stage 6: Pipeline Status Report
```

### 4.3 质量标准

| 指标 | 阻断阈值 | 警告阈值 |
|------|----------|----------|
| TypeScript 错误 | > 0 阻断 | — |
| 测试失败 | > 0 阻断 | — |
| 测试覆盖率 | < 70% 警告 | < 80% 建议 |
| Lint 错误 | > 0 警告 | — |
| 代码异味 | > 10/千行 警告 | > 5/千行 建议 |

---

## 五、文档管理规范

### 5.1 必要文档

| 文档 | 更新频率 | 负责人 |
|------|----------|--------|
| `README.md` | 每次功能变更 | 功能开发者 |
| `CONTRIBUTING.md` | 流程变更时 | 技术负责人 |
| `TECH_RADAR.md` | 每 2 周 | 技术负责人 |
| `IMPLEMENTATION_DOC.md` | 每 Sprint | Sprint 负责人 |
| `CHANGELOG.md` | 每次发布 | 发布负责人 |
| `TECH_SELECTION_REPORT.md` | 新技术引入时 | 调研负责人 |

### 5.2 文档版本化

- 所有文档与代码同仓库管理
- 文档变更走相同的 PR + Review 流程
- 技术文档标注最后更新日期

---

## 六、反馈循环机制

### 6.1 内部反馈循环

```
Sprint Review → Retrospective → Backlog Refinement → Sprint Planning
     ↑                                                    ↓
     └──────────── Daily Standup (调整) ←─────────────────┘
```

### 6.2 外部反馈循环

```
Stakeholder Review (月度)
      ↓
优先级调整 → Backlog Update → Sprint Planning
      ↓
User Feedback → Issue Creation → Priority Triage
```

### 6.3 反馈渠道

| 渠道 | 频率 | 处理方式 |
|------|------|----------|
| Sprint Review 演示 | 每 2 周 | 现场收集 → Backlog |
| GitHub Issues | 持续 | 标签分类 → Sprint Planning |
| Stakeholder 月度同步 | 每月 | 优先级调整 → 路线图更新 |
| 技术雷达趋势扫描 | 每 2 周 | 技术评估 → Adopt/Trial/Assess |

---

## 七、成功度量体系

### 7.1 交付效率

| KPI | 计算方式 | 目标 |
|-----|----------|------|
| Sprint 交付率 | 已完成 Story Points / 计划 Story Points | ≥ 85% |
| 需求到上线周期 | Issue 创建到 PR 合并的天数 | ≤ 14 天 |
| PR 审查周期 | PR 创建到合并的小时数 | ≤ 24h |

### 7.2 代码质量

| KPI | 计算方式 | 目标 |
|-----|----------|------|
| 测试覆盖率 | 覆盖行数 / 总行数 | ≥ 80% |
| CI 通过率 | 通过次数 / 总运行次数 | ≥ 95% |
| TypeScript 严格模式 | strict: true | 100% |

### 7.3 技术演进

| KPI | 计算方式 | 目标 |
|-----|----------|------|
| 技术雷达更新频率 | TECH_RADAR.md 更新次数 | ≥ 2 次/月 |
| 技术调研完成率 | 完成调研 / 计划调研 | ≥ 80% |
| 新技术采纳周期 | ASSESS → ADOPT 的 Sprint 数 | ≤ 2 |

---

## 八、紧急响应流程

### 8.1 生产故障 (P0)

```
1. 故障发现 (监控/用户报告)
2. 创建 hotfix 分支 (从 main)
3. 修复 + 测试 (加速审查)
4. 合并 → main (立即部署)
5. 反向合并 → develop (同步修复)
6. Post-mortem 分析 (24h 内)
```

### 8.2 Sprint 中途变更

```
1. 变更请求提出
2. 影响评估 (是否影响 Sprint 目标)
3. 决策:
   - 紧急 → Swap (替换同规模任务)
   - 重要 → 下期 Sprint 优先
   - 一般 → Backlog
```

---

*文档版本: 1.0 | 最后更新: 2026-05-13 | 维护者: agent_1 team*