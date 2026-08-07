# ResearchFlow — Architecture Baseline

> Phase 0 产物 · 日期：2026-08-07 · 基线 commit：`4561ecb`（branch `researchflow-v1`）
> 上游：OpenLAIR/dr-claw v1.1.4（npm `dr-claw`）
> 本文档回答：现有架构是什么、哪些可复用、哪些要隐藏/改动、DB 与路由如何扩展、风险在哪。
> 业务需求见 `ResearchFlow_PRODUCT_SPEC.md`，实施纪律见 `ResearchFlow_DeepSeekV4_Implementation_Prompt.md`。

---

## 1. Current Architecture（现状）

### 1.1 技术栈

| 层 | 技术 | 位置 |
|---|---|---|
| 前端 | React 18 + Vite 7 + Tailwind + react-router-dom（BrowserRouter） | `src/` |
| 后端 | Node.js + Express + ws（WebSocket）+ node-pty（终端） | `server/` |
| 数据库 | better-sqlite3（业务库）；sqlite3/sqlite 仅只读第三方 Cursor store.db | `server/database/` |
| 桌面 | Electron 37（子进程方式内嵌后端） | `electron/` |
| CLI | `server/cli.js`（bin: `dr-claw` / `vibelab`） | `server/` |
| 测试 | vitest（`server/__tests__`、`src/**/__tests__`）、node:test（`test/*.test.mjs`）、Playwright（`test/*.spec.ts`） | 见下 |

Node 版本：`.nvmrc` = v22（engines 20/22/24）。

### 1.2 进程模型与入口

- **Web 模式**：`npm run dev` 用 `concurrently` 同时跑 Express（`server/index.js`，默认 3001）与 Vite（5173）；vite.config.js 将 `/api`、`/ws`、`/shell` 代理到后端（端口经 `.runtime/ports.json` 动态解析）。**Server 自身不拉起 Vite**。
- **Desktop 模式**：`electron/main.mjs` 以 `spawn(nodeBinary, [server/index.js])` 启动**独立子进程**后端（`ELECTRON_RUN_AS_NODE=1`，注入 `DATABASE_PATH`/`WORKSPACES_ROOT`/`PORT`/`HOST=127.0.0.1`，main.mjs:265-315），健康检查后加载 UI；`userData` 重定向到 `%APPDATA%/Dr. Claw`（main.mjs:34），窗口 `contextIsolation:true, sandbox:true` + preload IPC 白名单（preload.mjs:3-31）。
- **Server 启动链**：`startServer()`（index.js:3201-3261）→ `initializeDatabase()` → `listenOnAvailablePort()`（写 `.runtime/ports.json`）→ `setupProjectsWatcher()`；SIGTERM/SIGINT 优雅退出。

### 1.3 数据模型（核心认知）

**Project 是 filesystem-first 的**：

- `server/projects.js` 的 `projects` 表（init.sql:104-117）**只是索引**：`id`=目录 slug、`user_id`、`display_name`、`path`、`is_starred`、`metadata JSON`。
- **消息从不进 DB**：按 provider 读文件——Claude `~/.claude/projects/<slug>/*.jsonl`、Gemini `~/.gemini/sessions/*.jsonl`、OpenRouter/LocalGPU `~/.dr-claw/*-sessions`（projects.js:859/1226/1291/1330/2108-2111）。
- 会话元数据索引在 `session_metadata` 表；项目显示名/回收站配置在 `~/.claude/project-config.json`。
- 工作区根：默认 `~/dr-claw`（routes/projects.js:18-29），路径安全校验 64-186。
- **对 ResearchFlow 的含义**：`rf_*` 应该沿用同一哲学——**状态/关系/元数据进 SQLite，artifact（config/checkpoint/figure/manuscript）落文件系统**；项目以 `project.name`（slug）为主键引用，服务端经 `extractProjectDirectory` 解析真实路径。

### 1.4 SQLite 初始化与迁移（无版本化系统）

- `server/database/db.js:36`：`DB_PATH = process.env.DATABASE_PATH || server/database/auth.db`；`load-env.js:73-75` 与 `electron/main.mjs:279` 各自兜底设置 `~/.dr-claw/auth.db`（三处重复，env 优先）。
- 初始化：`initializeDatabase()` 执行 `init.sql`（**全部 `CREATE TABLE IF NOT EXISTS`**，db.js:203-213）。
- 迁移：`runMigrations()`（db.js:85-200）用 `PRAGMA table_info` 探测列/表，幂等 `ALTER TABLE`/`CREATE`——**没有版本号迁移机制**。
- `PRAGMA foreign_keys = ON`（db.js:71）。
- 现有表：`users, api_keys, user_credentials, session_metadata, project_tags, session_tag_links, projects, auto_research_runs, app_settings, references_library, project_references, reference_tags, user_memories`。

### 1.5 API 与 WebSocket

- Express 路由统一挂载在 `server/index.js:475-539`：`/api` → `validateApiKey`；`/api/auth` 公开；其余全部 `authenticateToken`（JWT，`server/middleware/auth.js:42-74`，30 天有效期；`IS_PLATFORM` 单用户短路由 44-51）。
- **约 20 个 project 相关端点内联在 index.js:772-1344**（list/sessions/tags/rename/delete/trash/file tree/file CRUD/upload）——这是需要规避的"巨型文件"模式，新 domain 应独立 router。
- WebSocket：单端口单 `wss`（index.js:414-429，Bearer/query token 鉴权），**按 pathname 复用**：`/ws`（聊天）、`/shell`（PTY）、`/compute-shell`；聊天消息类型分发到 7 个 provider 适配器（index.js:1529-1741），统一经 `WebSocketWriter` 流式输出。
- 静态资源：`public/` + `dist/`（hash 缓存 1y）；SPA fallback `app.get('*')`（2952-2973）。

### 1.6 前端组织

- `src/main.jsx` → `App.tsx`：`BrowserRouter` 仅 3 条路由（`/`、`/session/:sessionId`、`/survey/diagram`），Provider 栈 I18next→Theme→Auth→WebSocket→TasksSettings→TaskMaster，全部包在 `ProtectedRoute`。
- **Tab 架构**：`AppTab`（src/types/app.ts:38）→ `MainContent.tsx:160-305` 按 tab 渲染：dashboard / autoresearch / skills / trash / news / compute；默认视图是 chat（ChatTabBar + ChatInterface）。侧栏导航在 `SidebarHeader.tsx:141-199`。
- **项目作用域工具的标准挂载点是 Chat 右侧栏**：`ChatContextSidebar.tsx:1023-1049` 已挂 ResearchLab、FileTree、GitPanel、ShellWorkspace——**ResearchFlow 项目页应复用此模式或新增顶层 tab，二选一在 Phase 2 决定**。
- i18n：i18next + react-i18next，语言 en/ko/zh-CN，8 个 namespace JSON（`src/i18n/locales/<lang>/*.json`），**新增 namespace 需在 `src/i18n/config.js` 三处注册**（import、`resources`、`ns`）。

### 1.7 Agent 集成（ResearchFlow V1 不依赖，但存在）

7 个适配器：`claude-sdk.js`（in-process SDK）、`cursor-cli.js`/`gemini-cli.js`/`nano-claude-code.js`（spawn CLI）、`openai-codex.js`（SDK chat loop）、`gemini-api.js`（REST+OAuth）、`openrouter.js`（OpenAI 兼容）。全部经 `/ws` 分发。

### 1.8 测试现状

- `npm test` = vitest run：覆盖 `server/__tests__/*.test.mjs`（8 文件）+ `src/**/__tests__`；**排除 `test/**`**。
- `test/*.test.mjs`（node:test）与 `test/*.spec.ts`（Playwright，webServer=`npm run dev`，baseURL 5173）**未接入 npm scripts**。
- **CI（.github/workflows/ci.yml）只跑 `typecheck` + `build`，无测试任务**。

---

## 2. Reusable Modules（直接复用）

| 模块 | 位置 | 复用于 ResearchFlow |
|---|---|---|
| Electron shell（子进程后端 + 健康检查 + 单实例 + userData 重定向） | `electron/main.mjs`、`preload.mjs`、`cli.mjs` | Phase 5 桌面硬化直接沿用 |
| Express 服务 + 鉴权（validateApiKey/authenticateToken/WS 鉴权） | `server/index.js:475-539`、`server/middleware/auth.js` | 所有 `/api/rf/*` 路由 |
| SQLite 初始化双通道（init.sql + runMigrations） | `server/database/db.js` | rf_* 表沿用此模式 |
| 项目解析与路径安全 | `server/projects.js`（getProjects/extractProjectDirectory）、`server/utils/safePath.js`、routes/projects.js:64-186 | rf_projects 关联现有 project |
| File/Git Explorer 与工作区处理 | `src/components/FileTree.jsx`、`GitPanel.jsx`、`server/routes/git.js` | Project 页的 Files/Git tab 保留 |
| i18n 基础设施 | `src/i18n/` | 新增 rf namespace 即可 |
| 设置/凭证存储 | `server/routes/settings.js` + `appSettingsDb/apiKeysDb/credentialsDb` | rf_settings 可并入或独立 |
| CodeMirror / Markdown / mermaid / katex 渲染链 | `src/components/CodeEditor.jsx`、react-markdown 等 | Manuscript/Evidence 编辑 |
| WebSocketWriter 流式通道 | `server/index.js:1371-1403` | 未来 Copilot 输出通道 |

---

## 3. Modules to Hide / Deprecate（V1 隐藏而非删除）

按 Implementation Prompt §0.3，V1 从导航/入口弱化（不物理删除，降低回归风险）：

- **News Dashboard**（`src/components/news-dashboard/`、`server/routes/news.js`）— MainContent.tsx:281 的 news tab
- **Auto Research Hub**（`src/components/AutoResearchHub.tsx`、`server/routes/auto-research.js`、`auto_research_runs` 表）
- **Promotion / Video / TTS**（ResearchLab 内 promotion 阶段卡片等）
- **agent-heavy onboarding**（`src/components/Onboarding.jsx` 中的 agent 引导部分）
- ResearchLab 的 autonomous pipeline 展示（`src/components/ResearchLab.jsx` 保留，仅弱化）
- compute-dashboard（`server/routes/compute.js`、`server/compute-node.js`）— 非 V1 必需

实施建议：优先通过 `MainContent`/`SidebarHeader` 的 tab 级隐藏 + 入口收敛，配合 `IS_PLATFORM`/feature-flag 环境变量，不动核心文件。

---

## 4. Modules Requiring Change（需要改动）

| 改动点 | 文件 | 说明 |
|---|---|---|
| rf_* 表 + 迁移 | `server/database/init.sql` + `server/database/db.js`（runMigrations） | 双通道新增；无版本化，必须幂等 |
| rf API router | **新建** `server/routes/rf.js`（或 rf/ 目录），在 `server/index.js:475-539` 注册 `app.use('/api/rf', authenticateToken, rfRoutes)` | 避免重蹈 index.js 巨型内联端点 |
| 前端 API helper | `src/utils/api.js` | 新增 rf 方法 |
| 前端页面/导航 | `src/types/app.ts`（AppTab）、`src/components/main-content/view/MainContent.tsx`、`src/components/sidebar/SidebarHeader.tsx` 或 ChatContextSidebar 右侧栏 | 二选一挂载策略，Phase 2 定 |
| i18n | `src/i18n/config.js` + `src/i18n/locales/{en,zh-CN}/researchflow.json` | 三处注册 |
| 项目模型扩展 | `server/routes/projects.js`（workspace root）、`src/components/ProjectCreationWizard.jsx`、`src/components/project-dashboard/` | 新建 RF 项目向导 + 现有 repo attach |
| Electron 标识 | `electron/main.mjs`（userData 名）、package.json `build`（productName/appId/artifactName） | Phase 5 重命名，分层做，勿全局 replace |
| 数据路径 | `server/load-env.js` / `electron/main.mjs` / `server/database/db.js` 三处 DATABASE_PATH | 建议收敛为单一 resolver（可选优化） |

---

## 5. Database Migration Plan（rf_* 落地路径）

沿用现状（无版本化工具）的推荐做法：

1. **init.sql** 追加 `CREATE TABLE IF NOT EXISTS rf_*`（新装生效），沿用现有风格：`id`、`project_id`（引用 `projects.id` TEXT slug）、`created_at`/`updated_at` DATETIME、`archived_at`、`sort_order`、`metadata_json`。
2. **runMigrations**（db.js:85-200）末尾追加同一组 `CREATE TABLE IF NOT EXISTS` + 索引（存量安装升级路径，幂等）。
3. 建议首期表（Phase 1）：`rf_projects, rf_stages, rf_stage_gates, rf_tasks, rf_task_dependencies, rf_activity_log`；Phase 3 追加 `rf_experiments, rf_experiment_runs, rf_claims, rf_evidence, rf_claim_evidence, rf_decisions, rf_literature, rf_figures_tables`；Phase 4 追加 `rf_manuscript_sections, rf_review_comments, rf_submission_profiles, rf_submission_items, rf_artifacts, rf_settings`。
4. 10 个默认 Stage 模板：作为种子数据在应用层（迁移或首次初始化函数）写入 `rf_stages`，不硬编码进 schema。
5. 约束：`foreign_keys=ON` 已开启；`projects.id` 是 TEXT slug（非自增），rf 外键保持字符串一致性；软删除优先（`archived_at`），尤其失败实验。

---

## 6. Routing Plan（前后端路由）

- **后端**：`server/routes/rf.js` 独立 router，资源化 REST（对齐 SPEC §25）：
  `GET/POST /api/rf/projects`、`GET /api/rf/projects/:id/dashboard`、`.../stages`、`.../experiments`、`POST /api/rf/experiments/:id/runs`、`.../claims`、`POST /api/rf/claim-evidence`、`.../manuscript`、`.../submission`；全部 `authenticateToken` 保护；返回 `{success, data}` 风格。
- **前端**：走 `src/utils/api.js` 封装；页面路由保持 SPA 单页 + tab 切换（不新增 BrowserRouter 路径），Project 内细分为 dashboard / roadmap / experiments / evidence / literature / manuscript / submission 子视图。
- 鉴权注意：`IS_PLATFORM` 单用户模式（server/constants/config.js:5）下 `req.user` 语义需在测试中覆盖。

---

## 7. Implementation Risks（风险清单）

1. **无版本化迁移**：多实例升级或中途改 schema 有漂移风险 → 全部幂等、加测试；rf 表上线后尽快引入 `rf_schema_version`（可选，Phase 1 评估）。
2. **巨型文件**：`server/index.js`（135KB）、`projects.js`（157KB）、`ResearchLab.jsx`（147KB）——rf 代码**必须独立模块**，禁止并入 index.js。
3. **项目模型耦合**：rf_projects 引用 `projects.id` slug 依赖 `~/.claude` 等外部配置；Attach Existing Repository 的路径解析（Windows/WSL 双路径）需 Phase 1 即设计 `workspace_type/wsl_distro/wsl_path/windows_path` 字段（SPEC §19）。
4. **进度算法与 Stage Gate 状态机**：StageProgress/Next Critical Action/Submission Ready 需独立 domain/service + 单测，禁止 UI 内复制逻辑（Prompt §5/§6）。
5. **Electron 重命名**：`Dr. Claw` 品牌、userData、appId、agent user-agent 标识分 6 层处理，全局替换会破坏旧数据兼容（Prompt §16）。
6. **测试环境敏感**：gemini-api 测试写真实 `~/.gemini`（本环境只读 HOME 直接失败）；codex-discovery 测试进程不退出（详见 UPSTREAM_ISSUES.md）。新增 rf 测试应全部走临时目录/内存 DB。
7. **Licensing**：GPL-3.0 + AGPL-3.0 双授权；分发 `.exe` 前核对源码提供义务（SPEC §31）。
8. **CI 无测试**：当前 CI 只跑 typecheck+build，rf 的 API/单测不会自动回归 → 建议 Phase 1 给 CI 增加 vitest 任务。

---

## 附：Phase 0 Baseline 验证结果（2026-08-07）

| 项 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 通过 |
| `npm run build` | ✅ 通过（27.6s；仅 chunk>1000kB 警告） |
| `npm test`（vitest） | ⚠️ 100/107 通过；7 失败 = gemini-api 写只读 `~/.gemini`（环境/测试隔离，非产品缺陷） |
| `node --test test/*.test.mjs` | ⚠️ 断言全过；codex-discovery 进程挂起（见 UPSTREAM_ISSUES） |
| Playwright e2e | ⏸ 未运行（需浏览器 + `npm run dev`，留待 CI/桌面环境） |
| `npm install` | ✅ node_modules 已在，`npm ci` 未重跑（package-lock 有未提交改动） |

> 上游缺陷另见 `docs/researchflow/UPSTREAM_ISSUES.md`。
