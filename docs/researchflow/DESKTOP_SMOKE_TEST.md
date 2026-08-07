# ResearchFlow — Desktop Smoke Test

> Phase 5 文档（2026-08-07）· 面向 Windows 发布的人工冒烟检查。
> 执行环境：Windows 11 + 安装包（或 `win-unpacked` 目录）。
> 记录每步结果（PASS / FAIL / NOTE）。所有步骤失败即阻止发布。

---

## 1. Install → Launch

| # | 步骤 | 预期 | 结果 |
|---|---|---|---|
| 1 | 运行安装包 `ResearchFlow-<version>-win-x64.exe` | 安装成功，生成开始菜单/桌面入口 | |
| 2 | 双击 ResearchFlow | 应用打开，**无终端窗口**，无需 Node/npm/WSL/手动 server | |
| 3 | Portfolio 出现 | 首页显示 ResearchFlow Portfolio + Data & Backup 面板 | |

## 2. Persistence

| # | 步骤 | 预期 | 结果 |
|---|---|---|---|
| 4 | 创建 ResearchFlow 项目 | 项目出现在 Portfolio | |
| 5 | 关闭应用 → 重启 | 项目仍在（数据持久化） | |
| 6 | 打开项目 Dashboard | 首屏显示 stage/progress/blocker/NCA | |
| 7 | 创建 Experiment | 出现在 Experiments 注册表 | |
| 8 | 重启应用 | Experiment 仍在 | |

## 3. Data safety

| # | 步骤 | 预期 | 结果 |
|---|---|---|---|
| 9 | Portfolio → Data & Backup → Create Backup | `backups/` 出现 `researchflow-backup-<ts>.zip` | |
| 10 | 打开 zip | 含 researchflow.db + manifest.json + settings.json | |
| 11 | Project → Export Project | 下载 `<name>-researchflow-export-<ts>.zip` | |
| 12 | 打开导出 zip | 含 project.json/stages.json/…/manifest.json（无 secrets） | |
| 13 | Restore Backup（选备份 → 恢复） | 提示重启；重启后数据为备份时状态 | |

## 4. Lifecycle / single instance / shutdown

| # | 步骤 | 预期 | 结果 |
|---|---|---|---|
| 14 | 应用运行中再启动一次 | 聚焦已有窗口，**不**出现第二个后端 | |
| 15 | 关闭应用 | 任务管理器中无残留 server 进程（无孤儿后端） | |
| 16 | 查看 `%APPDATA%\ResearchFlow\logs\desktop.log` 与 `backend.log` | 可读、含启动/退出记录 | |

## 5. Optional（WSL 项目）

| # | 步骤 | 预期 | 结果 |
|---|---|---|---|
| 17 | 项目 → Execution Environment → Type=WSL2 + distro + path → Save | 保存成功 | |
| 18 | Validate | 报告 Connected 或可读错误 | |
| 19 | Open in WSL Terminal | 打开 WSL 终端且 cwd 为项目路径 | |

---

## Release smoke test（§42 完整核对）

- [ ] installer opens
- [ ] install succeeds
- [ ] application starts（no terminal / no Node / no npm / no WSL / no dev server）
- [ ] database persists after restart
- [ ] uninstall works
- [ ] reinstall preserves `%APPDATA%\ResearchFlow`
- [ ] logs accessible
- [ ] backup works
- [ ] project export works
- [ ] 二次启动单实例安全行为
