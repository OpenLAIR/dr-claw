"""WebSocket chat helpers for the DrClaw server."""

import asyncio
import json
import os
from typing import Any, Callable, Dict, List, Optional

from .session import DrClaw


_PROVIDER_COMMAND_TYPES = {
    "claude": "claude-command",
    "cursor": "cursor-command",
    "codex": "codex-command",
    "gemini": "gemini-command",
    "nano": "nano-command",
}
_COMPLETE_EVENT_TYPES = {
    "claude-complete",
    "codex-complete",
    "gemini-complete",
    "complete",
    "session-complete",
}
_ERROR_EVENT_TYPES = {
    "claude-error",
    "cursor-error",
    "codex-error",
    "gemini-error",
    "error",
}
_WATCH_EVENT_TYPES = {
    "session-created",
    "claude-complete",
    "codex-complete",
    "gemini-complete",
    "session-complete",
    "session-status",
    "active-sessions",
    "projects_updated",
    "taskmaster-project-updated",
    "taskmaster-tasks-updated",
    "taskmaster-update",
    "claude-permission-request",
    "claude-permission-cancelled",
    "session-aborted",
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_text_from_agent_response(data: Dict[str, Any]) -> Optional[str]:
    """
    Extract human-readable text from a claude-response data payload.

    The SDK sends messages where data is the raw SDK message object.
    Assistant messages have data.type == 'assistant' and
    data.message.content is a list of content blocks.
    """
    if not isinstance(data, dict):
        return None

    msg_type = data.get("type")

    if msg_type == "item" and data.get("itemType") == "agent_message":
        message = data.get("message", {})
        content = message.get("content") if isinstance(message, dict) else None
        if isinstance(content, str) and content.strip():
            return content

    if msg_type == "message_delta":
        delta = data.get("delta", {})
        stop_reason = delta.get("stop_reason") if isinstance(delta, dict) else None
        if isinstance(stop_reason, str) and stop_reason.strip():
            return None

    # SDK 'assistant' messages carry content blocks
    if msg_type == "assistant":
        message = data.get("message", {})
        content = message.get("content", [])
        if isinstance(content, list):
            parts = [
                block["text"]
                for block in content
                if isinstance(block, dict)
                and block.get("type") == "text"
                and isinstance(block.get("text"), str)
                and block["text"].strip()
            ]
            return "\n".join(parts) if parts else None
        if isinstance(content, str) and content.strip():
            return content

    # SDK 'result' messages may also carry a result string
    if msg_type == "result":
        result = data.get("result", "")
        if isinstance(result, str) and result.strip():
            return result

    return None


def _normalize_provider(provider: Optional[str]) -> str:
    normalized = (provider or "claude").strip().lower()
    if normalized not in _PROVIDER_COMMAND_TYPES:
        raise ValueError(
            f"Unsupported provider '{provider}'. Expected one of: {', '.join(sorted(_PROVIDER_COMMAND_TYPES))}"
        )
    return normalized


def _session_identifier(session: Dict[str, Any]) -> str:
    for key in ("session_id", "sessionId", "id"):
        value = session.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def _extract_session_id(event: Dict[str, Any]) -> Optional[str]:
    for key in ("sessionId", "actualSessionId"):
        value = event.get(key)
        if isinstance(value, str) and value.strip():
            return value

    data = event.get("data")
    if isinstance(data, dict):
        for key in ("session_id", "sessionId", "id"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value

    return None


def _index_sessions_by_provider(sessions: List[Dict[str, Any]]) -> Dict[tuple[str, str], Dict[str, Any]]:
    index: Dict[tuple[str, str], Dict[str, Any]] = {}
    for session in sessions:
        provider = str(session.get("provider") or "claude").strip().lower()
        session_id = _session_identifier(session)
        if provider and session_id:
            index[(provider, session_id)] = session
    return index


def _build_processing_sessions(
    known_sessions: List[Dict[str, Any]],
    active_sessions: Dict[str, Any],
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    seen = set()
    session_index = _index_sessions_by_provider(known_sessions)

    for raw_provider, session_ids in active_sessions.items():
        provider = _normalize_provider(raw_provider)
        if not isinstance(session_ids, list):
            continue

        for raw_session_id in session_ids:
            session_id = str(raw_session_id or "").strip()
            if not session_id:
                continue

            key = (provider, session_id)
            if key in seen:
                continue
            seen.add(key)

            base = dict(session_index.get(key, {}))
            base["provider"] = provider
            base["session_id"] = session_id
            base.setdefault("summary", "")
            base.setdefault("project_id", base.get("project_name"))
            base.setdefault("project_name", None)
            base.setdefault("project_display_name", base.get("project_name"))
            base.setdefault("project_path", "")
            base["is_processing"] = True
            base["status"] = "waiting_for_response"
            rows.append(base)

    rows.sort(
        key=lambda row: (
            str(row.get("project_display_name") or row.get("project_name") or ""),
            str(row.get("provider") or ""),
            str(row.get("session_id") or ""),
        )
    )
    return rows


def _stable_waiting_row(session: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "project": session.get("project_name"),
        "project_display_name": session.get("project_display_name") or session.get("project_name"),
        "project_path": session.get("project_path") or "",
        "provider": session.get("provider") or "unknown",
        "session_id": session.get("session_id") or _session_identifier(session),
        "summary": session.get("summary") or "",
        "status": session.get("status") or "waiting_for_response",
        "is_processing": bool(session.get("is_processing", True)),
        "last_activity": session.get("lastActivity") or session.get("updatedAt") or session.get("createdAt") or "",
    }


def _compact_event(event: Dict[str, Any]) -> Dict[str, Any]:
    event_type = str(event.get("type") or "unknown")
    provider = event.get("provider")
    session_id = _extract_session_id(event)
    project_name = event.get("projectName") or event.get("project")

    compact = {
        "type": event_type,
        "provider": provider,
        "session_id": session_id,
        "project": project_name,
        "timestamp": event.get("timestamp") or "",
    }

    if event_type in ("taskmaster-project-updated", "taskmaster-tasks-updated"):
        compact["project"] = event.get("projectName")
    if event_type == "projects_updated":
        compact["change_type"] = event.get("changeType")
        compact["watch_provider"] = event.get("watchProvider")
        compact["changed_file"] = event.get("changedFile")
    if event_type == "claude-permission-request":
        compact["request_id"] = event.get("requestId")
        compact["tool_name"] = event.get("toolName")
    if event_type == "session-status":
        compact["is_processing"] = bool(event.get("isProcessing"))
    if event_type == "active-sessions":
        compact["providers"] = {
            provider_name: len(session_ids)
            for provider_name, session_ids in (event.get("sessions") or {}).items()
            if isinstance(session_ids, list)
        }
    if event_type == "session-aborted":
        compact["success"] = bool(event.get("success"))

    return compact


def _normalize_project_path(project_path: str) -> str:
    """Expand `~` and normalize filesystem-style project paths."""
    return os.path.abspath(os.path.expanduser(project_path))


def _ws_url_from_base(base_url: str) -> str:
    """Convert http(s)://host to ws(s)://host."""
    if base_url.startswith("https://"):
        return "wss://" + base_url[len("https://"):]
    if base_url.startswith("http://"):
        return "ws://" + base_url[len("http://"):]
    return base_url.rstrip("/")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def send_message(
    client: DrClaw,
    project_path: str,
    message: str,
    session_id: Optional[str] = None,
    provider: str = "claude",
    timeout: Optional[int] = None,
    permission_mode: Optional[str] = None,
    model: Optional[str] = None,
    attachments: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """
    Connect to the DrClaw WebSocket, send a provider command, collect the full
    response, and return {"reply": str, "session_id": str, "project_path": str}.
    """
    normalized_provider = _normalize_provider(provider)
    token = client._require_token()
    base_url = client.get_base_url()
    ws_base = _ws_url_from_base(base_url).rstrip("/")
    ws_url = f"{ws_base}/ws?token={token}"
    normalized_project_path = _normalize_project_path(project_path)

    # If no timeout is specified, we wait for a very long time (1 hour)
    # and rely on heartbeats to keep the connection alive.
    effective_timeout = timeout if timeout is not None else 3600
    is_long_wait = timeout is None

    async def _run() -> Dict[str, Any]:
        try:
            import websockets  # type: ignore
        except ImportError as exc:
            raise ImportError(
                "The 'websockets' package is required for chat commands. "
                "Install it with: pip install websockets>=11.0"
            ) from exc

        text_parts: List[str] = []
        stream_parts: List[str] = []
        captured_session_id: Optional[str] = session_id
        last_heartbeat = asyncio.get_event_loop().time()

        payload_options = {
            "cwd": normalized_project_path,
            "projectPath": normalized_project_path,
            "sessionId": session_id,
            "resume": session_id is not None,
        }
        if permission_mode:
            payload_options["permissionMode"] = permission_mode
        if model:
            payload_options["model"] = model
        if attachments:
            payload_options["attachments"] = attachments

        payload = {
            "type": _PROVIDER_COMMAND_TYPES[normalized_provider],
            "command": message,
            "options": payload_options,
        }

        async with websockets.connect(ws_url) as ws:
            await ws.send(json.dumps(payload))
            if is_long_wait:
                from ..utils.output import info
                info("Waiting for agent to complete task (Heartbeat enabled)...")

            async def receive_loop() -> None:
                nonlocal captured_session_id, last_heartbeat

                while True:
                    try:
                        # We use a smaller recv timeout to check for local heartbeat/timeout logic
                        raw = await asyncio.wait_for(ws.recv(), timeout=30)
                        last_heartbeat = asyncio.get_event_loop().time()
                    except asyncio.TimeoutError:
                        # No message for 30s, check if we've exceeded the total effective timeout
                        if asyncio.get_event_loop().time() - last_heartbeat > effective_timeout:
                            raise RuntimeError(f"Session timed out after {effective_timeout}s of inactivity.")
                        continue
                    except Exception:
                        return

                    try:
                        event = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    event_type = event.get("type", "")

                    # Reset inactivity timer on any valid event
                    last_heartbeat = asyncio.get_event_loop().time()

                    if event_type == "heartbeat":
                        # Optional: could print a dot or similar to show life
                        continue

                    # Capture session ID
                    if not captured_session_id:
                        sid = _extract_session_id(event)
                        if sid:
                            captured_session_id = sid

                    if event_type == "session-created":
                        captured_session_id = event.get("sessionId", captured_session_id)

                    elif event_type in ("claude-response", "gemini-response"):
                        data = event.get("data", {})
                        if isinstance(data, dict) and data.get("type") == "content_block_delta":
                            delta = data.get("delta", {})
                            delta_text = delta.get("text") if isinstance(delta, dict) else None
                            if isinstance(delta_text, str) and delta_text:
                                stream_parts.append(delta_text)
                            continue
                        if isinstance(data, dict) and data.get("type") == "content_block_stop":
                            if stream_parts:
                                text_parts.append("".join(stream_parts))
                                stream_parts.clear()
                            continue
                        text = _extract_text_from_agent_response(data)
                        if text:
                            text_parts.append(text)

                    elif event_type == "codex-response":
                        data = event.get("data", {})
                        text = _extract_text_from_agent_response(data)
                        if text:
                            text_parts.append(text)

                    elif event_type == "cursor-result":
                        data = event.get("data", {})
                        text = data.get("result") if isinstance(data, dict) else None
                        if isinstance(text, str) and text.strip():
                            text_parts.append(text)

                    elif event_type == "cursor-output":
                        text = event.get("data")
                        if isinstance(text, str) and text.strip():
                            text_parts.append(text)

                    elif event_type == "cursor-response":
                        data = event.get("data", {})
                        text = _extract_text_from_agent_response(data)
                        if text:
                            text_parts.append(text)

                    elif event_type in _COMPLETE_EVENT_TYPES:
                        captured_session_id = _extract_session_id(event) or captured_session_id
                        if stream_parts:
                            text_parts.append("".join(stream_parts))
                            stream_parts.clear()
                        return

                    elif event_type in _ERROR_EVENT_TYPES:
                        err_msg = event.get("error", "Unknown error from DrClaw server")
                        raise RuntimeError(f"DrClaw server error: {err_msg}")

                    elif event.get("final") or event.get("done"):
                        if stream_parts:
                            text_parts.append("".join(stream_parts))
                            stream_parts.clear()
                        return

            await receive_loop()

        reply = "\n".join(text_parts).strip()
        return {
            "reply": reply,
            "session_id": captured_session_id or "",
            "project_path": normalized_project_path,
            "provider": normalized_provider,
        }

    return asyncio.run(_run())


def _ws_request(
    client: DrClaw,
    payload: Dict[str, Any],
    expected_type: str,
    timeout: int = 20,
) -> Dict[str, Any]:
    token = client._require_token()
    base_url = client.get_base_url()
    ws_base = _ws_url_from_base(base_url).rstrip("/")
    ws_url = f"{ws_base}/ws?token={token}"

    async def _run() -> Dict[str, Any]:
        try:
            import websockets  # type: ignore
        except ImportError as exc:
            raise ImportError(
                "The 'websockets' package is required for chat commands. "
                "Install it with: pip install websockets>=11.0"
            ) from exc

        async with websockets.connect(ws_url) as ws:
            await ws.send(json.dumps(payload))

            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
                event = json.loads(raw)
                event_type = event.get("type")

                if event_type == expected_type:
                    return event

                if event_type in _ERROR_EVENT_TYPES:
                    err_msg = event.get("error", "Unknown error from DrClaw server")
                    raise RuntimeError(f"DrClaw server error: {err_msg}")

    return asyncio.run(_run())


def watch_events(
    client: DrClaw,
    *,
    timeout: Optional[int] = None,
    event_types: Optional[List[str]] = None,
    on_event: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> List[Dict[str, Any]]:
    """Watch websocket events until timeout or interruption."""
    token = client._require_token()
    base_url = client.get_base_url()
    ws_base = _ws_url_from_base(base_url).rstrip("/")
    ws_url = f"{ws_base}/ws?token={token}"
    wanted = {item.strip() for item in (event_types or []) if item and item.strip()}

    async def _run() -> List[Dict[str, Any]]:
        try:
            import websockets  # type: ignore
        except ImportError as exc:
            raise ImportError(
                "The 'websockets' package is required for chat commands. "
                "Install it with: pip install websockets>=11.0"
            ) from exc

        captured: List[Dict[str, Any]] = []
        async with websockets.connect(ws_url) as ws:
            async def consume() -> None:
                while True:
                    raw = await ws.recv()
                    try:
                        event = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    event_type = str(event.get("type") or "")
                    if event_type not in _WATCH_EVENT_TYPES and not event_type:
                        continue
                    if wanted and event_type not in wanted:
                        continue

                    compact = _compact_event(event)
                    captured.append(compact)
                    if on_event is not None:
                        on_event(compact)

            if timeout is None or timeout <= 0:
                await consume()
            else:
                await asyncio.wait_for(consume(), timeout=timeout)

        return captured

    try:
        return asyncio.run(_run())
    except asyncio.TimeoutError:
        return []


def get_active_sessions(client: DrClaw) -> List[Dict[str, Any]]:
    """
    Retrieve all active sessions across all projects.

    Returns a flat list of session dicts, each augmented with
    ``project_id`` and ``project_name`` keys.
    """
    projects_resp = client.get("/api/projects")
    projects_data = projects_resp.json()
    if isinstance(projects_data, dict):
        projects_list = projects_data.get("projects", [])
    else:
        projects_list = projects_data if isinstance(projects_data, list) else []

    all_sessions: List[Dict[str, Any]] = []
    for project in projects_list:
        project_name = project.get("name") or project.get("id") or ""
        project_label = (
            project.get("displayName")
            or project.get("display_name")
            or project_name
        )
        if not project_name:
            continue

        provider_collections = [
            ("claude", project.get("sessions") or []),
            ("cursor", project.get("cursorSessions") or []),
            ("codex", project.get("codexSessions") or []),
            ("gemini", project.get("geminiSessions") or []),
        ]

        for provider, sessions in provider_collections:
            if not isinstance(sessions, list):
                continue

            for session in sessions:
                if not isinstance(session, dict):
                    continue

                normalized = dict(session)
                normalized.setdefault("provider", provider)
                normalized.setdefault("session_id", _session_identifier(session))
                normalized.setdefault("project_id", project_name)
                normalized.setdefault("project_name", project_name)
                normalized.setdefault("project_display_name", project_label)
                normalized.setdefault("project_path", project.get("fullPath") or project.get("path") or "")
                normalized.setdefault(
                    "summary",
                    session.get("summary") or session.get("name") or session.get("title") or "",
                )
                all_sessions.append(normalized)

    return all_sessions


def get_processing_sessions(client: DrClaw) -> List[Dict[str, Any]]:
    """Retrieve sessions that the server reports as currently processing."""
    known_sessions = get_active_sessions(client)
    response = _ws_request(client, {"type": "get-active-sessions"}, expected_type="active-sessions")
    active_sessions = response.get("sessions", {})
    if not isinstance(active_sessions, dict):
        return []
    return _build_processing_sessions(known_sessions, active_sessions)


def get_waiting_sessions_compact(client: DrClaw) -> List[Dict[str, Any]]:
    """Retrieve a stable, compact waiting-session schema for automation."""
    return [_stable_waiting_row(session) for session in get_processing_sessions(client)]


def check_session_status(client: DrClaw, session_id: str, provider: str = "claude") -> Dict[str, Any]:
    """Check whether a specific session is currently processing."""
    normalized_provider = _normalize_provider(provider)
    return _ws_request(
        client,
        {
            "type": "check-session-status",
            "sessionId": session_id,
            "provider": normalized_provider,
        },
        expected_type="session-status",
    )
