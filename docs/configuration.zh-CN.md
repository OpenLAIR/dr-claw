[English](./configuration.md) | [中文](./configuration.zh-CN.md)

# 配置参考

Dr. Claw 通过项目根目录下的 `.env` 文件中的环境变量进行配置。本指南记录了应用读取的所有变量。

## `.env` 加载机制

1. **后端** — `server/load-env.js` 在启动时逐行读取 `.env`，对 `process.env` 中尚不存在的键进行设置。系统环境变量始终优先。
2. **前端** — Vite 自动加载 `.env`。只有以 `VITE_` 为前缀的变量会暴露给浏览器端代码。
3. **优先级** — 系统环境变量 > `.env` 文件值。

> **快速开始：** `cp .env.example .env` 即可获得合理的默认值。请参阅[快速入门指南](./quickstart.zh-CN.md)了解分步操作。

---

## 配置参考

### 服务器

| 变量 | 是否必需 | 默认值 | 说明 |
|------|---------|--------|------|
| `PORT` | 否 | `3001` | Express API + WebSocket 服务器端口。 |
| `VITE_PORT` | 否 | `5173` | Vite 开发服务器端口（仅开发模式）。 |
| `CLAUDE_CLI_PATH` | 否 | `claude` | Claude Code 二进制文件的绝对或相对路径。如果 `claude` 不在你的 `PATH` 中，可在此处覆盖。 |
| `CURSOR_CLI_PATH` | 否 | 自动探测（先 `cursor-agent` 后 `agent`） | 覆盖 Cursor CLI 命令/二进制名。适用于你的环境只提供某一个别名的情况。 |
| `GEMINI_CLI_PATH` | 否 | `gemini` | 覆盖 Gemini CLI 命令/二进制名。适用于通过自定义别名或路径安装 Gemini 的环境。 |
| `CODEX_CLI_PATH` | 否 | `codex` | 覆盖 Codex CLI 命令/二进制名。适用于 Codex 不在默认 `PATH` 中的环境。 |

### 数据库

| 变量 | 是否必需 | 默认值 | 说明 |
|------|---------|--------|------|
| `DATABASE_PATH` | 否 | `server/database/auth.db` | SQLite 数据库文件的绝对路径。如果目录不存在会自动创建。 |

### 身份认证

> 以下变量属于**安全敏感**配置。请参阅下方的[安全检查清单](#安全检查清单)。

| 变量 | 是否必需 | 默认值 | 说明 |
|------|---------|--------|------|
| `JWT_SECRET` | **是**（生产环境） | `claude-ui-dev-secret-change-in-production` | 用于签名和验证 JWT 令牌的密钥。在将 Dr. Claw 暴露到 localhost 以外之前**必须**更改。生成方法：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `API_KEY` | 否 | *（无 — 跳过验证）* | 设置后，每个 HTTP 请求必须包含值为此密钥的 `X-Api-Key` 请求头。适用于托管部署中限制访问。 |

### 上下文窗口

| 变量 | 是否必需 | 默认值 | 说明 |
|------|---------|--------|------|
| `CONTEXT_WINDOW` | 否 | `160000` | 发送给后端 CLI 进程的最大令牌上下文窗口大小。 |
| `VITE_CONTEXT_WINDOW` | 否 | `160000` | 暴露给前端的相同值（必须与 `CONTEXT_WINDOW` 一致）。 |

### 平台模式

平台模式是一个高级部署选项。大多数用户应保持这些配置为注释状态。

| 变量 | 是否必需 | 默认值 | 说明 |
|------|---------|--------|------|
| `VITE_IS_PLATFORM` | 否 | `false` | 设为 `true` 以启用平台模式。在此模式下，JWT 身份认证被绕过，所有请求使用数据库中的第一个用户。 |
| `WORKSPACES_ROOT` | 否 | 用户主目录（`os.homedir()`） | Dr. Claw 查找和创建项目工作区的根目录。仅在 `VITE_IS_PLATFORM=true` 时有意义。 |

### 集成

| 变量 | 是否必需 | 默认值 | 说明 |
|------|---------|--------|------|
| `OPENAI_API_KEY` | 否 | *（无）* | OpenAI API 密钥，用于 Codex 集成。仅在使用 Codex CLI 后端时需要。 |

### 高级

| 变量 | 是否必需 | 默认值 | 说明 |
|------|---------|--------|------|
| `CLAUDE_TOOL_APPROVAL_TIMEOUT_MS` | 否 | `55000` | Claude 工具审批提示的超时时间（毫秒），超时后自动拒绝。 |

---

## OSS 模式 vs 平台模式

Dr. Claw 支持两种身份认证路径：

| | OSS 模式（默认） | 平台模式 |
|---|---|---|
| **适用场景** | 本地运行 Dr. Claw 的个人开发者 | 托管 / 多租户部署 |
| **认证流程** | 使用用户名 + 密码注册/登录；每次会话签发 JWT | 绕过 JWT 认证；自动选择数据库中的第一个用户 |
| **启用方式** | 默认 — 无需额外配置 | 设置 `VITE_IS_PLATFORM=true` |
| **`WORKSPACES_ROOT`** | 忽略 | 定义所有项目工作区的根目录 |

> 在 OSS 模式下，`WORKSPACES_ROOT` 变量被忽略 — Dr. Claw 从用户主目录下的 Claude Code / Cursor / Codex 会话目录中发现项目。

---

## 安全检查清单

在将 Dr. Claw 部署到网络（而非仅 `localhost`）之前，请检查以下事项：

1. **`JWT_SECRET`** — 将默认值替换为强随机字符串。默认值是公开的，不提供任何安全保障。
2. **`API_KEY`** — 考虑设置 API 密钥以增加额外的认证层。
3. **`WORKSPACES_ROOT`** — 在平台模式下，确保此路径指向你信任的目录。Dr. Claw 会提供该目录树下的文件内容。
4. **`.gitignore`** — 确认 `.env` 已列入 `.gitignore`（默认已包含），防止密钥被提交。
5. **HTTPS** — 将 Dr. Claw 暴露到公网时，请将其放在反向代理（如 Nginx、Caddy）后面，并启用 TLS。

---

## 故障排除

- 变量未生效？检查是否有同名的系统环境变量在覆盖它。
- 数据库错误？请参阅 [FAQ — SQLITE_CANTOPEN](./faq.zh-CN.md#8-数据库权限错误sqlite_cantopen)。
- JWT 问题？请参阅 [FAQ — JWT_SECRET 安全警告](./faq.zh-CN.md#11-jwt_secret-安全警告)。
