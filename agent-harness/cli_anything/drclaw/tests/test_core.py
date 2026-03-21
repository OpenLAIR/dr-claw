"""
Unit tests for cli_anything.drclaw core modules.

All tests mock HTTP calls so no running server is required.

Run with:
    PYTHONPATH=agent-harness python3 -m unittest cli_anything.drclaw.tests.test_core -q
    pytest agent-harness/cli_anything/drclaw/tests/test_core.py -q
"""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers - build fake requests.Response objects
# ---------------------------------------------------------------------------

def _fake_response(json_data, status_code=200):
    """Return a mock requests.Response that returns *json_data* from .json()."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.raise_for_status.return_value = None
    return resp


# ---------------------------------------------------------------------------
# session.py tests
# ---------------------------------------------------------------------------

class TestSessionFile(unittest.TestCase):
    """Tests for token persistence helpers in session.py."""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.session_path = Path(self.tmpdir) / ".vibelab_session.json"

    def _patch_session_file(self):
        return patch("cli_anything.drclaw.core.session.SESSION_FILE", self.session_path)

    def _patch_legacy_session_file(self):
        return patch("cli_anything.drclaw.core.session.LEGACY_SESSION_FILE", self.session_path)

    def test_login_stores_token(self):
        """login() should write the JWT token to the session file."""
        from cli_anything.drclaw.core.session import DrClaw

        fake_resp = _fake_response(
            {"success": True, "token": "fake-jwt-token", "user": {"username": "alice"}}
        )

        with self._patch_session_file(), self._patch_legacy_session_file():
            client = DrClaw()
            with patch.object(client._session, "post", return_value=fake_resp):
                result = client.login("alice", "secret")

        self.assertEqual(result["token"], "fake-jwt-token")
        stored = json.loads(self.session_path.read_text())
        self.assertEqual(stored["token"], "fake-jwt-token")
        self.assertEqual(stored["username"], "alice")

    def test_logout_removes_session_file(self):
        """logout() should delete the session file."""
        from cli_anything.drclaw.core.session import DrClaw

        self.session_path.write_text(json.dumps({"token": "old-token"}))

        with self._patch_session_file(), self._patch_legacy_session_file():
            client = DrClaw()
            client.logout()

        self.assertFalse(self.session_path.exists())

    def test_get_token_reads_session_file(self):
        """get_token() should return the token from the session file."""
        from cli_anything.drclaw.core.session import DrClaw

        self.session_path.write_text(json.dumps({"token": "stored-token"}))

        with self._patch_session_file(), self._patch_legacy_session_file():
            client = DrClaw()
            token = client.get_token()

        self.assertEqual(token, "stored-token")

    def test_get_token_prefers_env_var(self):
        """DRCLAW_TOKEN env var should take precedence over the session file."""
        from cli_anything.drclaw.core.session import DrClaw

        self.session_path.write_text(json.dumps({"token": "file-token"}))

        with self._patch_session_file(), self._patch_legacy_session_file():
            # Test DRCLAW_TOKEN (highest priority)
            with patch.dict(os.environ, {"DRCLAW_TOKEN": "env-token"}):
                client = DrClaw()
                token = client.get_token()
                self.assertEqual(token, "env-token")
            
            # Test VIBELAB_TOKEN (fallback)
            with patch.dict(os.environ, {"VIBELAB_TOKEN": "legacy-token"}):
                client = DrClaw()
                token = client.get_token()
                self.assertEqual(token, "legacy-token")

    def test_not_logged_in_error(self):
        """Calling get() without a token raises NotLoggedInError."""
        from cli_anything.drclaw.core.session import NotLoggedInError, DrClaw

        with self._patch_session_file(), self._patch_legacy_session_file():
            client = DrClaw()
            with self.assertRaises(NotLoggedInError):
                client.get("/api/projects")

    def test_get_base_url_default(self):
        """get_base_url() should fall back to localhost:3001."""
        from cli_anything.drclaw.core.session import DrClaw

        with self._patch_session_file(), self._patch_legacy_session_file():
            with patch.dict(os.environ, {}, clear=True):
                client = DrClaw()
                url = client.get_base_url()

        self.assertEqual(url, "http://localhost:3001")

    def test_get_base_url_env_var(self):
        """DRCLAW_URL env var overrides the default."""
        from cli_anything.drclaw.core.session import DrClaw

        with self._patch_session_file(), self._patch_legacy_session_file():
            with patch.dict(os.environ, {"DRCLAW_URL": "http://myserver:4000"}):
                client = DrClaw()
                url = client.get_base_url()
                self.assertEqual(url, "http://myserver:4000")
            
            with patch.dict(os.environ, {"VIBELAB_URL": "http://legacy:5000"}):
                client = DrClaw()
                url = client.get_base_url()
                self.assertEqual(url, "http://legacy:5000")

    def test_get_base_url_override_param(self):
        """url_override constructor param takes highest precedence."""
        from cli_anything.drclaw.core.session import DrClaw

        with self._patch_session_file(), self._patch_legacy_session_file():
            with patch.dict(os.environ, {"DRCLAW_URL": "http://env:9000"}):
                client = DrClaw(url_override="http://explicit:1234")
                url = client.get_base_url()

        self.assertEqual(url, "http://explicit:1234")


# ---------------------------------------------------------------------------
# projects.py tests
# ---------------------------------------------------------------------------

class TestProjects(unittest.TestCase):

    def _make_client(self, json_data, status_code=200):
        """Return a DrClaw client whose HTTP methods return fake responses."""
        from cli_anything.drclaw.core.session import DrClaw

        client = DrClaw()
        client.get = MagicMock(return_value=_fake_response(json_data, status_code))
        client.put = MagicMock(return_value=_fake_response({"success": True}))
        client.post = MagicMock(return_value=_fake_response({"success": True, "project": {"name": "proj-abc"}}))
        client.delete = MagicMock(return_value=_fake_response({"success": True}))
        return client

    def test_list_projects_returns_list(self):
        """list_projects() should return the list of project dicts."""
        from cli_anything.drclaw.core.projects import list_projects

        projects = [
            {"id": "p1", "display_name": "Alpha"},
            {"id": "p2", "display_name": "Beta"},
        ]
        client = self._make_client(projects)
        result = list_projects(client)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["id"], "p1")

    def test_list_projects_unwraps_dict(self):
        """list_projects() handles a server response wrapped in {projects: [...]}."""
        from cli_anything.drclaw.core.projects import list_projects

        wrapped = {"projects": [{"id": "p3", "display_name": "Gamma"}]}
        client = self._make_client(wrapped)
        result = list_projects(client)
        self.assertEqual(result[0]["id"], "p3")

    def test_rename_project_calls_put(self):
        """rename_project() should PUT the correct URL and payload."""
        from cli_anything.drclaw.core.projects import rename_project

        client = self._make_client({})
        rename_project(client, "proj-abc", "New Name")
        client.put.assert_called_once_with(
            "/api/projects/proj-abc/rename", {"displayName": "New Name"}
        )

    def test_add_project_manual_calls_create_endpoint(self):
        """add_project_manual() should POST to the supported create-project route."""
        from cli_anything.drclaw.core.projects import add_project_manual

        client = self._make_client({})
        result = add_project_manual(client, "/tmp/demo", display_name="Demo")
        client.post.assert_called_once_with(
            "/api/projects", {"path": "/tmp/demo", "displayName": "Demo"}
        )
        self.assertEqual(result["name"], "proj-abc")

    def test_delete_project_calls_delete(self):
        """delete_project() should DELETE the correct URL."""
        from cli_anything.drclaw.core.projects import delete_project

        client = self._make_client({})
        result = delete_project(client, "proj-abc")
        client.delete.assert_called_once_with("/api/projects/proj-abc")
        self.assertTrue(result)

    def test_create_project_workspace_calls_create_workspace_endpoint(self):
        """create_project_workspace() should POST to the new-workspace endpoint."""
        from cli_anything.drclaw.core.projects import create_project_workspace

        client = self._make_client({})
        result = create_project_workspace(client, "/tmp/new-proj", display_name="New Proj")
        client.post.assert_called_once_with(
            "/api/projects/create-workspace",
            {"workspaceType": "new", "path": "/tmp/new-proj", "displayName": "New Proj"},
        )
        self.assertEqual(result["name"], "proj-abc")

    def test_create_project_workspace_passes_github_url(self):
        """create_project_workspace() should forward an optional github URL."""
        from cli_anything.drclaw.core.projects import create_project_workspace

        client = self._make_client({})
        create_project_workspace(
            client,
            "/tmp/new-proj",
            display_name="New Proj",
            github_url="https://github.com/example/repo",
        )
        client.post.assert_called_once_with(
            "/api/projects/create-workspace",
            {
                "workspaceType": "new",
                "path": "/tmp/new-proj",
                "displayName": "New Proj",
                "githubUrl": "https://github.com/example/repo",
            },
        )

class TestDigests(unittest.TestCase):

    def _make_client(self, json_data, status_code=200):
        """Return a DrClaw client whose HTTP methods return fake responses."""
        from cli_anything.drclaw.core.session import DrClaw

        client = DrClaw()
        client.get = MagicMock(return_value=_fake_response(json_data, status_code))
        client.put = MagicMock(return_value=_fake_response({"success": True}))
        client.post = MagicMock(return_value=_fake_response({"success": True, "project": {"name": "proj-abc"}}))
        client.delete = MagicMock(return_value=_fake_response({"success": True}))
        return client

    def test_build_portfolio_digest_recommends_waiting_project(self):
        from cli_anything.drclaw.drclaw_cli import _build_portfolio_digest

        items = [
            {
                "project": "proj-1",
                "project_display_name": "Project One",
                "project_path": "/tmp/proj-1",
                "status": "in-progress",
                "counts": {"total": 4, "completed": 1, "in_progress": 1, "pending": 2, "blocked": 0},
                "latest_session": {"session_id": "sess-1", "last_assistant_message": "Please answer the following questions?"},
                "updated_at": "2026-03-16T00:00:00Z",
            }
        ]
        waiting_rows = [
            {
                "project": "proj-1",
                "project_display_name": "Project One",
                "session_id": "sess-1",
                "summary": "waiting summary",
            }
        ]

        payload = _build_portfolio_digest(items, waiting_rows)
        self.assertEqual(payload["summary"]["high_priority_projects"], 1)
        self.assertEqual(payload["recommendations"][0]["action"], "reply")
        self.assertEqual(payload["recommendations"][0]["session_id"], "sess-1")

    def test_get_project_latest_message_picks_latest_session(self):
        """get_project_latest_message() should return the newest session snapshot."""
        from cli_anything.drclaw.core.projects import get_project_latest_message

        client = self._make_client({})
        project = {
            "name": "proj-1",
            "displayName": "Project One",
            "fullPath": "/tmp/proj-1",
            "sessions": [
                {
                    "id": "old-session",
                    "lastActivity": "2026-03-15T10:00:00.000Z",
                    "lastAssistantMessage": "old reply",
                },
                {
                    "id": "new-session",
                    "lastActivity": "2026-03-16T10:00:00.000Z",
                    "lastAssistantMessage": "new reply",
                },
            ],
        }

        payload = get_project_latest_message(client, project)
        self.assertEqual(payload["session"]["session_id"], "new-session")
        self.assertEqual(payload["session"]["last_assistant_message"], "new reply")

    def test_get_project_latest_message_filters_provider(self):
        """get_project_latest_message() should respect an optional provider filter."""
        from cli_anything.drclaw.core.projects import get_project_latest_message

        client = self._make_client({})
        project = {
            "name": "proj-1",
            "displayName": "Project One",
            "fullPath": "/tmp/proj-1",
            "sessions": [{"id": "claude-session", "lastActivity": "2026-03-16T10:00:00.000Z"}],
            "codexSessions": [{"id": "codex-session", "lastActivity": "2026-03-16T12:00:00.000Z"}],
        }

        payload = get_project_latest_message(client, project, provider="claude")
        self.assertEqual(payload["session"]["session_id"], "claude-session")
        self.assertEqual(payload["session"]["provider"], "claude")


# ---------------------------------------------------------------------------
# conversations.py tests
# ---------------------------------------------------------------------------

class TestConversations(unittest.TestCase):

    def test_list_sessions_returns_page(self):
        """list_sessions() should call the project-scoped endpoint and preserve pagination metadata."""
        from cli_anything.drclaw.core.conversations import list_sessions
        from cli_anything.drclaw.core.session import DrClaw

        payload = {"sessions": [{"id": "s1", "title": "First session"}], "total": 1, "hasMore": False}
        client = DrClaw()
        client.get = MagicMock(return_value=_fake_response(payload))

        result = list_sessions(client, "proj-123", limit=10, offset=5, include_meta=True)
        client.get.assert_called_once_with(
            "/api/projects/proj-123/sessions",
            params={"limit": 10, "offset": 5},
        )
        self.assertEqual(result["sessions"][0]["id"], "s1")
        self.assertEqual(result["total"], 1)

    def test_get_session_messages_returns_messages(self):
        """get_session_messages() should unwrap messages and pass provider pagination params."""
        from cli_anything.drclaw.core.conversations import get_session_messages
        from cli_anything.drclaw.core.session import DrClaw

        payload = {
            "messages": [
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": "Hi there!"},
            ],
            "total": 2,
            "hasMore": False,
        }
        client = DrClaw()
        client.get = MagicMock(return_value=_fake_response(payload))

        result = get_session_messages(
            client,
            "proj-123",
            "sess-456",
            limit=50,
            offset=10,
            provider="cursor",
            include_meta=True,
        )
        client.get.assert_called_once_with(
            "/api/projects/proj-123/sessions/sess-456/messages",
            params={"limit": 50, "offset": 10, "provider": "cursor"},
        )
        self.assertEqual(len(result["messages"]), 2)
        self.assertEqual(result["messages"][1]["role"], "assistant")


# ---------------------------------------------------------------------------
# taskmaster.py tests
# ---------------------------------------------------------------------------

class TestTaskMaster(unittest.TestCase):

    def test_get_summary_hits_server_summary_endpoint(self):
        """get_summary() should call the dedicated summary endpoint."""
        from cli_anything.drclaw.core.session import DrClaw
        from cli_anything.drclaw.core.taskmaster import get_summary

        client = DrClaw()
        client.get = MagicMock(return_value=_fake_response({"project": "proj-123", "status": "taskmaster-only"}))

        result = get_summary(client, "proj-123")
        client.get.assert_called_once_with("/api/taskmaster/summary/proj-123")
        self.assertEqual(result["project"], "proj-123")

    def test_build_summary_falls_back_to_composed_calls(self):
        """build_summary() should compute a stable summary if the server summary route is unavailable."""
        from requests import HTTPError

        from cli_anything.drclaw.core.session import DrClaw
        from cli_anything.drclaw.core.taskmaster import build_summary

        client = DrClaw()

        responses = {
            "/api/taskmaster/detect/proj-123": _fake_response(
                {"projectPath": "/tmp/proj-123", "status": "taskmaster-only", "timestamp": "2026-03-15T00:00:00Z"}
            ),
            "/api/taskmaster/tasks/proj-123": _fake_response(
                {
                    "projectPath": "/tmp/proj-123",
                    "tasks": [
                        {"id": 1, "status": "done", "title": "Done task"},
                        {"id": 2, "status": "pending", "title": "Pending task"},
                    ],
                    "tasksByStatus": {"done": 1, "pending": 1, "in-progress": 0},
                    "totalTasks": 2,
                    "timestamp": "2026-03-15T00:01:00Z",
                }
            ),
            "/api/taskmaster/next/proj-123": _fake_response(
                {"nextTask": {"id": 2, "title": "Pending task"}, "timestamp": "2026-03-15T00:02:00Z"}
            ),
            "/api/taskmaster/next-guidance/proj-123": _fake_response(
                {
                    "nextTask": {"id": 2, "title": "Pending task"},
                    "guidance": {"whyNext": "Do this next", "suggestedSkills": ["inno-experiment-dev"]},
                    "timestamp": "2026-03-15T00:03:00Z",
                }
            ),
        }

        def fake_get(path, **kwargs):
            if path == "/api/taskmaster/summary/proj-123":
                raise HTTPError("not found")
            return responses[path]

        client.get = MagicMock(side_effect=fake_get)
        summary = build_summary(client, "proj-123")

        self.assertEqual(summary["project"], "proj-123")
        self.assertEqual(summary["counts"]["total"], 2)
        self.assertEqual(summary["counts"]["completed"], 1)
        self.assertEqual(summary["counts"]["completion_rate"], 50.0)
        self.assertEqual(summary["next_task"]["id"], 2)
        self.assertEqual(summary["guidance"]["whyNext"], "Do this next")


# ---------------------------------------------------------------------------
# chat.py tests
# ---------------------------------------------------------------------------

class TestChat(unittest.TestCase):

    def test_get_active_sessions_normalizes_provider_metadata(self):
        from cli_anything.drclaw.core.chat import get_active_sessions
        from cli_anything.drclaw.core.session import DrClaw

        client = DrClaw()
        client.get = MagicMock(return_value=_fake_response({
            "projects": [
                {
                    "name": "proj-1",
                    "displayName": "Project One",
                    "fullPath": "/tmp/proj-1",
                    "sessions": [{"id": "claude-1", "summary": "Claude summary"}],
                    "cursorSessions": [{"sessionId": "cursor-1", "title": "Cursor title"}],
                }
            ]
        }))

        sessions = get_active_sessions(client)

        self.assertEqual(len(sessions), 2)
        self.assertEqual(sessions[0]["project_display_name"], "Project One")
        self.assertEqual(sessions[0]["project_path"], "/tmp/proj-1")
        self.assertEqual(sessions[1]["provider"], "cursor")
        self.assertEqual(sessions[1]["session_id"], "cursor-1")
        self.assertEqual(sessions[1]["summary"], "Cursor title")

    def test_get_processing_sessions_maps_server_active_sessions(self):
        from cli_anything.drclaw.core.chat import get_processing_sessions
        from cli_anything.drclaw.core.session import DrClaw

        client = DrClaw()

        known_sessions = [
            {
                "provider": "claude",
                "session_id": "claude-1",
                "project_name": "proj-1",
                "project_display_name": "Project One",
                "project_path": "/tmp/proj-1",
                "summary": "Needs reply",
            }
        ]

        with patch("cli_anything.drclaw.core.chat.get_active_sessions", return_value=known_sessions), patch(
            "cli_anything.drclaw.core.chat._ws_request",
            return_value={
                "type": "active-sessions",
                "sessions": {
                    "claude": ["claude-1"],
                    "cursor": ["cursor-2"],
                },
            },
        ):
            rows = get_processing_sessions(client)

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["provider"], "cursor")
        self.assertEqual(rows[0]["project_name"], None)
        self.assertEqual(rows[1]["provider"], "claude")
        self.assertEqual(rows[1]["project_name"], "proj-1")
        self.assertTrue(rows[1]["is_processing"])
        self.assertEqual(rows[1]["status"], "waiting_for_response")

    def test_check_session_status_uses_websocket_request(self):
        from cli_anything.drclaw.core.chat import check_session_status
        from cli_anything.drclaw.core.session import DrClaw

        client = DrClaw()
        with patch(
            "cli_anything.drclaw.core.chat._ws_request",
            return_value={"type": "session-status", "sessionId": "sess-1", "provider": "codex", "isProcessing": True},
        ) as ws_request:
            result = check_session_status(client, "sess-1", provider="codex")

        ws_request.assert_called_once_with(
            client,
            {"type": "check-session-status", "sessionId": "sess-1", "provider": "codex"},
            expected_type="session-status",
        )
        self.assertTrue(result["isProcessing"])

    def test_get_waiting_sessions_compact_returns_stable_schema(self):
        from cli_anything.drclaw.core.chat import get_waiting_sessions_compact
        from cli_anything.drclaw.core.session import DrClaw

        client = DrClaw()
        with patch(
            "cli_anything.drclaw.core.chat.get_processing_sessions",
            return_value=[
                {
                    "project_name": "proj-1",
                    "project_display_name": "Project One",
                    "project_path": "/tmp/proj-1",
                    "provider": "claude",
                    "session_id": "sess-1",
                    "summary": "Need approval",
                    "status": "waiting_for_response",
                    "is_processing": True,
                    "lastActivity": "2026-03-15T00:00:00Z",
                }
            ],
        ):
            rows = get_waiting_sessions_compact(client)

        self.assertEqual(rows[0]["project"], "proj-1")
        self.assertEqual(rows[0]["project_display_name"], "Project One")
        self.assertEqual(rows[0]["last_activity"], "2026-03-15T00:00:00Z")


class TestCliHelpers(unittest.TestCase):

    def _make_context(self):
        from cli_anything.drclaw.drclaw_cli import Context
        from cli_anything.drclaw.core.session import DrClaw

        return Context(json_mode=True, client=DrClaw(), lang="en")

    def test_resolve_session_provider_finds_unique_provider(self):
        from cli_anything.drclaw.drclaw_cli import _resolve_session_provider
        from cli_anything.drclaw.core.session import DrClaw

        client = DrClaw()
        project = {"name": "proj-1", "displayName": "Project One", "fullPath": "/tmp/proj-1"}

        with patch(
            "cli_anything.drclaw.drclaw_cli.chat_mod.get_active_sessions",
            return_value=[
                {"project_name": "proj-1", "provider": "codex", "session_id": "sess-1"},
                {"project_name": "proj-1", "provider": "claude", "session_id": "sess-2"},
            ],
        ):
            provider = _resolve_session_provider(client, project, "sess-1")

        self.assertEqual(provider, "codex")

    def test_resolve_session_provider_raises_when_missing(self):
        from cli_anything.drclaw.drclaw_cli import _resolve_session_provider
        from cli_anything.drclaw.core.session import DrClaw

        client = DrClaw()
        project = {"name": "proj-1", "displayName": "Project One", "fullPath": "/tmp/proj-1"}

        with patch(
            "cli_anything.drclaw.drclaw_cli.chat_mod.get_active_sessions",
            return_value=[],
        ):
            with self.assertRaises(ValueError):
                _resolve_session_provider(client, project, "missing-session")

    def test_maybe_send_openclaw_chat_notification_disabled(self):
        from unittest.mock import MagicMock
        from cli_anything.drclaw.drclaw_cli import _maybe_send_openclaw_chat_notification

        mock_ctx = MagicMock()
        result = _maybe_send_openclaw_chat_notification(
            self._make_context(),
            {"project": "proj-1", "provider": "claude", "session_id": "sess-1", "reply": "done"},
            action="chat_reply",
            notify_openclaw=False,
            notify_channel=None,
        )

        self.assertFalse(result["enabled"])
        self.assertFalse(result["sent"])

    def test_maybe_send_openclaw_chat_notification_sends_message(self):
        from unittest.mock import MagicMock
        from cli_anything.drclaw.drclaw_cli import _maybe_send_openclaw_chat_notification

        mock_ctx = MagicMock()
        with patch(
            "cli_anything.drclaw.drclaw_cli._resolve_push_channel",
            return_value="feishu:test",
        ), patch(
            "cli_anything.drclaw.drclaw_cli._send_openclaw_message",
            return_value="ok",
        ) as send_message:
            result = _maybe_send_openclaw_chat_notification(
                self._make_context(),
                {
                    "project_display_name": "Project One",
                    "provider": "claude",
                    "session_id": "sess-1",
                    "reply": "completed successfully",
                },
                action="chat_reply",
                notify_openclaw=True,
                notify_channel=None,
            )

        self.assertTrue(result["sent"])
        self.assertEqual(result["channel"], "feishu:test")
        self.assertIn("Project One", result["message"])
        send_message.assert_called_once()

    def test_install_openclaw_skill_copies_skill_tree_and_updates_session(self):
        from cli_anything.drclaw.drclaw_cli import _install_openclaw_skill

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            openclaw_home = tmp_path / ".openclaw"
            session_file = tmp_path / ".vibelab_session.json"
            source_dir = tmp_path / "skills-src"
            scripts_dir = source_dir / "scripts"
            scripts_dir.mkdir(parents=True)
            (source_dir / "SKILL.md").write_text("# skill\n")
            wrapper = scripts_dir / "openclaw_drclaw_turn.sh"
            wrapper.write_text("#!/bin/sh\nexit 0\n")
            waiter = scripts_dir / "drclaw_wait_until_clear.sh"
            waiter.write_text("#!/bin/sh\nexit 0\n")

            with patch("cli_anything.drclaw.drclaw_cli._OPENCLAW_SKILL_SOURCE_DIR", source_dir), patch(
                "cli_anything.drclaw.drclaw_cli.SESSION_FILE", session_file
            ), patch(
                "cli_anything.drclaw.core.session.SESSION_FILE", session_file
            ), patch(
                "cli_anything.drclaw.drclaw_cli._resolve_current_drclaw_bin",
                return_value="/tmp/bin/drclaw",
            ):
                payload = _install_openclaw_skill(
                    openclaw_dir=str(openclaw_home),
                    server_url="http://localhost:3001",
                    push_channel="feishu:test",
                )

            installed_skill = openclaw_home / "workspace" / "skills" / "drclaw" / "SKILL.md"
            installed_wrapper = openclaw_home / "workspace" / "skills" / "drclaw" / "scripts" / "openclaw_drclaw_turn.sh"
            self.assertTrue(installed_skill.exists())
            self.assertTrue(installed_wrapper.exists())
            self.assertTrue(installed_wrapper.stat().st_mode & 0o111)
            self.assertEqual(payload["installed_file_count"], 3)
            self.assertEqual(payload["server_url"], "http://localhost:3001")
            self.assertEqual(payload["push_channel"], "feishu:test")
            session_data = json.loads(session_file.read_text())
            self.assertEqual(session_data["base_url"], "http://localhost:3001")
            self.assertEqual(session_data["openclaw_push_channel"], "feishu:test")
            self.assertEqual(session_data["openclaw_drclaw_bin"], "/tmp/bin/drclaw")

    def test_build_artifact_brief_compacts_server_payload(self):
        from cli_anything.drclaw.drclaw_cli import _build_artifact_brief

        brief = _build_artifact_brief(
            {
                "projectName": "proj-1",
                "projectPath": "/tmp/proj-1",
                "totalArtifacts": 2,
                "latestArtifact": {"relativePath": "results/metrics.json", "modified": "2026-03-15T00:00:00Z"},
                "artifacts": [
                    {"relativePath": "results/metrics.json", "category": "results", "modified": "2026-03-15T00:00:00Z"},
                    {"relativePath": ".pipeline/docs/research_brief.json", "category": ".pipeline/docs", "modified": "2026-03-14T00:00:00Z"},
                ],
            }
        )

        self.assertEqual(brief["latest_artifact"], "results/metrics.json")
        self.assertEqual(brief["artifact_count"], 2)
        self.assertEqual(len(brief["artifacts"]), 2)

    def test_build_openclaw_turn_schema_marks_decision_needed(self):
        from cli_anything.drclaw.drclaw_cli import _build_openclaw_turn_schema

        schema = _build_openclaw_turn_schema(
            project={"name": "proj-1", "displayName": "Project One", "fullPath": "/tmp/proj-1"},
            provider="claude",
            session_id="sess-1",
            reply="Please confirm the dataset choice?",
            action="reply",
            waiting_rows=[],
        )

        self.assertEqual(schema["schema_version"], "openclaw.turn.v1")
        self.assertTrue(schema["decision"]["needed"])
        self.assertEqual(schema["turn"]["reply_kind"], "question")
        self.assertEqual(schema["next_actions"][0]["id"], "reply")

    def test_build_openclaw_project_schema_marks_attention(self):
        from cli_anything.drclaw.drclaw_cli import _build_openclaw_project_schema

        schema = _build_openclaw_project_schema(
            {
                "project": "proj-1",
                "project_display_name": "Project One",
                "project_path": "/tmp/proj-1",
                "status": "in-progress",
                "counts": {"total": 5, "completed": 1, "in_progress": 1, "pending": 2, "blocked": 1},
                "next_task": {"id": 2, "title": "Run eval"},
                "guidance": {"whyNext": "Need validation"},
                "waiting": [],
                "artifacts": {},
                "updated_at": "2026-03-21T12:00:00Z",
            }
        )

        self.assertEqual(schema["schema_version"], "openclaw.project.v1")
        self.assertEqual(schema["project"]["state"], "attention_needed")
        self.assertTrue(schema["decision"]["needed"])

    def test_build_openclaw_portfolio_schema_exposes_focus(self):
        from cli_anything.drclaw.drclaw_cli import _build_openclaw_portfolio_schema

        schema = _build_openclaw_portfolio_schema(
            {
                "summary": {"project_count": 2, "high_priority_projects": 1},
                "projects": [{"project": "proj-1"}, {"project": "proj-2"}],
                "recommendations": [
                    {"project": "proj-1", "project_display_name": "Project One", "priority": "high", "action": "reply"}
                ],
            }
        )

        self.assertEqual(schema["schema_version"], "openclaw.portfolio.v1")
        self.assertTrue(schema["decision"]["needed"])
        self.assertEqual(schema["focus"][0]["project_display_name"], "Project One")

    def test_build_openclaw_event_schema_maps_permission_request(self):
        from cli_anything.drclaw.drclaw_cli import _build_openclaw_event_schema

        schema = _build_openclaw_event_schema(
            {"type": "claude-permission-request", "project": "proj-1", "session_id": "sess-1", "timestamp": "2026-03-21T12:00:00Z"}
        )

        self.assertEqual(schema["schema_version"], "openclaw.event.v1")
        self.assertEqual(schema["event"]["mapped_kind"], "human_decision_needed")


class TestOpenClawWatcherDaemon(unittest.TestCase):

    def test_should_notify_deduplicates_same_signature(self):
        from cli_anything.drclaw.core import openclaw_daemon as daemon_mod

        state = {"seen_events": {}}
        event = {
            "type": "claude-permission-request",
            "project": "proj-1",
            "provider": "claude",
            "session_id": "sess-1",
            "tool_name": "write_file",
        }
        portfolio_event = {"decision": {"reason": "waiting_session"}, "project": {"state": "attention_needed"}}

        self.assertTrue(daemon_mod._should_notify(state, dict(event), portfolio_event))
        self.assertFalse(daemon_mod._should_notify(state, dict(event), portfolio_event))

    def test_should_notify_filters_unimportant_event(self):
        from cli_anything.drclaw.core import openclaw_daemon as daemon_mod

        state = {"seen_events": {}}
        event = {"type": "active-sessions", "project": "proj-1"}
        self.assertFalse(daemon_mod._should_notify(state, event, None))

    def test_build_event_message_includes_tool_name(self):
        from cli_anything.drclaw.core import openclaw_daemon as daemon_mod

        message = daemon_mod._build_event_message(
            {
                "type": "claude-permission-request",
                "project": "proj-1",
                "provider": "claude",
                "session_id": "sess-1",
                "tool_name": "edit_file",
                "openclaw": {"event": {"mapped_kind": "human_decision_needed"}},
            },
            {"decision": {"needed": True, "reason": "waiting_session"}, "next_actions": [{"label": "Check Status"}]},
        )

        self.assertIn("Tool: edit_file", message)
        self.assertIn("Decision: waiting_session", message)

    def test_derive_signals_detects_waiting_and_completion(self):
        from cli_anything.drclaw.core import openclaw_daemon as daemon_mod

        signals = daemon_mod._derive_signals(
            {"type": "taskmaster-update", "project": "proj-1"},
            {"waiting": 0, "blocked": 0, "completed": 1, "next_task_id": 1, "next_task_title": "A"},
            {"waiting": 1, "blocked": 0, "completed": 2, "next_task_id": 2, "next_task_title": "B"},
        )

        kinds = {row["kind"] for row in signals}
        self.assertIn("waiting_for_human", kinds)
        self.assertIn("task_completed", kinds)
        self.assertIn("next_task_changed", kinds)

    def test_should_emit_signal_filters_empty_noise(self):
        from cli_anything.drclaw.core import openclaw_daemon as daemon_mod

        self.assertFalse(daemon_mod._should_emit_signal({"type": "taskmaster-update"}, [], None))

    def test_extract_delivery_message_prefers_delivered_text(self):
        from cli_anything.drclaw.core import openclaw_daemon as daemon_mod

        text = daemon_mod._extract_delivery_message('{"delivered_text":"项目 A 已完成实验，下一步请确认是否发布。"}')
        self.assertEqual(text, "项目 A 已完成实验，下一步请确认是否发布。")

    def test_extract_delivery_message_reads_agent_payload_after_plugin_logs(self):
        from cli_anything.drclaw.core import openclaw_daemon as daemon_mod

        raw = (
            "[plugins] feishu_chat: Registered\n"
            "[plugins] other: Registered\n"
            '{"status":"ok","result":{"payloads":[{"text":"项目 B 发现 blocker，需先决定是否解除依赖。"}]}}'
        )
        text = daemon_mod._extract_delivery_message(raw)
        self.assertEqual(text, "项目 B 发现 blocker，需先决定是否解除依赖。")

    def test_build_project_digest_avoids_waiting_websocket_calls(self):
        from cli_anything.drclaw.core import openclaw_daemon as daemon_mod

        client = MagicMock()
        project = {"name": "proj-1", "displayName": "Project One", "fullPath": "/tmp/proj-1"}

        with patch(
            "cli_anything.drclaw.core.openclaw_daemon.taskmaster_mod.build_summary",
            return_value={"status": "taskmaster-only", "counts": {"total": 1, "completed": 0}, "next_task": {}, "guidance": {}, "updated_at": "2026-03-21T22:00:00Z"},
        ), patch(
            "cli_anything.drclaw.core.openclaw_daemon.taskmaster_mod.get_artifact_summary",
            return_value={"artifacts": [], "latestArtifact": {}, "totalArtifacts": 0},
        ), patch(
            "cli_anything.drclaw.core.openclaw_daemon.chat_mod.get_waiting_sessions_compact",
            side_effect=AssertionError("watcher should not query waiting websocket state here"),
        ):
            digest = daemon_mod._build_project_digest(client, project)

        self.assertEqual(digest["waiting"], [])

    def test_record_notification_keeps_recent_entries_only(self):
        from cli_anything.drclaw.core import openclaw_daemon as daemon_mod

        state = {"last_notifications": []}
        for idx in range(25):
            daemon_mod._record_notification(state, {"type": "taskmaster-update", "project": f"proj-{idx}"}, f"msg-{idx}")

        self.assertEqual(len(state["last_notifications"]), 20)
        self.assertEqual(state["last_notifications"][0]["project"], "proj-5")

    def test_build_daily_digest_aggregates_counts(self):
        from cli_anything.drclaw.drclaw_cli import _build_daily_digest

        digest = _build_daily_digest(
            [
                {"counts": {"total": 5, "completed": 2}, "waiting": [{}, {}]},
                {"counts": {"total": 3, "completed": 1}, "waiting": [{}]},
            ]
        )

        self.assertEqual(digest["summary"]["project_count"], 2)
        self.assertEqual(digest["summary"]["waiting_sessions"], 3)
        self.assertEqual(digest["summary"]["tasks_total"], 8)
        self.assertEqual(digest["summary"]["tasks_completed"], 3)


# ---------------------------------------------------------------------------
# output.py tests
# ---------------------------------------------------------------------------

class TestOutput(unittest.TestCase):

    def _capture(self, fn, *args, **kwargs):
        """Run fn() and capture both stdout and stderr."""
        import io
        from contextlib import redirect_stderr, redirect_stdout

        stdout_buf = io.StringIO()
        stderr_buf = io.StringIO()
        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            fn(*args, **kwargs)
        return stdout_buf.getvalue(), stderr_buf.getvalue()

    def test_output_json_mode_list(self):
        """output() with json_mode=True emits valid JSON."""
        from cli_anything.drclaw.utils.output import output

        data = [{"id": 1, "name": "foo"}, {"id": 2, "name": "bar"}]
        stdout, _ = self._capture(output, data, json_mode=True)
        parsed = json.loads(stdout.strip())
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0]["name"], "foo")

    def test_output_pretty_mode_list_of_dicts(self):
        """output() in pretty mode renders column headers."""
        from cli_anything.drclaw.utils.output import output

        data = [{"id": "1", "name": "Alpha"}]
        stdout, _ = self._capture(output, data, json_mode=False)
        self.assertIn("ID", stdout.upper())
        self.assertIn("Alpha", stdout)

    def test_output_empty_list(self):
        """output() handles an empty list without crashing."""
        from cli_anything.drclaw.utils.output import output

        stdout, _ = self._capture(output, [], json_mode=False)
        self.assertIn("no items", stdout)

    def test_success_json_mode(self):
        """success() in JSON mode emits {status: ok, ...}."""
        from cli_anything.drclaw.utils.output import success

        stdout, _ = self._capture(success, "Done!", True)
        parsed = json.loads(stdout.strip())
        self.assertEqual(parsed["status"], "ok")
        self.assertIn("Done!", parsed["message"])

    def test_error_goes_to_stderr(self):
        """error() always writes to stderr."""
        from cli_anything.drclaw.utils.output import error

        stdout, stderr = self._capture(error, "Something went wrong")
        self.assertEqual(stdout, "")
        self.assertIn("Something went wrong", stderr)

    def test_info_goes_to_stderr(self):
        """info() writes to stderr, not stdout."""
        from cli_anything.drclaw.utils.output import info

        stdout, stderr = self._capture(info, "Just a heads-up")
        self.assertEqual(stdout, "")
        self.assertIn("Just a heads-up", stderr)

    def test_output_json_mode_dict(self):
        """output() with a dict in JSON mode emits the dict as JSON."""
        from cli_anything.drclaw.utils.output import output

        data = {"needsSetup": False, "isAuthenticated": False}
        stdout, _ = self._capture(output, data, json_mode=True)
        parsed = json.loads(stdout.strip())
        self.assertFalse(parsed["needsSetup"])


if __name__ == "__main__":
    unittest.main()
