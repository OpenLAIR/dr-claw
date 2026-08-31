---
name: dr-claw
description: Dr. Claw skill for OpenClaw project discovery, idea intake, waiting-session triage, structured session control, event-driven notifications, and mobile reporting through the local drclaw CLI.
---

# Dr. Claw for OpenClaw

Use this skill when OpenClaw needs to operate Dr. Claw from chat or mobile, especially for:
- listing Dr. Claw projects
- finding sessions waiting for response
- replying into a session on the user's behalf
- continuing, approving, rejecting, retrying, or resuming workflows
- creating a new project from a fresh idea
- generating daily or per-project digests
- consuming stable `openclaw.*` JSON schema payloads
- running the background event-driven watcher daemon

## Preconditions

Before running Dr. Claw commands:

```bash
$DRCLAW_BIN server status
```

If the server is not running:

```bash
$DRCLAW_BIN server on
```

Assume the local wrapper exports these defaults when OpenClaw runs the skill:

```bash
DRCLAW_BIN="${DRCLAW_BIN:-$(which drclaw)}"
DRCLAW_URL=http://localhost:3001
```

When invoking the CLI from OpenClaw, prefer `$DRCLAW_BIN --url "$DRCLAW_URL" ...` instead of relying on PATH.

## Core operating rule

Prefer direct CLI facts over model guesses. For stateful operations, return the raw CLI result first, then summarize for the user.

When a command returns JSON, prefer the top-level `openclaw` field over scraping the raw natural-language `reply`.

Formal schema contract:

```bash
cat "$(git rev-parse --show-toplevel)/agent-harness/cli_anything/drclaw/SCHEMA.md"
```

When calling OpenClaw locally from automation or shell, use:

```bash
./scripts/openclaw_drclaw_turn.sh
```

This serializes `openclaw agent --local` calls per agent and avoids session-lock collisions.

## Project discovery

List projects:

```bash
$DRCLAW_BIN --url "$DRCLAW_URL" projects list
```

Inspect the latest message in a project:

```bash
$DRCLAW_BIN --url "$DRCLAW_URL" projects latest <project> --json
```

Inspect project progress and next actions:

```bash
$DRCLAW_BIN --url "$DRCLAW_URL" projects progress <project> --json
```

Create a new empty project workspace:

```bash
$DRCLAW_BIN --url "$DRCLAW_URL" projects create /absolute/path/to/project --name "Display Name" --json
```

Create a new project from a fresh idea and immediately start discussion:

```bash
$DRCLAW_BIN --url "$DRCLAW_URL" projects idea /absolute/path/to/project --name "Display Name" --idea "<idea text>" --json
```

Use `projects idea` for the “I suddenly have an idea” flow.

## Session lookup and waiting triage

List known sessions for one project:

```bash
$DRCLAW_BIN --url "$DRCLAW_URL" chat sessions --project <project> --json
```

List waiting sessions across all projects or one project:

```bash
$DRCLAW_BIN --url "$DRCLAW_URL" chat waiting --json
$DRCLAW_BIN --url "$DRCLAW_URL" chat waiting --project <project> --json
```

For session replies and workflow actions, use the embedded `openclaw.turn.v1` payload to decide:
- whether user input is required
- which quick action to render next
- whether the session is still processing

Recommended triage flow:
1. Resolve the project first if needed.
2. Use `chat waiting --json` to find actionable sessions.
3. Use `chat sessions --project ... --json` when the user wants more detail.

## Replying to an existing session

Once the user chooses a session:

```bash
$DRCLAW_BIN --url "$DRCLAW_URL" chat reply --project <project> --session <session-id> \
  --bypass-permissions --attach /path/to/file -m "<message>" --json
```

**Note:** Always use `--bypass-permissions` in automation to avoid being blocked by server-side tool approval requests. 

**Timeout & Heartbeat:** If you omit `--timeout`, the CLI will wait indefinitely (with a 1-hour safety cap) and use **heartbeat detection**. This is preferred for complex tasks like `Task 10` that run experiments.

If a specific provider (like Codex) is failing, add `--provider gemini` to the command to switch.

Immediately after replying, check whether the session is still processing:

```bash
$DRCLAW_BIN --url "$DRCLAW_URL" chat waiting --project <project> --json
```

If you need to wait until the session leaves the waiting list, use:

```bash
./scripts/drclaw_wait_until_clear.sh --project <project> --session <session-id>
```

The script returns JSON indicating whether the session cleared or timed out.

## Workflow control

Use these commands for workflow actions:

```bash
$DRCLAW_BIN --url "$DRCLAW_URL" workflow status --project <project> --json
$DRCLAW_BIN --url "$DRCLAW_URL" workflow continue --project <project> --session <session-id> --bypass-permissions -m "<instruction>" --json
$DRCLAW_BIN --url "$DRCLAW_URL" workflow approve --project <project> --session <session-id> --json
$DRCLAW_BIN --url "$DRCLAW_URL" workflow reject --project <project> --session <session-id> -m "<reason>" --json
$DRCLAW_BIN --url "$DRCLAW_URL" workflow retry --project <project> --session <session-id> --json
$DRCLAW_BIN --url "$DRCLAW_URL" workflow resume --project <project> --session <session-id> --bypass-permissions --json
```

For project-level UI cards or voice summaries, prefer the embedded `openclaw.project.v1` payload from:

```bash
$DRCLAW_BIN --url "$DRCLAW_URL" workflow status --project <project> --json
$DRCLAW_BIN --url "$DRCLAW_URL" digest project --project <project> --json
```

## Digests and reporting

Daily digest:

```bash
$DRCLAW_BIN --url "$DRCLAW_URL" digest daily --json
```

Per-project digest:

```bash
$DRCLAW_BIN --url "$DRCLAW_URL" digest project --project <project> --json
```

Cross-project portfolio digest with recommended follow-ups:

```bash
$DRCLAW_BIN --url "$DRCLAW_URL" digest portfolio --json
```

For cross-project OpenClaw dashboards, use the embedded `openclaw.portfolio.v1` field rather than custom ranking logic.

Artifacts and workflow state:

```bash
$DRCLAW_BIN --url "$DRCLAW_URL" workflow status --project <project> --json
$DRCLAW_BIN --url "$DRCLAW_URL" taskmaster artifacts --project <project> --json
```

## Response format guidance for mobile / chat

Keep replies compact:
- first line: direct answer
- then: short project / session / status bullets if relevant
- always include exact session ids when asking the user to choose one
- when reporting a post-reply state, say whether the session is still processing or has cleared

When JSON is available:
- prefer `openclaw.decision.needed` to decide whether to interrupt the user
- prefer `openclaw.next_actions` for quick replies or buttons
- prefer `openclaw.turn.summary` / `openclaw.focus` for compact rendering

## Event-driven watcher daemon

Use the watcher when OpenClaw should proactively notify the user instead of waiting for manual digest polling.

Start / stop / inspect:

```bash
$DRCLAW_BIN --url "$DRCLAW_URL" --json openclaw-watch on --to feishu:<chat_id>
$DRCLAW_BIN --url "$DRCLAW_URL" --json openclaw-watch status
$DRCLAW_BIN --url "$DRCLAW_URL" --json openclaw-watch off
```

Watcher behavior:
- subscribes to Dr. Claw WebSocket events
- reacts to important event types only
- resolves the affected project when possible, including path-based file change events
- compares workflow snapshots to derive higher-level `openclaw.event.v1.event.signals`
- current useful signals include `human_decision_needed`, `waiting_for_human`, `blocker_detected`, `blocker_cleared`, `task_completed`, `next_task_changed`, `attention_needed`, and `session_aborted`
- asks OpenClaw agent to generate the final Feishu/Lark notification when enough project context is available
- parses delivered agent output back into clean human-facing text instead of leaking plugin logs / raw JSON
- enriches events with `openclaw.event.v1` and project-level status when possible
- deduplicates repeated notifications for a 6-hour time window
- pushes only attention-worthy updates to the configured OpenClaw channel

Watcher runtime files:
- state: `~/.drclaw/openclaw-watcher-state.json`
- log: `~/.drclaw/logs/openclaw-watcher.log`

## Reliable OpenClaw patterns

Pattern: list projects
1. Run `$DRCLAW_BIN --url "$DRCLAW_URL" projects list`.
2. Present short names, display names, and paths only when needed.

Pattern: user asks what needs attention
1. Run `$DRCLAW_BIN --url "$DRCLAW_URL" digest portfolio --json`.
2. Use the embedded `openclaw.portfolio.v1.focus` field first.
3. Fall back to `chat waiting --json` if the user explicitly wants raw waiting sessions.

Pattern: user asks OpenClaw to answer a waiting session
1. Run `$DRCLAW_BIN --url "$DRCLAW_URL" chat reply --project ... --session ... -m ... --json`.
2. Read `openclaw.turn.v1` from the response.
3. If `decision.needed=true`, surface the decision reason and quick actions.
4. If the same session is still present in `waiting_sessions`, report that it is still processing.
5. Optionally run `drclaw_wait_until_clear.sh` and report the final clearance.

Pattern: user suddenly has a new idea
1. Pick a workspace path, usually `/Users/<user>/vibelab/<slug>`.
2. Run `$DRCLAW_BIN --url "$DRCLAW_URL" projects idea <path> --name <display-name> --idea <idea> --json`.
3. Return the created project, session id, and first Dr. Claw reply.
4. Continue the discussion with `$DRCLAW_BIN --url "$DRCLAW_URL" chat reply` on that session.

Pattern: user wants an update without opening Dr. Claw
1. Run `$DRCLAW_BIN --url "$DRCLAW_URL" digest daily --json`, `$DRCLAW_BIN --url "$DRCLAW_URL" digest project --project ... --json`, or `$DRCLAW_BIN --url "$DRCLAW_URL" digest portfolio --json`.
2. Use `digest portfolio` when the user wants cross-project progress, attention recommendations, or suggested replies.
3. Prefer the `openclaw.*` schema field for rendering.
4. Summarize only the load-bearing items: waiting sessions, task progress, blockers, next actions.
