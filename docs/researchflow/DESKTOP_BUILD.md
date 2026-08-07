# ResearchFlow — Desktop Build & Release

> Phase 5 文档（2026-08-07）· 仓库：OpenLAIR/dr-claw fork（branch `researchflow-v1`）
> 本文件回答：如何开发、如何跑桌面端、如何产出 Windows 安装包、native 依赖如何处理。

---

## 1. Development（Web 模式，WSL/Linux）

```bash
npm install
npm run dev
```

- 前端 Vite：`http://localhost:5173`（Windows 浏览器直接访问）
- 后端 Express：`http://localhost:3001`（`/health`）
- Web 模式使用默认数据路径：`~/.dr-claw/auth.db`（`DATABASE_PATH` 可覆盖）
- `npm run typecheck` / `npm run build` / `npm test` 均可用

## 2. Desktop development（Electron）

```bash
npm run desktop:dev
```

`electron/cli.mjs` 会依次：

1. `desktop:icons` 生成图标
2. `native:node` 为 **Node** ABI 重编译 native 模块（better-sqlite3、node-pty）
3. `npm run build` 产出前端 `dist/`
4. 以隔离 HOME（`.electron-home/`）启动 Electron（`electron/main.mjs`）

> 注意：`desktop:dev` 与 `desktop:dist` 之前都会重建 native 模块；两套 ABI
> （Node vs Electron）不能同时兼容，脚本会自动切换（见 §4）。

## 3. Windows release build

### 3.1 推荐路径：GitHub Actions Windows runner

官方发布构建在 **Windows** 上执行（SPEC §18.3 / Implementation Prompt §27）：

- workflow：`.github/workflows/release-windows.yml`
- 触发：手动 `workflow_dispatch`（或按需 tag）
- 步骤：`npm ci` → `npm run typecheck` → `npm run build` → ResearchFlow 测试 → `npm run desktop:dist:win`

### 3.2 本机 Windows 构建

```bash
npm run desktop:dist:win
```

等价于 `node electron/cli.mjs dist --win nsis --publish never`，产出：

```
release/ResearchFlow-<version>-win-x64.exe   （NSIS 安装包）
release/win-unpacked/                        （免安装目录）
```

`version` 来自 `package.json`（唯一权威版本，UI About / 日志 / 导出 manifest 同源）。

### 3.3 不要在 WSL 交叉编译 Windows 安装包

better-sqlite3 / node-pty 是 native 模块，Linux 上 node-gyp 无法产出 win32 ABI；
官方路径是 Windows 或 Windows CI runner。

## 4. Native dependencies（better-sqlite3 / node-pty）

- 均为 native 模块；Electron ABI 与 Node ABI 不同。
- 脚本：
  - `npm run native:node` → 为当前 Node 重编译（web / dev 用）
  - `npm run native:electron` → 为 Electron 重编译（desktop 用）
  - `postinstall: node scripts/fix-node-pty.js`
- `desktop:dev` / `desktop:dist` 内部已自动调用正确脚本，**不要手动改 node_modules**。
- electron-builder 打包时自动对 win32 目标做 native rebuild（npmRebuild 默认开启）。

## 5. Packaged app 行为

- **Electron 主进程**（`electron/main.mjs`）：
  - 单实例锁（二次启动聚焦已有窗口）
  - 以 `ELECTRON_RUN_AS_NODE=1` spawn `server/index.js` 内嵌后端
  - 注入 `DATABASE_PATH = %APPDATA%\ResearchFlow\researchflow.db`
  - 健康检查 `GET /health`（30s 超时），失败显示**启动错误窗口**（Open Logs / Open Data / Retry / Exit）
  - 后端 stdout/stderr 镜像到 `%APPDATA%\ResearchFlow\logs\backend.log`（2MB 轮转）
  - `contextIsolation: true`、`sandbox: true`、preload IPC 白名单
- **用户数据**（见 `DATA_AND_BACKUP.md`）：
  ```
  %APPDATA%\ResearchFlow\
  ├── researchflow.db
  ├── backups\
  ├── logs\
  │   ├── desktop.log
  │   └── backend.log
  ├── exports\
  └── runtime\
  ```

## 6. Known limitations

- **Windows 安装包本阶段未在 WSL 环境验证**：需在 Windows / Windows CI 执行 §3 并完成
  `RELEASE_CHECKLIST.md` 的 WINDOWS 段（见文末 "Windows manual verification"）。
- `desktop:dev` 的 userData 在仓库内 `.electron-home/`（隔离），与生产 `%APPDATA%` 分离。
- legacy `Dr. Claw` / `~/.dr-claw` 数据**不会自动迁移**；手动导入指引见 `DATA_AND_BACKUP.md` §6。

## 7. WSL adapter notes

- 后端提供受控 adapter（`server/rf/workspace.js`）：`WindowsLocalAdapter` / `WSLAdapter`
  （统一 `validate/exists/git/openTerminal`，全部 `spawn` 参数数组，无 shell 拼接）。
- 项目 workspace 元数据：`workspace_type` / `windows_path` / `wsl_distro` / `wsl_path`。
- REST：`GET|PUT /api/rf/projects/:id/workspace`、`POST .../workspace/validate`、
  `POST .../workspace/open-terminal`（`Open in WSL Terminal` 用 `wsl.exe -d <distro> --cd <path>`）。
- CI 中 WSL 调用被 mock（`rf-phase5-wsl.test.mjs`），不需要真实 WSL 安装。

## 8. Windows manual verification（交付时要求开发者在 Windows 上执行）

```text
1. npm ci
2. npm run typecheck && npm run build
3. npm run desktop:dist:win
4. 安装 release/ResearchFlow-<version>-win-x64.exe
5. 启动 ResearchFlow（无终端窗口、无需 Node/npm/WSL）
6. Portfolio 出现 → 创建项目 → 重启 → 项目仍在
7. 创建 Experiment → 重启 → 仍在
8. Create Backup → Export Project → 文件可打开
9. 启动两次应用 → 单实例聚焦
10. 卸载 → 重装 → 用户数据保留（%APPDATA%\ResearchFlow）
11. 检查 %APPDATA%\ResearchFlow\logs\desktop.log 与 backend.log 可读
```
