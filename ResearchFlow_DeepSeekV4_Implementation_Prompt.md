# Resonix + DeepSeek V4：ResearchFlow 实施提示词

> 使用方式：将本文件与 `ResearchFlow_PRODUCT_SPEC.md` 一起放入 fork 后的仓库根目录。  
> 然后在 Resonix 中让 DeepSeek V4 读取两份文件，再执行下面的总提示词。  
> **不要只把本提示词复制给模型却不给它 PRODUCT_SPEC。**

---

## 总提示词

你现在是这个仓库的 Principal Software Engineer / Staff Full-stack Engineer。

你的任务不是从零开发一个新 Web App，而是：

**在 `OpenLAIR/dr-claw` 的 fork 上，将现有产品重构/扩展为 ResearchFlow：一个面向计算机、AI、ML、RL 研究者，从 Idea Locked 管理到最终论文 Submitted 的 human-centric Research Progress OS。**

产品详细需求、生命周期、数据模型、页面、运行方式和验收标准见：

```text
ResearchFlow_PRODUCT_SPEC.md
```

你必须先完整阅读该文件，然后再开始实施。

---

# 0. 最重要的工作原则

## 0.1 不允许直接开始大改

第一步必须先对当前仓库做 architecture reconnaissance。

至少检查：

```text
package.json
src/
server/
shared/
electron/
test/
playwright.config.ts
.env.example
README.md
electron/README.md
```

重点弄清：

- React/Vite app entry
- routing
- layout/navigation
- existing project model
- Research Lab model
- SQLite database location and migration mechanism
- server routes
- WebSocket architecture
- Electron embedded server lifecycle
- native module rebuild
- i18n
- current tests
- desktop build pipeline
- File/Git Explorer coupling
- agent integrations

然后生成：

```text
docs/researchflow/ARCHITECTURE_BASELINE.md
```

包含：

1. current architecture
2. reusable modules
3. modules to hide/deprecate
4. modules requiring change
5. database migration plan
6. routing plan
7. implementation risks

在这个文件完成前，不做大规模业务重构。

---

# 0.2 不从零重写

必须尽可能复用：

- Electron shell
- Express/WebSocket server
- SQLite
- React/Vite
- Tailwind
- CodeMirror
- project/workspace handling
- file explorer
- git explorer
- settings
- i18n
- desktop file picker
- logs
- build scripts

不要另起：

```text
researchflow-new/
```

不要改成：

- Next.js
- Python backend
- PostgreSQL
- Docker-only architecture

除非仓库现状证明 PRODUCT_SPEC 中的假设完全错误，并且你在文档中给出充分理由。

默认沿用现有技术栈。

---

# 0.3 产品核心不是 Auto Research

ResearchFlow 是：

```text
human-centric Research Progress OS
```

不是：

```text
autonomous AI scientist
```

V1 必须在没有任何 LLM/API Key 的情况下完整可用。

现有 Dr. Claw 的：

- Auto Research
- Promotion
- News
- agent-heavy onboarding

优先采取：

```text
hide / feature flag / de-emphasize
```

而不是第一阶段暴力删除。

避免大范围回归。

---

# 0.4 数据不能只存在 UI state

所有核心对象必须真正持久化。

核心关系包括：

```text
Project
Stage
StageGate
Task

Experiment
ExperimentRun

Claim
Evidence
ClaimEvidence

Decision
Literature

FigureTable
ManuscriptSection
ReviewComment

SubmissionProfile
SubmissionItem
ActivityLog
```

使用当前 SQLite 基础设施和 migration 风格。

不得用 localStorage 替代核心数据库。

---

# 1. 目标运行方式

必须同时支持：

## Development

在 WSL2 Ubuntu 中：

```bash
npm install
npm run dev
```

Windows Chrome/Edge：

```text
http://localhost:5173
```

开发代码位于 WSL Linux filesystem，例如：

```text
~/projects/researchflow
```

不要要求开发者把仓库放在 `/mnt/c/`。

---

## Desktop

保留现有 Electron 架构。

Windows 最终用户：

```text
双击 ResearchFlow.exe
```

必须实现：

- Electron 自动启动 embedded backend
- 自动加载 UI
- 自动打开本地 DB
- 不要求用户先启动 WSL
- 不要求用户执行 npm
- 不要求用户手动打开浏览器

Windows build：

```bash
npm run desktop:dist:win
```

若当前 package scripts 已存在，优先复用并只改 productName/appId/artifactName 等必要配置。

---

# 2. Windows / WSL 的边界

ResearchFlow 本体 Desktop Runtime 在 Windows。

研究代码可以在：

```text
Windows local
```

或：

```text
WSL2
```

不要让 Electron 业务逻辑依赖 WSL 才能启动。

设计：

```ts
interface ExecutionAdapter {
  validate(): Promise<EnvironmentStatus>
  run(command: string, cwd: string): Promise<ExecutionResult>
  git(args: string[], cwd: string): Promise<ExecutionResult>
  exists(path: string): Promise<boolean>
}
```

至少留出：

```text
WindowsLocalAdapter
WSLAdapter
```

的架构边界。

WSL project metadata：

```text
workspace_type
wsl_distro
wsl_path
windows_path
```

如果完整 WSL execution 在当前阶段会明显扩大工作量：

1. 先实现 schema/interface。
2. 实现 `Open in WSL Terminal` 和 basic validation。
3. 把完整 WSL runner 标记为 Phase 5。
4. 不得因此延迟 ResearchFlow 核心业务。

---

# 3. 实施顺序

严格采用增量开发。

---

## Phase 0 — Baseline

完成：

1. 当前项目成功 `npm install`
2. 当前 web 成功运行
3. 当前 desktop dev 成功运行（若环境支持）
4. current tests 运行
5. current typecheck/build 运行
6. 写 `ARCHITECTURE_BASELINE.md`

如果存在上游 bug：

记录：

```text
docs/researchflow/UPSTREAM_ISSUES.md
```

不要把它们混淆为你的新功能 bug。

---

## Phase 1 — Domain Core

先做数据库和 API，不先堆 UI。

新增：

```text
rf_projects
rf_stages
rf_stage_gates
rf_tasks
rf_task_dependencies

rf_activity_log
```

要求：

- migration 可重复、安全
- 不破坏现有数据库
- foreign key / indexes 合理
- timestamps 一致
- API validation
- API tests

实现 10 个默认 Stage template。

创建 ResearchFlow project 时自动初始化 stages + gates。

---

## Phase 2 — Portfolio / Dashboard / Roadmap

实现：

```text
Portfolio
Project Dashboard
Roadmap
Stage Gate UI
Next Critical Action
Project Health
```

Dashboard 首屏必须显示：

- Overall Progress
- Current Stage
- Deadline
- Days Remaining
- Blockers
- Next Critical Action
- Experiment summary
- Evidence summary
- Manuscript summary
- Submission readiness

不要把 dashboard 做成纯 decorative charts。

信息优先。

---

## Phase 3 — Experiments / Evidence

数据库：

```text
rf_experiments
rf_experiment_runs

rf_claims
rf_evidence
rf_claim_evidence

rf_decisions
rf_literature
rf_figures_tables
```

实现完整 CRUD 和关系。

### Experiment 必须支持

```text
Experiment 1 → N Runs
```

Run 至少有：

- seed
- git commit
- branch
- config path
- result path
- metrics
- device
- status
- failure reason

### Failed experiment

不得删除。

必须有明确 failure classification。

### Claim-Evidence

必须能显示：

- Core Claim
- Current Evidence
- Evidence Strength
- Claim Status
- Missing Evidence

Dashboard 要检测：

```text
Critical Missing Evidence
```

---

## Phase 4 — Results Freeze / Manuscript / Submission

实现：

```text
Results Frozen
Manuscript Tracker
Figure/Table Registry
Internal Review
Submission Manager
```

### Results Freeze

Freeze 时生成 snapshot metadata：

- timestamp
- optional git commit
- result version
- notes

存在 Critical Missing Evidence 时：

默认禁止完成 Results Frozen Gate。

允许 override，但必须：

- 显式确认
- 填写 reason
- 写 Activity Log

### Submission Ready

必须根据 Required Checklist 自动计算。

`Submitted` 只能由用户显式操作。

不能由 AI/自动规则自行标记。

---

## Phase 5 — Desktop Hardening

完成：

- product rename
- appId rename
- icons placeholder/update mechanism
- userData paths
- SQLite path
- backup
- project export
- startup error UI
- log access
- Windows installer
- WSL adapter
- desktop smoke test

---

# 4. UI / UX 规则

## 4.1 默认语言

简体中文。

保留 English。

不要删除现有 i18n。

---

## 4.2 信息密度

目标接近：

```text
Linear
GitHub
modern IDE
```

而不是大型 ERP。

避免：

- 大量无意义卡片
- 过度渐变
- 巨大 Hero area
- “AI magic” 装饰
- dashboard 上塞十几个饼图

---

## 4.3 Status visual system

为以下状态建立统一 token：

- success
- warning
- danger
- muted
- active
- frozen
- blocked

不要在各组件中随意 hardcode 独立颜色。

---

## 4.4 所有列表

尽量支持：

- search
- filter
- sort
- quick edit

但 V1 不要为了复杂 table framework 阻塞核心功能。

---

# 5. Progress 算法

使用 PRODUCT_SPEC 定义：

```text
StageProgress =
0.70 × RequiredGateCompletion
+
0.30 × WeightedTaskCompletion
```

Overall：

```text
sum(StageWeight × StageProgress)
```

Stage Completed：

```text
ALL required gates == passed
```

不要把 task completion 当成 stage truth。

---

# 6. Next Critical Action

实现 deterministic function。

优先顺序：

1. current stage blocker
2. overdue critical
3. task related to unfinished required gate
4. critical/high task due within 7 days
5. highest-priority in-progress
6. highest-priority todo

请：

- 把算法放在独立 domain/service module
- 写 unit tests
- UI 不自行复制逻辑

---

# 7. Activity Log

以下操作必须记录：

- Stage changed
- Gate passed/unpassed
- Experiment created/completed/failed
- Claim status changed
- Evidence linked/unlinked
- Results Frozen
- Submission Ready achieved/lost
- Submitted
- Major Decision created

Activity Log 作为后续 AI digest 的基础数据。

---

# 8. 删除策略

核心科研对象优先 soft delete / archive：

- Experiments
- Claims
- Decisions
- Evidence

特别是：

```text
Failed Experiment
```

禁止因为 UI 上点击 Done/Failed 就物理删除。

---

# 9. 兼容现有项目

必须支持：

```text
Create New Research Project
```

以及：

```text
Attach Existing Repository
```

不得强制现有科研 repo 重构成固定目录。

ResearchFlow path references 应允许：

- absolute Windows path
- WSL metadata
- relative project path

---

# 10. Backup / Export

实现：

## Backup

备份：

- SQLite
- settings
- ResearchFlow metadata

## Project Export

输出 zip：

```text
project.json
stages.json
tasks.json
experiments.json
claims.json
decisions.json
literature.json
manuscript.json
submission.json
```

默认不打包：

- datasets
- checkpoints
- huge result directories

---

# 11. 测试要求

每个 Phase 都必须添加测试。

最低要求：

## Unit

- progress calculation
- stage gate logic
- next critical action
- submission readiness
- claim evidence health

## API

- CRUD
- relationships
- validation
- persistence

## Integration

- new project stage initialization
- experiment → run
- claim → evidence
- results freeze
- submission

## E2E / Playwright

至少：

```text
Create Project
→ open Dashboard
→ pass Idea gates
→ advance stage
```

和：

```text
create Claim without evidence
→ see warning
→ attach Experiment evidence
→ warning resolved
```

以及：

```text
complete Submission checklist
→ Submission Ready
→ manually mark Submitted
```

---

# 12. 每个 Phase 的交付方式

不要一次改几百个文件然后才汇报。

每个 Phase：

1. 说明本阶段目标。
2. 列出计划修改文件。
3. 实施。
4. 运行：
   ```bash
   npm run typecheck
   npm run build
   npm test
   ```
5. 运行相关 integration/e2e tests。
6. 修复错误。
7. 更新：
   ```text
   docs/researchflow/IMPLEMENTATION_STATUS.md
   ```
8. 给出：
   - completed
   - remaining
   - known issues
   - next phase

---

# 13. IMPLEMENTATION_STATUS.md 格式

维护：

```markdown
# ResearchFlow Implementation Status

## Phase 0
- [x] ...

## Phase 1
- [x] Database
- [ ] ...

## Current Risks
- ...

## Test Status
- typecheck:
- build:
- unit:
- e2e:

## Next
- ...
```

这是持续开发的 source of truth。

---

# 14. 不允许做的事情

除非明确证明必要，否则不要：

- 重写整个前端
- 换框架
- 换数据库
- 引入 Kubernetes
- 引入微服务
- 引入 Redis
- 引入云端账户系统
- 引入复杂 event sourcing
- 把所有状态保存成一个 JSON
- 删除上游 license/notice
- 为“代码优雅”进行大规模无关重构
- 为 AI 功能牺牲无 AI 可用性
- 把产品进度等价为 TODO 完成率

---

# 15. License

保留上游：

```text
LICENSE
NOTICE
copyright attribution
```

不要擅自改为 proprietary license。

所有新增源文件遵从本 fork 最终决定的、与上游兼容的许可证声明策略。

在 README 中写明上游来源和修改关系。

---

# 16. Product Rename

暂定产品名：

```text
ResearchFlow
```

代码中不要一次 global replace `Dr. Claw`。

分层处理：

1. UI product branding
2. Electron productName
3. appId
4. installer name
5. data directory
6. server/user-agent identifiers
7. internal legacy compatibility

旧 migration / key 名如直接改会导致兼容问题，则保留内部名并记录。

---

# 17. 最终验收命令

最终至少保证：

```bash
npm install
npm run typecheck
npm run build
npm test
```

Development：

```bash
npm run dev
```

Desktop：

```bash
npm run desktop:dev
```

Windows installer：

```bash
npm run desktop:dist:win
```

---

# 18. 最终用户体验

产品完成后的用户路径必须是：

```text
下载 ResearchFlow-x.y.z-win-x64.exe
        ↓
安装
        ↓
双击 ResearchFlow
        ↓
创建 / Attach Research Project
        ↓
立即进入 Research Dashboard
```

用户不需要：

- npm
- Node
- WSL
- terminal
- localhost
- 手动 server

如果用户选择 WSL Research Workspace：

```text
Settings
→ Execution Environment
→ WSL
→ Ubuntu-22.04
→ select/enter Linux project path
```

ResearchFlow 自身仍是 Windows app。

---

# 19. 你开始执行时的第一条回复格式

不要立即给代码。

先输出：

```markdown
## Repository Assessment

### Current Architecture
...

### Reusable Components
...

### High-risk Areas
...

### Proposed Migration Strategy
...

### Phase 0 Plan
...

### Files to inspect first
...
```

然后开始读取仓库、运行 baseline、写 `ARCHITECTURE_BASELINE.md`。

---

# 20. 质量优先级

如果需求冲突，按以下顺序：

1. 数据正确性
2. 科研状态可追溯性
3. 不破坏已有数据
4. 桌面启动可靠性
5. 核心工作流 UX
6. 测试
7. 性能
8. 视觉 polish
9. AI 功能

---

# 21. 最终目标

ResearchFlow V1 的核心判断不是“功能多不多”。

完成后必须满足：

> 打开一个项目，10 秒内我能知道它现在在哪个科研阶段、有哪些 blocker、下一步最关键的动作是什么、哪些核心 claim 还缺 evidence，以及距离论文最终提交还缺哪些 gate。

如果没有做到这一点，即使增加了很多 AI 功能，也不算完成。
