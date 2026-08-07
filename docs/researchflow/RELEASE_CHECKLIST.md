# ResearchFlow — Release Checklist

> Phase 5 文档（2026-08-07）· V1 发布前逐项核对；"Windows 手动"项需在 Windows 环境执行。

---

## CODE

- [x] `npm run typecheck` 通过（`tsc --noEmit`）
- [x] `npm run build` 通过（Vite production build）
- [x] ResearchFlow 测试全绿：14 文件 221 用例（rf-domain / rf-api / rf-api-platform /
      rf-insights / rf-phase3-domain / rf-phase4-domain / rf-phase5-data /
      rf-phase5-wsl / rf-phase5-api / rf-phase5-desktop / ResearchFlow UI /
      Phase3 UI / Phase4 UI / Phase5 UI）
- [ ] （Windows）全量 `npm test` 在 Windows runner 复跑（已知 U-01/U-02 为上游环境性问题，
      ResearchFlow 用例不受影响）

## DATA

- [x] migrations：`rf_schema_migrations` 版本化、幂等、fresh/upgrade/rerun/reopen 有测试
- [x] backup：`Create Backup` 生成一致快照 zip（SQLite backup API）
- [x] restore：验证结构 → 恢复前安全备份 → 下次启动应用；非法备份拒绝
- [x] export：单项目 19 个 JSON + versioned manifest；secrets 排除；跨项目隔离
- [ ] （Windows）备份/恢复/导出在真实 `%APPDATA%\ResearchFlow` 上人工验证一次

## WINDOWS

- [ ] 安装包：`npm run desktop:dist:win` 产出 `release/ResearchFlow-<version>-win-x64.exe`
- [ ] 启动：双击安装后无终端窗口、无需 Node/npm/WSL，内嵌后端自动启动
- [ ] 持久化：创建项目 → 重启 → 项目仍在；Experiment 同理
- [ ] 单实例：二次启动聚焦已有窗口，不产生两个后端
- [ ] 日志：`%APPDATA%\ResearchFlow\logs\desktop.log` + `backend.log` 可读
- [ ] 卸载/重装：卸载不删 `%APPDATA%\ResearchFlow`；重装后数据保留

## SECURITY

- [x] Electron：`contextIsolation: true`、`sandbox: true`
- [x] IPC：preload 白名单（invoke 19 + on 7），仅 1 处 `ipcRenderer.invoke`（safeInvoke 内）；
      无通用 execute/readAnyFile/writeAnyFile
- [x] 新增 IPC `app:relaunch` 为 purpose-specific（启动错误窗口 Retry）
- [x] secrets：backup/export 均不包含 API keys/credentials/tokens（有测试）
- [x] 路径：WSL 全走 `spawn` 参数数组 + distro/path 校验（有测试）
- [x] 外部链接：`shell:openExternal` 只放行 http/https

## PRODUCT

- [x] 无需 API key：ResearchFlow 核心（Portfolio/Dashboard/Roadmap/Tasks/Experiments/
      Evidence/Literature/Manuscript/Submission/Backup/Export）完全离线可用
- [x] 离线核心可用：无网络启动不依赖外部服务
- [x] ResearchFlow branding：productName/appId/窗口标题/菜单/安装包名/artifactName 已切换；
      内部 legacy 标识保留（见 DATA_AND_BACKUP.md §6）
- [x] 无阻塞性 Dr. Claw onboarding：ResearchFlow 为顶层入口，无需 agent/provider 配置
