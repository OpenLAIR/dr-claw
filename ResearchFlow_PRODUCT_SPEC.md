# ResearchFlow 产品需求与技术实施文档（PRD + Technical Spec）

> 版本：v0.1  
> 日期：2026-08-07  
> 产品定位：面向计算机 / AI / ML / RL 研究者的本地优先（local-first）科研项目进度管理系统  
> 推荐代码底座：OpenLAIR / dr-claw  
> 目标平台：Windows 11 主用；WSL2 Ubuntu 作为开发与可选执行环境  
> V1 目标：从 Idea 确定一直管理到论文最终提交（Submitted）

---

## 1. 产品一句话定义

**ResearchFlow 是一个 human-centric Research Progress OS：打开软件后 10 秒内，研究者必须能知道“项目做到哪了、卡在哪里、下一步做什么、离投稿还缺什么”。**

它不是 Jira 的科研换皮，也不是“让 AI 自动替人完成论文”的 Auto Research 系统。

核心对象不是 Issue / Sprint，而是：

- Research Idea
- Literature / Gap
- Research Design
- Experiment / Run
- Claim
- Evidence
- Decision
- Figure / Table
- Manuscript Section
- Submission Gate

---

## 2. 开源底座与参考项目

### 2.1 主底座：Dr. Claw

项目地址：

- https://github.com/OpenLAIR/dr-claw

选择原因：

1. 已覆盖 Survey → Ideation → Experiment → Publication 等科研生命周期。
2. 已具有项目、任务、文件、Git、Research Lab 等基础能力。
3. 技术栈适合二次开发：
   - Frontend：React 18 + Vite + Tailwind
   - Backend：Node.js + Express + WebSocket
   - Local DB：SQLite / better-sqlite3
4. 已有 Electron Desktop Shell。
5. Windows 可构建 NSIS `.exe` 安装包。
6. Electron 桌面端会自动启动现有 Express/WebSocket 后端，不需要用户另开服务。
7. Web 模式和 Desktop 模式共用主要业务逻辑。

### 2.2 数据思想参考：XScientist

项目 / 论文：

- https://github.com/smileformylove/XScientist
- https://arxiv.org/abs/2607.12301

只借鉴以下思想，不复制其 autonomous scientist 产品定位：

- exploration DAG
- failed branches 也是科研记录
- claim-to-evidence anchors
- provenance
- experiment / artifact 可追溯性
- reproducibility hooks

### 2.3 UX 参考：Leantime

项目：

- https://github.com/Leantime/leantime

借鉴：

- Goals
- Milestones
- Project Dashboard
- Idea Board
- Risk / Blocker
- Roadmap / Gantt 的信息组织方式

不建议以其作为代码底座。

---

## 3. 产品边界

### 3.1 V1 必须解决

1. 创建和管理多个科研项目。
2. 每个项目从 Idea Locked 一直推进到 Submitted。
3. 用 Stage Gate 而不是普通 TODO 完成率表示科研阶段。
4. 管理实验与实验运行结果。
5. 记录失败实验。
6. 建立 Claim ↔ Evidence ↔ Experiment ↔ Figure/Table 关系。
7. 记录关键 Research Decision。
8. 跟踪论文各 Section 的写作与 Review 状态。
9. 跟踪投稿前 checklist。
10. 自动给出当前 blocker 和 Next Critical Action。
11. 本地存储、可备份、可导出。
12. Web 开发模式和 Windows `.exe` 桌面模式都能运行。

### 3.2 V1 明确不做

以下内容不应阻塞 V1：

- 自动生成完整科研 Idea
- 自动替用户跑完所有实验
- 自动写完整论文
- 多 Agent autonomous research
- Zotero 双向同步
- Overleaf 双向同步
- W&B 深度同步
- Slurm/GPU 调度中心
- arXiv 自动爬取
- 多用户团队权限
- 云端账户体系
- 手机 App
- 复杂即时通讯
- Promotion / PPT / 视频生成

这些属于 V2/V3。

---

## 4. 核心设计原则

### P1. Human in the loop

AI/Agent 是辅助工具，不是 ResearchFlow 的主状态机。

**人的研究决策拥有最高优先级。**

### P2. Research state > Task state

不能只显示：

`Todo → Doing → Done`

必须显示：

`Idea → Gap → Design → Prototype → Main Exp → Validation → Results Frozen → Manuscript → Review → Submission`

### P3. Evidence first

任何论文核心 Claim 最终都应该能追溯到实验、图表、分析记录或文献证据。

### P4. Failure is data

失败实验不得自动删除。

### P5. Local first

默认所有研究状态存在本地 SQLite 和工作区中。

V1 不依赖云服务。

### P6. Offline usable

没有网络时，除外部集成功能外，核心进度管理应完整可用。

---

# 5. 科研生命周期

默认提供以下 10 个阶段。

---

## Stage 1 — Idea Locked

### 目的

把“一个模糊想法”变成可以执行的研究问题。

### 必填字段

- Project Title
- One-line Idea
- Research Question
- Motivation
- Novelty Hypothesis
- Expected Contribution
- Target Venue（可暂未确定）
- Risk Notes

### Gate

- [ ] Research Question 明确
- [ ] Motivation 明确
- [ ] Novelty Hypothesis 已记录
- [ ] 至少一个可验证 Hypothesis
- [ ] 明确下一阶段 Literature Scope

---

## Stage 2 — Literature & Gap

### 目标

建立 Related Work 和 Research Gap 的证据基础。

### 内容

- Key Papers
- SOTA
- Baselines
- Competing Methods
- Related Work Matrix
- Gap Statement
- Reproduction candidates

### Gate

- [ ] 核心近邻工作已记录
- [ ] Baseline 列表形成
- [ ] Research Gap 有证据支持
- [ ] 已检查“Idea 是否已被发表”
- [ ] Related Work Matrix 可支持后续论文写作

---

## Stage 3 — Research Design

### 内容

- Proposed Method
- Hypotheses
- Baselines
- Datasets / Environments
- Metrics
- Seeds
- Ablation Plan
- Compute Plan
- Success Criteria

### Gate

- [ ] Main Hypothesis 可实验验证
- [ ] Main Baselines 明确
- [ ] Primary Metrics 明确
- [ ] Main Experiment Matrix 已创建
- [ ] Ablation Plan 已创建
- [ ] Prototype Success Criteria 明确

---

## Stage 4 — Prototype

### 目标

尽早验证方案是否值得继续。

### Gate

- [ ] 最小实现可运行
- [ ] 至少一个关键实验成功完成
- [ ] 没有 Fatal Methodological Blocker
- [ ] 已记录 Continue / Pivot / Stop Decision

---

## Stage 5 — Main Experiments

### 内容

- Main benchmark
- Baseline comparison
- Multiple seeds
- Main performance table
- Compute / runtime record

### Gate

- [ ] 核心 baseline comparison 完成
- [ ] Required seeds 完成
- [ ] Main metric 完成
- [ ] 结果能够支撑至少一个核心 Claim
- [ ] 主要异常 run 已调查

---

## Stage 6 — Validation

### 内容

- Ablation
- Sensitivity
- Robustness
- Failure Case
- Statistical Analysis
- Compute / Cost Analysis
- Additional Reviewer-risk Experiments

### Gate

- [ ] Core Ablation 完成
- [ ] Robustness/Sensitivity 至少满足项目定义要求
- [ ] Failure Case 有记录
- [ ] Claim-Evidence Matrix 无 Critical Missing
- [ ] 关键结果已复查

---

## Stage 7 — Results Frozen

这是一个重要科研 Gate。

### 目的

防止进入论文写作后核心数字无止境变化。

### Gate

- [ ] Main Table 冻结
- [ ] Main Figures 冻结
- [ ] 核心 Claim 冻结
- [ ] 所有引用结果可追溯到 Experiment Run
- [ ] 若继续新实验，必须显式标记为 Post-Freeze Experiment

完成后记录：

- Freeze timestamp
- Frozen commit hash（可选）
- Dataset/config version
- Result snapshot

---

## Stage 8 — Manuscript

默认 Section：

- Abstract
- Introduction
- Related Work
- Method
- Experiments
- Discussion（optional）
- Conclusion
- References
- Appendix / Supplementary

每个 Section 有：

- Not Started
- Outline
- Draft
- Internal Review
- Revised
- Final

### Gate

- [ ] 所有必需 Section 至少达到 Draft
- [ ] 所有核心 Claim 在文中可找到 Evidence
- [ ] Figure/Table 引用完整
- [ ] References 无明显缺失
- [ ] Paper 可完整编译

---

## Stage 9 — Internal Review

### Gate

- [ ] 至少一轮完整 internal review
- [ ] Major comments 已处理
- [ ] Reproducibility checklist 完成
- [ ] Anonymous / formatting 检查
- [ ] Reviewer-risk checklist 完成

---

## Stage 10 — Submission

状态：

- Preparing
- Submission Ready
- Submitted

### Submission Gate

#### Paper
- [ ] PDF compile
- [ ] Page limit
- [ ] Anonymous requirements
- [ ] References
- [ ] Figure readability

#### Experiments
- [ ] Main results
- [ ] Required ablations
- [ ] Statistical reporting
- [ ] Frozen result snapshot

#### Artifacts
- [ ] Supplementary
- [ ] Code snapshot（如需要）
- [ ] Config snapshot
- [ ] Seeds / reproducibility record

#### Portal
- [ ] Title
- [ ] Abstract
- [ ] Authors
- [ ] Conflicts / topics
- [ ] Metadata
- [ ] Final upload

所有 Required gate 通过后：

`SUBMISSION READY`

用户显式点击：

`MARK AS SUBMITTED`

记录提交时间和最终版本。

---

# 6. 核心页面

V1 左侧主导航建议：

1. Portfolio
2. Dashboard
3. Roadmap
4. Tasks
5. Experiments
6. Evidence
7. Literature
8. Manuscript
9. Submission
10. Files / Git（保留 Dr. Claw 能力）
11. Settings

---

## 6.1 Portfolio

多项目总览。

卡片信息：

- Project Name
- Current Stage
- Overall Progress
- Target Venue
- Deadline
- Days Remaining
- Blocker count
- Next Critical Action
- Last Update

支持：

- Active
- Paused
- Submitted
- Archived

---

## 6.2 Project Dashboard

打开项目时默认进入这里。

必须在首屏看到：

```text
Project Title                         Target Venue

Overall Progress          Deadline / Days Remaining

Current Stage
Stage Progress

Blockers
- ...

Next Critical Action
- ...

Experiment Health
- Planned
- Running
- Completed
- Failed

Evidence Health
- Strong Claims
- Partial Claims
- Missing Claims

Manuscript
- Sections complete / total

Submission Readiness
- x / y required gates
```

目标：

**10 秒内理解项目状态。**

---

## 6.3 Roadmap

横向 Stage Timeline：

```text
Idea
  ✓
Literature
  ✓
Design
  ✓
Prototype
  ✓
Main Experiments
  ✓
Validation
  ●
Results Frozen
  ○
Manuscript
  ○
Review
  ○
Submission
  ○
```

点击 Stage 显示：

- Goal
- Required Gates
- Tasks
- Risks
- Deliverables
- Stage notes

---

## 6.4 Tasks

仍然保留普通任务，但任务必须允许绑定：

- Stage
- Experiment
- Claim
- Manuscript Section
- Submission Item

字段：

- title
- description
- status
- priority
- due_date
- blocker
- blocked_by
- stage_id
- relation_type
- relation_id

优先级：

- Critical
- High
- Medium
- Low

状态：

- Backlog
- Todo
- In Progress
- Blocked
- Done
- Cancelled

---

# 7. Experiment Registry

这是 V1 核心能力之一。

---

## 7.1 Experiment

表示科研实验设计，而不是一次具体运行。

字段：

```text
Experiment ID: EXP-037
Title
Research Question
Hypothesis
Stage
Type
Status
Priority
Method Variant
Baselines
Datasets / Environment
Metrics
Required Seeds
Success Criteria
Failure Criteria
Notes
```

Type：

- Prototype
- Main
- Baseline
- Ablation
- Sensitivity
- Robustness
- Failure Analysis
- Reproduction
- Post-Freeze

Status：

- Planned
- Ready
- Running
- Completed
- Failed
- Inconclusive
- Cancelled

---

## 7.2 Experiment Run

一次具体执行。

字段：

```text
Run ID
Experiment ID
Seed
Started At
Finished At
Status
Git Commit
Git Branch
Config Path
Checkpoint Path
Result Path
Dataset Version
Environment
Device / GPU
Runtime
Metrics JSON
Notes
Failure Reason
```

必须支持：

**Experiment 1 → N Runs**

---

## 7.3 Failed Experiment

失败必须保留。

失败原因类型：

- Implementation Bug
- Training Instability
- Hypothesis Rejected
- Resource Limit
- Invalid Design
- Data Issue
- External Dependency
- Unknown

失败实验可产生：

- Decision
- New Experiment
- New Risk
- Claim Weakening

---

# 8. Claim–Evidence Matrix

这是 ResearchFlow 的差异化核心模块。

## Claim

字段：

```text
Claim ID
Statement
Importance
Status
Manuscript Section
Notes
```

Importance：

- Core
- Major
- Supporting

Status：

- Unverified
- Partial
- Supported
- Strong
- Contradicted
- Dropped

---

## Evidence

Evidence 可以来自：

- Experiment
- Experiment Run
- Figure
- Table
- Literature
- Analysis Note
- Artifact

关系：

```text
Claim
 ├── supports → Evidence
 ├── contradicts → Evidence
 └── contextualized_by → Evidence
```

Evidence strength：

- Weak
- Moderate
- Strong

UI 默认使用矩阵：

| Claim | Importance | Evidence | Strength | Status |
|---|---|---|---|---|

Dashboard 必须显示：

- Core Claims Missing Evidence
- Partial Claims
- Contradicted Claims

**Submission Ready 前不能存在未处理的 Core Claim / Critical Missing Evidence。**

---

# 9. Research Decision Log

每个重要研究决策都应可以记录。

字段：

```text
Decision ID
Date
Title
Context
Decision
Reason
Evidence
Alternatives
Impact
Related Experiments
Related Claims
Related Tasks
```

示例：

```text
Decision:
Drop Top-1 router.

Reason:
3/5 seeds collapse while Top-2 remains stable.

Evidence:
EXP-041 / RUN-041-01..05

Impact:
Update Method and Ablation Plan.
```

---

# 10. Literature

V1 不做完整 Zotero 替代。

只维护“项目需要的文献状态”。

字段：

```text
Title
Authors
Year
Venue
URL / DOI / arXiv
Tags
Relation
Read Status
Priority
Key Finding
Method Summary
Difference to Ours
Used In Section
Citation Key
```

Relation：

- Closest Work
- Baseline
- Background
- Method Inspiration
- Evaluation
- Dataset
- Contradictory Evidence

Read Status：

- Inbox
- Skimmed
- Read
- Deep Read
- Cited

V2 可加 Zotero Connector。

---

# 11. Figure / Table Registry

字段：

```text
Artifact ID
Type: Figure / Table
Number
Working Title
Status
Source Experiments
Source Claims
File Path
Manuscript Section
Frozen
Notes
```

Status：

- Planned
- Draft
- Ready
- Frozen
- Deprecated

核心目标：

点击 Figure 4 时，能够知道它来自哪些 Experiment Run。

---

# 12. Manuscript Tracker

每个 Section：

```text
Section ID
Name
Status
Progress
Owner
Last Updated
Related Claims
Figures
Tables
Review Notes
File Path
```

Section 状态：

- Not Started
- Outline
- Draft
- Internal Review
- Revised
- Final

Manuscript 页面同时显示：

- Section Progress
- Missing Evidence
- Missing Figure/Table
- Open Review Comments

---

# 13. Submission Manager

字段：

```text
Venue
Track
Deadline
Timezone
Page Limit
Anonymous
Submission URL
Required Files
Status
```

Checklist item：

```text
title
category
required
status
due_date
notes
artifact_path
```

Status：

- Todo
- In Progress
- Done
- Waived

---

# 14. Progress 计算

不能使用简单的：

`done tasks / all tasks`

建议：

## 14.1 Stage 权重

默认：

| Stage | Weight |
|---|---:|
| Idea Locked | 7 |
| Literature & Gap | 10 |
| Research Design | 10 |
| Prototype | 10 |
| Main Experiments | 20 |
| Validation | 15 |
| Results Frozen | 5 |
| Manuscript | 15 |
| Internal Review | 5 |
| Submission | 3 |

总和 100。

允许用户在 Settings 中调整模板权重。

---

## 14.2 Stage Progress

建议：

```text
StageProgress =
0.70 × RequiredGateCompletion
+
0.30 × WeightedTaskCompletion
```

其中：

- Required Gate 未全部通过时 Stage 不能标记 Completed。
- Stage Progress 只能作为视觉进度。
- Gate 是状态机真实条件。

---

## 14.3 Next Critical Action

优先级算法：

1. 当前 Stage 的 Blocker。
2. 已逾期 Critical Task。
3. 当前 Stage 未完成 Required Gate 对应任务。
4. 7 日内截止的 High/Critical Task。
5. 当前 Stage 的最高优先级 In Progress。
6. 当前 Stage 的最高优先级 Todo。

Dashboard 始终只突出显示 **一个** Next Critical Action。

---

# 15. 数据模型建议

V1 使用现有 SQLite。

推荐新增表：

```text
rf_projects
rf_stages
rf_stage_gates
rf_tasks
rf_task_dependencies

rf_experiments
rf_experiment_runs

rf_claims
rf_evidence
rf_claim_evidence

rf_decisions
rf_literature

rf_manuscript_sections
rf_figures_tables
rf_review_comments

rf_submission_profiles
rf_submission_items

rf_artifacts
rf_activity_log
rf_settings
```

所有主要业务表至少应具有：

```text
id
project_id
created_at
updated_at
```

重要对象建议增加：

```text
archived_at
sort_order
metadata_json
```

---

# 16. 数据与文件的分离

## 16.1 SQLite 保存

- 状态
- 关系
- 元数据
- 进度
- UI settings
- path references

## 16.2 文件系统保存

- code
- config
- checkpoints
- figures
- tables
- notes
- manuscript
- datasets（只记录 path，默认不复制大数据）

避免把大型实验文件塞进 SQLite。

---

# 17. 推荐项目工作区结构

创建新 ResearchFlow Project 时可生成：

```text
ResearchProject/
├── .researchflow/
│   ├── project.json
│   ├── snapshots/
│   └── exports/
│
├── Literature/
│   ├── notes/
│   └── references/
│
├── Idea/
│   └── idea.md
│
├── Design/
│   ├── hypotheses.md
│   └── experiment_plan.md
│
├── Experiments/
│   ├── configs/
│   ├── results/
│   └── analysis/
│
├── Figures/
├── Tables/
│
├── Manuscript/
│   ├── paper/
│   └── supplementary/
│
└── Submission/
```

注意：

- ResearchFlow 不应强迫现有 Git repo 改目录。
- 对已有项目，应支持“Attach Existing Repository”。
- `.researchflow/` 只保存轻量元数据与导出，不保存数据库主副本。

---

# 18. Desktop / Web 运行架构

这是本产品的明确运行决策。

---

## 18.1 开发阶段：WSL2 + 浏览器

**推荐。**

开发目录：

```bash
~/projects/researchflow
```

不要把主要 Node 项目放在：

```bash
/mnt/c/...
```

原因：

- WSL Linux 文件系统对 npm/node_modules/native module 开发通常更稳定。
- Resonix / DeepSeek V4 也可以在同一个 WSL repo 中工作。
- Git、shell、测试环境统一。

开发启动：

```bash
git clone <your-fork>
cd researchflow

npm install
cp .env.example .env

npm run dev
```

Windows 浏览器打开：

```text
http://localhost:5173
```

后端使用项目现有端口配置。

### 开发阶段拓扑

```text
Windows 11
│
├── Chrome / Edge
│      │
│      └── localhost
│
└── WSL2 Ubuntu
       │
       ├── ResearchFlow source
       ├── React/Vite frontend
       ├── Express/WebSocket backend
       ├── SQLite dev DB
       ├── Git
       ├── Resonix
       └── DeepSeek V4 coding agent
```

---

## 18.2 最终日常使用：Windows `.exe`

**这是最终产品默认模式。**

保留 Dr. Claw 的 Electron 架构。

Electron 架构：

```text
ResearchFlow.exe
│
├── Electron Main Process
│
├── Embedded Express/WebSocket Backend
│        │
│        └── SQLite
│
└── BrowserWindow
         │
         └── React UI
```

用户双击：

```text
ResearchFlow.exe
```

即可使用。

**不要求：**

- 先打开 WSL
- 先运行 npm
- 手动启动 localhost server
- 手动打开浏览器

---

## 18.3 Windows 安装包

基于 Dr. Claw 现有 Electron Builder。

开发模式：

```bash
npm run desktop:dev
```

构建 Windows Installer：

```bash
npm run desktop:dist:win
```

最终输出：

```text
release/
  ResearchFlow-<version>-win-x64.exe
```

### 重要

**最终 Windows `.exe` 建议在原生 Windows 环境或 GitHub Actions Windows Runner 构建。**

不要把“在 WSL 中交叉编译 Windows installer”作为标准发布流程。

推荐：

```text
WSL = 开发
Windows / GitHub Actions = Windows 发布构建
```

---

# 19. WSL 项目兼容设计

很多 AI / RL 代码实际运行在 WSL。

ResearchFlow Desktop 应区分：

```text
ResearchFlow App Runtime
```

和：

```text
Research Code Execution Runtime
```

二者不必相同。

建议定义统一接口：

```ts
interface ExecutionAdapter {
  validate(): Promise<EnvironmentStatus>
  run(command: string, cwd: string): Promise<ExecutionResult>
  git(args: string[], cwd: string): Promise<ExecutionResult>
  exists(path: string): Promise<boolean>
}
```

实现：

```text
WindowsLocalAdapter
WSLAdapter
```

WSLAdapter 使用 Windows：

```text
wsl.exe
```

执行 Linux 命令。

项目路径不要只存普通 string，建议：

```text
workspace_type = windows | wsl

windows_path =
D:\Research\ProjectA

wsl_distro =
Ubuntu-22.04

wsl_path =
/home/<user>/projects/project-a
```

V1 可以先完成：

- 保存 WSL 项目路径
- Open in WSL terminal
- Git status
- Run user-defined command

完整训练任务调度属于后续版本。

---

# 20. 数据存储路径

## Desktop Windows

建议：

```text
%APPDATA%\ResearchFlow\
```

其中：

```text
ResearchFlow/
├── researchflow.db
├── backups/
├── logs/
├── settings.json
└── cache/
```

Electron 中使用：

```js
app.getPath('userData')
```

不要写死用户名路径。

---

## WSL Dev

建议：

```text
~/.local/share/researchflow/
```

或沿用现有 server 的可配置 data path。

---

# 21. Backup / Export

V1 必须提供：

### Backup

- SQLite DB snapshot
- lightweight project metadata
- settings

### Export Project

输出：

```text
<ProjectName>-researchflow-export.zip
```

包含：

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

大型 checkpoints / datasets 默认不打包。

---

# 22. UI 风格

目标：

- Research-focused
- Calm
- Dense but readable
- 类似 Linear / GitHub /现代 IDE
- 不做“花哨 AI dashboard”

建议：

- 深浅色模式
- 页面内容最大宽度合理
- 状态颜色统一
- Blocker 使用强警示但不过度红色
- Stage timeline 是项目主视觉之一
- 数据表支持排序 / 筛选
- 所有关键对象支持 Quick Edit

默认语言：

**简体中文**

同时保留现有 i18n 能力，提供 English。

技术术语允许保留英文，例如：

- Claim
- Evidence
- Experiment
- Run
- Baseline
- Ablation
- Submission Ready

---

# 23. 从 Dr. Claw 保留 / 降级 / 新增

## 23.1 保留

- Electron shell
- React/Vite frontend
- Express/WebSocket backend
- SQLite
- File Explorer
- Git Explorer
- Project selection
- Workspace handling
- CodeMirror
- Settings
- i18n
- desktop native file picker
- logs
- Web / Desktop 双模式

## 23.2 降级或隐藏

V1 先从导航隐藏而不是暴力删除：

- News Dashboard
- Promotion
- Video
- TTS
- Auto Research Hub
- autonomous pipeline execution
- excessive agent-centric onboarding

原因：

先减少回归风险。

## 23.3 新增

- Research Lifecycle
- Stage Gates
- Experiments Registry
- Experiment Runs
- Claim-Evidence Matrix
- Decision Log
- Literature Matrix
- Figure/Table Registry
- Manuscript Tracker
- Submission Manager
- Portfolio Dashboard
- Next Critical Action
- Project Health

---

# 24. Agent / LLM 设计

## V1

Agent 不是核心依赖。

软件即使没有 API Key 也必须完整使用。

## V1.5 / V2

可加入 Research Copilot：

```text
“总结当前项目进度”
“哪些 Core Claim 缺证据？”
“哪些实验阻塞 Results Freeze？”
“投稿前还缺什么？”
“根据现有数据生成本周研究计划”
```

Copilot 只读取结构化科研状态。

未经用户确认：

- 不允许修改核心研究结论
- 不允许把 Claim 标记 Strong
- 不允许把 Stage 标记 Completed
- 不允许把项目标记 Submitted

---

# 25. API 设计原则

REST API 使用资源化路径。

示例：

```text
GET    /api/rf/projects
POST   /api/rf/projects

GET    /api/rf/projects/:id/dashboard

GET    /api/rf/projects/:id/stages
PATCH  /api/rf/stages/:id

GET    /api/rf/projects/:id/experiments
POST   /api/rf/projects/:id/experiments
POST   /api/rf/experiments/:id/runs

GET    /api/rf/projects/:id/claims
POST   /api/rf/projects/:id/claims

POST   /api/rf/claim-evidence

GET    /api/rf/projects/:id/manuscript
GET    /api/rf/projects/:id/submission
```

不要把所有对象塞到一个巨大 JSON 文件。

---

# 26. Activity Log

所有关键操作写 Activity Log：

```text
2026-08-07 14:10
EXP-037 marked Completed

2026-08-07 14:12
C-04 changed Partial → Supported

2026-08-07 14:15
Validation Gate: Core Ablation passed
```

后续可以用于：

- daily digest
- weekly report
- AI assistant
- audit

---

# 27. 推荐开发阶段

## Phase 0 — Baseline

目标：

- fork Dr. Claw
- 成功启动 web
- 成功启动 desktop dev
- 跑现有 tests
- 记录 architecture
- 禁止功能开发前大规模重构

---

## Phase 1 — Research Domain Core

实现：

- DB migrations
- Project extension
- Stages
- Gates
- Tasks relation model
- REST API
- Activity Log

完成后：

用户可以创建 Project 并推进 Stage。

---

## Phase 2 — Dashboard / Roadmap

实现：

- Portfolio
- Project Dashboard
- Roadmap
- Stage Gate UI
- Next Critical Action
- Project Health

---

## Phase 3 — Research Evidence

实现：

- Experiments
- Experiment Runs
- Failed Experiment
- Claims
- Evidence
- Claim-Evidence Matrix
- Decisions
- Literature
- Figures/Tables

---

## Phase 4 — Paper / Submission

实现：

- Manuscript Tracker
- Review Comments
- Results Freeze
- Submission Manager
- Submission Ready Gate

---

## Phase 5 — Desktop Hardening

实现：

- Windows Desktop QA
- Data path
- Backups
- Export
- WSL project adapter
- Windows installer
- startup error handling

---

# 28. V1 验收标准

V1 只有满足以下条件才视为完成。

## Project

- [ ] 可以创建 / 编辑 / 归档项目
- [ ] Project 有目标 venue 和 deadline
- [ ] 可以看到 current stage

## Lifecycle

- [ ] 10 个默认 Stage 可用
- [ ] Gate 可勾选
- [ ] 未满足 required gate 时不能误标 Stage Completed

## Dashboard

- [ ] 10 秒内能看到总体状态
- [ ] Blocker 可见
- [ ] Next Critical Action 可见
- [ ] Deadline 可见
- [ ] Overall progress 可见

## Experiments

- [ ] Experiment CRUD
- [ ] Experiment Run CRUD
- [ ] 多 seed 支持
- [ ] Failed 状态和 failure reason
- [ ] Git commit/config/result path 可记录

## Evidence

- [ ] Claim CRUD
- [ ] Claim ↔ Evidence
- [ ] 缺 Evidence 的 Core Claim 可被检测
- [ ] Claim 可以关联 Experiment/Figure/Table

## Decisions

- [ ] Decision Log 可记录
- [ ] Decision 可关联 Evidence

## Manuscript

- [ ] Section 状态可追踪
- [ ] Figure/Table 可追踪
- [ ] Results Freeze 可执行

## Submission

- [ ] Venue metadata
- [ ] Checklist
- [ ] Submission Ready 自动判断
- [ ] Submitted 必须人工确认

## Persistence

- [ ] 重启后数据完整
- [ ] Backup
- [ ] Export

## Runtime

- [ ] WSL `npm run dev` 可运行
- [ ] Windows `npm run desktop:dev` 可运行
- [ ] Windows installer 可构建
- [ ] 安装 `.exe` 后无需用户手动启动后台服务

## Quality

- [ ] typecheck
- [ ] build
- [ ] unit tests
- [ ] core API tests
- [ ] 至少覆盖关键 UI flow 的 Playwright smoke test

---

# 29. 推荐第一批自动化测试

1. Create Project → 默认 10 Stages 创建。
2. Required Gate 未完成 → Stage 不能 Completed。
3. 完成 Gate → 可推进下一 Stage。
4. 创建 Experiment → 创建 5 seed Runs。
5. Run Failed → Failure Reason 被持久化。
6. Claim 无 evidence → dashboard warning。
7. Claim 关联 evidence → warning 更新。
8. Results Freeze 前存在 Critical Missing Evidence → 禁止 Freeze。
9. Submission checklist 未完成 → 非 Submission Ready。
10. 所有 Required item 完成 → Submission Ready。
11. 重启 server → 数据保持。
12. Electron 启动 → embedded server 正常启动。

---

# 30. 安全要求

1. V1 默认仅绑定 localhost。
2. Electron BrowserWindow 保持：
   - contextIsolation = true
   - sandbox = true
3. IPC channel 使用 allowlist。
4. 不允许 renderer 直接任意执行 shell。
5. WSL/Windows command 必须走受控 adapter。
6. API Key 不写入 project export。
7. 日志不得打印 secret。
8. 外部 URL 必须用系统浏览器打开。
9. 所有删除重要研究对象的操作需要确认或 soft delete。

---

# 31. License 注意事项

Dr. Claw 当前包含 GPL-3.0 与 AGPL-3.0 授权部分。

如果 ResearchFlow 基于其 fork：

- 保留 LICENSE / NOTICE。
- 不要删除上游版权声明。
- 对外分发 `.exe` 前必须检查对应 GPL/AGPL 源代码提供义务。
- 如果未来作为网络服务给他人使用，也需要特别审视 AGPL 要求。

如果未来希望做闭源商业产品，应在早期重新评估代码底座授权，而不是开发完成后再处理。

---

# 32. 推荐最终形态

## 开发者视角

```text
WSL2
 ├── Git repo
 ├── npm dev
 ├── tests
 ├── Resonix
 └── DeepSeek V4
```

## 用户视角

```text
Windows
  └── ResearchFlow.exe
       ├── UI
       ├── local backend
       └── local SQLite
```

## AI/RL 代码执行

```text
ResearchFlow.exe
       │
       └── optional WSL Adapter
              │
              └── Ubuntu-22.04
                   ├── research code
                   ├── conda
                   ├── CUDA tools
                   └── training scripts
```

这是建议保持的最终架构。

---

# 33. 产品成功标准

ResearchFlow V1 不以“功能数量”衡量成功。

成功标准只有四个：

1. **打开项目 10 秒内知道现在做到哪。**
2. **不会忘记关键实验、失败实验和研究决策。**
3. **论文 Claim 能追溯到 Evidence。**
4. **投稿前能明确知道还缺什么。**

如果这四点可靠完成，V1 就已经成立。

---

# 34. V1 之后的候选路线

按价值排序：

1. Zotero Connector
2. Git commit / experiment auto capture
3. W&B / TensorBoard metadata import
4. Weekly Research Digest
5. Research Copilot
6. Overleaf / local LaTeX integration
7. Reviewer-risk detector
8. Deadline calendar integration
9. Slurm / SSH remote experiment runner
10. Team collaboration

不要在 V1 同时实现。

---

# 35. 实施结论

**建议直接 fork `OpenLAIR/dr-claw`，而不是从零创建前后端。**

实现策略：

```text
Dr. Claw
   ↓ fork
保留通用底座
   ↓
弱化 autonomous AI research
   ↓
新增 research state/evidence domain
   ↓
ResearchFlow
```

开发：

```text
WSL2 Ubuntu + Resonix + DeepSeek V4
```

日常产品：

```text
Windows Electron .exe
```

最终用户不需要理解 Node、WSL 或 server。

这就是 V1 的目标运行体验。
