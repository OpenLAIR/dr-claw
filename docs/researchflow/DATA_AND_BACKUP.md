# ResearchFlow — Data & Backup

> Phase 5 文档（2026-08-07）
> 本文件回答：数据存在哪、备份含什么、导出与备份的区别、恢复行为、工作区路径、用户需自行备份什么。

---

## 1. Where ResearchFlow stores data

| 模式 | 数据库 | 数据目录 |
|---|---|---|
| Web 开发（WSL/Linux `npm run dev`） | `~/.dr-claw/auth.db`（`DATABASE_PATH` 可覆盖） | `~/.dr-claw/` |
| Desktop（Windows 生产） | `%APPDATA%\ResearchFlow\researchflow.db` | `%APPDATA%\ResearchFlow\` |

Desktop 数据目录布局：

```
%APPDATA%\ResearchFlow\
├── researchflow.db       主数据库（ResearchFlow 全部状态/关系/元数据）
├── backups\              手动备份 zip（researchflow-backup-<timestamp>.zip）
├── restore-pending\      恢复暂存（下次启动时应用）
├── exports\              项目导出 zip（<name>-researchflow-export-<timestamp>.zip）
├── logs\
│   ├── desktop.log       Electron 主进程日志
│   └── backend.log       内嵌后端日志（2MB 轮转）
└── runtime\              端口/运行时信息
```

路径在 UI 中可见：Portfolio → **Data & Backup** 面板（Database / Data directory），
Electron 菜单 Help → View Logs / Open Data Directory，启动错误窗口可打开数据目录与日志。

## 2. What a backup contains

- `researchflow.db` — 通过 SQLite **backup API** 生成的一致快照（不是裸拷贝）
- `manifest.json` — 格式、appVersion、schemaVersion、时间戳
- `settings.json` — `app_settings` 表中**非敏感**项（key 含 `key/secret/token/credential/password/api` 的项被跳过）

备份不包含：API keys、credentials、tokens、datasets、checkpoints、大体积结果目录、外部 Git 仓库。

## 3. What a backup does NOT contain

- 用户的 LLM provider 凭证 / API key（从不写入）
- `users` / `api_keys` / `user_credentials` 等 legacy 敏感表
- 任何项目外部文件（`backup` 只含 SQLite + manifest + settings）

## 4. Backup vs Export

| | Backup | Project Export |
|---|---|---|
| 范围 | 整个应用（所有项目 + settings） | 单个 ResearchFlow 项目 |
| 形式 | `researchflow-backup-<ts>.zip` | `<ProjectName>-researchflow-export-<ts>.zip` |
| 用途 | 灾难恢复 / 升级前快照 | 分享 / 归档 / 未来 import |
| 内容 | DB 快照 + manifest + settings | 19 个 JSON（project/stages/tasks/experiments/experiment-runs/claims/evidence/claim-evidence/decisions/literature/figures-tables/entity-links/manuscript/result-freezes/reviews/submission/submission-items/activity-log/task-links）+ manifest |
| 恢复 | 支持（见 §5） | V1 不提供 import（export 带版本号，为未来 import 预留） |

## 5. Restore behavior

- UI：Portfolio → Data & Backup → 选择备份 → Restore Backup。
- 服务端先**验证**备份结构（manifest + 合法 SQLite），**非法备份拒绝**。
- 恢复是**两阶段**的：
  1. 先自动创建**恢复前安全备份**（pre-restore backup）
  2. 把待恢复 DB 暂存到 `restore-pending/`
  3. **下次应用启动时**（打开 DB 之前）校验并替换 `researchflow.db`，替换前删除
     `-wal`/`-shm`，完成后清理暂存目录
- 恢复过程中**绝不删除当前数据**：失败会保留暂存并记录日志，当前 DB 不受影响。
- 需要重启应用生效；UI 会明确提示 `Restart ResearchFlow to apply`。
- **注意**：备份快照会清空 sensitive legacy 表（`users`/`api_keys`/`user_credentials`/
  `session_metadata`/`app_settings` 的行，schema 保留）——这是安全取舍：ResearchFlow
  全部状态（`rf_*` 表）完整保留，但 Dr. Claw legacy 体系（用户/凭证）不随备份恢复，
  需另行备份（见 §8）。多用户模式下恢复后需重新注册/导入用户。

## 6. Legacy Dr. Claw data / path compatibility

- 旧版（Dr. Claw / vibelab）数据可能位于 `~/.dr-claw/auth.db` 或 `~/.vibelab/auth.db`
  （以及桌面旧版 `%APPDATA%\Dr. Claw`）。
- **ResearchFlow V1 不自动复制/迁移任何 legacy 数据**（方案 B：干净目录 + 显式兼容）。
  - 启动时若检测到 legacy DB 且生产 DB 不存在，会在 `desktop.log` 记录提示。
- 手动导入指引：
  1. 关闭 ResearchFlow。
  2. 复制 legacy DB 到 `%APPDATA%\ResearchFlow\researchflow.db`（若不存在）。
  3. 启动 ResearchFlow，验证项目仍在。
  4. 如需回退，先删除新 DB，恢复旧文件。
- 数据库 schema 标识、表名、`JWT_SECRET`/`DATABASE_PATH` env 名等内部标识**有意保留**，
  以保证 legacy 兼容，不属于产品品牌（产品品牌见 `DESKTOP_BUILD.md` §5）。

## 7. Workspace paths（Windows / WSL）

- 项目 workspace 元数据（`rf_projects`）：`workspace_type` / `windows_path` / `wsl_distro` / `wsl_path`。
- Windows 路径与 WSL 路径**不互相转换**——各自按类型存储与校验。
- `Open in WSL Terminal` 使用 `wsl.exe -d <distro> --cd <wsl_path>`；Windows 侧打开目录用
  `explorer.exe`。全部经受控后端 adapter（`server/rf/workspace.js`），无 shell 拼接。

## 8. What users must back up separately

- 项目代码 / Git 仓库（ResearchFlow 只记录 path 引用）
- 实验数据 / checkpoints / 大结果目录（ResearchFlow 只记录 path 引用与轻量元数据）
- 若使用多用户/平台模式：`users` / `api_keys` 等 legacy 表属于 Dr. Claw 体系，
  不在 ResearchFlow 备份范围内，请另行备份 `~/.dr-claw/auth.db`。
