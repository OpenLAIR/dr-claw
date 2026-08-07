# ResearchFlow Implementation Status

> 持续开发的 source of truth（Implementation Prompt §13）· 最近更新：2026-08-07
> 基线 commit：`4561ecb`（branch `researchflow-v1`）· 上游：OpenLAIR/dr-claw v1.1.4
> 标记规则：`[x]` = 有真实执行/验证结果；`[ ]` = 未执行或未完整验证。不猜测，不虚标。

---

## Phase 0 — Baseline

| 项 | 状态 | 说明 |
|---|---|---|
| repository architecture audit | `[x]` | 完成广域 + 逐文件审计（前端 entry/routing/tab、项目模型、SQLite、API/WS、Electron lifecycle、File/Git Explorer、i18n、agent 集成、测试） |
| dependency installation | `[x]`* | 已由开发者**手动完成**依赖安装（WSL 环境），`npm run dev` 可正常启动 |
| baseline build | `[x]` | `npm run build` 通过（vite build，27.6s；仅 chunk>1000kB 警告） |
| baseline dev startup（web） | `[x]`* | 已由开发者**手动验证**：WSL 中 `npm run dev` 成功启动，Windows 浏览器可访问 `http://localhost:5173` |
| baseline typecheck | `[x]` | `npm run typecheck` 通过（`tsc --noEmit`，无错误） |
| baseline unit tests | `[x]`* | `npm test`（vitest）：19 文件 18 过 1 败，107 用例 100 过 7 败；7 败全部为 `server/__tests__/gemini-api.test.mjs` 写只读 `~/.gemini`（环境/测试隔离问题，非产品缺陷，见 UPSTREAM_ISSUES U-01） |
| baseline node:test | `[ ]` | `test/*.test.mjs` 断言全过（auth-url-detection 8/8、cli-resolution 4/4、image-attachment 5/5、session-mode 5/5），但 `codex-discovery.test.mjs` **进程挂起不退出**（U-02），整体未通过 |
| Electron baseline | `[ ]` | `npm run desktop:dev` / `desktop:dist` **未运行**（本环境无桌面会话/未做 Electron 运行时验证，NOT RUN）；仅静态确认 electron/main.mjs 架构（spawn 子进程后端） |
| Playwright e2e | `[ ]` | `npx playwright test` **未运行**（需浏览器 + `npm run dev`，NOT RUN） |
| architecture document | `[x]` | `docs/researchflow/ARCHITECTURE_BASELINE.md` 已创建（含 reusable / hide / require-change / DB migration plan / routing plan / risks） |
| upstream issues document | `[x]` | `docs/researchflow/UPSTREAM_ISSUES.md` 已创建（U-01~U-06） |

\* 单元测试项标记 `[x]` 仅表示"已执行并得到真实结果"（结果含环境性失败），不代表全绿。

---

## Phase 1 — Research Domain Core

> 2026-08-07 完成（与计划偏差见文档底部）

- [x] DB migrations：ResearchFlow 自有版本化迁移 `server/rf/migrations.js`（`rf_schema_migrations` + 8 表：`rf_projects / rf_stages / rf_stage_gates / rf_tasks / rf_task_dependencies / rf_task_links / rf_activity_log`；事务化、幂等、restart-safe；**未动** legacy init.sql/runMigrations）
- [x] 10 个默认 Stage template（`server/rf/lifecycle.js`，63 个 gates，权重 7/10/10/10/20/15/5/15/5/3=100 对齐 SPEC §14.1）
- [x] Project extension：创建 RF project 时事务内自动初始化 10 stages + gates，首个 stage 设为 current；`rf_projects.id` 用稳定 UUID + `source_project_id` 可选关联 `projects.id` + 预留 workspace_type/windows_path/wsl_distro/wsl_path
- [x] Tasks relation model：`rf_tasks`（stage 软绑定）+ `rf_task_dependencies`（防自引用/重复/环）+ `rf_task_links`（polymorphic，relation_type 受控枚举，不提前建 Phase 3/4 表）
- [x] REST API：`server/routes/rf.js` 独立 router，`/api/rf/*` 资源化端点（projects/stages/gates/tasks/dependencies/links/activity），`authenticateToken` 保护，`{success, data}` 风格
- [x] Activity Log：`server/rf/activity.js` + service 事务内写入（project_created/stage_changed/gate_passed/gate_unpassed/task_created/task_completed/task_blocked 等）
- [x] API validation + API tests：`server/rf/validation.js`；3 个测试文件 24 用例全过（临时目录/隔离 DB，零新依赖，覆盖普通 JWT + IS_PLATFORM 双模式）
- [x] 进度算法 domain/service 模块 + unit tests：`server/rf/progress.js` 纯函数（StageProgress=0.7×Gates+0.3×Tasks、Stage Completed ⟺ 全部 required gates passed、OverallProgress 加权）

### Phase 1 deviations

- `rf_task_links` 按用户 §6 字段实现（无 project_id/updated_at）；`rf_task_dependencies` 附加 project_id 便于项目级查询
- 端点 `POST /api/rf/projects/:id/advance-stage`（推进 current→completed 并激活下一 stage）与 `POST /api/rf/stages/:id/complete`（gate 不变量校验）作为显式状态机端点新增
- service 层直接调用时也强制 relation_type 受控枚举（不依赖 routes 层 validation）
- CI 只新增 rf 专项 vitest step（不跑全量，规避 U-01/U-02）

### Phase 1 code review fixes（built-in review 发现并修复）

1. `setStageCurrent` 曾全表 demote `status='current'` → 改为按 `project_id` 限定（防跨项目污染），新增跨项目隔离测试
2. `completeStage` 完成后不激活下一 stage → `advanceStage` 死路；修复为 complete 自动激活下一 pending stage；且仅允许 complete `current` stage（已完成幂等、乱序 409），新增自动推进断言
3. gate un-pass 不破坏不变量：completed stage 的 required gate 被取消通过时，stage 回退为 `current`（项目退回该阶段）+ activity，新增回退测试

## Phase 2 — Dashboard / Roadmap

> 2026-08-07 完成（与计划偏差见文档底部）

- [x] **顶层导航挂载决策**：ResearchFlow 为 TOP-LEVEL 入口（非 Chat 右侧栏）——`AppTab` 加 `'researchflow'`、`SidebarProps`/`useProjectsState`（`handleOpenResearchflow`）8 文件 prop-threading、SidebarHeader desktop+mobile 两处按钮、MainContent 空态前分支、MainContentTitle 全局标题；MobileNav 5-slot 已满未加（UX 决策）
- [x] Portfolio：全页项目卡片（name/current stage/overall progress/venue/deadline/days remaining/blockers/NCA/health），状态 active/paused/submitted/archived 由 Phase 1 `status` 字段支持，未新增 schema 字段
- [x] Project Workspace：子导航 dashboard | roadmap | tasks + 5 个未来 tab（experiments/evidence/literature/manuscript/submission）禁用占位，未实现其 domain
- [x] Project Dashboard：`GET /api/rf/projects/:id/dashboard` 服务端聚合（above-the-fold：name/venue/overall/current stage/stage progress/deadline/blockers/NCA + 生命周期状态 + health + task/gate summary），纯展示无装饰图表；未来域 summary 零未来表依赖
- [x] Roadmap：10-stage timeline（completed/current/pending 三态）+ 点击 Stage 详情（gates/related tasks/blockers/notes）；Stage 状态逻辑不复制进 React
- [x] Stage Gate UI：`StageGatePanel` 勾选/取消走 `PATCH /api/rf/gates/:id`，409 透传，complete 按钮 disabled 条件 = 未全过 required gates，un-pass 回退 completed stage 由服务端状态即时反映
- [x] Next Critical Action：`server/rf/insights.js` 纯函数（6 级优先级），Dashboard 与 Portfolio 消费同一后端结果，21 个单测覆盖排序与边界
- [x] Project Health：`healthy/at_risk/critical` 确定性状态 + 可解释 reason codes（无 ML/小数分数），reasons 前端 i18n 翻译
- [x] 前端 API helper：`src/utils/api.js` 新增 `rf` domain（15 方法）
- [x] i18n：`researchflow.json`（en + zh-CN 完整，ko 回退 en），config.js 三处注册
- [x] 测试：insights 21 + dashboard API 1 + 前端 SSR 渲染 8（renderToStaticMarkup，仓库无 RTL）——全部隔离，零新依赖
- [x] CI：rf step 扩展为 5 个测试文件（57 用例）

### Phase 2 deviations

- `listProjects` 返回增强聚合（每项目 currentStage/overallProgress/blockerCount/daysRemaining/NCA/health）——Portfolio 与 Dashboard 消费同一后端 domain 结果（用户 §8 要求），批量 IN 查询避免 N+1
- dashboard 聚合含 taskSummary/gateSummary（Phase 1 schema 直接支持）；未来域（experiments/evidence/manuscript）summary 未返回（零未来表依赖）
- health `at_risk` 的 deadline 判定含已过期（≤7 天含负值）——已过截止日期比 7 天内更糟
- 新项目（无任务 + 未过 gates）health 为 `at_risk`（reason: unfinished_required_gates_no_progress）

### Phase 2 code review fixes（built-in review 发现并修复）

1. `gateSummary` i18n 插值缺参 → 改纯 label（en/zh-CN）
2. ProjectWorkspace 错误门控：tasks 加载失败不再永久 spinner（error 优先显示）
3. date-only 截止日期时区 off-by-one → `insights.js` 新增 `parseDateLocal`（本地午夜归一化），`service.daysRemaining` 复用
4. deadline 已过仍 healthy → at_risk 判定 `days <= 7`（含负值）+ 补测试
5. `listProjects` N+1 → repo 批量 `listStagesByProjects`/`listTasksByProjects`（常量次查询）
6. Portfolio 创建失败静默 → error 红条显示（nit）

## Phase 3 — Experiments / Evidence

> 2026-08-07 完成（与计划偏差见文档底部）

- [x] **DB migrations（version 2）**：`rf_experiments / rf_experiment_runs / rf_claims / rf_evidence / rf_claim_evidence / rf_decisions / rf_literature / rf_figures_tables / rf_entity_links` 9 表，经现有 `rf_schema_migrations` 版本化机制追加（有序/事务化/restart-safe/幂等，未动 legacy 迁移）；`Experiment 1→N Runs`（UNIQUE(experiment_id, run_code)）；所有 `project_id → rf_projects.id`（UUID）
- [x] **Experiment domain**：自动项目内唯一 code（EXP-001）、type/status/priority 受控枚举（service 层也强制校验）、stage 软绑定（可选）
- [x] **Experiment Run**：run_code 自动生成（RUN-001）、seed/git_commit/git_branch/config_path/checkpoint_path/result_path/dataset_version/environment_name/device/runtime_seconds/metrics_json/failure_reason/failure_classification
- [x] **Failed experiment 保留**：`status=failed` 与 `archived_at` 完全分离（soft archive 独立于 failed）；8 类 failure classification；失败 run 永不被物理删除，可查询
- [x] **Run aggregation（domain 纯函数）**：`summarizeExperiment`（total/planned/running/completed/failed/seeds/hasMetrics/completionState/failureState）——只计数，不推断科学结论
- [x] **Claim domain**：claim_code（C-01）、importance（core/major/supporting）、status（unverified/partial/supported/strong/contradicted/dropped）——**status 仅由用户/service 显式设置，evidence 附加绝不自动提升**（18/18b 测试覆盖）
- [x] **Evidence domain**：evidence_type（experiment/experiment_run/figure/table/literature/analysis_note/artifact）、source_id polymorphic（同项目校验）、strength（weak/moderate/strong）
- [x] **Claim-Evidence Matrix**：`rf_claim_evidence` 专用表（supports/contradicts/contextualized_by；UNIQUE 防重复 + 幂等返回；跨项目 link 拒绝）
- [x] **Evidence health（domain 纯函数）**：`claimEvidenceHealth`（no_evidence/weak_only/partial/supported_by_evidence/has_contradictory_evidence；core+无证据 → `critical_missing_evidence`）+ `projectEvidenceSummary`（core_claims_total/missing/contradictory/supported/partial）——只报告，不改 claim.status
- [x] **Decision Log**：decision_code（DEC-001）、date/context/decision/reason/alternatives/impact；经 `rf_entity_links` 关联 experiment/claim/evidence（同项目强制）
- [x] **Literature**：紧凑字段（title/authors/year/venue/url/doi/arxiv_id/citation_key/relation/read_status/priority/key_finding/method_summary/difference_to_ours/used_in_section 占位），非 Zotero 替代
- [x] **Figure/Table Registry**：artifact_code（FIG-01/TBL-01）、type/status/file_path/frozen/manuscript_section 占位；经 `rf_entity_links` 链接 experiment/run/claim —— **provenance 可追溯**（Figure → Run → Git commit/seed → Claim）
- [x] **关系模型（混合方案）**：Claim-Evidence 专用表（语义强）+ `rf_entity_links` 受控通用表（Decision/FigureTable provenance；source/target/relation 类型受控枚举、同项目校验、UNIQUE 防重复、自链接拒绝）——避免可空 FK 列堆叠（用户 §13）
- [x] **Task 集成**：`rf_task_links` 保留枚举中的 `experiment`/`claim` relation 已可用（Phase 1 预留，Phase 3 不新增 schema 变更）
- [x] **Activity Log 扩展**：experiment_created/status_changed、experiment_run_created/started/completed/failed、claim_created/status_changed、evidence_created、claim_evidence_linked/unlinked、decision_created、literature_added、figure_table_created/status_changed、*_archived（全部与状态变更同一事务）
- [x] **REST API**：`/api/rf/*` 新增 30 端点（experiments/runs/claims/evidence/claim-evidence/evidence-health/decisions/literature/figures-tables/entity-links），`{success,data}` + authenticateToken + 项目隔离
- [x] **Phase 3 UI**：ProjectWorkspace 激活 **Experiments / Evidence / Literature** tabs（manuscript/submission 仍禁用）；Experiments 注册表（列表 + 详情 + runs，FAILED 醒目且与 ARCHIVED 分离）；EvidenceView 子 tab（**Claim-Evidence Matrix** 表格含 CRITICAL MISSING 醒目样式 + **Decision Log** + **Figures & Tables** provenance 展开）；Literature（search + relation/readStatus/priority filter）
- [x] **Dashboard 集成**：experimentSummary（runs 计数）+ evidenceSummary（core claims/missing/contradictory）真实数据；health 增加 research reasons（core_claim_missing_evidence → ≥at_risk、main experiment failed 无 completed → critical_experiment_blocked → critical）
- [x] **测试**：`rf-phase3-domain.test.mjs`（33 项：experiments 9 / claims-evidence 10 / decisions 3 / literature 2 / figures+provenance 4 / migration 4 / activity 1）+ `rf-api.test.mjs` 扩展（34/34b/34c/36）+ `rf-api-platform.test.mjs` 扩展（35）+ `Phase3.test.jsx`（SSR 渲染 5）+ dashboard 18b 回归；全部临时文件 DB 隔离
- [x] **CI**：rf step 扩展为 9 文件 152 用例

### Phase 3 deviations

- 关系模型按用户 §13 采用**混合方案**（`rf_claim_evidence` 专用 + `rf_entity_links` 受控通用），理由已在 Plan 说明
- evidence health 分级规则：0 证据 → no_evidence/critical_missing；有 contradicts → has_contradictory_evidence；全 weak → weak_only；强弱混合 → partial；其余（≥1 非 weak）→ supported_by_evidence——纯可解释，无 ML
- `evidence.source_id` 对 experiment/run/figure/table/literature 类型做同项目校验；analysis_note/artifact 允许无 source（自由记录）
- entity-links 的 relation_type 受控集合为 `references/produces/supports/contradicts/relates_to`（覆盖 decision 引用与 figure provenance 场景）
- `getProjectDashboard` 的 experimentSummary/evidenceSummary 为服务端聚合，前端零复制计算（review 修复后与 `/evidence-health` 一致）

### Phase 3 code review fixes（focused built-in review，三轮）

1. dashboard `evidenceSummary` 缺 `strength` 映射（`evidence_strength` 别名未归一）→ claimsSupported/claimsPartial 恒 0 → dashboard 路径补映射 + 18b 回归测试（should-fix）
2. `listRunsByProject` 未过滤已归档实验的 runs → dashboard 聚合改为 `listRunsByExperiments`（只统计活跃实验）
3. delete 系列（run/claim/evidence/decision/literature/figure-table）无 activity → 全部补齐 `*_archived`（与状态变更同事务）
4. 死代码 `repo.listRunsByProject` 删除（无引用）
5. 复核确认：跨项目隔离/join/claim 不自动提升/failed 不删除/防重复链接/cascade/事务一致性/migration 幂等/UI 不复制 health 计算 —— 全部干净

## Phase 4 — Manuscript / Results Freeze / Review / Submission

> 2026-08-07 完成（与计划偏差见文档底部）

- [x] **DB migrations（version 3）**：`rf_manuscript_sections / rf_result_freezes / rf_review_comments / rf_submission_profiles / rf_submission_items` 5 表，经 `rf_schema_migrations` 追加（有序/事务化/幂等/restart-safe；fresh + Phase3→4 upgrade + rerun + reopen 测试）
- [x] **Manuscript sections**：默认模板 9 节（abstract…appendix，discussion/appendix 标记 optional，可项目自定义）；`is_optional` 区分 required；初始化幂等；**status 六态由显式 human action 推进，progress 绝不自动升级 status**
- [x] **Manuscript completeness（domain 纯函数）**：`manuscriptCompleteness`（totalRequired/notStarted/draftOrBetter/underReview/final/requiredSectionsComplete=全部 required ≥ draft 对齐 SPEC Stage 8 gate + claims/figures/tables_not_assigned_to_section 经 section links 检测，archived 排除）
- [x] **Section relationships**：复用 `rf_entity_links`（section→claim/figure_table/literature/review_comment，`ENTITY_TYPES` 扩展 `manuscript_section`/`review_comment`/`submission_item`；同项目校验 + UNIQUE 防重复）——不建专用表（用户 §5）
- [x] **Results Freeze**：`rf_result_freezes`（freeze_number 递增、git_commit/branch、result/dataset/config version、snapshot_json、notes、override_reason）；**immutable**（无 update/delete 端点）；`freezeReadiness` 纯函数（core claim critical missing evidence / contradicted core 未 acknowledge / main experiment blocked / validation required gates 未全过 → 可解释 blockers，不发明规则）
- [x] **Freeze override**：readiness 未过且无 overrideReason → 409；override 需非空 reason + `results_freeze_overridden` activity + override_reason 持久化（仅 override 时存）；UI 区分 Normal/Overridden
- [x] **Freeze snapshot + staleness**：`buildFreezeSnapshot`（claims status/health、figures status/frozen、experiments runSummary 轻量元数据，不拷贝数据）；`freezeStaleness` 对比快照（claim/evidence/figure/experiment/run 变化与新增 → `freeze_current|stale` + 可解释 reasons）；**历史快照不可变**
- [x] **Internal Review**：`rf_review_comments`（comment_code RC-001、severity minor/major/critical、status open/in_progress/resolved/wont_fix、source 五类、manuscript_section_id FK SET NULL）；**resolve/reopen 显式 action**（resolved_at + activity，绝不自动 resolve）；`reviewSummary`（open critical/major/minor + resolved）
- [x] **Submission profile**：`rf_submission_profiles`（venue/track/deadline/timezone/page_limit/anonymous/url/status + submitted_at/final_paper_path/external_submission_id）；多 submission attempts 支持
- [x] **Submission checklist**：`rf_submission_items`（category paper/experiments/artifacts/portal、required、status todo/in_progress/done/waived）；默认 19 项模板（对齐 SPEC §19，code/config snapshot 等标记非必需）；初始化幂等（UNIQUE(profile,category,title)）；每项可编辑/可 waive
- [x] **Submission Ready（deterministic + 可逆）**：`submissionReadiness` 纯函数（required items 全 done/waived ∧ 有效 freeze（最新非 stale）∧ required sections ≥ draft ∧ 无 unresolved critical comment ∧ 无 core claim critical missing evidence ∧ submission stage required gates 全过）；**readiness 派生且可逆**——17 个 mutation 触发点（claim/experiment/run/freeze/manuscript/review/checklist）事务内 `recalculateProjectSubmissions`，status preparing↔submission_ready + `submission_ready_achieved/lost` activity
- [x] **Submitted 仅人工**：`POST /submissions/:id/mark-submitted` + `confirmation:true`（routes validate + service 双层强制）+ submitted_at/final_paper_path/external_submission_id + `paper_marked_submitted` activity；**Submitted 不可逆**（recalc 跳过、profile/item 编辑拒绝、无 unsubmit 路径）
- [x] **Task 集成**：`TASK_RELATION_TYPES` 补 `review_comment`（manuscript_section/submission_item 已有）——task 可关联 section/comment/item
- [x] **Activity Log**：manuscript_section_status_changed/finalized、results_freeze_created/overridden、review_comment_created/resolved/reopened、submission_profile_created、submission_item_completed/reopened、submission_ready_achieved/lost、paper_marked_submitted（全部与状态变更同事务）
- [x] **REST API**：17 个 Phase 4 端点（manuscript/initialize/sections、results-freeze readiness+list+POST、review-comments CRUD、submissions CRUD+readiness、submission-items PATCH、mark-submitted）
- [x] **Phase 4 UI**：Workspace 激活全部 8 tabs（manuscript/submission 已启用）；**Manuscript** 三子 tab（Sections：状态显式切换 + completeness 徽章；**Results Freeze**：readiness/blockers/last freeze/staleness + Create Freeze + Override Freeze 需 typed reason + Normal/Overridden 视觉区分；**Review Comments**：severity/status filters + resolve/reopen，Critical 未解决不"绿"）；**Submission**：venue/deadline/status + readiness blockers + checklist 按 4 类分组（done/waive）+ 确认式 Mark Submitted
- [x] **Dashboard 集成**：manuscriptSummary（final/required）、resultsSummary（none/current/stale + overridden）、reviewSummary（open critical/major）、submissionSummary（done/required + READY/NOT READY/SUBMITTED）——真实后端数据，无装饰图表
- [x] **Roadmap 集成**：Stage 7-10 gates 已在 Phase 1 全功能（gate UI + 状态机复用，Results Freeze 事件与 gate 无强耦合——高层 lifecycle 仍以 10-stage gate 为 truth）
- [x] **测试**：`rf-phase4-domain.test.mjs`（45 项：manuscript 8 / freeze 9 / review 6 / submission 14 / migration 4 / activity 4）+ `rf-api.test.mjs`（45/47）+ `rf-api-platform.test.mjs`（46）+ `Phase4.test.jsx`（SSR 渲染 4）+ 32b 状态翻转回归；全部临时 DB 隔离
- [x] **CI**：rf step 扩展为 9 文件 152 用例

### Phase 4 deviations

- 关系模型复用 `rf_entity_links`（不新增专用 link 表），`ENTITY_TYPES`/`TASK_RELATION_TYPES` 以**追加**方式扩展（不破坏 Phase 3 既有 link）
- `submissionReadiness` 的 "manuscript sufficiently complete" 定义为全部 required sections ≥ draft（对齐 SPEC Stage 8 gate "所有必需 Section 至少达到 Draft"，非 final）
- `markSubmitted` 不强制 readiness=ready（人类优先原则 P1：研究者可决定在未全绿时提交）；但必须 `confirmation:true` 显式确认
- freeze readiness 未实现 "main figure/table required" 检查（无项目级 required 标记机制，避免发明规则——用户 §10 "Do not invent unsupported scientific rules"）；contradicted core claim 的 "acknowledged" = claim.status 被显式设为 `contradicted`
- submission_ready 状态持久化在 profile.status，但**重算以 mutation 为准**（17 个触发点），readiness GET 只做事务内同步兜底
- checkpoint/submission 编辑在 submitted 后被拒绝（已提交记录防篡改）

### Phase 4 code review fixes（focused built-in review，三轮）

1. `recalculateSubmissionStatus` 只在 checklist/GET 触发 → **17 个 mutation 触发点**（claim/experiment/run/freeze/manuscript/review 的 create/update/delete）事务内补 `recalculateProjectSubmissions`（should-fix）+ 32b 状态翻转回归测试
2. `getSubmissionReadiness` 同步写无事务 → `tx()` 包裹（状态 UPDATE + activity 原子）（should-fix）
3. `createResultsFreeze` 在 readiness ready 时也持久化用户传入 overrideReason → 仅 `overridden` 时存（防 spurious "overridden" badge）
4. `manuscriptCompleteness` 未过滤 archived claims/artifacts → 补 `archived_at` 过滤
5. 复核确认：跨项目隔离/Submitted 仅 confirmation/override 需 reason/freeze immutable/前端不查前端状态/claim status 不被自动改/Critical 阻断 wired/checklist 初始化一次/migration v3 幂等/derived status 正确持久化/activity 事务一致/Submitted 不可逆 —— 全部干净

## Phase 5 — Desktop Hardening / Windows Release

> 2026-08-07 完成（与计划偏差见文档底部；Windows 安装包为 **IMPLEMENTED / NOT YET WINDOWS-VERIFIED**）

- [x] **Product rename（分层，非全局 replace）**：用户可见层全切 ResearchFlow——`electron/main.mjs` `productName='ResearchFlow'`/`appId='io.openlair.researchflow'`/菜单/窗口标题/启动错误文案、package.json `build.productName/appId`、artifactName 由 `${productName}` 自动生效（`ResearchFlow-<version>-win-x64.exe`）；**内部 legacy 标识保留**（npm 包名 `dr-claw`、env 名、DB 表名、`~/.dr-claw` web 默认路径、`resolveSharedWorkspacesRoot`），对照表见 DATA_AND_BACKUP.md §6
- [x] **userData / SQLite 路径**：生产 DB = `app.getPath('userData')/researchflow.db`（`%APPDATA%\ResearchFlow\`），自动建 backups/logs/runtime/exports；**legacy 数据方案 B**（干净目录 + 显式导入指引，不自动复制/迁移 `~/.dr-claw`/`%APPDATA%\Dr. Claw`，启动时只读检测 + 日志提示）
- [x] **Backup**：`server/rf/backup.js`——SQLite `db.backup()` 一致快照 + manifest/settings zip（`researchflow-backup-<毫秒时间戳>.zip`）；app_settings 中 secret 类 key 跳过；**排除** users/api_keys/credentials/tokens/大文件；REST `POST /api/rf/backup`、`GET /api/rf/backups`；测试 5-13（一致性/内容/排除/非法拒绝/路径穿越拒绝）
- [x] **Restore（两阶段）**：`restoreBackup()` 验证结构 → **先自动创建恢复前安全备份** → 暂存 `restore-pending/`；`applyPendingRestore()` 在下次进程启动（DB 打开前，db.js）校验 SQLite 头并原子替换 + 清侧车文件 + 清理标记；UI 提示重启生效；非法/非 SQLite 暂存被丢弃不崩启动；REST `POST /api/rf/backup/restore`；测试 9-13
- [x] **Project Export**：`server/rf/export.js`——单项目 zip `<ProjectName>-researchflow-export-<ts>.zip`，19 个 JSON（对齐 SPEC §10 命名：project/stages/stage-gates/tasks/task-dependencies/task-links/experiments/experiment-runs/claims/evidence/claim-evidence/decisions/literature/figures-tables/entity-links/manuscript/result-freezes/reviews/submission/submission-items/activity-log）+ manifest（exportVersion/appVersion/schemaVersion/timestamp/project UUID）；**secrets 排除**（非 rf 表不导出）；路径字段保留为 local path references（manifest 注明）；文件名 sanitize（中文/空格/括号安全）；跨项目隔离；REST `GET /api/rf/projects/:id/export`；**Import 推迟 V1.x**（export 版本化预留）；测试 14-19
- [x] **WSL adapter 架构边界**：`server/rf/workspace.js`——`WindowsLocalAdapter`/`WSLAdapter`（统一 validate/exists/git/openTerminal）；WSL 全走 `spawn('wsl.exe', ['-d', distro, '--', ...])` 参数数组（无 shell 拼接）；distro 白名单正则（拒绝空格/斜杠/`--`）、WSL 路径必须绝对 Linux 路径（拒绝 `\`/驱动器）、Windows 路径必须盘符/UNC；`workspace_type/windows_path/wsl_distro/wsl_path` 由 updateProjectWorkspace 持久化 + 语义校验；REST `GET|PUT /api/rf/projects/:id/workspace`、`POST .../validate`、`POST .../open-terminal`；CI mock spawn（无需真实 WSL）；测试 rf-phase5-wsl 19 项
- [x] **Embedded backend startup（复核并保持）**：spawn 一次 + `ELECTRON_RUN_AS_NODE=1` + `waitForServer(/health, 30s)` + 可用端口 + 单实例锁（二次启动聚焦）+ will-quit 杀子进程；**新增**后端 stdout/stderr 镜像到 `%APPDATA%\ResearchFlow\logs\backend.log`（2MB 轮转）
- [x] **startup error UI**：boot/后端启动失败 → 友好错误窗口（内联 HTML，`contextIsolation/sandbox` + 白名单 preload）——friendly reason + Technical details 折叠 + Open Logs / Open Data / **Retry**（新增 purpose-specific IPC `app:relaunch`）/ Exit；无空白窗口；错误写入 desktop.log
- [x] **Logging**：desktop.log（Electron 主进程，userData）+ backend.log（后端转发）；记录启动/版本/平台/后端启停/DB 路径；不记录 secrets
- [x] **Diagnostics/About**：`GET /api/rf/info`（appVersion/platform/databasePath/dataDir/backupsDir/schemaVersion）+ Electron `app:getInfo` 增强（databasePath/logDir）；UI：Portfolio → Data & Backup 面板（About 信息 + Create Backup + 备份列表 + Restore + Open Data Folder（Electron））
- [x] **前端 UI**：`DataBackupPanel.jsx`（全局数据安全面板）+ `WorkspacePanel.jsx`（执行环境表单 + Validate + Open in WSL Terminal）+ ProjectWorkspace header（Export Project 下载 + Execution Environment 按钮）；i18n en/zh-CN（`data` + `workspace` keys）
- [x] **安全**：contextIsolation/sandbox 保持；preload 白名单 19 invoke + 7 on（新增 `app:relaunch`）；无通用 execute/readAnyFile/writeAnyFile（测试断言 ipcRenderer.invoke 仅 1 处）；`shell:openExternal` 只放行 http/https
- [x] **Windows 打包策略**：新增 `.github/workflows/release-windows.yml`（windows-latest：typecheck + build + rf 测试 + `desktop:dist:win`，workflow_dispatch 手动触发）为官方 Windows 构建路径；`npm run desktop:dist:win` 已存在（NSIS，productName 变更自动产出 `ResearchFlow-<version>-win-x64.exe`）；WSL 环境**不宣称已构建验证**
- [x] **native 依赖**：`native:node` / `native:electron` 双 ABI 切换机制保持（cli.mjs 自动调用）；electron-builder npmRebuild
- [x] **文档**：DESKTOP_BUILD.md（开发/桌面/Windows 构建/native 说明/限制/WSL notes/Windows 手动验证步骤）、DATA_AND_BACKUP.md（存储位置/备份内容/排除/导出 vs 备份/恢复/legacy 兼容/用户需自行备份）、RELEASE_CHECKLIST.md（CODE/DATA/WINDOWS/SECURITY/PRODUCT）、DESKTOP_SMOKE_TEST.md（安装/持久化/数据安全/单实例/WSL 冒烟 + §42 核对）
- [x] **测试**：`rf-phase5-data.test.mjs`（20，含 13b swap 回滚）+ `rf-phase5-wsl.test.mjs`（19）+ `rf-phase5-api.test.mjs`（12）+ `rf-phase5-desktop.test.mjs`（16，Electron 静态源码断言）+ `Phase5.test.jsx`（3 SSR）；CI 扩展为 14 文件 222 用例
- [ ] **Windows installer / release smoke**：**IMPLEMENTED / NOT YET WINDOWS-VERIFIED** —— 需在 Windows 或 GH Actions Windows runner 执行 DESKTOP_BUILD.md §8 / DESKTOP_SMOKE_TEST.md / RELEASE_CHECKLIST.md WINDOWS 段

### Phase 5 deviations

- legacy 数据采用**方案 B**（干净 `%APPDATA%\ResearchFlow` + 显式导入指引）而非自动迁移——V1 无已发布 desktop 数据，自动迁移违背"不安全不迁移"（用户 §6）
- `safeTimestamp` 毫秒级（`20260807T203000000`）防同秒备份覆盖（用户 §7 示例为秒级，注释说明等效安全命名）
- restore 为两阶段（staging + 下次启动应用）而非运行中 close/swap DB——server 共享单例连接，运行中替换不安全；UI 明确提示重启
- `desktop:dev` 的 userData 在仓库 `.electron-home/`（隔离），与生产分离
- WSL `Open in WSL Terminal` 用 `wsl.exe -d <distro> --cd <path>`；Windows Local 用 `explorer.exe` 打开目录（V1 边界）
- 产品版本 = `package.json`（1.1.4，未 bump，避免影响 upstream release 流程）——artifact 为 `ResearchFlow-1.1.4-win-x64.exe`

### Phase 5 code review fixes（focused built-in review，三轮 + 打包前最终轮）

1. **backup 泄露 secrets（blocking）**：`db.backup()` 整库快照含 `users`/`api_keys`/`user_credentials`/`session_metadata`/`app_settings`（password hash / provider keys）→ 新增 `sanitizeSnapshot`（DELETE 敏感表 + **VACUUM** 真正擦除字节）+ manifest excludes 修正 + 测试 6 字节级断言（快照内无 secret 字符串、敏感表 COUNT=0、schema 保留）
2. **restore 失败重试门控 bug（should-fix）**：swap 为 rm-before-rename——失败即删生产 DB，且 db.js 门控 `fs.existsSync(DB_PATH)` 使失败后不再重试 → swap 改**原子替换**（displace 旧 DB → rename staged → 清理 → 失败回滚 displace）+ db.js 门控去掉 existsSync（marker 存在即重试）+ 测试 13b（模拟 EPERM，断言旧 DB 回滚 + marker/staged 保留；spy 未匹配分支透传 realRename 保证 displacement/回滚路径真实执行）
3. **打包 0 字节 auth.db 污染生产路径（should-fix）**：仓库 `server/database/auth.db` 为 0 字节 dev 产物，会随 electron-builder 打包并在首次桌面运行时被 legacy 复制逻辑拷入 `%APPDATA%\ResearchFlow\researchflow.db` → legacy 复制加 `isUsableSqliteFile` 校验（非空 + `SQLite format 3` 头），0 字节/损坏不复制
4. **startup error HTML 转义（nit）**：inline onclick 手写字符串转义 + data dir 未转义 → 改 `JSON.stringify` 生成 JS 字符串字面量 + HTML 转义显示文本
5. **dev artifacts 进 git（nit）**：backups/exports/restore-pending 目录 → 加入 `.gitignore`
6. **测试 13b spy no-op（review 复验发现）**：spy 未匹配分支 `return fs.renameSync` 不真正调用 → 捕获 `realRename` 透传（见 2）
7. 复核确认：生产 DB 路径确定性/迁移先于 UI/无静默重建/backup 一致性（backup API）/restore 两阶段/export 跨项目隔离 + 跨用户 404/WSL spawn 参数数组 + distro-path 校验/Windows-WSL 路径类型化/IPC 白名单（仅 1 处 invoke）/contextIsolation+sandbox/后端单 spawn + 健康检查 + will-quit 清理/单实例锁/startup error window/打包路径（asar:false + resourcesPath/app）/web 模式零回归（全量仅 U-01）/离线启动无网络依赖/native 双 ABI 脚本 —— 全部干净

> 打包前最终轮 verdict：**PASS，无剩余 blockers**；2 个非阻塞 nit（swap 中 WAL/SHM 删除顺序、error window 的 preload 在 `data:` URL 上执行）留给 DESKTOP_SMOKE_TEST.md 核对。

---

## Current Risks

（来源：ARCHITECTURE_BASELINE.md §7 + UPSTREAM_ISSUES.md）

1. **rf 迁移演进纪律**（原"无版本化迁移"风险已由 `rf_schema_migrations` 解决）：rf 与 legacy 两套迁移机制并行维护——新增 ResearchFlow migration 必须**追加到 `server/rf/migrations.js` 的 `MIGRATIONS` 数组末尾且版本号递增，禁止修改已应用版本**；rf 表与 legacy 表命名空间分离（`rf_*` 前缀），防止命名冲突。
2. **巨型文件蔓延**：`server/index.js`（135KB）已有约 20 个内联 project 端点——rf 代码必须独立模块（`server/routes/rf.js`），禁止并入 index.js。
3. **工作区路径可移植性**（原"项目模型耦合"风险已解决：`rf_projects.id` 现为稳定 UUID，`source_project_id` 可选关联 `projects.id`，目录 rename/move 不影响 ResearchFlow 身份）：`workspace_type/windows_path/wsl_distro/wsl_path` 字段**已被 Phase 5 workspace adapter 消费**（`server/rf/workspace.js`：WindowsLocal/WSL 校验 + validate + Open in WSL Terminal，测试 rf-phase5-wsl 19 项）；Windows/WSL 路径不做朴素转换，按类型存储与校验。
4. **测试环境敏感（U-01/U-02）**：gemini-api 测试写真实 `~/.gemini`（只读 HOME 下 EROFS 失败）；codex-discovery 测试进程挂起。rf 测试一律走临时目录/隔离 DB（已规避），upstream 两处缺陷按 UPSTREAM_ISSUES.md 记录，不属 ResearchFlow 回归。
5. **upstream 全量测试未入 CI（U-03，非阻塞）**：rf 专项 vitest step 已加入 CI（`.github/workflows/ci.yml` 与 `.github/workflows/release-windows.yml`，**14 文件 222 用例**：rf-domain/rf-api/rf-api-platform/rf-insights/rf-phase3-domain/rf-phase4-domain/rf-phase5-data/rf-phase5-wsl/rf-phase5-api/rf-phase5-desktop/ResearchFlow UI/Phase3 UI/Phase4 UI/Phase5 UI）；upstream 全量测试（含 U-01/U-02 影响）仍未纳入 CI，属已知上游问题，不阻塞 ResearchFlow。
6. **DATABASE_PATH 解析多处维护（U-04，部分收敛 / non-blocking）**：Phase 5 已将 Electron 侧收敛为 `resolveProductionDatabasePath()`（`%APPDATA%\ResearchFlow\researchflow.db` + legacy 只读检测），`load-env.js`（web 默认 `~/.dr-claw/auth.db`）与 `db.js`（兜底 + legacy 复制校验）仍各维护默认路径——web/desktop 语义不同属有意设计，后续如需统一可收敛为单一 resolver。
7. **Electron 重命名**：分层处理，避免破坏旧数据兼容（Prompt §16）。
8. **License**：GPL-3.0 + AGPL-3.0 双授权；分发 `.exe` 前核对源码提供义务（SPEC §31）。

---

## Test Status

| 项 | 状态 | 说明 |
|---|---|---|
| install | PASS* | 已由开发者手动完成依赖安装（WSL）；非本仓库 agent 自动执行 |
| typecheck | PASS | `npm run typecheck` 通过 |
| build | PASS | `npm run build` 通过（约 19s，仅 chunk 体积警告） |
| unit | PARTIAL | vitest 322/329 通过；7 失败 = gemini-api 写只读 `~/.gemini`（环境性，非产品缺陷，U-01）；新增 ResearchFlow 14 文件 222 用例全过 |
| integration | NOT RUN | 无独立 integration 命令；vitest 中 `server/__tests__`（gemini/session-delete 等）部分可视为集成级，但未单独执行验证 |
| e2e | NOT RUN | `npx playwright test` 未执行（需浏览器 + dev server） |
| web dev | PASS* | 开发者手动验证：WSL 中 `npm run dev` 成功，Windows 浏览器可访问 `http://localhost:5173` |
| electron dev | NOT RUN | `npm run desktop:dev` 未启动验证（本环境无桌面会话） |
| node:test | FAIL-HANG | 断言全过但 `test/codex-discovery.test.mjs` 进程挂起（U-02），`node --test test/*.test.mjs` 无法完成 |

\* = 由开发者手动执行/验证，非本仓库 agent 自动执行。

---

## Next

**Phase 5 收尾（Windows 验证）**：在 Windows / GH Actions Windows runner 执行 `desktop:dist:win` 并跑通 DESKTOP_SMOKE_TEST.md 与 RELEASE_CHECKLIST.md 的 WINDOWS 段；确认 `%APPDATA%\\ResearchFlow` 持久化、单实例、日志、卸载/重装数据保留。

V1 验收：见 RELEASE_CHECKLIST.md（CODE/DATA 已全绿；WINDOWS 段待 Windows 验证）。
