# Dr. Claw CLI Harness - Standard Operating Procedure

## Overview

VibeLab, now also branded as Dr. Claw, is a full-stack AI research workspace for managing multi-provider coding and research sessions. The Python `drclaw` CLI exposes the same server capabilities for automation, OpenClaw integration, mobile status reporting, and structured OpenClaw-ready schemas.

## Core workflows

### Authentication

```bash
drclaw auth status
drclaw auth login --username admin --password s3cr3t
drclaw auth logout
```

### Projects

```bash
drclaw projects list
drclaw projects add /absolute/path/to/project --name "My Project"
drclaw projects rename <project-ref> "New Display Name"
drclaw projects delete <project-ref>
```

`<project-ref>` may be a project `name`, `displayName`, or filesystem path.

### Sessions and chat

```bash
drclaw sessions list <project-ref>
drclaw sessions list <project-ref> --provider cursor --limit 20 --offset 0
drclaw sessions messages <project-ref> <session-id> --provider claude --limit 100
drclaw chat sessions --project <project-ref>
drclaw chat send --project <project-ref> --message "What changed?"
drclaw chat send --project <project-ref> --session <session-id> --message "Continue"
drclaw --json chat reply --project <project-ref> --session <session-id> -m "Continue and tell me the next checkpoint"
```

`chat send` resolves the project reference to a real filesystem path before opening the websocket, and waits for explicit completion events instead of using a silence timeout.

For machine-facing clients, `chat send`, `chat reply`, `workflow continue`, and `workflow resume` now embed `openclaw.turn.v1` under the top-level `openclaw` field.

### TaskMaster / pipeline progress

```bash
drclaw taskmaster status
drclaw taskmaster detect <project-ref>
drclaw taskmaster detect-all
drclaw taskmaster init <project-ref>
drclaw taskmaster tasks <project-ref>
drclaw taskmaster next <project-ref>
drclaw taskmaster next-guidance <project-ref>
drclaw taskmaster summary <project-ref>
```

The server now also exposes a dedicated summary route, so OpenClaw and other agents can fetch one stable progress payload instead of stitching together multiple endpoints.

### OpenClaw / mobile reporting

```bash
drclaw openclaw install
drclaw openclaw configure --push-channel feishu:<chat_id>
drclaw openclaw report --project <project-ref> --dry-run
drclaw openclaw report --project <project-ref>
drclaw openclaw-watch on --interval 30
drclaw openclaw-watch status
drclaw openclaw-watch off
```

`openclaw report` generates a concise status digest with counts, next task, required inputs, suggested skills, and optional next-action prompt text.

`openclaw-watch` runs as a background daemon and subscribes to Dr. Claw WebSocket events so OpenClaw can receive event-driven notifications instead of polling digest commands. It now resolves the affected project, compares workflow snapshots, derives higher-level signals such as `blocker_detected`, `waiting_for_human`, and `task_completed`, and asks OpenClaw agent to write the final Lark/Feishu summary.

## OpenClaw schema contract

Major JSON commands now include a top-level `openclaw` field with a stable versioned payload:

- `openclaw.turn.v1`
- `openclaw.project.v1`
- `openclaw.portfolio.v1`
- `openclaw.daily.v1`
- `openclaw.report.v1`
- `openclaw.event.v1`

Formal schema reference:

```bash
cat agent-harness/cli_anything/drclaw/SCHEMA.md
```

## Server contract notes

Important server routes used by the CLI:

- `GET /api/projects`
- `POST /api/projects`
- `PUT /api/projects/:projectName/rename`
- `GET /api/projects/:projectName/sessions`
- `GET /api/projects/:projectName/sessions/:sessionId/messages`
- `GET /api/taskmaster/installation-status`
- `GET /api/taskmaster/detect/:projectName`
- `GET /api/taskmaster/detect-all`
- `POST /api/taskmaster/initialize/:projectName`
- `GET /api/taskmaster/tasks/:projectName`
- `GET /api/taskmaster/next/:projectName`
- `GET /api/taskmaster/next-guidance/:projectName`
- `GET /api/taskmaster/summary/:projectName`
- WebSocket: `/ws?token=<jwt>`

## JSON mode

Use `--json` whenever OpenClaw or another agent needs machine-readable output:

```bash
drclaw --json projects list
drclaw --json sessions list <project-ref> --provider codex
drclaw --json taskmaster summary <project-ref>
drclaw --json openclaw report --project <project-ref> --dry-run
drclaw --json workflow status --project <project-ref>
drclaw --json digest portfolio
drclaw --json chat watch --event claude-permission-request --event taskmaster-project-updated
```

Guidance:

- Prefer the embedded `openclaw` field over parsing natural-language `reply`
- Use `decision.needed` and `next_actions` for mobile quick actions
- Use `openclaw-watch` when proactive notifications are needed
- For watcher-driven notifications, prefer `event.signals` over raw websocket event names
