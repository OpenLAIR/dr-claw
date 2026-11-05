#!/usr/bin/env bash
# ARIS Meta-Optimize: Event Logger
# Reads Claude Code hook JSON from stdin, extracts key fields,
# appends structured events locally; global logging is a separate opt-in.
#
# Called automatically by Claude Code hooks (PostToolUse, UserPromptSubmit, etc.)
# Input: JSON via stdin (Claude Code hook payload)
# Output:
#   Project: $CLAUDE_PROJECT_DIR/.aris/meta/events.jsonl  (project-specific details)
#   Optional: ~/.aris/meta/events.jsonl when ARIS_META_GLOBAL_LOG=1

set -euo pipefail

PROJECT_META="${CLAUDE_PROJECT_DIR:-.}/.aris/meta"
GLOBAL_LOG=""
mkdir -p "$PROJECT_META"
if [ "${ARIS_META_GLOBAL_LOG:-0}" = "1" ]; then
    GLOBAL_LOG="$HOME/.aris/meta/events.jsonl"
    mkdir -p "$HOME/.aris/meta"
fi

# Read stdin payload into env var (cannot use heredoc + herestring simultaneously)
export ARIS_HOOK_PAYLOAD="$(cat)"

python3 - "$PROJECT_META/events.jsonl" "$GLOBAL_LOG" << 'PYEOF'
import json, sys, os
from datetime import datetime, timezone

project_log = sys.argv[1]
global_log = sys.argv[2]

raw = os.environ.get("ARIS_HOOK_PAYLOAD", "").strip()
if not raw:
    sys.exit(0)
try:
    p = json.loads(raw)
except json.JSONDecodeError:
    sys.exit(0)

if not isinstance(p, dict):
    sys.exit(0)

event_name = p.get("hook_event_name", "unknown")
session_id = p.get("session_id", "")
project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

record = {"ts": ts, "session": session_id, "event": event_name}

if event_name in ("PostToolUse", "PostToolUseFailure"):
    tool_name = p.get("tool_name", "")
    tool_input = p.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        tool_input = {}
    record["tool"] = tool_name

    if event_name == "PostToolUseFailure":
        record["event"] = "tool_failure"

    if tool_name == "Skill" and event_name != "PostToolUseFailure":
        record["event"] = "skill_invoke"
        record["skill"] = tool_input.get("skill", "")
        record["args"] = tool_input.get("args", "")
    elif tool_name == "Bash":
        record["input_summary"] = tool_input.get("command", "")[:200]
    elif tool_name in ("Edit", "Write", "Read"):
        record["input_summary"] = tool_input.get("file_path", "")
    elif tool_name.startswith("mcp__codex__") and event_name != "PostToolUseFailure":
        record["event"] = "codex_call"
        record["input_summary"] = tool_input.get("prompt", "")[:150]

elif event_name == "UserPromptSubmit":
    prompt = p.get("prompt", "")
    if prompt.startswith("/"):
        parts = prompt.split(None, 1)
        record["event"] = "slash_command"
        record["command"] = parts[0]
        record["args"] = parts[1] if len(parts) > 1 else ""
    else:
        record["event"] = "user_prompt"
        record["prompt_preview"] = prompt[:100]

elif event_name == "SessionStart":
    record["event"] = "session_start"
    record["source"] = p.get("source", "")
    record["model"] = p.get("model", "")

elif event_name == "SessionEnd":
    record["event"] = "session_end"

# Write to project-level log
with open(project_log, "a", encoding="utf-8") as f:
    f.write(json.dumps(record, ensure_ascii=False) + "\n")

# Write to global log with project tag
if global_log and os.path.abspath(global_log) != os.path.abspath(project_log):
    global_record = record.copy()
    global_record["project"] = os.path.basename(project_dir) if project_dir else "unknown"
    with open(global_log, "a", encoding="utf-8") as f:
        f.write(json.dumps(global_record, ensure_ascii=False) + "\n")
PYEOF
