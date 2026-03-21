# drclaw

A stateful Python CLI for operating Dr. Claw from terminals, automation, and OpenClaw.

It turns Dr. Claw into a controllable research backend so another agent can:
- inspect projects and sessions
- find conversations waiting for user input
- reply into a specific session
- continue, approve, reject, retry, or resume workflows
- summarize project progress and portfolio-wide status
- push compact reports back to mobile / OpenClaw

## What This CLI Is For

`drclaw` is the control plane between three layers:
- **Dr. Claw**: the research workspace and server
- **`drclaw` CLI**: the stable machine-facing interface
- **OpenClaw**: the mobile / chat / voice-facing assistant that calls the CLI and reports back to the user

The intended workflow is: the user talks to OpenClaw, OpenClaw runs `drclaw ...`, and Dr. Claw continues execution inside the right project or session.

## Install

From the repo root:

```bash
pip install -e ./agent-harness
```

The main entrypoint is `drclaw`. The legacy `vibelab` alias is still supported.

Verify installation:

```bash
drclaw --help
drclaw --json projects list
```

If you want to invoke the module directly:

```bash
PYTHONPATH=agent-harness python3 -m cli_anything.drclaw.drclaw_cli --help
```

## Server And Auth

Check whether the local Dr. Claw server is up:

```bash
drclaw server status
```

Start it if needed:

```bash
drclaw server on
```

Login:

```bash
drclaw auth login --username <username> --password <password>
```

Auth state is stored in `~/.drclaw_session.json`.

Useful auth commands:

```bash
drclaw auth status
drclaw auth logout
```

If `~/.drclaw_session.json` only contains OpenClaw integration fields and no `token`, authenticated commands such as `projects list` and `chat waiting` will return `Not logged in`.

## How To Use

### 1. Find a project

List all projects:

```bash
drclaw --json projects list
```

Anywhere the CLI accepts `<project-ref>`, you can pass one of:
- project `name`
- project `displayName`
- project filesystem `path` or `fullPath`

### 2. Inspect the current state

See the latest conversation in a project:

```bash
drclaw --json projects latest <project-ref>
```

See project progress and next action:

```bash
drclaw --json projects progress <project-ref>
drclaw --json workflow status --project <project-ref>
drclaw --json digest project --project <project-ref>
```

See the whole portfolio:

```bash
drclaw --json digest portfolio
drclaw --json digest daily
```

### 3. Find sessions waiting for a reply

Across all projects:

```bash
drclaw --json chat waiting
```

Within one project:

```bash
drclaw --json chat waiting --project <project-ref>
```

List known sessions in a project:

```bash
drclaw --json chat sessions --project <project-ref>
drclaw --json sessions list <project-ref>
```

Read message history from one session:

```bash
drclaw --json sessions messages <project-ref> <session-id> --provider claude --limit 100
```

### 4. Talk to a project or reply to a waiting session

Send a new message into a project:

```bash
drclaw --json chat send --project <project-ref> --message "What changed?"
```

Reply to an existing waiting session:

```bash
drclaw --json chat reply --project <project-ref> --session <session-id> -m "Please continue with the plan and tell me the next decision point."
```

Talk to a specific project session:

```bash
drclaw --json chat project --project <project-ref> --session <session-id> -m "Summarize the current blockers and propose the next three actions."
```

### 5. Control workflow execution explicitly

Use these when the user wants execution control rather than just freeform chat:

```bash
drclaw --json workflow status --project <project-ref>
drclaw --json workflow continue --project <project-ref> --session <session-id> -m "<instruction>"
drclaw --json workflow approve --project <project-ref> --session <session-id>
drclaw --json workflow reject --project <project-ref> --session <session-id> -m "<reason>"
drclaw --json workflow retry --project <project-ref> --session <session-id>
drclaw --json workflow resume --project <project-ref> --session <session-id>
```

### 6. Use TaskMaster and artifacts

```bash
drclaw --json taskmaster detect <project-ref>
drclaw --json taskmaster summary <project-ref>
drclaw --json taskmaster next <project-ref>
drclaw --json taskmaster next-guidance <project-ref>
drclaw --json taskmaster artifacts --project <project-ref>
```

If a project does not have TaskMaster initialized yet:

```bash
drclaw taskmaster init <project-ref>
```

### 7. Create or manage projects

Create a new empty workspace project:

```bash
drclaw --json projects create /abs/path --name "Display Name"
```

Create a new project from an idea and immediately start discussion:

```bash
drclaw --json projects idea /abs/path --name "Display Name" --idea "Build an OpenClaw-native project secretary for Dr. Claw"
```

Add, rename, or delete a project:

```bash
drclaw projects add /abs/path --name "Display Name"
drclaw projects rename <project-ref> "New Display Name"
drclaw projects delete <project-ref>
```

## Important Chat Options

Advanced chat and workflow commands support:
- `--provider [claude|gemini|codex|cursor]`: force a provider when needed
- `--bypass-permissions`: auto-approve tool calls for automation
- `--timeout <seconds>`: hard wait limit
- `--attach <path>`: attach a file or image, repeatable
- `--model <model-id>`: override the provider model

If `--timeout` is omitted, the CLI waits with heartbeat detection and uses a 1-hour safety cap. This is usually the right default for long-running research tasks.

## OpenClaw Integration

The current integration has three stable layers:
- **control plane**: OpenClaw runs local `drclaw ...` commands directly
- **structured contract**: major JSON responses include a top-level `openclaw` payload
- **proactive delivery**: a background watcher can push important project changes to Feishu/Lark through OpenClaw

### Minimum prerequisites

Before wiring OpenClaw in, make sure:
- Dr. Claw server is running
- `drclaw` CLI is installed locally
- at least one Dr. Claw project exists
- OpenClaw has local shell or `exec` capability
- if you want push notifications, OpenClaw can already deliver to a Feishu/Lark channel

### Recommended first commands

```bash
drclaw --json chat waiting
drclaw --json digest portfolio
drclaw --json digest project --project <project-ref>
drclaw --json workflow status --project <project-ref>
```

If OpenClaw can run those and consume the JSON, the core integration is working.

### One-command install for OpenClaw

```bash
drclaw install --server-url http://localhost:3001
```

This will:
- copy the Dr. Claw skill into `~/.openclaw/workspace/skills/drclaw`
- install wrapper scripts used for serialized local turns
- save the current Dr. Claw server URL into `~/.drclaw_session.json`
- remember the local `drclaw` executable path for OpenClaw usage

To also save a default push channel:

```bash
drclaw install --server-url http://localhost:3001 --push-channel feishu:<chat_id>
```

The OpenClaw-specific alias is also available:

```bash
drclaw openclaw install --server-url http://localhost:3001
```

### Serialized local turns

When OpenClaw calls local `openclaw agent --local`, use the wrapper script to avoid session-lock collisions:

```bash
agent-harness/skills/dr-claw/scripts/openclaw_drclaw_turn.sh --json -m "Use your exec tool to run `drclaw --json digest portfolio`. Return only the result."
```

## Watcher And Proactive Notifications

The watcher is event-driven. It listens to Dr. Claw WebSocket events and only emits attention-worthy updates.

Configure the default push channel once:

```bash
drclaw openclaw configure --push-channel feishu:<chat_id>
```

Start, inspect, and stop the watcher:

```bash
drclaw --json openclaw-watch on --to feishu:<chat_id>
drclaw --json openclaw-watch status
drclaw --json openclaw-watch off
```

What it does:
- subscribes to Dr. Claw WebSocket events instead of polling digests
- resolves the affected project for task, project, and file-change events when possible
- compares workflow snapshots to derive higher-level signals instead of forwarding raw event names
- deduplicates repeated notifications with a stable signature and 6-hour TTL
- asks `openclaw agent --deliver` to write the final human-facing Feishu/Lark summary
- falls back to a plain bridge push if agent summarization fails
- stores state in `~/.drclaw/openclaw-watcher-state.json`
- stores logs in `~/.drclaw/logs/openclaw-watcher.log`

Current important signals include:
- `human_decision_needed`
- `waiting_for_human`
- `blocker_detected`
- `blocker_cleared`
- `task_completed`
- `next_task_changed`
- `attention_needed`
- `session_aborted`

## Structured OpenClaw Schema

Major machine-facing commands return a versioned `openclaw` field.

Current schema families:
- `openclaw.turn.v1`
- `openclaw.project.v1`
- `openclaw.portfolio.v1`
- `openclaw.daily.v1`
- `openclaw.report.v1`
- `openclaw.event.v1`

Formal contract:

```bash
cat agent-harness/cli_anything/drclaw/SCHEMA.md
```

Recommended client rendering rules:
- prefer `openclaw.decision.needed` to decide whether to interrupt the user
- prefer `openclaw.next_actions` for quick actions and voice suggestions
- prefer `openclaw.turn.summary` or portfolio `openclaw.focus` for compact rendering
- for watcher notifications, render from `openclaw.event.v1.event.signals` first
- do not depend on raw `reply` text alone when `openclaw` exists

## Typical Use Cases

### User asks: what is waiting for response?

```bash
drclaw --json chat waiting
```

### User asks OpenClaw to answer one session

```bash
drclaw --json chat reply --project <project-ref> --session <session-id> -m "Please proceed with option B and tell me the next milestone."
drclaw --json chat waiting --project <project-ref>
```

### User suddenly has a new idea

```bash
drclaw --json projects idea /absolute/path/to/project --name "Idea Project" --idea "<idea text>"
```

### User asks for cross-project progress and suggestions

```bash
drclaw --json digest portfolio
```

### User wants a mobile-ready report pushed out

```bash
drclaw --json openclaw report --project <project-ref> --dry-run
drclaw openclaw report --project <project-ref>
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DRCLAW_URL` | Server base URL | `http://localhost:3001` |
| `DRCLAW_TOKEN` | Inject token without session file | session file |
| `DRCLAW_LANG` | Default CLI language | `en` |
| `VIBELAB_URL` | Legacy server base URL | `http://localhost:3001` |
| `VIBELAB_TOKEN` | Legacy token fallback | session file |

The `--url URL` flag overrides `DRCLAW_URL` and `VIBELAB_URL` for one invocation.

## Troubleshooting

If `drclaw` is not found:

```bash
PYTHONPATH=agent-harness python3 -m cli_anything.drclaw.drclaw_cli --help
```

If authenticated commands fail, check:

```bash
drclaw auth status
drclaw server status
```

If watcher delivery looks wrong, inspect:

```bash
drclaw --json openclaw-watch status
tail -n 50 ~/.drclaw/logs/openclaw-watcher.log
cat ~/.drclaw/openclaw-watcher-state.json
```

## Running Tests

```bash
PYTHONPATH=agent-harness python3 -m unittest cli_anything.drclaw.tests.test_core -q
```
