# OpenClaw Schema

This document defines the stable JSON payloads produced by `drclaw` for OpenClaw, mobile, and voice clients.

All schemas are embedded under the top-level `openclaw` field of normal CLI JSON responses.

## Design goals

- Stable versioned envelopes for downstream clients
- Compact enough for mobile cards and voice summaries
- Explicit decision points and next actions
- No dependence on parsing natural-language `reply` text only

## Versioning

- Every schema object includes `schema_version`
- Breaking changes must use a new schema version string
- Additive fields may be introduced without bumping the version if existing fields keep semantics

## Common conventions

- `kind`: schema family identifier
- `project.ref`: canonical project identifier when available
- `project.display_name`: user-facing project name
- `session.id`: provider session id
- `decision.needed`: whether OpenClaw should ask the user for input/approval
- `next_actions`: machine-renderable follow-up actions for chat/mobile clients

## `openclaw.turn.v1`

Used in:
- `drclaw --json chat send`
- `drclaw --json chat reply`
- `drclaw --json workflow continue`
- `drclaw --json workflow resume`

Shape:

```json
{
  "schema_version": "openclaw.turn.v1",
  "kind": "session_turn",
  "project": {
    "ref": "proj-1",
    "display_name": "Project One",
    "path": "/abs/path"
  },
  "session": {
    "id": "sess-123",
    "provider": "claude",
    "state": "processing"
  },
  "turn": {
    "action": "reply",
    "reply_text": "full assistant reply",
    "reply_kind": "question",
    "summary": ["short point 1", "short point 2"]
  },
  "decision": {
    "needed": true,
    "reason": "assistant_requested_input"
  },
  "next_actions": [
    {
      "id": "reply",
      "label": "Reply",
      "kind": "command",
      "command": "drclaw --json chat reply ..."
    }
  ],
  "waiting_sessions": []
}
```

### `reply_kind`

Allowed values:
- `empty`
- `update`
- `question`
- `blocker`
- `completion`

## `openclaw.project.v1`

Used in:
- `drclaw --json workflow status`
- `drclaw --json digest project`

Shape:

```json
{
  "schema_version": "openclaw.project.v1",
  "kind": "project_digest",
  "project": {
    "ref": "proj-1",
    "display_name": "Project One",
    "path": "/abs/path",
    "state": "attention_needed"
  },
  "status": {
    "workflow": "in-progress",
    "updated_at": "2026-03-21T12:00:00Z"
  },
  "counts": {
    "total": 10,
    "completed": 4,
    "in_progress": 2,
    "pending": 3,
    "blocked": 1,
    "completion_rate": 40.0
  },
  "next_task": {},
  "guidance": {},
  "waiting_sessions": [],
  "artifacts": {},
  "decision": {
    "needed": true,
    "reason": "blocked_task"
  },
  "next_actions": []
}
```

### `project.state`

Allowed values:
- `attention_needed`
- `active`
- `idle`

## `openclaw.portfolio.v1`

Used in:
- `drclaw --json digest portfolio`

Shape:

```json
{
  "schema_version": "openclaw.portfolio.v1",
  "kind": "portfolio_digest",
  "summary": {
    "project_count": 4,
    "waiting_sessions": 2,
    "tasks_total": 15,
    "tasks_completed": 7,
    "high_priority_projects": 1,
    "medium_priority_projects": 2
  },
  "projects": [],
  "focus": [
    {
      "project": "proj-1",
      "project_display_name": "Project One",
      "priority": "high",
      "action": "reply",
      "reason": "Project has 1 waiting session(s) that need input.",
      "session_id": "sess-123",
      "suggested_reply": "建议回复：..."
    }
  ],
  "decision": {
    "needed": true,
    "reason": "high_priority_projects_present"
  },
  "next_actions": []
}
```

## `openclaw.daily.v1`

Used in:
- `drclaw --json digest daily`

Shape:

```json
{
  "schema_version": "openclaw.daily.v1",
  "kind": "daily_digest",
  "summary": {},
  "projects": [
    { "schema_version": "openclaw.project.v1", "kind": "project_digest" }
  ]
}
```

## `openclaw.report.v1`

Used in:
- `drclaw --json openclaw report --project ... --dry-run`

Shape:

```json
{
  "schema_version": "openclaw.report.v1",
  "kind": "project_report",
  "project": {
    "ref": "proj-1",
    "display_name": "Project One",
    "path": "/abs/path"
  },
  "report_text": "rendered mobile report",
  "summary": {},
  "channel": "feishu:chat-id",
  "sent": false
}
```

## `openclaw.event.v1`

Used in:
- `drclaw --json chat watch`
- internally by the `openclaw-watch` daemon

Shape:

```json
{
  "schema_version": "openclaw.event.v1",
  "kind": "event",
  "event": {
    "type": "claude-permission-request",
    "mapped_kind": "human_decision_needed",
    "project": "proj-1",
    "provider": "claude",
    "session_id": "sess-123",
    "timestamp": "2026-03-21T12:00:00Z",
    "details": {},
    "signals": [
      {
        "kind": "human_decision_needed",
        "summary": "Agent requests permission for edit_file.",
        "priority": "high",
        "action_required": true
      }
    ]
  },
  "portfolio_event": {
    "schema_version": "openclaw.project.v1",
    "kind": "project_digest"
  }
}
```

### `mapped_kind`

Current mappings:
- `claude-permission-request` -> `human_decision_needed`
- `taskmaster-*` / `projects_updated` -> primary derived signal kind when available
- `session-aborted` -> `session_aborted`
- all others -> `info`

### `event.signals`

Derived higher-level watcher signals. Current kinds include:
- `human_decision_needed`
- `waiting_for_human`
- `blocker_detected`
- `blocker_cleared`
- `task_completed`
- `next_task_changed`
- `attention_needed`
- `session_aborted`

## Watcher daemon behavior

`drclaw openclaw-watch on` starts a background daemon that:
- subscribes to Dr. Claw WebSocket events
- resolves the concrete project when possible, including path-based `projects_updated` events
- derives higher-level `signals` from project snapshot diffs
- enriches events with project-level schema when possible
- deduplicates notifications by a stable event signature
- sends the final user-facing summary through `openclaw agent --deliver` when context is available
- falls back to a plain bridge push if OpenClaw agent summarization fails
- stores watcher state in `~/.drclaw/openclaw-watcher-state.json`

### Important event types

- `claude-permission-request`
- `taskmaster-project-updated`
- `taskmaster-tasks-updated`
- `taskmaster-update`
- `projects_updated`
- `session-aborted`

### Deduplication

Notifications are deduplicated for 6 hours using a stable signature built from:
- event type
- project
- provider
- session id
- tool name
- change type
- success flag
- project-level decision reason/state when available

## Client integration guidance

- Prefer the `openclaw` field over scraping text from `reply`
- Use `decision.needed` to decide whether to interrupt the user
- Use `next_actions` to render buttons or voice suggestions
- Use `summary` arrays for mobile cards and TTS compression
- Treat unknown additive fields as safe to ignore
