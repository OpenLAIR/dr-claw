# ResearchFlow — Upstream Issues

> Phase 0 记录 · 上游：OpenLAIR/dr-claw v1.1.4 · 验证环境：Node v22.23.2、Linux/WSL2
> 目的：区分「上游既有问题」与「ResearchFlow 新功能引入的问题」（Implementation Prompt §0.1 要求）。
> 严重级别：🔴 阻断 / 🟠 高 / 🟡 中 / ⚪ 低

---

## 🟠 U-01 gemini-api 测试写真实 `~/.gemini`，未隔离 HOME（只在只读/CI 环境暴露）

- **文件**：`server/__tests__/gemini-api.test.mjs`（7 个用例）
- **现象**：在本环境跑 `npm test`，`server/__tests__/gemini-api.test.mjs` 的 7 个用例失败，全部为：
  `Error: EROFS: read-only file system, open '/home/mars/.gemini/sessions/gemini-*.jsonl'`
- **根因**：`queryGeminiApi` 经 `ensureSessionMetadata`（`server/gemini-api.js:575`）向 `~/.gemini/sessions/` 写会话 JSONL；测试**没有 mock 或重定向该路径**，直接写真实用户 HOME。本环境 `/home/mars/.gemini` 为只读挂载，故失败。上游 CI（干净 runner，HOME 可写）大概率能通过——因此这是**测试隔离缺口**而非生产缺陷。
- **影响**：任何 HOME 受限的环境（只读挂载、沙箱、某些 CI）都会红；测试污染真实用户数据（副作用泄漏）。
- **建议**：测试前设置隔离的 `HOME`/session 目录（如 `os.tmpdir()` 临时目录，参考 `test/codex-discovery.test.mjs` 的 `withTempHome` 模式），或注入可配置的 session 根路径。
- **对 ResearchFlow**：新增 rf 测试一律使用临时目录/内存 DB，禁止触碰真实 HOME。

## 🟠 U-02 `test/codex-discovery.test.mjs` 断言全过但进程不退出（node --test 挂起）

- **文件**：`test/codex-discovery.test.mjs`（3 个用例）
- **现象**：`node --test test/codex-discovery.test.mjs` 三个用例全部 `ok`，但**进程永不退出**（`timeout 12` 后 exit=124；挂起时进程停在 `do_epo` 事件循环等待，无子进程）。连带导致 `node --test test/*.test.mjs` 无法跑完整个目录。
- **最小复现**：`node -e "import('./server/routes/cli-auth.js')"` 同样挂起；改用纯 ESM 入口 `node --input-type=module -e "import('./server/routes/cli-auth.js')"` 则正常退出。指向该 import 图（`cli-auth.js` → `db.js` better-sqlite3 连接等）在 CJS 动态 import 场景下遗留事件循环句柄；测试未显式 `db.close()` / 句柄清理。
- **影响**：该测试未接入 npm scripts 与 CI，影响面为本地开发者手动跑 node:test；但会误导"测试全过"判断。
- **建议**：测试文件增加显式清理（关闭 DB 连接 / `process.exit` 前句柄释放），或在 CI 中对该文件单独加超时。
- **对 ResearchFlow**：新增 node:test 文件需自检进程能否自然退出。

## 🟡 U-03 CI 不运行任何测试（只 typecheck + build）

- **文件**：`.github/workflows/ci.yml`（step：`npm ci` → `npm run typecheck` → `npm run build`）
- **现象**：`npm test`、node:test、Playwright 均未纳入 CI；U-01/U-02 因此无法被上游 CI 捕获。
- **建议**：ResearchFlow Phase 1 起在 CI 增加 vitest 任务（rf API/单测回归的底线）。

## 🟡 U-04 `DATABASE_PATH` 解析逻辑三处重复

- **文件**：`server/load-env.js:73-75`、`electron/main.mjs:279`（经 `resolveSharedDatabasePath` 210-243）、`server/database/db.js:36`（兜底）
- **现象**：同一套"默认 `~/.dr-claw/auth.db` + env 优先 + 旧路径迁移"逻辑在三个文件维护；rf 若增加数据路径（如 `~/.researchflow`）需同步改三处。
- **建议**：收敛为单一 resolver 模块（Phase 1 顺手做，低风险）。

## ⚪ U-05 前端主 bundle 超大（build 警告）

- **现象**：`npm run build` 报 `index-C3EAvAKr.js 2.85MB`（gzip 835KB）超过 1000kB 阈值；依赖 vite 手动分包。
- **影响**：非阻断；V1 不强制优化，避免无关重构（Prompt §14）。

## ⚪ U-06 `sqlite3`/`sqlite` 依赖仅用于读 Cursor store.db

- **说明**：package.json 中 `sqlite3`、`sqlite` 两个依赖仅服务于 `server/projects.js:3402-3416` 等只读场景，与业务 schema 无关；rf 表全部走 better-sqlite3。上游 native module 依赖较脆（`better-sqlite3` 需 node-gyp 编译），`npm install` 失败时优先怀疑 native rebuild（见 `scripts/fix-node-pty.js` 的同类处理）。
