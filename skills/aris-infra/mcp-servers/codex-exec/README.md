# Codex reviewer bridge

Bundled from upstream ARIS; see [UPSTREAM.md](../../UPSTREAM.md). The standalone
Python server exposes `codex` / `codex-reply` tools via `codex exec`, without Python
packages. Codex CLI 0.154.0 removed the old `codex mcp-server` entry point.

After installing/authenticating Codex, explicitly register the bridge from the
Dr. Claw checkout (do not run this during ordinary workflow execution):

```bash
claude mcp add codex -s user -- python3 "$(pwd)/skills/aris-infra/mcp-servers/codex-exec/server.py"
```

If an old registration already exists, inspect it first; replace it manually only
if you intend to change it. Restart Claude Code after registration. No API key,
model availability, or working connection is implied by registration alone.

The MCP arguments `model`, `config`, `sandbox` and `cwd` map to CLI options.
Workflow M explicitly requests `sandbox: read-only` and its project cwd; the
server supports other sandbox modes for other workflows but does **not** enforce
Workflow M policy itself. Do not add full-access/bypass flags. Continuations use
saved thread settings, including the initial model, effort, sandbox and cwd.
New sessions default to read-only when no sandbox is supplied. The explicit or
stored sandbox wins over `config.sandbox_mode`. Missing/corrupt thread state and
invalid thread IDs fail closed; start a new review instead of falling back to
the user's default configuration. Other arbitrary Codex configuration remains
available for non-Workflow-M uses and is not a security sandbox provided by this
bridge; use trusted configuration and host-level permissions.
Per-thread state is written under `~/.codex/state/codex-exec/threads/`; it is not
written by installing or importing the Python file.

The bridge streams progress, handles ping/cancel requests and returns CLI failures
as errors. MCP stdin closure cancels the active reviewer too: TERM followed by
KILL after a short grace period, including the process group on POSIX.
Host hard tool timeouts still apply. No automatic review retry is
implied by a timeout. See [routing](../../shared-references/reviewer-routing.md)
for the limited model/effort capability fallback and family checks.
