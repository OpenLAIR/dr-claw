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

> 全部未完成 `[ ]`

- [ ] Portfolio（多项目总览卡片）
- [ ] Project Dashboard（10 秒状态首屏：Overall Progress / Current Stage / Deadline / Blockers / Next Critical Action / Experiment & Evidence & Manuscript summary / Submission readiness）
- [ ] Roadmap（Stage Timeline + 点击 Stage 详情）
- [ ] Stage Gate UI（勾选 / 未满足 required gate 禁止标记 Completed）
- [ ] Next Critical Action（deterministic 算法，独立模块 + 单测）
- [ ] Project Health
- [ ] 前端挂载策略定夺：新增顶层 tab vs Chat 右侧栏 tab（ARCHITECTURE_BASELINE §1.6/§4）

## Phase 3 — Experiments / Evidence

> 全部未完成 `[ ]`

- [ ] `rf_experiments / rf_experiment_runs`：Experiment 1→N Runs（seed / git commit / config / result path / metrics / failure reason）
- [ ] Failed experiment 保留 + failure classification（禁止物理删除）
- [ ] `rf_claims / rf_evidence / rf_claim_evidence`：Claim↔Evidence 矩阵（supports / contradicts / contextualized_by）
- [ ] Critical Missing Evidence 检测（Core Claim 无证据 → dashboard warning）
- [ ] `rf_decisions`（Research Decision Log）
- [ ] `rf_literature`（项目文献状态）
- [ ] `rf_figures_tables`（Figure/Table → Source Experiment Run 可追溯）

## Phase 4 — Manuscript / Submission

> 全部未完成 `[ ]`

- [ ] `rf_manuscript_sections / rf_review_comments`（Section 状态机：Not Started→…→Final）
- [ ] Results Freeze（snapshot metadata；Critical Missing Evidence 时默认禁止，override 需显式确认 + reason + Activity Log）
- [ ] `rf_submission_profiles / rf_submission_items`（venue metadata + checklist）
- [ ] Submission Ready 自动判定（Required checklist 全过）
- [ ] `Submitted` 仅人工显式操作

## Phase 5 — Desktop Hardening

> 全部未完成 `[ ]`

- [ ] Product rename（6 层分层处理：UI branding / productName / appId / installer / data dir / user-agent；勿全局 replace）
- [ ] userData / SQLite 路径（%APPDATA%\ResearchFlow，Electron `app.getPath('userData')`）
- [ ] Backup（SQLite snapshot + metadata + settings）
- [ ] Project Export（zip：project/stages/tasks/experiments/claims/decisions/literature/manuscript/submission.json）
- [ ] WSL adapter 架构边界（ExecutionAdapter interface + workspace_type/wsl_distro/wsl_path/windows_path，Open in WSL Terminal）
- [ ] startup error UI / log access
- [ ] Windows installer（`npm run desktop:dist:win`，建议 Windows/GH Actions 构建）
- [ ] desktop smoke test

---

## Current Risks

（来源：ARCHITECTURE_BASELINE.md §7 + UPSTREAM_ISSUES.md）

1. **rf 迁移演进纪律**（原"无版本化迁移"风险已由 `rf_schema_migrations` 解决）：rf 与 legacy 两套迁移机制并行维护——新增 ResearchFlow migration 必须**追加到 `server/rf/migrations.js` 的 `MIGRATIONS` 数组末尾且版本号递增，禁止修改已应用版本**；rf 表与 legacy 表命名空间分离（`rf_*` 前缀），防止命名冲突。
2. **巨型文件蔓延**：`server/index.js`（135KB）已有约 20 个内联 project 端点——rf 代码必须独立模块（`server/routes/rf.js`），禁止并入 index.js。
3. **工作区路径可移植性**（原"项目模型耦合"风险已解决：`rf_projects.id` 现为稳定 UUID，`source_project_id` 可选关联 `projects.id`，目录 rename/move 不影响 ResearchFlow 身份）：`workspace_type/windows_path/wsl_distro/wsl_path` 字段已预留但尚未消费；Windows/WSL 路径可移植性与 `Open in WSL Terminal` 属 **Phase 5** WSL adapter 关注点，不阻塞 Phase 2。
4. **测试环境敏感（U-01/U-02）**：gemini-api 测试写真实 `~/.gemini`（只读 HOME 下 EROFS 失败）；codex-discovery 测试进程挂起。rf 测试一律走临时目录/隔离 DB（已规避），upstream 两处缺陷按 UPSTREAM_ISSUES.md 记录，不属 ResearchFlow 回归。
5. **upstream 全量测试未入 CI（U-03，非阻塞）**：rf 专项 vitest step 已加入 CI（`.github/workflows/ci.yml`，rf-domain/rf-api/rf-api-platform 26 用例）；upstream 全量测试（含 U-01/U-02 影响）仍未纳入 CI，属已知上游问题，不阻塞 ResearchFlow。
6. **DATABASE_PATH 三处重复（U-04，deferred / non-blocking）**：load-env.js / electron/main.mjs / db.js 各自维护默认路径；**明确推迟**——不属 Phase 2 任务，待 Phase 5 数据路径整合时一并收敛。
7. **Electron 重命名**：分层处理，避免破坏旧数据兼容（Prompt §16）。
8. **License**：GPL-3.0 + AGPL-3.0 双授权；分发 `.exe` 前核对源码提供义务（SPEC §31）。

---

## Test Status

| 项 | 状态 | 说明 |
|---|---|---|
| install | PASS* | 已由开发者手动完成依赖安装（WSL）；非本仓库 agent 自动执行 |
| typecheck | PASS | `npm run typecheck` 通过 |
| build | PASS | `npm run build` 通过（27.6s，仅 chunk 体积警告） |
| unit | PARTIAL | vitest 126/133 通过；7 失败 = gemini-api 写只读 `~/.gemini`（环境性，非产品缺陷，U-01）；新增 ResearchFlow 3 文件 26 用例全过 |
| integration | NOT RUN | 无独立 integration 命令；vitest 中 `server/__tests__`（gemini/session-delete 等）部分可视为集成级，但未单独执行验证 |
| e2e | NOT RUN | `npx playwright test` 未执行（需浏览器 + dev server） |
| web dev | PASS* | 开发者手动验证：WSL 中 `npm run dev` 成功，Windows 浏览器可访问 `http://localhost:5173` |
| electron dev | NOT RUN | `npm run desktop:dev` 未启动验证（本环境无桌面会话） |
| node:test | FAIL-HANG | 断言全过但 `test/codex-discovery.test.mjs` 进程挂起（U-02），`node --test test/*.test.mjs` 无法完成 |

\* = 由开发者手动执行/验证，非本仓库 agent 自动执行。

---

## Next

**Phase 2 — Dashboard / Roadmap**（Portfolio / Project Dashboard / Roadmap / Stage Gate UI / Next Critical Action / Project Health；前端挂载策略定夺：顶层 tab vs Chat 右侧栏 tab）
