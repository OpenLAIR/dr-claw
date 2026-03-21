---
name: drclaw
description: Dr. Claw workspace skill for project lookup, session inspection, TaskMaster progress, OpenClaw structured schema, and event-driven reporting
---

# Dr. Claw Research Skill

Use this skill when the user asks about Dr. Claw projects, wants to inspect Claude/Cursor/Codex/Gemini sessions, needs task progress pushed to OpenClaw/mobile, or wants structured OpenClaw-ready JSON outputs.

## Setup check

Before using Dr. Claw, verify the server is reachable:

```bash
drclaw server status
```

If needed, start it:

```bash
drclaw server on
```

## Project discovery

```bash
drclaw --json projects list
```

Project references accepted by the CLI:

- `name`
- `displayName`
- filesystem `path` / `fullPath`

If a path exists locally but is not registered yet:

```bash
drclaw projects add /absolute/path/to/project --name "Display Name"
```

## Session workflows

List sessions:

```bash
drclaw --json sessions list <project-ref>
drclaw --json sessions list <project-ref> --provider cursor
```

Fetch messages:

```bash
drclaw --json sessions messages <project-ref> <session-id> --provider claude --limit 100
```

Send Claude a message:

```bash
drclaw --json chat send --project <project-ref> --message "<user message>"
```

Reply to an existing session with structured OpenClaw output:

```bash
drclaw --json chat reply --project <project-ref> --session <session-id> -m "<user message>"
```

List active sessions across projects:

```bash
drclaw --json chat sessions
```

## TaskMaster workflows

Check whether TaskMaster is present:

```bash
drclaw --json taskmaster detect <project-ref>
```

Get progress and next action:

```bash
drclaw --json taskmaster summary <project-ref>
drclaw --json taskmaster next-guidance <project-ref>
```

Initialize `.pipeline` for a project if needed:

```bash
drclaw taskmaster init <project-ref>
```

## OpenClaw / mobile reporting

Configure the default push channel once:

```bash
drclaw openclaw configure --push-channel feishu:<chat_id>
```

Preview a mobile report:

```bash
drclaw --json openclaw report --project <project-ref> --dry-run
```

Send it:

```bash
drclaw openclaw report --project <project-ref>
```

Start the event-driven watcher daemon:

```bash
drclaw --json openclaw-watch on --to feishu:<chat_id>
drclaw --json openclaw-watch status
drclaw --json openclaw-watch off
```

The watcher is now a useful notification pipeline rather than raw websocket forwarding. It:
- subscribes to Dr. Claw WebSocket events
- resolves the concrete project when possible
- compares workflow snapshots to derive higher-level signals
- deduplicates repeated notifications with a stable signature and 6-hour TTL
- asks OpenClaw agent to generate the final Feishu/Lark summary through `--deliver`
- falls back to a direct bridge push if agent summarization fails

Current attention-worthy signals include:
- `human_decision_needed`
- `waiting_for_human`
- `blocker_detected`
- `blocker_cleared`
- `task_completed`
- `next_task_changed`
- `attention_needed`
- `session_aborted`

Watcher runtime files:
- state: `~/.drclaw/openclaw-watcher-state.json`
- log: `~/.drclaw/logs/openclaw-watcher.log`

## Structured OpenClaw schema

Major JSON commands now include a top-level `openclaw` field with a stable versioned schema for mobile / voice clients.

Current schema families:

- `openclaw.turn.v1`
- `openclaw.project.v1`
- `openclaw.portfolio.v1`
- `openclaw.daily.v1`
- `openclaw.report.v1`
- `openclaw.event.v1`

Practical client rules:
- prefer `decision.needed` over guessing whether to interrupt the user
- prefer `next_actions` for quick actions and voice suggestions
- prefer `turn.summary` or portfolio `focus` for compact rendering
- for watcher events, read `openclaw.event.v1.event.signals` first instead of raw `type`

Formal contract:

```bash
cat agent-harness/cli_anything/drclaw/SCHEMA.md
```

## Recommended operating flow

1. If the user did not specify a project, run `projects list` and resolve the project first.
2. For freeform project questions, use `chat send` or `chat reply`, and prefer the `openclaw` schema field over parsing raw reply text.
3. For status/progress questions, prefer `workflow status`, `digest project`, `digest portfolio`, and `taskmaster next-guidance`.
4. For proactive mobile updates, use `openclaw report`.
5. For background attention monitoring, use `openclaw-watch on` instead of polling digest commands manually.
