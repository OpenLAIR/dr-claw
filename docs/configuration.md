[English](./configuration.md) | [中文](./configuration.zh-CN.md)

# Configuration Reference

Dr. Claw is configured through environment variables in a `.env` file at the project root. This guide documents every variable the application reads.

## How `.env` Loading Works

1. **Backend** — `server/load-env.js` reads `.env` line-by-line on startup and sets any key not already present in `process.env`. System environment variables always take precedence.
2. **Frontend** — Vite loads `.env` automatically. Only variables prefixed with `VITE_` are exposed to browser code.
3. **Precedence** — System env > `.env` file values.

> **Quick start:** `cp .env.example .env` gives you sensible defaults. See the [Quickstart guide](./quickstart.md) for a step-by-step walkthrough.

---

## Configuration Reference

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | Express API + WebSocket server port. |
| `VITE_PORT` | No | `5173` | Vite dev server port (development only). |
| `CLAUDE_CLI_PATH` | No | `claude` | Absolute or relative path to the Claude Code binary. Override if `claude` is not on your `PATH`. |
| `CURSOR_CLI_PATH` | No | Auto-detect (`cursor-agent` then `agent`) | Override Cursor CLI command/binary. Useful when your environment only provides one alias. |
| `GEMINI_CLI_PATH` | No | `gemini` | Override Gemini CLI command/binary. Useful when your shell resolves Gemini through a custom alias or path. |
| `CODEX_CLI_PATH` | No | `codex` | Override Codex CLI command/binary. Useful when Codex is installed outside your default `PATH`. |

### Database

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_PATH` | No | `server/database/auth.db` | Absolute path to the SQLite database file. The directory is created automatically if it does not exist. |

### Authentication

> These variables are **security-sensitive**. See the [Security Checklist](#security-checklist) below.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | **Yes** (production) | `claude-ui-dev-secret-change-in-production` | Secret used to sign and verify JWT tokens. **Must** be changed before exposing Dr. Claw outside localhost. Generate one with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `API_KEY` | No | *(none — validation skipped)* | When set, every HTTP request must include an `X-Api-Key` header with this value. Useful for restricting access in hosted setups. |

### Context Window

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CONTEXT_WINDOW` | No | `160000` | Maximum token context window sent to the backend CLI process. |
| `VITE_CONTEXT_WINDOW` | No | `160000` | Same value exposed to the frontend (must match `CONTEXT_WINDOW`). |

### Platform Mode

Platform mode is an advanced deployment option. Most users should leave these commented out.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_IS_PLATFORM` | No | `false` | Set to `true` to enable Platform mode. In this mode JWT authentication is bypassed and the first database user is used for all requests. |
| `WORKSPACES_ROOT` | No | User home directory (`os.homedir()`) | Root directory where Dr. Claw looks for and creates project workspaces. Only meaningful when `VITE_IS_PLATFORM=true`. |

### Integrations

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | No | *(none)* | OpenAI API key for Codex integration. Required only if you use the Codex CLI backend. |

### Advanced

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLAUDE_TOOL_APPROVAL_TIMEOUT_MS` | No | `55000` | Timeout in milliseconds for Claude tool-approval prompts before auto-declining. |

---

## OSS Mode vs Platform Mode

Dr. Claw supports two authentication paths:

| | OSS Mode (default) | Platform Mode |
|---|---|---|
| **Who uses it** | Individual developers running Dr. Claw locally | Hosted / multi-tenant deployments |
| **Auth flow** | Register/login with username + password; JWT issued per session | JWT auth bypassed; first DB user auto-selected |
| **Enable** | Default — no extra config needed | Set `VITE_IS_PLATFORM=true` |
| **`WORKSPACES_ROOT`** | Ignored | Defines the root directory for all project workspaces |

> In OSS mode the `WORKSPACES_ROOT` variable is ignored — Dr. Claw discovers projects from Claude Code / Cursor / Codex session directories under the user's home folder.

---

## Security Checklist

Before deploying Dr. Claw on a network (not just `localhost`), review the following:

1. **`JWT_SECRET`** — Replace the default with a strong random string. The default value is public and provides zero security.
2. **`API_KEY`** — Consider setting an API key to add an extra authentication layer.
3. **`WORKSPACES_ROOT`** — In Platform mode, ensure this is scoped to a directory you trust. Dr. Claw serves file contents from this tree.
4. **`.gitignore`** — Verify that `.env` is listed in `.gitignore` (it is by default) so secrets are never committed.
5. **HTTPS** — When exposing Dr. Claw to the internet, place it behind a reverse proxy (e.g. Nginx, Caddy) with TLS termination.

---

## Troubleshooting

- Variable not taking effect? Check that there is no system environment variable with the same name overriding it.
- Database errors? See [FAQ — SQLITE_CANTOPEN](./faq.md#8-database-permission-errors-sqlite_cantopen).
- JWT issues? See [FAQ — JWT_SECRET security warning](./faq.md#11-jwt_secret-security-warning).
