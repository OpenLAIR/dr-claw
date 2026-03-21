"""
drclaw - CLI harness for the Dr. Claw / DrClaw research workspace.

Entry point: cli_anything.drclaw.drclaw_cli:cli

Usage overview:
  drclaw [--json] [--url URL] <command> [<subcommand>] [options]

Global flags (must come before the command):
  --json        Output all results as JSON to stdout.
  --url URL     Override the Dr. Claw server URL for this invocation.

Sub-command tree:
  auth
    login       Authenticate and store token in ~/.drclaw_session.json
    logout      Remove the local session file
    status      Check server auth status (no token required)
  projects
    list        List all projects
    add         Register a project by filesystem path
    rename      Rename a project display name
    delete      Delete a project
  sessions
    list        List sessions for a project
    messages    Retrieve messages for a session
  taskmaster
    status          Show TaskMaster installation status
    detect          Detect TaskMaster state for a project
    detect-all      Detect TaskMaster state across all projects
    init            Initialize .pipeline files for a project
    tasks           List project tasks
    add-task        Add a task to a project workflow
    update-task     Update a task in a project workflow
    artifacts       Summarize recent project artifacts
    next            Show the next task
    next-guidance   Show next-task guidance metadata
    summary         Show a compact progress summary
  digest
    project         Send/print a project digest
    daily           Send/print a multi-project digest
  settings
    api-keys
      list      List API keys
      create    Create an API key
      delete    Delete an API key
  skills
    list        List global skills
  chat
    send        Send a provider message over WebSocket
    reply       Reply to an existing session
    sessions    List known sessions across projects
    waiting     List sessions currently waiting for response
    watch       Watch realtime session/task events
  openclaw
    install     Install the Dr. Claw skill into OpenClaw
    configure   Save the default push channel
    push        Send a raw message through OpenClaw
    report      Send a TaskMaster status report through OpenClaw
"""

import base64
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import time
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional

warnings.filterwarnings("ignore", category=DeprecationWarning)

import click
import requests

from .core import chat as chat_mod
from .core import conversations as conversations_mod
from .core import daemon as daemon_mod
from .core import openclaw_daemon as openclaw_daemon_mod
from .core import projects as projects_mod
from .core import settings as settings_mod
from .core import taskmaster as taskmaster_mod
from .core.openclaw_bridge import send_openclaw_message as _send_openclaw_via_bridge
from .core.session import (
    SESSION_FILE,
    NotLoggedInError,
    DrClaw,
    _load_session_file,
    _save_session_file,
)
from .utils.output import error, info, output, success


_SESSION_COLLECTIONS = {
    "claude": "sessions",
    "cursor": "cursorSessions",
    "codex": "codexSessions",
    "gemini": "geminiSessions",
}
_PROVIDER_CHOICES = ["claude", "cursor", "codex", "gemini"]
_OPENCLAW_SKILL_DIR_NAME = "drclaw"
_SKILL_MD_FILENAME = "SKILL.md"
_HARNESS_ROOT = Path(__file__).parent.parent.parent
_OPENCLAW_SKILL_SOURCE_DIR = _HARNESS_ROOT / "skills" / "dr-claw"
_PRIMARY_CLI_NAME = "drclaw"


def _cli_cmd(command: str = "") -> str:
    command = command.strip()
    return f"{_PRIMARY_CLI_NAME} {command}" if command else _PRIMARY_CLI_NAME


_TRANSLATIONS = {
    "en": {
        "status": "Status",
        "progress": "Progress",
        "next_step": "Next",
        "stage": "Stage",
        "suggestion": "Guidance",
        "inputs": "Inputs",
        "skills": "Skills",
        "prompt": "Prompt",
        "updated_at": "Updated",
        "no_pending": "No pending tasks",
        "action": "Action",
        "provider": "Provider",
        "session": "Session",
        "reply": "Reply",
        "empty": "(empty)",
        "suggest_answer_questions": "Suggested reply: answer the clarifying questions directly — confirm goals, constraints, deliverables, and next steps.",
        "suggest_continue_task": "Suggested reply: let it continue the current task and report blockers, next checkpoint, and where it needs your input.",
        "suggest_unblock": "Suggested reply: ask it to describe the current blocker, missing inputs, and the next step after unblocking.",
        "suggest_summarize_progress": "Suggested reply: summarize current experiment progress, completed parts, risks, and plan for the next phase.",
        "suggest_converge_plan": "Suggested reply: converge the current discussion into a research brief, phase breakdown, and draft tasks.",
        "suggest_start_next": "Suggested reply: start the next pending task and report the first verifiable deliverable.",
    },
    "zh": {
        "status": "状态",
        "progress": "进度",
        "next_step": "下一步",
        "stage": "阶段",
        "suggestion": "建议",
        "inputs": "输入",
        "skills": "技能",
        "prompt": "提示词",
        "updated_at": "更新于",
        "no_pending": "无待处理任务",
        "action": "动作",
        "provider": "服务商",
        "session": "会话",
        "reply": "回复",
        "empty": "(空)",
        "suggest_answer_questions": "建议回复：直接回答它刚刚提出的澄清问题，确认目标、约束、输出物和下一步。",
        "suggest_continue_task": "建议回复：让它继续执行当前任务，并汇报 blocker、下一检查点和需要你的输入。",
        "suggest_unblock": "建议回复：让它说明当前 blocker、缺少的输入，以及解除阻塞后的下一步。",
        "suggest_summarize_progress": "建议回复：请总结当前实验进展、已完成部分、风险和下一阶段计划。",
        "suggest_converge_plan": "建议回复：请把当前讨论收敛成 research brief、阶段拆分和 draft tasks。",
        "suggest_start_next": "建议回复：从下一个 pending 任务开始执行，并汇报第一个可验证产物。",
    },
}


class Context:
    def __init__(self, json_mode: bool, client: DrClaw, lang: str = "en") -> None:
        self.json_mode = json_mode
        self.client = client
        self.lang = lang if lang in _TRANSLATIONS else "en"

    def t(self, key: str) -> str:
        return _TRANSLATIONS[self.lang].get(key, key)


pass_context = click.make_pass_decorator(Context)


def _handle_error(exc: Exception, json_mode: bool) -> None:
    """Print a tidy error message and exit with code 1."""
    if isinstance(exc, NotLoggedInError):
        error(str(exc))
    elif isinstance(exc, requests.HTTPError):
        try:
            detail = exc.response.json().get("error", exc.response.text)
        except Exception:
            detail = str(exc)
        
        # Enhanced error handling for session-related failures
        detail_lower = detail.lower()
        is_session_error = any(msg in detail_lower for msg in ["missing rollout path", "session not found", "state db missing"])
        
        if is_session_error:
            error(f"HTTP {exc.response.status_code}: {detail}")
            if not json_mode:
                info(f"\n💡 {click.style('Tip:', bold=True)} This session appears to be invalid or has expired on the server.")
                info("   This often happens with 'codex' when the local state path is missing.")
                info("   Try starting a new session with a different provider (e.g., gemini):")
                info(f"   {_PRIMARY_CLI_NAME} chat send --project <project> --provider gemini -m \"Continue Task...\"")
        else:
            error(f"HTTP {exc.response.status_code}: {detail}")
    elif isinstance(exc, requests.ConnectionError):
        error(f"Could not connect to the Dr. Claw server. Is it running?  ({exc})")
    elif isinstance(exc, requests.Timeout):
        error("Request timed out. Try increasing --timeout.")
    else:
        error(str(exc))
    sys.exit(1)


def _normalize_path(value: str) -> str:
    return os.path.abspath(os.path.expanduser(value))


def _project_label(project: Dict[str, Any]) -> str:
    return (
        project.get("displayName")
        or project.get("display_name")
        or project.get("name")
        or project.get("fullPath")
        or project.get("path")
        or "unknown"
    )


def _project_identity(project: Dict[str, Any]) -> str:
    return project.get("name") or project.get("fullPath") or project.get("path") or repr(project)


def _resolve_project_ref(
    client: DrClaw,
    project_ref: str,
    allow_path_fallback: bool = False,
) -> Dict[str, Any]:
    """Resolve a project name, display name, or filesystem path to a project."""
    ref = (project_ref or "").strip()
    if not ref:
        raise ValueError("Project reference is required.")

    projects = projects_mod.list_projects(client)
    if not isinstance(projects, list):
        raise ValueError("Failed to load DrClaw projects.")

    ref_lower = ref.lower()
    maybe_path = None
    if os.path.isabs(ref) or ref.startswith("~") or ref.startswith(".") or "/" in ref:
        maybe_path = _normalize_path(ref)

    matches: List[tuple[int, Dict[str, Any]]] = []
    for project in projects:
        if not isinstance(project, dict):
            continue

        score = -1
        project_name = str(project.get("name") or "").strip()
        display_name = str(project.get("displayName") or project.get("display_name") or "").strip()
        project_paths = [
            str(project.get("path") or "").strip(),
            str(project.get("fullPath") or "").strip(),
        ]

        if project_name and ref == project_name:
            score = max(score, 100)
        elif project_name and ref_lower == project_name.lower():
            score = max(score, 90)

        if display_name and ref == display_name:
            score = max(score, 80)
        elif display_name and ref_lower == display_name.lower():
            score = max(score, 70)

        for candidate_path in project_paths:
            if not candidate_path:
                continue
            if ref == candidate_path:
                score = max(score, 60)
            if maybe_path and _normalize_path(candidate_path) == maybe_path:
                score = max(score, 95)

        if score >= 0:
            matches.append((score, project))

    if matches:
        matches.sort(key=lambda item: item[0], reverse=True)
        top_score = matches[0][0]
        top_projects: List[Dict[str, Any]] = []
        seen = set()
        for score, project in matches:
            if score != top_score:
                continue
            identity = _project_identity(project)
            if identity in seen:
                continue
            seen.add(identity)
            top_projects.append(project)

        if len(top_projects) == 1:
            return top_projects[0]

        labels = ", ".join(sorted(_project_label(project) for project in top_projects))
        raise ValueError(f"Project reference '{project_ref}' is ambiguous. Matches: {labels}")

    if allow_path_fallback and maybe_path and os.path.exists(maybe_path):
        return {
            "name": None,
            "displayName": os.path.basename(maybe_path) or maybe_path,
            "path": maybe_path,
            "fullPath": maybe_path,
            "_unlisted_path": True,
        }

    sample_refs = ", ".join(_project_label(project) for project in projects[:6] if isinstance(project, dict))
    if sample_refs:
        raise ValueError(
            f"Project '{project_ref}' was not found. Try a project name, display name, or path from: {sample_refs}"
        )
    raise ValueError("No DrClaw projects are available.")


def _require_project_name(project: Dict[str, Any], project_ref: str) -> str:
    project_name = project.get("name")
    if not project_name:
        raise ValueError(
            f"Project '{project_ref}' is not registered in Dr. Claw. Add it first, or choose a project from `{_cli_cmd('projects list')}`."
        )
    return str(project_name)


def _project_rows(projects: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for project in projects:
        if not isinstance(project, dict):
            continue
        taskmaster = project.get("taskmaster") or {}
        rows.append(
            {
                "name": project.get("name", ""),
                "display_name": _project_label(project),
                "path": project.get("fullPath") or project.get("path") or "",
                "claude": len(project.get("sessions") or []),
                "cursor": len(project.get("cursorSessions") or []),
                "codex": len(project.get("codexSessions") or []),
                "gemini": len(project.get("geminiSessions") or []),
                "taskmaster": taskmaster.get("status") or "",
            }
        )
    return rows


def _emit_collection(
    ctx: Context,
    page: Dict[str, Any],
    item_key: str,
    title: str,
) -> None:
    if ctx.json_mode:
        output(page, json_mode=True)
        return

    items = page.get(item_key) or []
    output(items, json_mode=False, title=title)

    meta_parts: List[str] = []
    if page.get("total") is not None:
        meta_parts.append(f"total={page['total']}")
    if page.get("offset") is not None:
        meta_parts.append(f"offset={page['offset']}")
    if page.get("limit") is not None:
        meta_parts.append(f"limit={page['limit']}")
    if meta_parts:
        info("  " + "  ".join(meta_parts))
    if page.get("hasMore"):
        info("  More items are available. Increase --limit or use --offset.")


def _normalize_provider(provider: Optional[str]) -> Optional[str]:
    if provider is None:
        return None
    return provider.lower().strip()


def _session_timestamp(session: Dict[str, Any]) -> str:
    for key in ("lastActivity", "lastModified", "updatedAt", "createdAt", "timestamp"):
        value = session.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def _list_provider_sessions_from_project(
    project: Dict[str, Any],
    provider: str,
    limit: Optional[int],
    offset: int,
) -> Dict[str, Any]:
    field_name = _SESSION_COLLECTIONS[provider]
    raw_sessions = project.get(field_name) or []
    if not isinstance(raw_sessions, list):
        raw_sessions = []

    normalized: List[Dict[str, Any]] = []
    for session in raw_sessions:
        if not isinstance(session, dict):
            continue
        row = dict(session)
        row.setdefault("provider", provider)
        row.setdefault("project_id", project.get("name"))
        row.setdefault("project_name", project.get("name"))
        row.setdefault("project_display_name", _project_label(project))
        row.setdefault("summary", row.get("summary") or row.get("title") or row.get("name") or "")
        normalized.append(row)

    normalized.sort(key=_session_timestamp, reverse=True)
    safe_offset = max(offset, 0)
    total = len(normalized)

    if limit is None:
        page_items = normalized[safe_offset:]
    else:
        page_items = normalized[safe_offset : safe_offset + max(limit, 0)]

    return {
        "sessions": page_items,
        "total": total,
        "offset": safe_offset,
        "limit": limit,
        "hasMore": safe_offset + len(page_items) < total,
    }


def _resolve_session_provider(
    client: DrClaw,
    project: Dict[str, Any],
    session_id: str,
) -> str:
    project_name = project.get("name")
    project_path = project.get("fullPath") or project.get("path")

    candidates: List[Dict[str, Any]] = []
    for session in chat_mod.get_active_sessions(client):
        same_project = (
            session.get("project_name") == project_name
            or session.get("project_path") == project_path
        )
        if not same_project:
            continue

        known_session_id = (
            session.get("session_id")
            or session.get("sessionId")
            or session.get("id")
        )
        if known_session_id == session_id:
            candidates.append(session)

    providers = sorted(
        {
            _normalize_provider(session.get("provider"))
            for session in candidates
            if session.get("provider")
        }
    )

    if len(providers) == 1:
        return providers[0] or "claude"

    if len(providers) > 1:
        raise ValueError(
            f"Session '{session_id}' is ambiguous in project '{_project_label(project)}'. Matching providers: {', '.join(providers)}"
        )

    project_name = _project_label(project)
    sessions_cmd = _cli_cmd(f'chat sessions --project "{project_name}"')
    waiting_cmd = _cli_cmd(f'chat waiting --project "{project_name}"')
    raise ValueError(
        f"Session '{session_id}' was not found in project '{project_name}'. Run `{sessions_cmd}` or `{waiting_cmd}` first."
    )


def _resolve_push_channel(channel: Optional[str]) -> Optional[str]:
    if channel:
        return channel
    session_file = SESSION_FILE
    session_data = _load_session_file(session_file)
    return session_data.get("openclaw_push_channel")


def _resolve_current_drclaw_bin() -> str:
    candidates = [
        shutil.which(_PRIMARY_CLI_NAME),
        shutil.which("dr-claw"),
        shutil.which("vibelab"),
    ]
    for candidate in candidates:
        if candidate:
            return os.path.abspath(candidate)

    user_base = ""
    try:
        result = subprocess.run(
            [sys.executable, "-c", "import site; print(site.getuserbase())"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        user_base = (result.stdout or "").strip()
    except Exception:
        user_base = ""

    for name in (_PRIMARY_CLI_NAME, "dr-claw", "vibelab"):
        if user_base:
            candidate_path = Path(user_base) / "bin" / name
            if candidate_path.exists():
                return str(candidate_path)

    return _PRIMARY_CLI_NAME


def _mark_executable(path: Path) -> None:
    mode = path.stat().st_mode
    path.chmod(mode | 0o111)


def _install_openclaw_skill(
    *,
    openclaw_dir: Optional[str],
    server_url: Optional[str],
    push_channel: Optional[str],
) -> Dict[str, Any]:
    base = Path(openclaw_dir).expanduser() if openclaw_dir else Path.home() / ".openclaw"
    skill_source = _OPENCLAW_SKILL_SOURCE_DIR
    skill_dest = base / "workspace" / "skills" / _OPENCLAW_SKILL_DIR_NAME

    if not skill_source.exists():
        raise FileNotFoundError(
            f"Dr. Claw skill source not found at {skill_source}. Run this command from the agent-harness repo."
        )

    shutil.copytree(str(skill_source), str(skill_dest), dirs_exist_ok=True)

    installed_files: List[str] = []
    for path in sorted(skill_dest.rglob("*")):
        if not path.is_file():
            continue
        installed_files.append(str(path))
        if path.suffix == ".sh":
            _mark_executable(path)

    resolved_server_url = (server_url or "").strip() or None
    if resolved_server_url:
        resolved_server_url = resolved_server_url.rstrip("/")

    session_file = SESSION_FILE
    session_data = _load_session_file(session_file)
    if resolved_server_url:
        session_data["base_url"] = resolved_server_url
    if push_channel:
        session_data["openclaw_push_channel"] = push_channel
    session_data["openclaw_skill_dir"] = str(skill_dest)
    session_data["openclaw_drclaw_bin"] = _resolve_current_drclaw_bin()
    _save_session_file(session_data, session_file)

    return {
        "openclaw_dir": str(base),
        "skill_dir": str(skill_dest),
        "installed_files": installed_files,
        "installed_file_count": len(installed_files),
        "server_url": resolved_server_url or session_data.get("base_url") or "http://localhost:3001",
        "push_channel": push_channel or session_data.get("openclaw_push_channel"),
        "drclaw_bin": session_data.get("openclaw_drclaw_bin") or _resolve_current_drclaw_bin(),
    }


def _send_openclaw_message(message_text: str, channel: str) -> str:
    try:
        return _send_openclaw_via_bridge(message_text, channel)
    except Exception as exc:
        raise RuntimeError(str(exc)) from exc


def _truncate_text(value: Any, max_len: int = 220) -> str:
    text = str(value or "").strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


def _make_progress_bar(rate: int, length: int = 10) -> str:
    """Create a beautiful block-style progress bar."""
    filled = max(0, min(length, int(rate * length / 100)))
    bar = "█" * filled + "░" * (length - filled)
    
    color = "green"
    if rate < 30:
        color = "red"
    elif rate < 70:
        color = "yellow"
        
    return click.style(bar, fg=color)


def _get_status_style(status: str) -> tuple[str, str]:
    """Get color and emoji for a given status string."""
    s = str(status or "").lower()
    if "configured" in s or "done" in s or "success" in s:
        return "green", "🟢"
    if "pending" in s or "in-progress" in s or "active" in s:
        return "blue", "🔵"
    if "blocked" in s or "error" in s or "fail" in s:
        return "red", "🔴"
    if "waiting" in s or "review" in s:
        return "yellow", "🟡"
    return "white", "⚪"


def _build_openclaw_report(
    project: Dict[str, Any],
    summary: Dict[str, Any],
    ctx: Context,
    include_prompt: bool = False,
) -> str:
    counts = summary.get("counts") or {}
    next_task = summary.get("next_task") or {}
    guidance = summary.get("guidance") or {}

    project_label = _project_label(project)
    header = click.style(f"📊 [Dr. Claw] {project_label}", bold=True, fg="cyan")
    
    lines = [header]
    
    status = summary.get('status', 'unknown')
    color, emoji = _get_status_style(status)
    lines.append(f"{emoji} {click.style(ctx.t('status'), bold=True)}: {click.style(status, fg=color)}")
    
    done = counts.get('completed', 0)
    total = counts.get('total', 0)
    rate = int(counts.get('completion_rate', 0))
    progress_bar = _make_progress_bar(rate)
    lines.append(f"📈 {click.style(ctx.t('progress'), bold=True)}: {progress_bar} {click.style(f'{done}/{total} ({rate}%)', fg='bright_black')}")
    
    if next_task:
        task_id = next_task.get('id', '?')
        task_title = next_task.get("title") or "Untitled task"
        lines.append(f"⏩ {click.style(ctx.t('next_step'), bold=True)}: {click.style(f'#{task_id}', fg='yellow')} {task_title}")
        
        stage = next_task.get("stage")
        if stage:
            lines.append(f"   📍 {click.style(ctx.t('stage'), bold=True)}: {click.style(stage, italic=True)}")
    else:
        lines.append(f"⏩ {click.style(ctx.t('next_step'), bold=True)}: {click.style(ctx.t('no_pending'), fg='bright_black')}")

    why_next = guidance.get("whyNext")
    if why_next:
        lines.append(f"💡 {click.style(ctx.t('suggestion'), bold=True)}: {_truncate_text(why_next, 180)}")

    required_inputs = guidance.get("requiredInputs") or []
    if required_inputs:
        inputs_str = click.style(", ".join(str(item) for item in required_inputs[:4]), fg="magenta")
        lines.append(f"📥 {click.style(ctx.t('inputs'), bold=True)}: {inputs_str}")

    suggested_skills = guidance.get("suggestedSkills") or []
    if suggested_skills:
        skills_str = click.style(", ".join(str(item) for item in suggested_skills[:4]), fg="green")
        lines.append(f"🛠️ {click.style(ctx.t('skills'), bold=True)}: {skills_str}")

    if include_prompt and guidance.get("nextActionPrompt"):
        lines.append(f"💬 {click.style(ctx.t('prompt'), bold=True)}: \n{click.style('> ', fg='bright_black')}{click.style(_truncate_text(guidance['nextActionPrompt'], 320), italic=True)}")

    updated_at = summary.get("updated_at")
    if updated_at:
        display_time = updated_at
        if "T" in updated_at and "." in updated_at:
            try:
                display_time = updated_at.split(".")[0].replace("T", " ")
            except Exception: pass
        lines.append(f"🕒 {click.style(ctx.t('updated_at'), bold=True)}: {click.style(display_time, fg='bright_black')}")

    return "\n".join(lines)


def _build_openclaw_chat_notification(payload: Dict[str, Any], action: str, ctx: Context) -> str:
    project_name = payload.get("project_display_name") or payload.get("project") or payload.get("project_path") or "unknown"
    provider = payload.get("provider") or "unknown"
    session_id = payload.get("session_id") or ""
    reply = _truncate_text(payload.get("reply") or "", 400)

    # Emoji based on provider
    provider_emojis = {
        "claude": "🎭",
        "cursor": "🛰️",
        "codex": "🔮",
        "gemini": "♊"
    }
    emoji = provider_emojis.get(provider.lower(), "🤖")

    title = click.style(f"💬 [Dr. Claw] {project_name}", bold=True, fg="cyan")
    lines = [title]
    lines.append(f"🎬 {click.style(ctx.t('action'), bold=True)}: {click.style(action, fg='yellow')}")
    lines.append(f"{emoji} {click.style(ctx.t('provider'), bold=True)}: {click.style(provider, fg='green')}")
    if session_id:
        lines.append(f"🆔 {click.style(ctx.t('session'), bold=True)}: {click.style(session_id, fg='bright_black')}")
    
    if reply:
        lines.append(f"📝 {click.style(ctx.t('reply'), bold=True)}: \n{click.style('> ', fg='bright_black')}{reply}")
    else:
        lines.append(f"📝 {click.style(ctx.t('reply'), bold=True)}: {click.style(ctx.t('empty'), italic=True, fg='bright_black')}")
    return "\n".join(lines)



def _compact_waiting_sessions(sessions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = []
    for session in sessions:
        rows.append(
            {
                "project": session.get("project"),
                "project_display_name": session.get("project_display_name") or session.get("project"),
                "provider": session.get("provider"),
                "session_id": session.get("session_id"),
                "summary": session.get("summary") or "",
                "status": session.get("status") or "waiting_for_response",
                "is_processing": bool(session.get("is_processing", True)),
                "last_activity": session.get("last_activity") or "",
            }
        )
    return rows


def _build_artifact_brief(data: Dict[str, Any]) -> Dict[str, Any]:
    artifacts = data.get("artifacts") or []
    latest = data.get("latestArtifact") or {}
    categories = sorted({artifact.get("category") for artifact in artifacts if artifact.get("category")})
    return {
        "project": data.get("projectName"),
        "project_path": data.get("projectPath"),
        "latest_artifact": latest.get("relativePath"),
        "latest_modified": latest.get("modified"),
        "artifact_count": data.get("totalArtifacts", len(artifacts)),
        "categories": categories,
        "artifacts": [
            {
                "path": artifact.get("relativePath"),
                "category": artifact.get("category"),
                "modified": artifact.get("modified"),
            }
            for artifact in artifacts
        ],
    }


def _build_project_digest(project: Dict[str, Any], summary: Dict[str, Any], waiting: List[Dict[str, Any]], artifacts: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "project": project.get("name"),
        "project_display_name": _project_label(project),
        "project_path": project.get("fullPath") or project.get("path") or "",
        "status": summary.get("status"),
        "counts": summary.get("counts") or {},
        "next_task": summary.get("next_task") or {},
        "guidance": summary.get("guidance") or {},
        "waiting": _compact_waiting_sessions(waiting),
        "artifacts": _build_artifact_brief(artifacts),
        "updated_at": summary.get("updated_at"),
    }



def _project_progress_payload(ctx: Context, project_ref: str) -> Dict[str, Any]:
    project = _resolve_project_ref(ctx.client, project_ref)
    project_name = _require_project_name(project, project_ref)
    summary = taskmaster_mod.build_summary(ctx.client, project_name)
    latest = projects_mod.get_project_latest_message(ctx.client, project)
    payload = {
        "project": project.get("name"),
        "project_display_name": _project_label(project),
        "project_path": project.get("fullPath") or project.get("path") or "",
        "status": summary.get("status"),
        "counts": summary.get("counts") or {},
        "next_task": summary.get("next_task") or {},
        "guidance": summary.get("guidance") or {},
        "updated_at": summary.get("updated_at"),
        "latest_session": latest.get("session"),
    }
    return payload



def _progress_brief(payload: Dict[str, Any]) -> Dict[str, Any]:
    counts = payload.get("counts") or {}
    latest = payload.get("latest_session") or {}
    return {
        "project": payload.get("project"),
        "project_display_name": payload.get("project_display_name"),
        "project_path": payload.get("project_path"),
        "status": payload.get("status"),
        "counts": counts,
        "latest_session": latest,
        "updated_at": payload.get("updated_at"),
    }


def _recommend_project_attention(payload: Dict[str, Any], waiting_rows: List[Dict[str, Any]], lang: str = "en") -> Dict[str, Any]:
    counts = payload.get("counts") or {}
    latest = payload.get("latest_session") or {}
    waiting_for_project = [
        row for row in waiting_rows
        if row.get("project") == payload.get("project")
        or row.get("project_display_name") == payload.get("project_display_name")
    ]

    t = lambda key: _TRANSLATIONS.get(lang, _TRANSLATIONS["en"]).get(key, key)

    priority = "low"
    action = "monitor"
    reason = "No urgent signal detected."
    suggested_reply = ""

    assistant_text = str(latest.get("last_assistant_message") or "").strip()
    has_questions = any(token in assistant_text for token in ["?", "？", "Clarifying Questions", "澄清", "问题"])

    if waiting_for_project:
        priority = "high"
        action = "reply"
        reason = f"Project has {len(waiting_for_project)} waiting session(s) that need input."
        if has_questions:
            suggested_reply = t("suggest_answer_questions")
        else:
            suggested_reply = t("suggest_continue_task")
    elif counts.get("blocked", 0):
        priority = "high"
        action = "unblock"
        reason = f"Project has {counts.get('blocked', 0)} blocked task(s)."
        suggested_reply = t("suggest_unblock")
    elif counts.get("in_progress", 0):
        priority = "medium"
        action = "check_progress"
        reason = f"Project has {counts.get('in_progress', 0)} in-progress task(s)."
        suggested_reply = t("suggest_summarize_progress")
    elif counts.get("total", 0) == 0 and latest:
        priority = "medium"
        action = "plan"
        reason = "Project has active discussion context but no formal task pipeline yet."
        suggested_reply = t("suggest_converge_plan")
    elif counts.get("pending", 0):
        priority = "medium"
        action = "start_next"
        reason = f"Project has {counts.get('pending', 0)} pending task(s) ready to start."
        suggested_reply = t("suggest_start_next")

    return {
        "project": payload.get("project"),
        "project_display_name": payload.get("project_display_name"),
        "priority": priority,
        "action": action,
        "reason": reason,
        "session_id": waiting_for_project[0].get("session_id") if waiting_for_project else latest.get("session_id"),
        "suggested_reply": suggested_reply,
    }


def _build_portfolio_digest(items: List[Dict[str, Any]], waiting_rows: List[Dict[str, Any]], lang: str = "en") -> Dict[str, Any]:
    briefs = [_progress_brief(item) for item in items]
    recommendations = [_recommend_project_attention(item, waiting_rows, lang=lang) for item in items]
    priority_rank = {"high": 0, "medium": 1, "low": 2}
    recommendations.sort(key=lambda row: (priority_rank.get(row.get("priority"), 9), str(row.get("project_display_name") or "")))
    return {
        "projects": briefs,
        "recommendations": recommendations,
        "summary": {
            "project_count": len(briefs),
            "waiting_sessions": len(waiting_rows),
            "tasks_total": sum((item.get("counts") or {}).get("total", 0) for item in items),
            "tasks_completed": sum((item.get("counts") or {}).get("completed", 0) for item in items),
            "high_priority_projects": sum(1 for row in recommendations if row.get("priority") == "high"),
            "medium_priority_projects": sum(1 for row in recommendations if row.get("priority") == "medium"),
        },
    }


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _infer_reply_kind(reply: str) -> str:
    text = _clean_text(reply)
    if not text:
        return "empty"
    lowered = text.lower()
    if any(token in text for token in ["?", "？", "请确认", "请选择", "需要你", "请决定"]):
        return "question"
    if any(token in lowered for token in ["blocked", "error", "failed"]) or any(token in text for token in ["阻塞", "失败", "报错"]):
        return "blocker"
    if any(token in lowered for token in ["done", "completed", "finished"]) or any(token in text for token in ["完成", "已完成"]):
        return "completion"
    return "update"


def _extract_bullets(text: str, limit: int = 3) -> List[str]:
    rows: List[str] = []
    for line in str(text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith(("- ", "* ", "• ")):
            rows.append(line[2:].strip())
        elif len(rows) == 0:
            rows.append(line)
        if len(rows) >= limit:
            break
    return rows


def _build_mobile_actions(project_name: str, session_id: Optional[str], provider: Optional[str], reply_kind: str) -> List[Dict[str, Any]]:
    project_ref = project_name or ""
    actions: List[Dict[str, Any]] = []
    if session_id:
        actions.append(
            {
                "id": "reply",
                "label": "Reply",
                "kind": "command",
                "command": f'{_PRIMARY_CLI_NAME} --json chat reply --project "{project_ref}" --session {session_id} --provider {provider or "claude"} -m "<message>"',
            }
        )
        actions.append(
            {
                "id": "resume",
                "label": "Resume",
                "kind": "command",
                "command": f'{_PRIMARY_CLI_NAME} --json workflow resume --project "{project_ref}" --session {session_id} --provider {provider or "claude"}',
            }
        )
    if reply_kind == "blocker":
        actions.append(
            {
                "id": "status",
                "label": "Check Status",
                "kind": "command",
                "command": f'{_PRIMARY_CLI_NAME} --json workflow status --project "{project_ref}"',
            }
        )
    return actions


def _build_openclaw_turn_schema(
    *,
    project: Dict[str, Any],
    provider: str,
    session_id: str,
    reply: str,
    action: str,
    waiting_rows: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    clean_reply = _clean_text(reply)
    reply_kind = _infer_reply_kind(clean_reply)
    waiting = waiting_rows or []
    decision_needed = reply_kind in {"question", "blocker"} or any(not row.get("is_processing", True) for row in waiting)
    summary = _extract_bullets(clean_reply, limit=3)
    project_name = project.get("name") or project.get("fullPath") or project.get("path") or ""
    display_name = _project_label(project)
    schema = {
        "schema_version": "openclaw.turn.v1",
        "kind": "session_turn",
        "project": {
            "ref": project_name,
            "display_name": display_name,
            "path": project.get("fullPath") or project.get("path") or "",
        },
        "session": {
            "id": session_id or "",
            "provider": provider or "claude",
            "state": "processing" if waiting else "idle",
        },
        "turn": {
            "action": action,
            "reply_text": clean_reply,
            "reply_kind": reply_kind,
            "summary": summary,
        },
        "decision": {
            "needed": decision_needed,
            "reason": "assistant_requested_input" if reply_kind == "question" else ("blocker_detected" if reply_kind == "blocker" else None),
        },
        "next_actions": _build_mobile_actions(project_name, session_id, provider, reply_kind),
        "waiting_sessions": _compact_waiting_sessions(waiting),
    }
    return schema


def _build_openclaw_project_schema(payload: Dict[str, Any]) -> Dict[str, Any]:
    counts = payload.get("counts") or {}
    waiting = payload.get("waiting") or []
    next_task = payload.get("next_task") or {}
    guidance = payload.get("guidance") or {}
    blocked = counts.get("blocked", 0)
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
        "next_task": next_task,
        "guidance": guidance,
        "waiting_sessions": _compact_waiting_sessions(waiting),
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
                "command": f'{_PRIMARY_CLI_NAME} --json workflow status --project "{payload.get("project") or payload.get("project_path") or ""}"',
            },
            {
                "id": "report",
                "label": "Push Report",
                "kind": "command",
                "command": f'{_PRIMARY_CLI_NAME} --json openclaw report --project "{payload.get("project") or payload.get("project_path") or ""}" --dry-run',
            },
        ],
    }


def _build_openclaw_portfolio_schema(payload: Dict[str, Any]) -> Dict[str, Any]:
    recommendations = payload.get("recommendations") or []
    projects = payload.get("projects") or []
    focus = recommendations[:5]
    return {
        "schema_version": "openclaw.portfolio.v1",
        "kind": "portfolio_digest",
        "summary": payload.get("summary") or {},
        "projects": projects,
        "focus": focus,
        "decision": {
            "needed": any(row.get("priority") == "high" for row in focus),
            "reason": "high_priority_projects_present" if any(row.get("priority") == "high" for row in focus) else None,
        },
        "next_actions": [
            {
                "id": "inbox",
                "label": "Check Inbox",
                "kind": "command",
                "command": f"{_PRIMARY_CLI_NAME} --json chat waiting",
            }
        ],
    }


def _build_openclaw_event_schema(event: Dict[str, Any], portfolio_event: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    event_type = str(event.get("type") or "unknown")
    mapped_kind = "info"
    if event_type == "claude-permission-request":
        mapped_kind = "human_decision_needed"
    elif event_type in {"taskmaster-project-updated", "taskmaster-tasks-updated", "projects_updated"}:
        mapped_kind = "project_updated"
    elif event_type == "session-aborted":
        mapped_kind = "session_aborted"

    return {
        "schema_version": "openclaw.event.v1",
        "kind": "event",
        "event": {
            "type": event_type,
            "mapped_kind": mapped_kind,
            "project": event.get("project"),
            "provider": event.get("provider"),
            "session_id": event.get("session_id"),
            "timestamp": event.get("timestamp"),
            "details": event,
        },
        "portfolio_event": portfolio_event,
    }


def _format_portfolio_digest(payload: Dict[str, Any]) -> str:
    summary = payload.get("summary") or {}
    recommendations = payload.get("recommendations") or []
    projects = payload.get("projects") or []

    header = click.style("📋 [Dr. Claw Portfolio Digest]", bold=True, fg="cyan")
    lines = [header]
    
    stats_line = (
        f"{click.style('Projects:', bold=True)} {summary.get('project_count', 0)} | "
        f"{click.style('Waiting:', bold=True)} {summary.get('waiting_sessions', 0)} | "
        f"{click.style('Tasks:', bold=True)} {summary.get('tasks_completed', 0)}/{summary.get('tasks_total', 0)} done"
    )
    lines.append(stats_line)
    
    attn_line = (
        f"{click.style('Attention:', bold=True)} "
        f"{click.style('high', fg='red')} {summary.get('high_priority_projects', 0)} | "
        f"{click.style('medium', fg='yellow')} {summary.get('medium_priority_projects', 0)}"
    )
    lines.append(attn_line)

    if recommendations:
        lines.append(f"\n{click.style('🎯 Focus:', bold=True)}")
        for row in recommendations[:5]:
            priority = row.get('priority', 'low')
            p_color = "red" if priority == "high" else ("yellow" if priority == "medium" else "bright_black")
            
            p_label = click.style(f"[{priority.upper()}]", fg=p_color, bold=True)
            proj_name = click.style(row.get('project_display_name', 'unknown'), fg="cyan")
            segment = f"{p_label} {proj_name}: {row.get('reason')}"
            
            if row.get("session_id"):
                session_info = click.style(f"session={row['session_id']}", fg="bright_black")
                segment += f" {session_info}"
            lines.append(segment)
            if row.get("suggested_reply"):
                lines.append(f"  {click.style('↳', fg='bright_black')} {click.style(row['suggested_reply'], italic=True, fg='green')}")

    if projects:
        lines.append(f"\n{click.style('📈 Progress:', bold=True)}")
        for item in projects[:8]:
            counts = item.get("counts") or {}
            rate = int(counts.get('completion_rate', 0)) if counts.get('completion_rate') is not None else 0
            if counts.get('total') and not rate:
                rate = int(counts.get('completed', 0) * 100 / counts['total'])
            
            bar = _make_progress_bar(rate, length=5)
            name = click.style(f"{item.get('project_display_name'):<20}", fg="cyan")
            status = item.get('status', 'unknown')
            s_color, s_emoji = _get_status_style(status)
            
            counts_str = click.style(f"{counts.get('completed', 0)}/{counts.get('total', 0)}", fg="bright_black")
            status_str = click.style(status, fg=s_color)
            lines.append(f"{s_emoji} {name} {bar} {counts_str} {status_str}")
    return "\n".join(lines)

def _format_project_progress(payload: Dict[str, Any]) -> str:
    counts = payload.get("counts") or {}
    next_task = payload.get("next_task") or {}
    latest = payload.get("latest_session") or {}

    title = click.style(f"🚀 [Dr. Claw Project Progress] {payload.get('project_display_name') or payload.get('project')}", bold=True, fg="cyan")
    lines = [title]
    
    status = payload.get('status') or 'unknown'
    s_color, s_emoji = _get_status_style(status)
    lines.append(f"{s_emoji} {click.style('Status:', bold=True)} {click.style(status, fg=s_color)}")
    
    done = counts.get('completed', 0)
    total = counts.get('total', 0)
    rate = int(counts.get('completion_rate', 0)) if counts.get('completion_rate') is not None else 0
    if total and not rate:
        rate = int(done * 100 / total)
        
    bar = _make_progress_bar(rate)
    progress_str = click.style(f"{done}/{total} done", fg="bright_black")
    lines.append(
        f"📊 {click.style('Progress:', bold=True)} {bar} {progress_str} | "
        f"{click.style('in-progress', fg='blue')} {counts.get('in_progress', 0)} | "
        f"{click.style('pending', fg='bright_black')} {counts.get('pending', 0)} | "
        f"{click.style('blocked', fg='red')} {counts.get('blocked', 0)}"
    )
    
    if next_task:
        task_id_str = click.style(f"#{next_task.get('id', '?')}", fg="yellow")
        lines.append(f"⏩ {click.style('Next:', bold=True)} {task_id_str} {next_task.get('title') or 'Untitled task'}")
    
    if latest:
        p_emojis = {"claude": "🎭", "cursor": "🛰️", "codex": "🔮", "gemini": "♊"}
        p_emoji = p_emojis.get(str(latest.get('provider')).lower(), "🤖")
        lines.append(f"{p_emoji} {click.style('Latest session:', bold=True)} {click.style(latest.get('provider', 'unknown'), fg='green')} {click.style(latest.get('session_id', ''), fg='bright_black')}")
        
        msg = latest.get('last_assistant_message') or latest.get('last_user_message')
        prefix = "Assistant" if latest.get('last_assistant_message') else "User"
        if msg:
            lines.append(f"   {click.style(f'{prefix}:', bold=True)} {click.style(_truncate_text(msg, 220), italic=True, fg='bright_black')}")
            
    if payload.get("updated_at"):
        lines.append(f"🕒 {click.style('Updated:', bold=True)} {click.style(payload['updated_at'], fg='bright_black')}")
    
    return "\n".join(lines)

def _build_daily_digest(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    waiting_total = sum(len(item.get("waiting") or []) for item in items)
    task_total = sum((item.get("counts") or {}).get("total", 0) for item in items)
    completed_total = sum((item.get("counts") or {}).get("completed", 0) for item in items)
    return {
        "projects": items,
        "summary": {
            "project_count": len(items),
            "waiting_sessions": waiting_total,
            "tasks_total": task_total,
            "tasks_completed": completed_total,
        },
    }


def _format_project_digest(payload: Dict[str, Any]) -> str:
    counts = payload.get("counts") or {}
    next_task = payload.get("next_task") or {}
    waiting = payload.get("waiting") or []
    artifact_info = payload.get("artifacts") or {}

    title = click.style(f"📑 [Dr. Claw Digest] {payload.get('project_display_name') or payload.get('project')}", bold=True, fg="cyan")
    lines = [title]
    
    status = payload.get('status') or 'unknown'
    s_color, s_emoji = _get_status_style(status)
    lines.append(f"{s_emoji} {click.style('Status:', bold=True)} {click.style(status, fg=s_color)}")
    
    done = counts.get('completed', 0)
    total = counts.get('total', 0)
    rate = int(counts.get('completion_rate', 0)) if counts.get('completion_rate') is not None else 0
    if total and not rate:
        rate = int(done * 100 / total)
    bar = _make_progress_bar(rate)
    progress_str = click.style(f"{done}/{total} done", fg="bright_black")
    
    lines.append(
        f"📊 {click.style('Progress:', bold=True)} {bar} {progress_str} | "
        f"{click.style('in-progress', fg='blue')} {counts.get('in_progress', 0)} | "
        f"{click.style('blocked', fg='red')} {counts.get('blocked', 0)}"
    )
    
    if next_task:
        task_id_str = click.style(f"#{next_task.get('id', '?')}", fg="yellow")
        lines.append(f"⏩ {click.style('Next:', bold=True)} {task_id_str} {next_task.get('title') or 'Untitled task'}")
    
    w_color = "yellow" if waiting else "bright_black"
    lines.append(f"⏳ {click.style('Waiting:', bold=True)} {click.style(f'{len(waiting)} session(s)', fg=w_color)}")
    
    if waiting:
        first = waiting[0]
        lines.append(
            f"   {click.style('↳ Top:', bold=True)} {click.style(first.get('provider', 'unknown'), fg='green')} "
            f"{click.style(first.get('session_id', ''), fg='bright_black')} {click.style(_truncate_text(first.get('summary'), 100), italic=True)}"
        )
        
    if artifact_info.get("latest_artifact"):
        lines.append(f"📦 {click.style('Latest artifact:', bold=True)} {click.style(artifact_info['latest_artifact'], fg='magenta')}")
        
    if payload.get("updated_at"):
        lines.append(f"🕒 {click.style('Updated:', bold=True)} {click.style(payload['updated_at'], fg='bright_black')}")
        
    return "\n".join(lines)


def _format_daily_digest(payload: Dict[str, Any]) -> str:
    summary = payload.get("summary") or {}
    items = payload.get("projects") or []
    
    header = click.style("📅 [Dr. Claw Daily Digest]", bold=True, fg="cyan")
    lines = [header]
    
    stats = (
        f"{click.style('Projects:', bold=True)} {summary.get('project_count', 0)} | "
        f"{click.style('Waiting:', bold=True)} {summary.get('waiting_sessions', 0)} | "
        f"{click.style('Tasks:', bold=True)} {summary.get('tasks_completed', 0)}/{summary.get('tasks_total', 0)} done"
    )
    lines.append(stats)
    lines.append("") # Spacer
    
    for item in items[:10]:
        counts = item.get("counts") or {}
        done = counts.get('completed', 0)
        total = counts.get('total', 0)
        rate = int(done * 100 / total) if total else 0
        bar = _make_progress_bar(rate, length=5)
        
        waiting_count = len(item.get('waiting') or [])
        w_str = f"waiting {waiting_count}"
        if waiting_count > 0:
            w_str = click.style(w_str, fg="yellow", bold=True)
        else:
            w_str = click.style(w_str, fg="bright_black")
            
        name = click.style(f"{item.get('project_display_name'):<20}", fg="cyan")
        progress_str = click.style(f"{done}/{total}", fg="bright_black")
        lines.append(f"- {name} {bar} {progress_str} | {w_str}")
    return "\n".join(lines)


def _maybe_send_openclaw_chat_notification(
    ctx: Context,
    payload: Dict[str, Any],
    action: str,
    notify_openclaw: bool,
    notify_channel: Optional[str],
) -> Dict[str, Any]:
    if not notify_openclaw and not notify_channel:
        return {"enabled": False, "sent": False, "channel": None, "message": ""}

    resolved_channel = _resolve_push_channel(notify_channel)
    if not resolved_channel:
        raise ValueError(
            "OpenClaw notification requested, but no channel is configured. Use --notify-to <channel> or run `drclaw openclaw configure --push-channel <channel>` first."
        )

    message_text = _build_openclaw_chat_notification(payload, action, ctx)
    cmd_output = _send_openclaw_message(message_text, resolved_channel)
    return {
        "enabled": True,
        "sent": True,
        "channel": resolved_channel,
        "message": message_text,
        "output": cmd_output,
    }


@click.group(invoke_without_command=True)
@click.option("--json", "json_mode", is_flag=True, default=False, help="Output results as JSON.")
@click.option("--url", "url_override", default=None, metavar="URL", help="Override the Dr. Claw server URL.")
@click.option("--lang", "lang", default=None, help="Language for output (en, zh). Defaults to en or DRCLAW_LANG.")
@click.pass_context
def cli(ctx: click.Context, json_mode: bool, url_override: Optional[str], lang: Optional[str]) -> None:
    """Dr. Claw CLI harness - manage projects, sessions, workflows, and OpenClaw integration."""
    effective_lang = lang or os.environ.get("DRCLAW_LANG") or "en"
    client = DrClaw(url_override=url_override)
    ctx.obj = Context(json_mode=json_mode, client=client, lang=effective_lang)
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


def vibelab_cli():
    """Alias for drclaw with a deprecation warning."""
    warnings.warn(
        "The 'vibelab' command is deprecated and will be removed in a future version. "
        "Please use 'drclaw' instead.",
        DeprecationWarning,
        stacklevel=1
    )
    # Print warning to stderr as well since DeprecationWarning is often filtered
    print("Warning: 'vibelab' command is deprecated; use 'drclaw' instead.", file=sys.stderr)
    cli()


@cli.group("openclaw-watch")
def openclaw_watch() -> None:
    """Background OpenClaw watcher daemon management."""


@openclaw_watch.command("on")
@click.option("--to", "channel", default=None, metavar="CHANNEL", help="Destination channel. Falls back to configured default channel.")
@click.option("--interval", default=30, show_default=True, type=int, metavar="SECONDS", help="Polling interval for portfolio checks.")
@click.option("--drclaw-bin", default=None, metavar="PATH", help="CLI binary used by the watcher subprocess.")
@pass_context
def openclaw_watch_on(ctx: Context, channel: Optional[str], interval: int, drclaw_bin: Optional[str]) -> None:
    """Start the OpenClaw watcher daemon."""
    try:
        resolved_channel = _resolve_push_channel(channel)
        if not resolved_channel:
            raise ValueError("No channel specified. Use --to <channel> or run `drclaw openclaw configure --push-channel <channel>` first.")
        payload = openclaw_daemon_mod.watcher_start(
            channel=resolved_channel,
            interval=interval,
            drclaw_bin=drclaw_bin or _resolve_current_drclaw_bin(),
            base_url=ctx.client.get_base_url(),
        )
        if ctx.json_mode:
            output(payload, json_mode=True)
        else:
            success(f"OpenClaw watcher started (PID {payload['pid']}).", json_mode=False)
            info(f"  log   : {payload['log_file']}")
            info(f"  state : {payload['state_file']}")
            info(f"  every : {payload['interval']}s")
            info(f"  to    : {resolved_channel}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@openclaw_watch.command("off")
@pass_context
def openclaw_watch_off(ctx: Context) -> None:
    """Stop the OpenClaw watcher daemon."""
    try:
        payload = openclaw_daemon_mod.watcher_stop()
        if ctx.json_mode:
            output(payload, json_mode=True)
        elif payload.get("stopped"):
            success(payload["message"], json_mode=False)
        else:
            info(payload["message"])
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@openclaw_watch.command("status")
@click.option("--logs", "show_logs", is_flag=True, default=False, help="Print the last 20 lines of the watcher log.")
@pass_context
def openclaw_watch_status(ctx: Context, show_logs: bool) -> None:
    """Show watcher daemon status."""
    try:
        payload = openclaw_daemon_mod.watcher_status()
        if ctx.json_mode:
            output(payload, json_mode=True)
            return
        state = "RUNNING" if payload.get("running") else "STOPPED"
        state_text = click.style(state, fg="green" if payload.get("running") else "red", bold=True)
        click.echo(f"  status : {state_text}")
        if payload.get("pid"):
            click.echo(f"  pid    : {payload['pid']}")
        click.echo(f"  logs   : {payload['log_file']}")
        click.echo(f"  state  : {payload['state_file']}")
        if payload.get("state", {}).get("last_run_at"):
            click.echo(f"  last   : {payload['state']['last_run_at']}")
        if show_logs and payload.get("log_tail"):
            click.echo("\n--- last 20 log lines ---")
            click.echo(payload["log_tail"])
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@cli.group()
def auth() -> None:
    """Authentication commands."""


@auth.command("login")
@click.option("--username", "-u", prompt="Username", help="DrClaw username.")
@click.option("--password", "-p", prompt="Password", hide_input=True, help="DrClaw password.")
@pass_context
def auth_login(ctx: Context, username: str, password: str) -> None:
    """Log in and store the JWT token locally."""
    try:
        data = ctx.client.login(username, password)
        user = data.get("user", {})
        success(
            f"Logged in as '{user.get('username', username)}'. Token stored in {SESSION_FILE}",
            json_mode=ctx.json_mode,
        )
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@auth.command("logout")
@pass_context
def auth_logout(ctx: Context) -> None:
    """Remove the local session file (token is not revoked server-side)."""
    ctx.client.logout()
    success("Logged out. Session file removed.", json_mode=ctx.json_mode)


@auth.command("status")
@pass_context
def auth_status(ctx: Context) -> None:
    """Check whether the server needs initial setup."""
    try:
        resp = ctx.client.get_unauthenticated("/api/auth/status")
        data = resp.json()
        data["has_local_token"] = ctx.client.get_token() is not None
        output(data, json_mode=ctx.json_mode, title="Auth Status")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@cli.group()
def projects() -> None:
    """Project management commands."""


@projects.command("list")
@pass_context
def projects_list(ctx: Context) -> None:
    """List all projects."""
    try:
        items = projects_mod.list_projects(ctx.client)
        if ctx.json_mode:
            output(items, json_mode=True)
        else:
            output(_project_rows(items), json_mode=False, title="Projects")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@projects.command("add")
@click.argument("project_path")
@click.option("--name", "display_name", default=None, metavar="DISPLAY_NAME", help="Optional display name to save for the project.")
@pass_context
def projects_add(ctx: Context, project_path: str, display_name: Optional[str]) -> None:
    """Register PROJECT_PATH as a DrClaw project."""
    try:
        project = projects_mod.add_project_manual(
            ctx.client,
            _normalize_path(project_path),
            display_name=display_name,
        )
        if ctx.json_mode:
            output(project, json_mode=True)
        else:
            success(f"Project '{_project_label(project)}' added.", json_mode=False)
            info(f"  name : {project.get('name', '')}")
            info(f"  path : {project.get('fullPath') or project.get('path') or ''}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@projects.command("create")
@click.argument("workspace_path")
@click.option("--name", "display_name", default=None, metavar="DISPLAY_NAME", help="Optional display name to save for the project.")
@click.option("--github-url", default=None, metavar="URL", help="Optional GitHub repository URL to clone into the new workspace.")
@pass_context
def projects_create(ctx: Context, workspace_path: str, display_name: Optional[str], github_url: Optional[str]) -> None:
    """Create WORKSPACE_PATH as a new DrClaw project workspace."""
    try:
        project = projects_mod.create_project_workspace(
            ctx.client,
            _normalize_path(workspace_path),
            display_name=display_name,
            github_url=github_url,
        )
        if ctx.json_mode:
            output(project, json_mode=True)
        else:
            success(f"Project '{_project_label(project)}' created.", json_mode=False)
            info(f"  name : {project.get('name', '')}")
            info(f"  path : {project.get('fullPath') or project.get('path') or ''}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


def _process_attachments(attachments: List[str]) -> List[Dict[str, str]]:
    processed = []
    for path in attachments:
        p = Path(path).expanduser()
        if not p.exists():
            error(f"Attachment not found: {path}")
            sys.exit(1)
        
        mime_type, _ = mimetypes.guess_type(str(p))
        if not mime_type:
            mime_type = "application/octet-stream"
            
        with open(p, "rb") as f:
            data = f.read()
            b64_data = base64.b64encode(data).decode("utf-8")
            processed.append({
                "name": p.name,
                "data": f"data:{mime_type};base64,{b64_data}"
            })
    return processed

@projects.command("idea")
@click.argument("workspace_path")
@click.option("--name", "display_name", default=None, metavar="DISPLAY_NAME", help="Optional display name to save for the project.")
@click.option("--idea", required=True, metavar="TEXT", help="Initial idea to seed into the new project.")
@click.option("--provider", type=click.Choice(_PROVIDER_CHOICES, case_sensitive=False), default="claude", show_default=True, help="Provider used to start the seeded discussion.")
@click.option("--timeout", type=int, default=None, metavar="SECONDS", help="Wait timeout. If omitted, waits indefinitely with heartbeat.")
@click.option("--attach", "attachments", multiple=True, help="Path to a file or image to attach. Repeat for multiple attachments.")
@pass_context
def projects_idea(
    ctx: Context,
    workspace_path: str,
    display_name: Optional[str],
    idea: str,
    provider: str,
    timeout: Optional[int],
    attachments: List[str],
) -> None:
    """Create a new project and seed it with an initial idea discussion."""
    try:
        processed_attachments = _process_attachments(attachments) if attachments else None
        result = projects_mod.create_idea_project(
            ctx.client,
            _normalize_path(workspace_path),
            display_name=display_name,
            idea=idea,
            provider=_normalize_provider(provider) or "claude",
            timeout=timeout,
            attachments=processed_attachments,
        )
        if ctx.json_mode:
            output(result, json_mode=True)
        else:
            project = result.get("project") or {}
            success(f"Project '{_project_label(project)}' created and seeded.", json_mode=False)
            info(f"  name    : {project.get('name', '')}")
            info(f"  path    : {project.get('fullPath') or project.get('path') or ''}")
            chat = result.get("chat") or {}
            session_id = chat.get("session_id") or chat.get("sessionId") or ""
            if session_id:
                info(f"  session : {session_id}")
            reply = str(chat.get("reply") or "").strip()
            if reply:
                info("\nInitial reply:")
                click.echo(reply)
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)

@projects.command("latest")
@click.argument("project_ref")
@click.option("--provider", type=click.Choice(_PROVIDER_CHOICES, case_sensitive=False), default=None, help="Optional provider filter.")
@pass_context
def projects_latest(ctx: Context, project_ref: str, provider: Optional[str]) -> None:
    """Show the latest known message snapshot for PROJECT_REF."""
    try:
        project = _resolve_project_ref(ctx.client, project_ref)
        payload = projects_mod.get_project_latest_message(
            ctx.client,
            project,
            provider=_normalize_provider(provider),
        )
        output(payload, json_mode=ctx.json_mode, title=f"Latest Message: {_project_label(project)}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@projects.command("progress")
@click.argument("project_ref")
@pass_context
def projects_progress(ctx: Context, project_ref: str) -> None:
    """Show project completion progress and latest session context."""
    try:
        payload = _project_progress_payload(ctx, project_ref)
        if ctx.json_mode:
            output(payload, json_mode=True)
        else:
            click.echo(_format_project_progress(payload))
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)

@projects.command("rename")
@click.argument("project_ref")
@click.argument("new_name")
@pass_context
def projects_rename(ctx: Context, project_ref: str, new_name: str) -> None:
    """Rename PROJECT_REF to NEW_NAME."""
    try:
        project = _resolve_project_ref(ctx.client, project_ref)
        project_name = _require_project_name(project, project_ref)
        projects_mod.rename_project(ctx.client, project_name, new_name)
        success(
            f"Project '{_project_label(project)}' renamed to '{new_name}'.",
            json_mode=ctx.json_mode,
        )
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@projects.command("delete")
@click.argument("project_ref")
@click.confirmation_option(prompt="Are you sure you want to delete this project?")
@pass_context
def projects_delete(ctx: Context, project_ref: str) -> None:
    """Delete PROJECT_REF."""
    try:
        project = _resolve_project_ref(ctx.client, project_ref)
        project_name = _require_project_name(project, project_ref)
        projects_mod.delete_project(ctx.client, project_name)
        success(f"Project '{_project_label(project)}' deleted.", json_mode=ctx.json_mode)
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@cli.group()
def sessions() -> None:
    """Conversation session commands."""


@sessions.command("list")
@click.argument("project_ref")
@click.option("--provider", type=click.Choice(_PROVIDER_CHOICES, case_sensitive=False), default="claude", show_default=True, help="Session provider to list.")
@click.option("--limit", type=int, default=20, show_default=True, metavar="N", help="Maximum number of sessions to fetch.")
@click.option("--offset", type=int, default=0, show_default=True, metavar="N", help="Number of newest sessions to skip.")
@pass_context
def sessions_list(ctx: Context, project_ref: str, provider: str, limit: int, offset: int) -> None:
    """List sessions for PROJECT_REF."""
    try:
        normalized_provider = _normalize_provider(provider) or "claude"
        project = _resolve_project_ref(ctx.client, project_ref)
        project_name = _require_project_name(project, project_ref)

        if normalized_provider == "claude":
            page = conversations_mod.list_sessions(
                ctx.client,
                project_name,
                limit=limit,
                offset=offset,
                include_meta=True,
            )
        else:
            page = _list_provider_sessions_from_project(project, normalized_provider, limit=limit, offset=offset)

        title = f"Sessions for {_project_label(project)} ({normalized_provider})"
        _emit_collection(ctx, page, "sessions", title)
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@sessions.command("messages")
@click.argument("project_ref")
@click.argument("session_id")
@click.option("--provider", type=click.Choice(_PROVIDER_CHOICES, case_sensitive=False), default=None, help="Session provider for message lookup.")
@click.option("--limit", type=int, default=None, metavar="N", help="Maximum number of messages to fetch. Omit to fetch all available messages.")
@click.option("--offset", type=int, default=0, show_default=True, metavar="N", help="Number of newest messages to skip when pagination is enabled.")
@pass_context
def sessions_messages(
    ctx: Context,
    project_ref: str,
    session_id: str,
    provider: Optional[str],
    limit: Optional[int],
    offset: int,
) -> None:
    """Get messages for SESSION_ID within PROJECT_REF."""
    try:
        normalized_provider = _normalize_provider(provider)
        project = _resolve_project_ref(ctx.client, project_ref)
        project_name = _require_project_name(project, project_ref)
        page = conversations_mod.get_session_messages(
            ctx.client,
            project_name,
            session_id,
            limit=limit,
            offset=offset,
            provider=normalized_provider,
            include_meta=True,
        )
        title = f"Messages for {session_id} in {_project_label(project)}"
        _emit_collection(ctx, page, "messages", title)
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@cli.group()
def taskmaster() -> None:
    """TaskMaster / pipeline status commands."""


@taskmaster.command("status")
@pass_context
def taskmaster_status(ctx: Context) -> None:
    """Show global TaskMaster installation status."""
    try:
        data = taskmaster_mod.get_installation_status(ctx.client)
        output(data, json_mode=ctx.json_mode, title="TaskMaster Status")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@taskmaster.command("detect")
@click.argument("project_ref")
@pass_context
def taskmaster_detect(ctx: Context, project_ref: str) -> None:
    """Detect TaskMaster configuration for PROJECT_REF."""
    try:
        project = _resolve_project_ref(ctx.client, project_ref)
        project_name = _require_project_name(project, project_ref)
        data = taskmaster_mod.detect_taskmaster(ctx.client, project_name)
        output(data, json_mode=ctx.json_mode, title=f"TaskMaster detect: {_project_label(project)}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@taskmaster.command("detect-all")
@pass_context
def taskmaster_detect_all(ctx: Context) -> None:
    """Detect TaskMaster state for all known projects."""
    try:
        data = taskmaster_mod.detect_all(ctx.client)
        output(data, json_mode=ctx.json_mode, title="TaskMaster Detect All")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@taskmaster.command("init")
@click.argument("project_ref")
@pass_context
def taskmaster_init(ctx: Context, project_ref: str) -> None:
    """Initialize .pipeline files for PROJECT_REF."""
    try:
        project = _resolve_project_ref(ctx.client, project_ref)
        project_name = _require_project_name(project, project_ref)
        data = taskmaster_mod.initialize(ctx.client, project_name)
        if ctx.json_mode:
            output(data, json_mode=True)
        else:
            success(f"TaskMaster initialized for {_project_label(project)}.", json_mode=False)
            info(f"  pipeline : {data.get('pipelinePath', '')}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@taskmaster.command("tasks")
@click.argument("project_ref")
@pass_context
def taskmaster_tasks(ctx: Context, project_ref: str) -> None:
    """List TaskMaster tasks for PROJECT_REF."""
    try:
        project = _resolve_project_ref(ctx.client, project_ref)
        project_name = _require_project_name(project, project_ref)
        data = taskmaster_mod.list_tasks(ctx.client, project_name)
        if ctx.json_mode:
            output(data, json_mode=True)
        else:
            output(data.get("tasks") or [], json_mode=False, title=f"Tasks for {_project_label(project)}")
            counts = data.get("tasksByStatus") or {}
            if counts:
                info(
                    "  "
                    + "  ".join(
                        [
                            f"pending={counts.get('pending', 0)}",
                            f"in-progress={counts.get('in-progress', 0)}",
                            f"done={counts.get('done', 0)}",
                            f"review={counts.get('review', 0)}",
                        ]
                    )
                )
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@taskmaster.command("add-task")
@click.argument("project_ref")
@click.option("--prompt", default=None, metavar="TEXT", help="Prompt used to generate the task title/description.")
@click.option("--title", default=None, metavar="TEXT", help="Explicit task title.")
@click.option("--description", default=None, metavar="TEXT", help="Explicit task description.")
@click.option("--priority", default="high", show_default=True, metavar="LEVEL", help="Task priority.")
@click.option("--stage", default=None, metavar="STAGE", help="Optional workflow stage.")
@click.option("--depends-on", "dependencies", multiple=True, help="Dependency task ID. Repeat for multiple dependencies.")
@pass_context
def taskmaster_add_task(
    ctx: Context,
    project_ref: str,
    prompt: Optional[str],
    title: Optional[str],
    description: Optional[str],
    priority: str,
    stage: Optional[str],
    dependencies: List[str],
) -> None:
    """Add a task to PROJECT_REF."""
    try:
        project = _resolve_project_ref(ctx.client, project_ref)
        project_name = _require_project_name(project, project_ref)
        data = taskmaster_mod.add_task(
            ctx.client,
            project_name,
            prompt=prompt,
            title=title,
            description=description,
            priority=priority,
            dependencies=list(dependencies) or None,
            stage=stage,
        )
        output(data, json_mode=ctx.json_mode, title=f"Task added: {_project_label(project)}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@taskmaster.command("update-task")
@click.argument("project_ref")
@click.argument("task_id")
@click.option("--title", default=None, metavar="TEXT", help="New task title.")
@click.option("--description", default=None, metavar="TEXT", help="New task description.")
@click.option("--status", default=None, metavar="STATUS", help="New task status.")
@click.option("--priority", default=None, metavar="LEVEL", help="New task priority.")
@click.option("--details", default=None, metavar="TEXT", help="Detailed notes.")
@click.option("--test-strategy", default=None, metavar="TEXT", help="Test strategy notes.")
@click.option("--depends-on", "dependencies", multiple=True, help="Dependency task ID. Repeat for multiple dependencies.")
@pass_context
def taskmaster_update_task(
    ctx: Context,
    project_ref: str,
    task_id: str,
    title: Optional[str],
    description: Optional[str],
    status: Optional[str],
    priority: Optional[str],
    details: Optional[str],
    test_strategy: Optional[str],
    dependencies: List[str],
) -> None:
    """Update a workflow task in PROJECT_REF."""
    try:
        project = _resolve_project_ref(ctx.client, project_ref)
        project_name = _require_project_name(project, project_ref)
        data = taskmaster_mod.update_task(
            ctx.client,
            project_name,
            task_id,
            title=title,
            description=description,
            status=status,
            priority=priority,
            details=details,
            testStrategy=test_strategy,
            dependencies=list(dependencies) if dependencies else None,
        )
        output(data, json_mode=ctx.json_mode, title=f"Task updated: {_project_label(project)}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@taskmaster.command("artifacts")
@click.argument("project_ref")
@pass_context
def taskmaster_artifacts(ctx: Context, project_ref: str) -> None:
    """Summarize recent artifacts for PROJECT_REF."""
    try:
        project = _resolve_project_ref(ctx.client, project_ref)
        project_name = _require_project_name(project, project_ref)
        data = taskmaster_mod.get_artifact_summary(ctx.client, project_name)
        brief = _build_artifact_brief(data)
        output(brief if ctx.json_mode else brief.get("artifacts") or [], json_mode=ctx.json_mode, title=f"Artifacts: {_project_label(project)}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@cli.group()
def workflow() -> None:
    """Workflow-oriented control commands for OpenClaw."""


@workflow.command("status")
@click.option("--project", "project_ref", required=True, metavar="PROJECT", help="Project name, display name, or path.")
@click.option("--json", "force_json", is_flag=True, default=False, help="Output results as JSON.")
@pass_context
def workflow_status(ctx: Context, project_ref: str, force_json: bool) -> None:
    """Show workflow status for a project."""
    try:
        if force_json:
            ctx.json_mode = True
        payload = _collect_project_digest(ctx, project_ref)
        payload["openclaw"] = _build_openclaw_project_schema(payload)
        output(payload, json_mode=ctx.json_mode, title=f"Workflow Status: {payload.get('project_display_name')}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@workflow.command("continue")
@click.option("--project", "project_ref", required=True, metavar="PROJECT", help="Project name, display name, or path.")
@click.option("--session", "session_id", required=True, metavar="SESSION_ID", help="Session ID to continue.")
@click.option("--message", "message", "-m", required=True, metavar="TEXT", help="Instruction to continue execution.")
@click.option("--provider", type=click.Choice(_PROVIDER_CHOICES, case_sensitive=False), default=None, help="Override the session's provider.")
@click.option("--timeout", type=int, default=None, metavar="SECONDS", help="Wait timeout. If omitted, waits indefinitely with heartbeat.")
@click.option("--bypass-permissions", is_flag=True, default=False, help="Automatically approve all tool calls.")
@click.option("--attach", "attachments", multiple=True, help="Path to a file or image to attach. Repeat for multiple attachments.")
@click.option("--model", default=None, metavar="MODEL", help="Override the model for this request.")
@click.option("--notify-openclaw", is_flag=True, default=False, help="Send a completion notification to OpenClaw.")
@click.option("--notify-to", "notify_channel", default=None, metavar="CHANNEL", help="Override the OpenClaw channel for this command.")
@click.option("--json", "force_json", is_flag=True, default=False, help="Output results as JSON.")
@pass_context
def workflow_continue(
    ctx: Context,
    project_ref: str,
    session_id: str,
    message: str,
    provider: Optional[str],
    timeout: Optional[int],
    bypass_permissions: bool,
    attachments: List[str],
    model: Optional[str],
    notify_openclaw: bool,
    notify_channel: Optional[str],
    force_json: bool,
) -> None:
    """Continue a workflow by replying to a waiting session."""
    try:
        if force_json:
            ctx.json_mode = True
        project = _resolve_project_ref(ctx.client, project_ref, allow_path_fallback=True)
        normalized_provider = _normalize_provider(provider)
        if not normalized_provider:
            normalized_provider = _resolve_session_provider(ctx.client, project, session_id)
        
        processed_attachments = _process_attachments(attachments) if attachments else None
        project_path = project.get("fullPath") or project.get("path") or project_ref
        result = chat_mod.send_message(
            ctx.client,
            project_path=str(project_path),
            message=message,
            provider=normalized_provider,
            session_id=session_id,
            timeout=timeout,
            permission_mode="bypassPermissions" if bypass_permissions else None,
            model=model,
            attachments=processed_attachments,
        )
        payload = {
            "action": "continue",
            "project": project.get("name") or project.get("fullPath") or project.get("path"),
            "project_display_name": _project_label(project),
            "project_path": result.get("project_path"),
            "provider": result.get("provider", normalized_provider),
            "session_id": result.get("session_id") or session_id,
            "reply": result.get("reply", ""),
        }
        waiting_after = chat_mod.get_waiting_sessions_compact(ctx.client)
        waiting_for_session = [
            row for row in waiting_after
            if row.get("session_id") == payload["session_id"]
            and (
                row.get("project") == project.get("name")
                or row.get("project_path") == project_path
            )
        ]
        payload["openclaw"] = _build_openclaw_turn_schema(
            project=project,
            provider=payload["provider"],
            session_id=payload["session_id"],
            reply=payload["reply"],
            action="continue",
            waiting_rows=waiting_for_session,
        )
        payload["openclaw_notification"] = _maybe_send_openclaw_chat_notification(
            ctx,
            payload,
            action="reply",
            notify_openclaw=notify_openclaw,
            notify_channel=notify_channel,
        )

        output(payload, json_mode=ctx.json_mode, title=f"Workflow Continue: {_project_label(project)}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@workflow.command("retry")
@click.option("--project", "project_ref", required=True, metavar="PROJECT", help="Project name, display name, or path.")
@click.option("--task", "task_id", required=True, metavar="TASK_ID", help="Task ID to mark for retry.")
@click.option("--message", default=None, metavar="TEXT", help="Optional retry note appended to task details.")
@click.option("--json", "force_json", is_flag=True, default=False, help="Output results as JSON.")
@pass_context
def workflow_retry(ctx: Context, project_ref: str, task_id: str, message: Optional[str], force_json: bool) -> None:
    """Retry a workflow task by resetting it to pending."""
    try:
        if force_json:
            ctx.json_mode = True
        project = _resolve_project_ref(ctx.client, project_ref)
        project_name = _require_project_name(project, project_ref)
        details = f"Retry requested. {message}".strip() if message else "Retry requested."
        data = taskmaster_mod.update_task(ctx.client, project_name, task_id, status="pending", details=details)
        output(data, json_mode=ctx.json_mode, title=f"Workflow Retry: {_project_label(project)}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@workflow.command("approve")
@click.option("--project", "project_ref", required=True, metavar="PROJECT", help="Project name, display name, or path.")
@click.option("--task", "task_id", required=True, metavar="TASK_ID", help="Task ID to approve.")
@click.option("--note", default=None, metavar="TEXT", help="Optional approval note.")
@click.option("--json", "force_json", is_flag=True, default=False, help="Output results as JSON.")
@pass_context
def workflow_approve(ctx: Context, project_ref: str, task_id: str, note: Optional[str], force_json: bool) -> None:
    """Approve a task by moving it to in-progress."""
    try:
        if force_json:
            ctx.json_mode = True
        project = _resolve_project_ref(ctx.client, project_ref)
        project_name = _require_project_name(project, project_ref)
        details = f"Approved by OpenClaw. {note}".strip() if note else "Approved by OpenClaw."
        data = taskmaster_mod.update_task(ctx.client, project_name, task_id, status="in-progress", details=details)
        output(data, json_mode=ctx.json_mode, title=f"Workflow Approve: {_project_label(project)}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@workflow.command("reject")
@click.option("--project", "project_ref", required=True, metavar="PROJECT", help="Project name, display name, or path.")
@click.option("--task", "task_id", required=True, metavar="TASK_ID", help="Task ID to reject.")
@click.option("--reason", default=None, metavar="TEXT", help="Optional rejection reason.")
@click.option("--json", "force_json", is_flag=True, default=False, help="Output results as JSON.")
@pass_context
def workflow_reject(ctx: Context, project_ref: str, task_id: str, reason: Optional[str], force_json: bool) -> None:
    """Reject or defer a task."""
    try:
        if force_json:
            ctx.json_mode = True
        project = _resolve_project_ref(ctx.client, project_ref)
        project_name = _require_project_name(project, project_ref)
        details = f"Rejected by OpenClaw. {reason}".strip() if reason else "Rejected by OpenClaw."
        data = taskmaster_mod.update_task(ctx.client, project_name, task_id, status="deferred", details=details)
        output(data, json_mode=ctx.json_mode, title=f"Workflow Reject: {_project_label(project)}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@workflow.command("resume")
@click.option("--project", "project_ref", required=True, metavar="PROJECT", help="Project name, display name, or path.")
@click.option("--session", "session_id", required=True, metavar="SESSION_ID", help="Session ID to resume.")
@click.option("--provider", type=click.Choice(_PROVIDER_CHOICES, case_sensitive=False), default=None, help="Override the session's provider.")
@click.option("--timeout", type=int, default=None, metavar="SECONDS", help="Wait timeout. If omitted, waits indefinitely with heartbeat.")
@click.option("--bypass-permissions", is_flag=True, default=False, help="Automatically approve all tool calls.")
@click.option("--attach", "attachments", multiple=True, help="Path to a file or image to attach. Repeat for multiple attachments.")
@click.option("--json", "force_json", is_flag=True, default=False, help="Output results as JSON.")
@pass_context
def workflow_resume(
    ctx: Context,
    project_ref: str,
    session_id: str,
    provider: Optional[str],
    timeout: Optional[int],
    bypass_permissions: bool,
    attachments: List[str],
    force_json: bool,
) -> None:
    """Resume a waiting session with a default continue instruction."""
    try:
        if force_json:
            ctx.json_mode = True
        project = _resolve_project_ref(ctx.client, project_ref, allow_path_fallback=True)
        normalized_provider = _normalize_provider(provider)
        if not normalized_provider:
            normalized_provider = _resolve_session_provider(ctx.client, project, session_id)
        
        processed_attachments = _process_attachments(attachments) if attachments else None
        project_path = project.get("fullPath") or project.get("path") or project_ref
        result = chat_mod.send_message(
            ctx.client,
            project_path=str(project_path),
            message="Continue from the latest state and summarize the next meaningful checkpoint.",
            provider=normalized_provider,
            session_id=session_id,
            timeout=timeout,
            permission_mode="bypassPermissions" if bypass_permissions else None,
            attachments=processed_attachments,
        )
        payload = {
            "action": "resume",
            "project": project.get("name") or project.get("fullPath") or project.get("path"),
            "project_path": result.get("project_path"),
            "project_display_name": _project_label(project),
            "provider": result.get("provider", normalized_provider),
            "session_id": result.get("session_id") or session_id,
            "reply": result.get("reply", ""),
        }
        waiting_after = chat_mod.get_waiting_sessions_compact(ctx.client)
        waiting_for_session = [
            row for row in waiting_after
            if row.get("session_id") == payload["session_id"]
            and (
                row.get("project") == project.get("name")
                or row.get("project_path") == project_path
            )
        ]
        payload["openclaw"] = _build_openclaw_turn_schema(
            project=project,
            provider=payload["provider"],
            session_id=payload["session_id"],
            reply=payload["reply"],
            action="resume",
            waiting_rows=waiting_for_session,
        )
        output(payload, json_mode=ctx.json_mode, title=f"Workflow Resume: {_project_label(project)}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@taskmaster.command("next")
@click.argument("project_ref")
@pass_context
def taskmaster_next(ctx: Context, project_ref: str) -> None:
    """Show the next task for PROJECT_REF."""
    try:
        project = _resolve_project_ref(ctx.client, project_ref)
        project_name = _require_project_name(project, project_ref)
        data = taskmaster_mod.get_next_task(ctx.client, project_name)
        output(data, json_mode=ctx.json_mode, title=f"Next task: {_project_label(project)}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@taskmaster.command("next-guidance")
@click.argument("project_ref")
@pass_context
def taskmaster_next_guidance(ctx: Context, project_ref: str) -> None:
    """Show next-task guidance metadata for PROJECT_REF."""
    try:
        project = _resolve_project_ref(ctx.client, project_ref)
        project_name = _require_project_name(project, project_ref)
        data = taskmaster_mod.get_next_guidance(ctx.client, project_name)
        output(data, json_mode=ctx.json_mode, title=f"Next guidance: {_project_label(project)}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@taskmaster.command("summary")
@click.argument("project_ref")
@click.option("--include-prompt", is_flag=True, default=False, help="Include the next action prompt in pretty output.")
@pass_context
def taskmaster_summary(ctx: Context, project_ref: str, include_prompt: bool) -> None:
    """Show a compact TaskMaster summary for PROJECT_REF."""
    try:
        project = _resolve_project_ref(ctx.client, project_ref)
        project_name = _require_project_name(project, project_ref)
        summary = taskmaster_mod.build_summary(ctx.client, project_name)
        if ctx.json_mode:
            output(summary, json_mode=True)
        else:
            click.echo(_build_openclaw_report(project, summary, ctx, include_prompt=include_prompt))

    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@cli.group()
def settings() -> None:
    """Settings management commands."""


@settings.group("api-keys")
def settings_api_keys() -> None:
    """API key management."""


@settings_api_keys.command("list")
@pass_context
def api_keys_list(ctx: Context) -> None:
    """List all API keys."""
    try:
        items = settings_mod.list_api_keys(ctx.client)
        output(items, json_mode=ctx.json_mode, title="API Keys")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@settings_api_keys.command("create")
@click.argument("key_name")
@pass_context
def api_keys_create(ctx: Context, key_name: str) -> None:
    """Create a new API key named KEY_NAME."""
    try:
        key = settings_mod.create_api_key(ctx.client, key_name)
        output(key, json_mode=ctx.json_mode, title="New API Key")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@settings_api_keys.command("delete")
@click.argument("key_id")
@click.confirmation_option(prompt="Are you sure you want to delete this API key?")
@pass_context
def api_keys_delete(ctx: Context, key_id: str) -> None:
    """Delete API key KEY_ID."""
    try:
        settings_mod.delete_api_key(ctx.client, key_id)
        success(f"API key '{key_id}' deleted.", json_mode=ctx.json_mode)
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@cli.group()
def skills() -> None:
    """Skill management commands."""


@skills.command("list")
@pass_context
def skills_list(ctx: Context) -> None:
    """List global skills."""
    try:
        resp = ctx.client.get("/api/skills")
        data = resp.json()
        if isinstance(data, list):
            display = [
                {
                    "name": item.get("name", ""),
                    "type": item.get("type", ""),
                    "path": item.get("path", ""),
                }
                for item in data
                if isinstance(item, dict)
            ]
        else:
            display = data
        output(display, json_mode=ctx.json_mode, title="Skills")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@cli.group()
def server() -> None:
    """Start / stop the Dr. Claw Node.js server as a background daemon."""


@server.command("on")
@click.option("--path", "server_path", default=None, metavar="PATH", help="Path to the DrClaw installation directory (saved for future use).")
@click.option("--port", default=None, type=int, metavar="PORT", help="Port to listen on (default: 3001).")
@pass_context
def server_on(ctx: Context, server_path: Optional[str], port: Optional[int]) -> None:
    """Start the Dr. Claw server as a daemon. Logs -> ~/.vibelab/logs/server.log"""
    try:
        result = daemon_mod.server_start(path_override=server_path, port=port)
        if ctx.json_mode:
            output(result, json_mode=True)
        else:
            success(f"Server started (PID {result['pid']}). Logs: {result['log_file']}", json_mode=False)
            info(f"  logs : {result['log_file']}")
            info(f"  path : {result['server_path']}")
    except Exception as exc:
        error(str(exc))
        sys.exit(1)


@server.command("off")
@pass_context
def server_off(ctx: Context) -> None:
    """Stop the running DrClaw daemon."""
    try:
        result = daemon_mod.server_stop()
        if ctx.json_mode:
            output(result, json_mode=True)
        elif result["stopped"]:
            success(result["message"], json_mode=False)
        else:
            info(result["message"])
    except Exception as exc:
        error(str(exc))
        sys.exit(1)


@server.command("status")
@click.option("--logs", "show_logs", is_flag=True, default=False, help="Print the last 20 lines of the server log.")
@pass_context
def server_status(ctx: Context, show_logs: bool) -> None:
    """Show whether the daemon is running."""
    try:
        st = daemon_mod.server_status()
        if ctx.json_mode:
            output(st, json_mode=True)
            return

        state = "RUNNING" if st["running"] else "STOPPED"
        state_text = click.style(state, fg="green" if st["running"] else "red", bold=True)
        click.echo(f"  status : {state_text}")
        if st.get("pid"):
            click.echo(f"  pid    : {st['pid']}")
        click.echo(f"  logs   : {st['log_file']}")
        if show_logs and st.get("log_tail"):
            click.echo("\n--- last 20 log lines ---")
            click.echo(st["log_tail"])
    except Exception as exc:
        error(str(exc))
        sys.exit(1)


@server.command("logs")
@click.option("-n", "lines", default=50, show_default=True, help="Number of lines to show.")
@click.option("-f", "follow", is_flag=True, default=False, help="Follow the log (like tail -f).")
@pass_context
def server_logs(ctx: Context, lines: int, follow: bool) -> None:
    """Tail the server log file."""
    if not daemon_mod.LOG_FILE.exists():
        info("No log file yet. Start the server first.")
        return
    if follow:
        try:
            subprocess.run(["tail", f"-{lines}", "-f", str(daemon_mod.LOG_FILE)], check=False)
        except KeyboardInterrupt:
            pass
    else:
        subprocess.run(["tail", f"-{lines}", str(daemon_mod.LOG_FILE)], check=False)


@cli.group()
def chat() -> None:
    """Chat with provider sessions via WebSocket."""


@chat.command("send")
@click.option("--project", "project_ref", required=True, metavar="PROJECT", help="Project name, display name, or filesystem path.")
@click.option("--message", "message", "-m", required=True, metavar="TEXT", help="Message to send to the session.")
@click.option("--provider", type=click.Choice(_PROVIDER_CHOICES, case_sensitive=False), default="claude", show_default=True, help="Session provider.")
@click.option("--session", "session_id", default=None, metavar="SESSION_ID", help="Session ID to resume (omit to start a new session).")
@click.option("--timeout", type=int, default=None, metavar="SECONDS", help="Wait timeout. If omitted, waits indefinitely with heartbeat.")
@click.option("--bypass-permissions", is_flag=True, default=False, help="Automatically approve all tool calls.")
@click.option("--attach", "attachments", multiple=True, help="Path to a file or image to attach. Repeat for multiple attachments.")
@click.option("--model", default=None, metavar="MODEL", help="Override the model for this request.")
@click.option("--json", "force_json", is_flag=True, default=False, help="Output results as JSON.")
@click.option("--notify-openclaw", is_flag=True, default=False, help="After completion, send a summary message to the configured OpenClaw channel.")
@click.option("--notify-to", "notify_channel", default=None, metavar="CHANNEL", help="Override the OpenClaw notification channel for this command.")
@pass_context
def chat_send(
    ctx: Context,
    project_ref: str,
    message: str,
    provider: str,
    session_id: Optional[str],
    timeout: Optional[int],
    bypass_permissions: bool,
    attachments: List[str],
    model: Optional[str],
    force_json: bool,
    notify_openclaw: bool,
    notify_channel: Optional[str],
) -> None:
    """Send a message to a provider session and print the reply."""
    try:
        if force_json:
            ctx.json_mode = True
        normalized_provider = _normalize_provider(provider) or "claude"
        project = _resolve_project_ref(ctx.client, project_ref, allow_path_fallback=True)
        
        processed_attachments = _process_attachments(attachments) if attachments else None
        project_path = project.get("fullPath") or project.get("path") or project_ref
        result = chat_mod.send_message(
            ctx.client,
            project_path=str(project_path),
            message=message,
            provider=normalized_provider,
            session_id=session_id or None,
            timeout=timeout,
            permission_mode="bypassPermissions" if bypass_permissions else None,
            model=model,
            attachments=processed_attachments,
        )
        waiting_after = chat_mod.get_waiting_sessions_compact(ctx.client)
        waiting_for_session = [
            row for row in waiting_after
            if row.get("session_id") == (result.get("session_id") or session_id)
            and (
                row.get("project") == project.get("name")
                or row.get("project_path") == project_path
            )
        ]
        payload = {
            "project": project.get("name") or project.get("fullPath") or project.get("path"),
            "project_display_name": _project_label(project),
            "project_path": result.get("project_path"),
            "provider": result.get("provider", normalized_provider),
            "session_id": result.get("session_id"),
            "reply": result.get("reply", ""),
        }
        payload["openclaw"] = _build_openclaw_turn_schema(
            project=project,
            provider=payload["provider"],
            session_id=payload.get("session_id") or "",
            reply=payload["reply"],
            action="send",
            waiting_rows=waiting_for_session,
        )
        payload["openclaw_notification"] = _maybe_send_openclaw_chat_notification(
            ctx,
            payload,
            action="reply",
            notify_openclaw=notify_openclaw,
            notify_channel=notify_channel,
        )

        if ctx.json_mode:
            output(payload, json_mode=True)
        else:
            click.echo(result.get("reply", ""))
            info(f"Provider: {payload['provider']}")
            info(f"Session: {result.get('session_id', '')}")
            info(f"Project: {payload['project_path']}")
            if payload["openclaw_notification"].get("sent"):
                info(f"OpenClaw: sent to {payload['openclaw_notification']['channel']}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@chat.command("reply")
@click.option("--project", "project_ref", required=True, metavar="PROJECT", help="Project name, display name, or filesystem path.")
@click.option("--session", "session_id", required=True, metavar="SESSION_ID", help="Session ID to resume.")
@click.option("--message", "message", "-m", required=True, metavar="TEXT", help="Reply text to send.")
@click.option("--provider", type=click.Choice(_PROVIDER_CHOICES, case_sensitive=False), default=None, help="Override the session's provider.")
@click.option("--timeout", type=int, default=None, metavar="SECONDS", help="Wait timeout. If omitted, waits indefinitely with heartbeat.")
@click.option("--bypass-permissions", is_flag=True, default=False, help="Automatically approve all tool calls.")
@click.option("--attach", "attachments", multiple=True, help="Path to a file or image to attach. Repeat for multiple attachments.")
@click.option("--model", default=None, metavar="MODEL", help="Override the model for this request.")
@click.option("--json", "force_json", is_flag=True, default=False, help="Output results as JSON.")
@click.option("--notify-openclaw", is_flag=True, default=False, help="After completion, send a summary message to the configured OpenClaw channel.")
@click.option("--notify-to", "notify_channel", default=None, metavar="CHANNEL", help="Override the OpenClaw notification channel for this command.")
@pass_context
def chat_reply(
    ctx: Context,
    project_ref: str,
    session_id: str,
    message: str,
    provider: Optional[str],
    timeout: Optional[int],
    bypass_permissions: bool,
    attachments: List[str],
    model: Optional[str],
    force_json: bool,
    notify_openclaw: bool,
    notify_channel: Optional[str],
) -> None:
    """Reply to an existing provider session and print the reply."""
    try:
        if force_json:
            ctx.json_mode = True
        project = _resolve_project_ref(ctx.client, project_ref, allow_path_fallback=True)
        normalized_provider = _normalize_provider(provider)
        if not normalized_provider:
            normalized_provider = _resolve_session_provider(ctx.client, project, session_id)
        
        processed_attachments = _process_attachments(attachments) if attachments else None
        project_path = project.get("fullPath") or project.get("path") or project_ref
        result = chat_mod.send_message(
            ctx.client,
            project_path=str(project_path),
            message=message,
            provider=normalized_provider,
            session_id=session_id,
            timeout=timeout,
            permission_mode="bypassPermissions" if bypass_permissions else None,
            model=model,
            attachments=processed_attachments,
        )
        waiting_after = chat_mod.get_waiting_sessions_compact(ctx.client)
        waiting_for_session = [
            row for row in waiting_after
            if row.get("session_id") == (result.get("session_id") or session_id)
            and (
                row.get("project") == project.get("name")
                or row.get("project_path") == project_path
            )
        ]
        payload = {
            "project": project.get("name") or project.get("fullPath") or project.get("path"),
            "project_display_name": _project_label(project),
            "project_path": result.get("project_path"),
            "provider": result.get("provider", normalized_provider),
            "session_id": result.get("session_id") or session_id,
            "reply": result.get("reply", ""),
        }
        payload["openclaw"] = _build_openclaw_turn_schema(
            project=project,
            provider=payload["provider"],
            session_id=payload.get("session_id") or "",
            reply=payload["reply"],
            action="reply",
            waiting_rows=waiting_for_session,
        )
        payload["openclaw_notification"] = _maybe_send_openclaw_chat_notification(
            ctx,
            payload,
            action="reply",
            notify_openclaw=notify_openclaw,
            notify_channel=notify_channel,
        )

        if ctx.json_mode:
            output(payload, json_mode=True)
        else:
            click.echo(result.get("reply", ""))
            info(f"Provider: {payload['provider']}")
            info(f"Session: {payload['session_id']}")
            info(f"Project: {payload['project_path']}")
            if payload["openclaw_notification"].get("sent"):
                info(f"OpenClaw: sent to {payload['openclaw_notification']['channel']}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@chat.command("project")
@click.option("--project", "project_ref", required=True, metavar="PROJECT", help="Project name, display name, or filesystem path.")
@click.option("--session", "session_id", default=None, metavar="SESSION_ID", help="Existing session ID to continue. Defaults to the latest session for the project.")
@click.option("--provider", type=click.Choice(_PROVIDER_CHOICES, case_sensitive=False), default=None, help="Provider for a new session when no existing session is chosen.")
@click.option("--message", "message", "-m", default=None, metavar="TEXT", help="Single message to send without entering interactive mode.")
@click.option("--timeout", type=int, default=180, show_default=True, metavar="SECONDS", help="Maximum seconds to wait for each reply.")
@click.option("--json", "force_json", is_flag=True, default=False, help="Output results as JSON.")
@pass_context
def chat_project(
    ctx: Context,
    project_ref: str,
    session_id: Optional[str],
    provider: Optional[str],
    message: Optional[str],
    timeout: int,
    force_json: bool,
) -> None:
    """Enter a project session and issue multiple project-specific instructions."""
    try:
        if force_json:
            ctx.json_mode = True
        project = _resolve_project_ref(ctx.client, project_ref, allow_path_fallback=True)
        project_path = project.get("fullPath") or project.get("path") or project_ref
        latest = projects_mod.get_project_latest_message(ctx.client, project)
        chosen_session = session_id or ((latest.get("session") or {}).get("session_id") or None)
        chosen_provider = _normalize_provider(provider)
        if not chosen_provider and chosen_session:
            chosen_provider = _resolve_session_provider(ctx.client, project, chosen_session)
        if not chosen_provider:
            chosen_provider = "claude"

        def run_turn(text: str) -> Dict[str, Any]:
            return chat_mod.send_message(
                ctx.client,
                project_path=str(project_path),
                message=text,
                provider=chosen_provider or "claude",
                session_id=chosen_session,
                timeout=timeout,
            )

        if message:
            result = run_turn(message)
            payload = {
                "project": project.get("name") or project.get("fullPath") or project.get("path"),
                "project_display_name": _project_label(project),
                "project_path": result.get("project_path"),
                "provider": result.get("provider", chosen_provider),
                "session_id": result.get("session_id") or chosen_session,
                "reply": result.get("reply", ""),
            }
            output(payload if ctx.json_mode else payload.get("reply", ""), json_mode=ctx.json_mode, title=f"Project Chat: {_project_label(project)}")
            return

        if ctx.json_mode:
            raise ValueError("Interactive project chat is only available without --json. Use -m/--message for single-turn JSON output.")

        success(f"Project chat: {_project_label(project)}", json_mode=False)
        info(f"  path     : {project_path}")
        info(f"  provider : {chosen_provider}")
        if chosen_session:
            info(f"  session  : {chosen_session}")
        info("  type /exit or /quit to leave")

        while True:
            prompt = click.prompt(_PRIMARY_CLI_NAME, prompt_suffix="> ", default="", show_default=False)
            text = str(prompt or "").strip()
            if not text:
                continue
            if text in {"/exit", "/quit"}:
                break
            result = run_turn(text)
            chosen_session = result.get("session_id") or chosen_session
            chosen_provider = result.get("provider", chosen_provider)
            click.echo(result.get("reply", ""))
            if chosen_session:
                info(f"Session: {chosen_session}")
    except (EOFError, KeyboardInterrupt):
        click.echo()
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@chat.command("sessions")
@click.option("--project", "project_ref", default=None, metavar="PROJECT", help="Optional project name, display name, or path filter.")
@click.option("--provider", type=click.Choice(_PROVIDER_CHOICES, case_sensitive=False), default=None, help="Optional provider filter.")
@click.option("--json", "force_json", is_flag=True, default=False, help="Output results as JSON.")
@pass_context
def chat_sessions(ctx: Context, project_ref: Optional[str], provider: Optional[str], force_json: bool) -> None:
    """List known sessions across all projects."""
    try:
        if force_json:
            ctx.json_mode = True
        sessions = chat_mod.get_active_sessions(ctx.client)
        normalized_provider = _normalize_provider(provider)
        if project_ref:
            project = _resolve_project_ref(ctx.client, project_ref)
            project_name = project.get("name")
            project_path = project.get("fullPath") or project.get("path")
            sessions = [
                session
                for session in sessions
                if session.get("project_name") == project_name or session.get("project_path") == project_path
            ]
        if normalized_provider:
            sessions = [session for session in sessions if session.get("provider") == normalized_provider]
        output(sessions, json_mode=ctx.json_mode, title="Known Sessions")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@chat.command("waiting")
@click.option("--project", "project_ref", default=None, metavar="PROJECT", help="Optional project name, display name, or path filter.")
@click.option("--provider", type=click.Choice(_PROVIDER_CHOICES, case_sensitive=False), default=None, help="Optional provider filter.")
@click.option("--json", "force_json", is_flag=True, default=False, help="Output results as JSON.")
@pass_context
def chat_waiting(ctx: Context, project_ref: Optional[str], provider: Optional[str], force_json: bool) -> None:
    """List sessions currently waiting for response / still processing."""
    try:
        if force_json:
            ctx.json_mode = True
        sessions = chat_mod.get_waiting_sessions_compact(ctx.client)
        normalized_provider = _normalize_provider(provider)
        if project_ref:
            project = _resolve_project_ref(ctx.client, project_ref)
            project_name = project.get("name")
            project_path = project.get("fullPath") or project.get("path")
            sessions = [
                session
                for session in sessions
                if session.get("project") == project_name or session.get("project_path") == project_path
            ]
        if normalized_provider:
            sessions = [session for session in sessions if session.get("provider") == normalized_provider]
        compact = _compact_waiting_sessions(sessions)
        output(compact, json_mode=ctx.json_mode, title="Dr. Claw Waiting Sessions")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@chat.command("watch")
@click.option("--timeout", type=int, default=300, show_default=True, metavar="SECONDS", help="Maximum seconds to watch. Use 0 or a negative value to watch until interrupted.")
@click.option("--event", "event_types", multiple=True, help="Event type filter. Repeat to watch multiple event types.")
@click.option("--json", "force_json", is_flag=True, default=False, help="Output results as JSON.")
@click.option("--notify-openclaw", is_flag=True, default=False, help="Push each matching event to OpenClaw as it arrives.")
@click.option("--notify-to", "notify_channel", default=None, metavar="CHANNEL", help="Override the OpenClaw notification channel for this command.")
@pass_context
def chat_watch(
    ctx: Context,
    timeout: int,
    event_types: List[str],
    force_json: bool,
    notify_openclaw: bool,
    notify_channel: Optional[str],
) -> None:
    """Watch realtime session and task events."""
    try:
        if force_json:
            ctx.json_mode = True

        events: List[Dict[str, Any]] = []

        def handle_event(event: Dict[str, Any]) -> None:
            events.append(event)
            portfolio_event = None
            if event.get("type") in {"taskmaster-project-updated", "taskmaster-tasks-updated", "projects_updated", "claude-permission-request", "session-aborted"}:
                project_ref = event.get("project")
                if project_ref:
                    try:
                        digest = _collect_project_digest(ctx, project_ref)
                        portfolio_event = _build_openclaw_project_schema(digest)
                    except Exception:
                        portfolio_event = None
            event["openclaw"] = _build_openclaw_event_schema(event, portfolio_event=portfolio_event)
            if notify_openclaw or notify_channel:
                payload = {
                    "project_display_name": event.get("project") or "unknown",
                    "provider": event.get("provider") or "system",
                    "session_id": event.get("session_id") or "",
                    "reply": json.dumps(event, ensure_ascii=False),
                }
                _maybe_send_openclaw_chat_notification(
                    ctx,
                    payload,
                    action=f"event:{event.get('type')}",
                    notify_openclaw=notify_openclaw,
                    notify_channel=notify_channel,
                )
            if not ctx.json_mode:
                output([event], json_mode=False)

        returned = chat_mod.watch_events(
            ctx.client,
            timeout=timeout,
            event_types=list(event_types) or None,
            on_event=handle_event,
        )

        if ctx.json_mode:
            output(events or returned, json_mode=True)
    except KeyboardInterrupt:
        if ctx.json_mode:
            output([], json_mode=True)
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@cli.group()
def openclaw() -> None:
    """OpenClaw integration commands."""


@cli.group()
def digest() -> None:
    """Digest and inbox summaries for OpenClaw/mobile use."""


def _collect_project_digest(ctx: Context, project_ref: str) -> Dict[str, Any]:
    project = _resolve_project_ref(ctx.client, project_ref)
    project_name = _require_project_name(project, project_ref)
    summary = taskmaster_mod.build_summary(ctx.client, project_name)
    waiting = [
        row for row in chat_mod.get_waiting_sessions_compact(ctx.client)
        if row.get("project") == project_name
        or row.get("project_path") == (project.get("fullPath") or project.get("path"))
    ]
    artifacts = taskmaster_mod.get_artifact_summary(ctx.client, project_name)
    return _build_project_digest(project, summary, waiting, artifacts)


@digest.command("project")
@click.option("--project", "project_ref", required=True, metavar="PROJECT", help="Project name, display name, or path.")
@click.option("--json", "force_json", is_flag=True, default=False, help="Output results as JSON.")
@click.option("--push-openclaw", is_flag=True, default=False, help="Send the digest to the configured OpenClaw channel.")
@click.option("--to", "channel", default=None, metavar="CHANNEL", help="Override the OpenClaw channel.")
@pass_context
def digest_project(ctx: Context, project_ref: str, force_json: bool, push_openclaw: bool, channel: Optional[str]) -> None:
    """Build a project digest."""
    try:
        if force_json:
            ctx.json_mode = True
        payload = _collect_project_digest(ctx, project_ref)
        payload["openclaw"] = _build_openclaw_project_schema(payload)
        if push_openclaw or channel:
            resolved_channel = _resolve_push_channel(channel)
            if not resolved_channel:
                raise ValueError("No channel specified. Use --to <channel> or run `drclaw openclaw configure --push-channel <channel>` first.")
            send_output = _send_openclaw_message(_format_project_digest(payload), resolved_channel)
            payload["openclaw_notification"] = {"sent": True, "channel": resolved_channel, "output": send_output}
        if ctx.json_mode:
            output(payload, json_mode=True)
        else:
            click.echo(_format_project_digest(payload))
            if payload.get("openclaw_notification", {}).get("sent"):
                info(f"OpenClaw: sent to {payload['openclaw_notification']['channel']}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@digest.command("portfolio")
@click.option("--json", "force_json", is_flag=True, default=False, help="Output results as JSON.")
@click.option("--push-openclaw", is_flag=True, default=False, help="Send the digest to the configured OpenClaw channel.")
@click.option("--to", "channel", default=None, metavar="CHANNEL", help="Override the OpenClaw channel.")
@pass_context
def digest_portfolio(ctx: Context, force_json: bool, push_openclaw: bool, channel: Optional[str]) -> None:
    """Build a cross-project progress summary with attention recommendations."""
    try:
        if force_json:
            ctx.json_mode = True
        projects = projects_mod.list_projects(ctx.client)
        waiting_rows = chat_mod.get_waiting_sessions_compact(ctx.client)
        items = []
        for project in projects:
            try:
                ref = project.get("name") or project.get("fullPath") or project.get("path")
                if not ref:
                    continue
                items.append(_project_progress_payload(ctx, ref))
            except Exception:
                continue
        payload = _build_portfolio_digest(items, waiting_rows, lang=ctx.lang)
        payload["openclaw"] = _build_openclaw_portfolio_schema(payload)
        if push_openclaw or channel:
            resolved_channel = _resolve_push_channel(channel)
            if not resolved_channel:
                raise ValueError("No channel specified. Use --to <channel> or run `drclaw openclaw configure --push-channel <channel>` first.")
            send_output = _send_openclaw_message(_format_portfolio_digest(payload), resolved_channel)
            payload["openclaw_notification"] = {"sent": True, "channel": resolved_channel, "output": send_output}
        if ctx.json_mode:
            output(payload, json_mode=True)
        else:
            click.echo(_format_portfolio_digest(payload))
            if payload.get("openclaw_notification", {}).get("sent"):
                info(f"OpenClaw: sent to {payload['openclaw_notification']['channel']}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@digest.command("daily")
@click.option("--json", "force_json", is_flag=True, default=False, help="Output results as JSON.")
@click.option("--push-openclaw", is_flag=True, default=False, help="Send the digest to the configured OpenClaw channel.")
@click.option("--to", "channel", default=None, metavar="CHANNEL", help="Override the OpenClaw channel.")
@pass_context
def digest_daily(ctx: Context, force_json: bool, push_openclaw: bool, channel: Optional[str]) -> None:
    """Build a multi-project daily digest."""
    try:
        if force_json:
            ctx.json_mode = True
        projects = projects_mod.list_projects(ctx.client)
        items = []
        for project in projects:
            try:
                ref = project.get("name") or project.get("fullPath") or project.get("path")
                if not ref:
                    continue
                items.append(_collect_project_digest(ctx, ref))
            except Exception:
                continue
        payload = _build_daily_digest(items)
        payload["openclaw"] = {
            "schema_version": "openclaw.daily.v1",
            "kind": "daily_digest",
            "summary": payload.get("summary") or {},
            "projects": [
                _build_openclaw_project_schema(item)
                for item in items
            ],
        }
        if push_openclaw or channel:
            resolved_channel = _resolve_push_channel(channel)
            if not resolved_channel:
                raise ValueError("No channel specified. Use --to <channel> or run `drclaw openclaw configure --push-channel <channel>` first.")
            send_output = _send_openclaw_message(_format_daily_digest(payload), resolved_channel)
            payload["openclaw_notification"] = {"sent": True, "channel": resolved_channel, "output": send_output}
        if ctx.json_mode:
            output(payload, json_mode=True)
        else:
            click.echo(_format_daily_digest(payload))
            if payload.get("openclaw_notification", {}).get("sent"):
                info(f"OpenClaw: sent to {payload['openclaw_notification']['channel']}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@cli.command("install")
@click.option("--openclaw-dir", "openclaw_dir", default=None, metavar="DIR", help="Path to the OpenClaw workspace root (default: ~/.openclaw).")
@click.option("--server-url", default=None, metavar="URL", help="Server URL to save for OpenClaw / CLI use. Defaults to the current CLI base URL.")
@click.option("--push-channel", default=None, metavar="CHANNEL", help="Optional default OpenClaw push channel to save during setup.")
@pass_context
def install_command(ctx: Context, openclaw_dir: Optional[str], server_url: Optional[str], push_channel: Optional[str]) -> None:
    """One-command setup for Dr. Claw + OpenClaw local integration."""
    try:
        payload = _install_openclaw_skill(
            openclaw_dir=openclaw_dir,
            server_url=server_url or ctx.client.get_base_url(),
            push_channel=push_channel,
        )
        payload["openclaw_found"] = shutil.which("openclaw") is not None
        payload["next_steps"] = [
            f"{payload['drclaw_bin']} --url {payload['server_url']} --json chat waiting",
            f"{payload['drclaw_bin']} --url {payload['server_url']} --json digest portfolio",
            "~/.openclaw/workspace/skills/drclaw/scripts/openclaw_drclaw_turn.sh --json -m 'Use your exec tool to run `$DRCLAW_BIN --url \"$VIBELAB_URL\" chat waiting --json`. Return a concise Chinese summary.'",
        ]
        if ctx.json_mode:
            output(payload, json_mode=True)
        else:
            success(f"Dr. Claw linked to OpenClaw at {payload['skill_dir']}", json_mode=False)
            info(f"Server URL : {payload['server_url']}")
            info(f"CLI path   : {payload['drclaw_bin']}")
            if payload.get("push_channel"):
                info(f"Push chan  : {payload['push_channel']}")
            info(f"Files      : {payload['installed_file_count']} installed")
            if not payload["openclaw_found"]:
                info("OpenClaw CLI was not found on PATH, but the skill files were installed.")
            click.echo()
            click.echo("Try:")
            for step in payload["next_steps"]:
                click.echo(f"  {step}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@openclaw.command("install")
@click.option("--openclaw-dir", "openclaw_dir", default=None, metavar="DIR", help="Path to the OpenClaw workspace root (default: ~/.openclaw).")
@click.option("--server-url", default=None, metavar="URL", help="Server URL to save for OpenClaw / CLI use. Defaults to the current CLI base URL.")
@click.option("--push-channel", default=None, metavar="CHANNEL", help="Optional default OpenClaw push channel to save during setup.")
@pass_context
def openclaw_install(ctx: Context, openclaw_dir: Optional[str], server_url: Optional[str], push_channel: Optional[str]) -> None:
    """Install the Dr. Claw skill into the OpenClaw workspace."""
    try:
        payload = _install_openclaw_skill(
            openclaw_dir=openclaw_dir,
            server_url=server_url or ctx.client.get_base_url(),
            push_channel=push_channel,
        )
        if ctx.json_mode:
            output(payload, json_mode=True)
        else:
            success(f"Dr. Claw skill installed to {payload['skill_dir']}", json_mode=False)
            info(f"Server URL : {payload['server_url']}")
            info(f"CLI path   : {payload['drclaw_bin']}")
            if payload.get("push_channel"):
                info(f"Push chan  : {payload['push_channel']}")
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@openclaw.command("push")
@click.argument("message_text")
@click.option("--to", "channel", default=None, metavar="CHANNEL", help="Destination channel (for example feishu:<chat_id>). Falls back to saved openclaw_push_channel in ~/.drclaw_session.json.")
@pass_context
def openclaw_push(ctx: Context, message_text: str, channel: Optional[str]) -> None:
    """Send a message via the OpenClaw CLI."""
    resolved_channel = _resolve_push_channel(channel)
    if not resolved_channel:
        error("No channel specified. Use --to <channel> or run `drclaw openclaw configure --push-channel <channel>` first.")
        sys.exit(1)

    try:
        cmd_output = _send_openclaw_message(message_text, resolved_channel)
        if ctx.json_mode:
            output({"sent": True, "channel": resolved_channel, "output": cmd_output}, json_mode=True)
        else:
            success(f"Message sent to {resolved_channel}", json_mode=False)
            if cmd_output:
                click.echo(cmd_output)
    except FileNotFoundError:
        error("'openclaw' command not found. Is OpenClaw installed and on your PATH?")
        sys.exit(1)
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


@openclaw.command("configure")
@click.option("--push-channel", "push_channel", required=True, metavar="CHANNEL", help="Default channel for `openclaw push` and `openclaw report`.")
@pass_context
def openclaw_configure(ctx: Context, push_channel: str) -> None:
    """Save OpenClaw integration settings to ~/.drclaw_session.json."""
    session_file = SESSION_FILE
    session_data = _load_session_file(session_file)
    session_data["openclaw_push_channel"] = push_channel
    _save_session_file(session_data)
    if ctx.json_mode:
        output({"openclaw_push_channel": push_channel}, json_mode=True)
    else:
        success(f"Default OpenClaw push channel set to: {push_channel}", json_mode=False)


@openclaw.command("report")
@click.option("--project", "project_ref", required=True, metavar="PROJECT", help="Project name, display name, or path.")
@click.option("--to", "channel", default=None, metavar="CHANNEL", help="Destination channel. Falls back to the configured default channel.")
@click.option("--dry-run", is_flag=True, default=False, help="Print the report without sending it to OpenClaw.")
@click.option("--include-prompt", is_flag=True, default=False, help="Include the next action prompt in the generated report text.")
@pass_context
def openclaw_report(
    ctx: Context,
    project_ref: str,
    channel: Optional[str],
    dry_run: bool,
    include_prompt: bool,
) -> None:
    """Generate a TaskMaster status report for OpenClaw / mobile delivery."""
    try:
        project = _resolve_project_ref(ctx.client, project_ref)
        project_name = _require_project_name(project, project_ref)
        summary = taskmaster_mod.build_summary(ctx.client, project_name)
        report_text = _build_openclaw_report(project, summary, ctx, include_prompt=include_prompt)

        resolved_channel = _resolve_push_channel(channel)
        sent = False
        cmd_output = ""
        if not dry_run:
            if not resolved_channel:
                raise ValueError(
                    "No channel specified. Use --to <channel>, run `drclaw openclaw configure --push-channel <channel>`, or pass --dry-run."
                )
            cmd_output = _send_openclaw_message(report_text, resolved_channel)
            sent = True

        payload = {
            "project": project_name,
            "channel": resolved_channel,
            "sent": sent,
            "report": report_text,
            "summary": summary,
            "openclaw_output": cmd_output,
        }
        payload["openclaw"] = {
            "schema_version": "openclaw.report.v1",
            "kind": "project_report",
            "project": {
                "ref": project_name,
                "display_name": _project_label(project),
                "path": project.get("fullPath") or project.get("path") or "",
            },
            "report_text": report_text,
            "summary": summary,
            "channel": resolved_channel,
            "sent": sent,
        }
        if ctx.json_mode:
            output(payload, json_mode=True)
        else:
            click.echo(report_text)
            if sent:
                success(f"Report sent to {resolved_channel}", json_mode=False)
                if cmd_output:
                    click.echo(cmd_output)
            else:
                info("Dry run only; report was not sent.")
    except FileNotFoundError:
        error("'openclaw' command not found. Is OpenClaw installed and on your PATH?")
        sys.exit(1)
    except Exception as exc:
        _handle_error(exc, ctx.json_mode)


if __name__ == "__main__":
    cli()
