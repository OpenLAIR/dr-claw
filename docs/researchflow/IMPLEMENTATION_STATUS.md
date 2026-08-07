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

> 计划项（未开始，全部 `[ ]`）

- [ ] DB migrations：`init.sql` + `runMigrations` 双通道新增 `rf_projects / rf_stages / rf_stage_gates / rf_tasks / rf_task_dependencies / rf_activity_log`（幂等、外键、索引、timestamps）
- [ ] 10 个默认 Stage template（种子数据，权重对齐 SPEC §14.1）
- [ ] Project extension：创建 ResearchFlow project 时自动初始化 stages + gates
- [ ] Tasks relation model（stage / experiment / claim / manuscript / submission 绑定 + dependency）
- [ ] REST API：`server/routes/rf.js` 独立 router，`/api/rf/*` 资源化端点，`authenticateToken` 保护
- [ ] Activity Log 写入（Stage/Gate/Experiment/Claim 等关键操作）
- [ ] API validation + API tests（临时目录/内存 DB，规避 U-01/U-02 教训）
- [ ] 进度算法 domain/service 模块 + unit tests（StageProgress / Stage Completed 判定）

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

1. **无版本化迁移**：`init.sql` + `runMigrations` 双通道须幂等；评估 `rf_schema_version`。
2. **巨型文件蔓延**：`server/index.js`（135KB）已有约 20 个内联 project 端点——rf 代码必须独立模块（`server/routes/rf.js`），禁止并入 index.js。
3. **项目模型耦合**：rf 外键引用 `projects.id`（TEXT slug）；Attach Existing Repository 需 Phase 1 即设计 Windows/WSL 双路径字段。
4. **测试环境敏感（U-01/U-02）**：gemini-api 测试写真实 `~/.gemini`（只读 HOME 下 EROFS 失败）；codex-discovery 测试进程挂起。rf 测试一律走临时目录/内存 DB。
5. **CI 无测试（U-03）**：当前 CI 只跑 typecheck+build，rf 回归无自动保障 → Phase 1 起在 CI 增加 vitest 任务。
6. **DATABASE_PATH 三处重复（U-04）**：load-env.js / electron/main.mjs / db.js；rf 数据路径扩展前先收敛。
7. **Electron 重命名**：分层处理，避免破坏旧数据兼容（Prompt §16）。
8. **License**：GPL-3.0 + AGPL-3.0 双授权；分发 `.exe` 前核对源码提供义务（SPEC §31）。

---

## Test Status

| 项 | 状态 | 说明 |
|---|---|---|
| install | PASS* | 已由开发者手动完成依赖安装（WSL）；非本仓库 agent 自动执行 |
| typecheck | PASS | `npm run typecheck` 通过 |
| build | PASS | `npm run build` 通过（27.6s，仅 chunk 体积警告） |
| unit | PARTIAL | vitest 100/107 通过；7 失败 = gemini-api 写只读 `~/.gemini`（环境性，非产品缺陷，U-01） |
| integration | NOT RUN | 无独立 integration 命令；vitest 中 `server/__tests__`（gemini/session-delete 等）部分可视为集成级，但未单独执行验证 |
| e2e | NOT RUN | `npx playwright test` 未执行（需浏览器 + dev server） |
| web dev | PASS* | 开发者手动验证：WSL 中 `npm run dev` 成功，Windows 浏览器可访问 `http://localhost:5173` |
| electron dev | NOT RUN | `npm run desktop:dev` 未启动验证（本环境无桌面会话） |
| node:test | FAIL-HANG | 断言全过但 `test/codex-discovery.test.mjs` 进程挂起（U-02），`node --test test/*.test.mjs` 无法完成 |

\* = 由开发者手动执行/验证，非本仓库 agent 自动执行。

---

## Next

**Phase 1 — Research Domain Core**（先 DB + API，不堆 UI；完成后按 Prompt §12 汇报并更新本文件）
