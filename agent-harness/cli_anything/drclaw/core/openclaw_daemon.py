"""Background OpenClaw watcher daemon driven by Dr. Claw WebSocket events."""

import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import chat as chat_mod
from . import projects as projects_mod
from . import taskmaster as taskmaster_mod
from .openclaw_bridge import send_openclaw_agent_message as _send_openclaw_agent_via_bridge
from .openclaw_bridge import send_openclaw_message as _send_openclaw_via_bridge
from .session import DrClaw, _load_session_file


DRCLAW_DIR = Path.home() / ".drclaw"
LEGACY_VIBELAB_DIR = Path.home() / ".vibelab"

BASE_DIR = DRCLAW_DIR
if not DRCLAW_DIR.exists() and LEGACY_VIBELAB_DIR.exists():
    BASE_DIR = LEGACY_VIBELAB_DIR

LOG_DIR = BASE_DIR / "logs"
PID_FILE = BASE_DIR / "openclaw-watcher.pid"
LOG_FILE = LOG_DIR / "openclaw-watcher.log"
STATE_FILE = BASE_DIR / "openclaw-watcher-state.json"
DEDUP_TTL_SECONDS = 6 * 3600
IMPORTANT_EVENT_TYPES = {
    "claude-permission-request",
    "taskmaster-project-updated",
    "taskmaster-tasks-updated",
    "taskmaster-update",
    "session-aborted",
    "projects_updated",
}
PATH_CHANGE_TYPES = {"add", "change", "unlink"}


def _ensure_dirs() -> None:
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)


def _now() -> str:
    import datetime
    return datetime.datetime.now().isoformat(timespec="seconds")


def _read_pid() -> Optional[int]:
    try:
        return int(PID_FILE.read_text().strip())
    except (FileNotFoundError, ValueError):
        return None


def _write_pid(pid: int) -> None:
    PID_FILE.write_text(str(pid))


def _clear_pid() -> None:
    try:
        PID_FILE.unlink()
    except FileNotFoundError:
        pass


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def _load_state() -> Dict[str, Any]:
    try:
        data = json.loads(STATE_FILE.read_text())
        if isinstance(data, dict):
            return data
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return {
        "channel": None,
        "last_run_at": None,
        "last_notification_at": None,
        "last_event_at": None,
        "seen_events": {},
        "project_snapshots": {},
        "last_notifications": [],
    }


def _save_state(data: Dict[str, Any]) -> None:
    _ensure_dirs()
    STATE_FILE.write_text(json.dumps(data, indent=2))


def _append_log(message: str) -> None:
    _ensure_dirs()
    with LOG_FILE.open("a") as fh:
        fh.write(f"{message}\n")


def watcher_status() -> Dict[str, Any]:
    pid = _read_pid()
    running = pid is not None and _pid_alive(pid)
    if pid is not None and not running:
        _clear_pid()

    tail = ""
    if LOG_FILE.exists():
        tail = "\n".join(LOG_FILE.read_text(errors="replace").splitlines()[-20:])

    state = _load_state()
    return {
        "running": running,
        "pid": pid if running else None,
        "log_file": str(LOG_FILE),
        "state_file": str(STATE_FILE),
        "log_tail": tail,
        "state": state,
    }


def watcher_start(
    *,
    channel: Optional[str] = None,
    interval: int = 30,
    drclaw_bin: Optional[str] = None,
    base_url: Optional[str] = None,
) -> Dict[str, Any]:
    pid = _read_pid()
    if pid is not None and _pid_alive(pid):
        raise RuntimeError(f"OpenClaw watcher is already running (PID {pid}).")

    _clear_pid()
    _ensure_dirs()

    args = [
        sys.executable,
        "-m",
        "cli_anything.drclaw.core.openclaw_daemon",
        "run",
        "--interval",
        str(max(interval, 5)),
    ]
    if channel:
        args.extend(["--channel", channel])
    if drclaw_bin:
        args.extend(["--drclaw-bin", drclaw_bin])
    if base_url:
        args.extend(["--base-url", base_url])

    log_fh = LOG_FILE.open("a")
    log_fh.write(f"\n{'=' * 60}\n")
    log_fh.write(f"[watcher] Starting at {_now()}\n")
    log_fh.write(f"[watcher] Command: {' '.join(args)}\n")
    log_fh.write(f"{'=' * 60}\n")
    log_fh.flush()

    proc = subprocess.Popen(
        args,
        stdout=log_fh,
        stderr=log_fh,
        env=os.environ.copy(),
        start_new_session=True,
    )

    time.sleep(1.0)
    if proc.poll() is not None:
        log_fh.close()
        raise RuntimeError(f"OpenClaw watcher exited immediately (code {proc.returncode}). Check logs: {LOG_FILE}")

    _write_pid(proc.pid)
    log_fh.close()
    return {
        "pid": proc.pid,
        "log_file": str(LOG_FILE),
        "state_file": str(STATE_FILE),
        "interval": max(interval, 5),
        "channel": channel,
    }


def watcher_stop() -> Dict[str, Any]:
    pid = _read_pid()
    if pid is None or not _pid_alive(pid):
        _clear_pid()
        return {"stopped": False, "pid": None, "message": "OpenClaw watcher is not running."}

    try:
        os.kill(pid, signal.SIGTERM)
        for _ in range(10):
            time.sleep(0.5)
            if not _pid_alive(pid):
                break
        else:
            os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass

    _clear_pid()
    _append_log(f"[watcher] Stopped at {_now()} (PID {pid})")
    return {"stopped": True, "pid": pid, "message": f"OpenClaw watcher (PID {pid}) stopped."}


def _run_cmd(cmd: List[str]) -> Dict[str, Any]:
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        stderr = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(stderr or f"Command failed: {' '.join(cmd)}")
    stdout = result.stdout.strip()
    return json.loads(stdout) if stdout else {}


def _send_openclaw(channel: str, message: str) -> str:
    return _send_openclaw_via_bridge(message, channel)


def _send_openclaw_agent(channel: str, prompt: str) -> str:
    return _send_openclaw_agent_via_bridge(prompt, channel)


def _compact_message(value: Any, limit: int = 220) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


def _normalize_path(value: Optional[str]) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return os.path.abspath(os.path.expanduser(text))


def _project_label(project: Dict[str, Any]) -> str:
    return str(
        project.get("displayName")
        or project.get("display_name")
        or project.get("name")
        or project.get("fullPath")
        or project.get("path")
        or "unknown"
    )


def _compact_waiting_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    compact: List[Dict[str, Any]] = []
    for row in rows[:3]:
        compact.append(
            {
                "project": row.get("project"),
                "project_display_name": row.get("project_display_name") or row.get("project"),
                "provider": row.get("provider"),
                "session_id": row.get("session_id"),
                "summary": _compact_message(row.get("summary"), limit=140),
                "status": row.get("status"),
                "is_processing": bool(row.get("is_processing", True)),
                "last_activity": row.get("last_activity") or row.get("lastActivity") or row.get("updatedAt") or "",
            }
        )
    return compact


def _build_artifact_brief(payload: Dict[str, Any]) -> Dict[str, Any]:
    artifacts = payload.get("artifacts") or []
    latest = payload.get("latestArtifact") or {}
    return {
        "latest_artifact": latest.get("relativePath"),
        "latest_modified": latest.get("modified"),
        "artifact_count": payload.get("totalArtifacts", len(artifacts)),
    }


def _build_project_digest(client: DrClaw, project: Dict[str, Any]) -> Dict[str, Any]:
    project_name = str(project.get("name") or "").strip()
    if not project_name:
        raise ValueError("Project is not registered in Dr. Claw.")

    summary = taskmaster_mod.build_summary(client, project_name)
    artifacts = taskmaster_mod.get_artifact_summary(client, project_name)

    return {
        "project": project_name,
        "project_display_name": _project_label(project),
        "project_path": project.get("fullPath") or project.get("path") or "",
        "status": summary.get("status"),
        "counts": summary.get("counts") or {},
        "next_task": summary.get("next_task") or {},
        "guidance": summary.get("guidance") or {},
        "waiting": [],
        "artifacts": _build_artifact_brief(artifacts),
        "updated_at": summary.get("updated_at"),
    }


def _build_project_schema(payload: Dict[str, Any]) -> Dict[str, Any]:
    counts = payload.get("counts") or {}
    waiting = payload.get("waiting") or []
    blocked = int(counts.get("blocked", 0) or 0)
    waiting_count = len(waiting)
    overall_state = "attention_needed" if blocked or waiting_count else ("active" if counts.get("in_progress", 0) else "idle")
    return {
        "schema_version": "openclaw.project.v1",
        "kind": "project_digest",
        "project": {
            "ref": payload.get("project"),
            "display_name": payload.get("project_display_name"),
            "path": payload.get("project_path") or "",
            "state": overall_state,
        },
        "status": {
            "workflow": payload.get("status"),
            "updated_at": payload.get("updated_at"),
        },
        "counts": counts,
        "next_task": payload.get("next_task") or {},
        "guidance": payload.get("guidance") or {},
        "waiting_sessions": waiting,
        "artifacts": payload.get("artifacts") or {},
        "decision": {
            "needed": bool(waiting_count or blocked),
            "reason": "waiting_session" if waiting_count else ("blocked_task" if blocked else None),
        },
        "next_actions": [
            {
                "id": "status",
                "label": "Check Status",
                "kind": "command",
                "command": f'drclaw --json workflow status --project "{payload.get("project") or payload.get("project_path") or ""}"',
            }
        ],
    }


def _resolve_project_from_event(client: DrClaw, event: Dict[str, Any], cached_projects: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
    projects = cached_projects if cached_projects is not None else projects_mod.list_projects(client)
    project_ref = str(event.get("project") or "").strip()
    changed_file = _normalize_path(event.get("changed_file"))

    def matches_project(project: Dict[str, Any]) -> bool:
        project_name = str(project.get("name") or "").strip()
        display_name = str(project.get("displayName") or project.get("display_name") or "").strip()
        project_paths = [_normalize_path(project.get("fullPath")), _normalize_path(project.get("path"))]
        if project_ref and project_ref in {project_name, display_name, *[path for path in project_paths if path]}:
            return True
        if changed_file:
            for project_path in project_paths:
                if project_path and (changed_file == project_path or changed_file.startswith(project_path + os.sep)):
                    return True
        return False

    for project in projects:
        if isinstance(project, dict) and matches_project(project):
            return project
    return None


def _snapshot_from_digest(digest: Dict[str, Any]) -> Dict[str, Any]:
    counts = digest.get("counts") or {}
    next_task = digest.get("next_task") or {}
    waiting = digest.get("waiting") or []
    return {
        "status": digest.get("status"),
        "completed": int(counts.get("completed", 0) or 0),
        "blocked": int(counts.get("blocked", 0) or 0),
        "in_progress": int(counts.get("in_progress", 0) or 0),
        "pending": int(counts.get("pending", 0) or 0),
        "waiting": len(waiting),
        "next_task_id": next_task.get("id"),
        "next_task_title": next_task.get("title"),
    }


def _change_signal(kind: str, summary: str, *, priority: str = "medium", action_required: bool = False) -> Dict[str, Any]:
    return {
        "kind": kind,
        "summary": summary,
        "priority": priority,
        "action_required": action_required,
    }


def _derive_signals(event: Dict[str, Any], previous: Optional[Dict[str, Any]], current: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    event_type = str(event.get("type") or "")
    signals: List[Dict[str, Any]] = []
    previous = previous or {}
    current = current or {}

    if event_type == "claude-permission-request":
        tool_name = _compact_message(event.get("tool_name"), limit=80) or "tool call"
        signals.append(_change_signal("human_decision_needed", f"Agent requests permission for {tool_name}.", priority="high", action_required=True))
        return signals

    if event_type == "session-aborted":
        signals.append(_change_signal("session_aborted", "Session execution was aborted.", priority="high", action_required=True))
        return signals

    prev_waiting = int(previous.get("waiting", 0) or 0)
    curr_waiting = int(current.get("waiting", 0) or 0)
    prev_blocked = int(previous.get("blocked", 0) or 0)
    curr_blocked = int(current.get("blocked", 0) or 0)
    prev_completed = int(previous.get("completed", 0) or 0)
    curr_completed = int(current.get("completed", 0) or 0)

    if curr_waiting > prev_waiting:
        signals.append(_change_signal("waiting_for_human", f"Waiting sessions increased from {prev_waiting} to {curr_waiting}.", priority="high", action_required=True))
    if curr_blocked > prev_blocked:
        signals.append(_change_signal("blocker_detected", f"Blocked tasks increased from {prev_blocked} to {curr_blocked}.", priority="high", action_required=True))
    if curr_blocked < prev_blocked:
        signals.append(_change_signal("blocker_cleared", f"Blocked tasks decreased from {prev_blocked} to {curr_blocked}.", priority="medium"))
    if curr_completed > prev_completed:
        delta = curr_completed - prev_completed
        noun = "task" if delta == 1 else "tasks"
        signals.append(_change_signal("task_completed", f"{delta} {noun} completed since the last snapshot.", priority="medium"))

    prev_next = (previous.get("next_task_id"), previous.get("next_task_title"))
    curr_next = (current.get("next_task_id"), current.get("next_task_title"))
    if previous and prev_next != curr_next and curr_next[1]:
        signals.append(_change_signal("next_task_changed", f"Next task is now: {curr_next[1]}", priority="low"))

    if not signals and event_type in {"taskmaster-project-updated", "taskmaster-tasks-updated", "taskmaster-update"}:
        if curr_blocked or curr_waiting:
            signals.append(_change_signal("attention_needed", "Project still needs human attention.", priority="high", action_required=True))

    return signals


def _select_primary_signal(signals: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not signals:
        return None
    rank = {"high": 0, "medium": 1, "low": 2}
    return sorted(signals, key=lambda item: (rank.get(str(item.get("priority") or "low"), 9), str(item.get("kind") or "")))[0]


def _event_details(event: Dict[str, Any]) -> Dict[str, Any]:
    return {key: value for key, value in event.items() if key != "openclaw"}


def _build_event_schema(event: Dict[str, Any], portfolio_event: Optional[Dict[str, Any]], signals: List[Dict[str, Any]]) -> Dict[str, Any]:
    primary = _select_primary_signal(signals)
    mapped_kind = str((primary or {}).get("kind") or "info")
    return {
        "schema_version": "openclaw.event.v1",
        "kind": "event",
        "event": {
            "type": event.get("type"),
            "mapped_kind": mapped_kind,
            "project": event.get("project"),
            "provider": event.get("provider"),
            "session_id": event.get("session_id"),
            "timestamp": event.get("timestamp"),
            "details": _event_details(event),
            "signals": signals,
        },
        "portfolio_event": portfolio_event,
    }


def _should_emit_signal(event: Dict[str, Any], signals: List[Dict[str, Any]], portfolio_event: Optional[Dict[str, Any]]) -> bool:
    if not signals:
        return False
    primary = _select_primary_signal(signals) or {}
    if primary.get("action_required"):
        return True
    if primary.get("kind") in {"task_completed", "blocker_cleared"}:
        return True
    decision = (portfolio_event or {}).get("decision") or {}
    return bool(decision.get("needed"))


def _build_summary_prompt(event: Dict[str, Any], project_digest: Dict[str, Any], signals: List[Dict[str, Any]]) -> str:
    event_type = str(event.get("type") or "unknown")
    project_name = project_digest.get("project_display_name") or event.get("project") or "unknown"
    payload = {
        "event": {
            "type": event_type,
            "provider": event.get("provider"),
            "session_id": event.get("session_id"),
            "change_type": event.get("change_type"),
            "changed_file": event.get("changed_file"),
            "tool_name": event.get("tool_name"),
            "success": event.get("success"),
            "timestamp": event.get("timestamp"),
        },
        "signals": signals,
        "project_digest": project_digest,
    }
    return (
        "请作为 Dr. Claw 项目秘书，用中文给用户发送一条飞书通知。\n"
        "要求：\n"
        "1. 直接输出要发送的正文，不要加前言、不要解释。\n"
        "2. 4 行以内。\n"
        "3. 第一行必须点名项目和核心变化。\n"
        "4. 如果需要用户决策，明确写出要决定什么。\n"
        "5. 如果只是进展更新，说明完成了什么和下一步。\n"
        f"当前项目：{project_name}\n"
        f"结构化上下文：{json.dumps(payload, ensure_ascii=False)}"
    )


def _extract_json_object(text: str) -> Optional[Dict[str, Any]]:
    decoder = json.JSONDecoder()
    starts = [idx for idx, char in enumerate(text) if char == "{"]
    for start in reversed(starts):
        try:
            payload, _ = decoder.raw_decode(text[start:])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    return None



def _extract_message_from_payload(payload: Dict[str, Any]) -> str:
    for key in ("delivered_text", "message", "text", "output"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    delivered = payload.get("delivered")
    if isinstance(delivered, dict):
        for key in ("message", "text", "content"):
            value = delivered.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

    result = payload.get("result")
    if isinstance(result, dict):
        payloads = result.get("payloads")
        if isinstance(payloads, list):
            texts = []
            for item in payloads:
                if isinstance(item, dict):
                    value = item.get("text")
                    if isinstance(value, str) and value.strip():
                        texts.append(value.strip())
            if texts:
                return "\n".join(texts)

    return ""



def _extract_delivery_message(raw_output: str) -> str:
    text = str(raw_output or "").strip()
    if not text:
        return ""

    payload = None
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            payload = parsed
    except json.JSONDecodeError:
        payload = _extract_json_object(text)

    if isinstance(payload, dict):
        message = _extract_message_from_payload(payload)
        if message:
            return message

    lines = [line.strip() for line in text.splitlines() if line.strip() and not line.strip().startswith("[plugins]")]
    return "\n".join(lines).strip() or text


def _event_signature(event: Dict[str, Any], portfolio_event: Optional[Dict[str, Any]]) -> str:
    stable = {
        "type": event.get("type"),
        "project": event.get("project"),
        "provider": event.get("provider"),
        "session_id": event.get("session_id"),
        "tool_name": event.get("tool_name"),
        "change_type": event.get("change_type"),
        "success": event.get("success"),
        "portfolio_reason": ((portfolio_event or {}).get("decision") or {}).get("reason"),
        "portfolio_state": ((portfolio_event or {}).get("project") or {}).get("state"),
    }
    raw = json.dumps(stable, sort_keys=True, ensure_ascii=False)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _prune_seen_events(state: Dict[str, Any], now_ts: float) -> None:
    seen = state.setdefault("seen_events", {})
    keep: Dict[str, Any] = {}
    for key, value in seen.items():
        seen_at = float(value.get("seen_at_epoch", 0)) if isinstance(value, dict) else 0
        if now_ts - seen_at <= DEDUP_TTL_SECONDS:
            keep[key] = value
    state["seen_events"] = keep


def _should_notify(state: Dict[str, Any], event: Dict[str, Any], portfolio_event: Optional[Dict[str, Any]]) -> bool:
    event_type = str(event.get("type") or "")
    if event_type not in IMPORTANT_EVENT_TYPES:
        return False

    if event_type == "projects_updated" and event.get("change_type") not in PATH_CHANGE_TYPES:
        return False

    now_ts = time.time()
    _prune_seen_events(state, now_ts)
    signature = _event_signature(event, portfolio_event)
    seen = state.setdefault("seen_events", {})
    existing = seen.get(signature)
    if existing and now_ts - float(existing.get("seen_at_epoch", 0)) <= DEDUP_TTL_SECONDS:
        return False

    seen[signature] = {
        "seen_at": _now(),
        "seen_at_epoch": now_ts,
        "event_type": event_type,
        "project": event.get("project"),
        "session_id": event.get("session_id"),
    }
    return True


def _build_event_message(event: Dict[str, Any], portfolio_event: Optional[Dict[str, Any]]) -> str:
    project_name = event.get("project") or ((portfolio_event or {}).get("project") or {}).get("display_name") or "unknown"
    event_type = event.get("type") or "unknown"
    mapped_kind = event.get("openclaw", {}).get("event", {}).get("mapped_kind") or event_type
    lines = [f"[Dr. Claw] {project_name}", f"Type: {mapped_kind}"]
    if event.get("provider"):
        lines.append(f"Provider: {event['provider']}")
    if event.get("session_id"):
        lines.append(f"Session: {event['session_id']}")
    if event_type == "claude-permission-request":
        lines.append(f"Tool: {_compact_message(event.get('tool_name'))}")
        lines.append("Next: review and approve or deny the requested tool call")
    elif event_type == "session-aborted":
        lines.append(f"Result: {'aborted' if event.get('success') else 'abort_failed'}")
    elif event_type == "projects_updated":
        lines.append(f"Change: {_compact_message(event.get('change_type'))}")
    if portfolio_event:
        decision = portfolio_event.get("decision") or {}
        if decision.get("needed"):
            lines.append(f"Decision: {decision.get('reason')}")
        next_actions = portfolio_event.get("next_actions") or []
        if next_actions:
            lines.append(f"Action: {next_actions[0].get('label')}")
    return "\n".join(lines)


def _record_notification(state: Dict[str, Any], event: Dict[str, Any], message: str) -> None:
    rows = state.setdefault("last_notifications", [])
    rows.append(
        {
            "sent_at": _now(),
            "event_type": event.get("type"),
            "project": event.get("project"),
            "session_id": event.get("session_id"),
            "message": message,
        }
    )
    del rows[:-20]


def _watch_loop(channel: str, drclaw_bin: str, base_url: Optional[str], interval: int) -> None:
    client = DrClaw(url_override=base_url)
    state = _load_state()
    state["channel"] = channel
    _save_state(state)

    def handle_event(event: Dict[str, Any]) -> None:
        state["last_event_at"] = _now()
        project = _resolve_project_from_event(client, event)
        if event.get("type") == "projects_updated" and project is None:
            _save_state(state)
            return

        project_digest = None
        portfolio_event = None
        snapshot_before = None
        snapshot_after = None
        project_key = None
        if project is not None:
            project_digest = _build_project_digest(client, project)
            portfolio_event = _build_project_schema(project_digest)
            project_key = str(project_digest.get("project") or project_digest.get("project_path") or "")
            snapshots = state.setdefault("project_snapshots", {})
            snapshot_before = snapshots.get(project_key)
            snapshot_after = _snapshot_from_digest(project_digest)

        signals = _derive_signals(event, snapshot_before, snapshot_after)
        event["openclaw"] = _build_event_schema(event, portfolio_event, signals)

        if project_key and snapshot_after is not None:
            state.setdefault("project_snapshots", {})[project_key] = snapshot_after

        if not _should_emit_signal(event, signals, portfolio_event):
            _save_state(state)
            return

        if not _should_notify(state, event, portfolio_event):
            _save_state(state)
            return

        message = _build_event_message(event, portfolio_event)
        if project_digest is not None and signals:
            prompt = _build_summary_prompt(event, project_digest, signals)
            try:
                message = _extract_delivery_message(_send_openclaw_agent(channel, prompt))
            except Exception as exc:
                _append_log(f"[watcher] Agent summary failed at {_now()}: {exc}")
                message = _build_event_message(event, portfolio_event)
                _send_openclaw(channel, message)
        else:
            _send_openclaw(channel, message)

        state["last_notification_at"] = _now()
        state["last_run_at"] = _now()
        _record_notification(state, event, message)
        _save_state(state)

    while True:
        try:
            chat_mod.watch_events(
                client,
                timeout=max(interval, 5),
                event_types=sorted(IMPORTANT_EVENT_TYPES),
                on_event=handle_event,
            )
            state["last_run_at"] = _now()
            _save_state(state)
        except KeyboardInterrupt:
            raise
        except Exception as exc:
            _append_log(f"[watcher] Loop error at {_now()}: {exc}")
            time.sleep(2)


def run_loop(*, channel: str, interval: int, drclaw_bin: str, base_url: Optional[str]) -> None:
    _append_log(f"[watcher] Run loop starting at {_now()} channel={channel} interval={interval}")
    _watch_loop(channel=channel, drclaw_bin=drclaw_bin, base_url=base_url, interval=interval)


def main(argv: Optional[List[str]] = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Dr. Claw OpenClaw watcher daemon")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--channel", required=False)
    run_parser.add_argument("--interval", type=int, default=30)
    run_parser.add_argument("--drclaw-bin", default="drclaw")
    run_parser.add_argument("--base-url", default=None)

    args = parser.parse_args(argv)

    if args.command == "run":
        session = _load_session_file()
        channel = args.channel or session.get("openclaw_push_channel")
        if not channel:
            raise RuntimeError("No OpenClaw channel configured for watcher daemon.")
        _ensure_dirs()
        run_loop(channel=channel, interval=args.interval, drclaw_bin=args.drclaw_bin, base_url=args.base_url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
