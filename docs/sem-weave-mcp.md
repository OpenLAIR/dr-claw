# Local code navigation with Sem

This optional recipe uses Dr. Claw's existing Claude MCP settings. Install
[Sem](https://github.com/Ataraxy-Labs/sem) on the machine running the Dr. Claw
server (tested with Sem 0.29.0). The checkout must exist on that machine, not
only on the browser's machine.

## Configure the server

1. Open **Settings → Agents → Claude → MCP Servers**.
2. Add a server named `sem`, select **User (Global)** scope, then **JSON Import**.
3. Replace both absolute paths and import this single-server object, without an
   `mcpServers` wrapper:

```json
{
  "type": "stdio",
  "command": "/absolute/path/to/sem",
  "args": [
    "mcp"
  ],
  "env": {
    "SEM_REPO": "/absolute/path/to/checkout",
    "SEM_LOCAL": "1",
    "SEM_MCP_NO_SHARED": "1",
    "SEM_NO_NETWORK": "1",
    "SEM_NO_TELEMETRY": "1"
  }
}
```

This makes the selected checkout available to Claude sessions for the OS user
running Dr. Claw. Choose an appropriate scope and trusted checkout. Preserve
existing servers and permission settings. As with other Claude MCP recipes,
use the default Claude configuration location; Dr. Claw does not load a custom
`CLAUDE_CONFIG_DIR` for this path.

Start a new Claude session. Ask: "Use Sem's sem_find to locate a known function
in this checkout and report its source location." Approve only the operations
you intend to allow, and check the returned locations. Static relationships can
be incomplete. If tools are absent, check that the backend is Claude and that
the server process can execute the binary and read the checkout.

`SEM_LOCAL=1` disables the MCP cloud client; `SEM_MCP_NO_SHARED=1` avoids a shared
daemon with different settings. Neither provides network/filesystem isolation.
Sem may write local indexes and exposes command-running tools as well as lookup;
source results may reach the configured model provider.

## Optional entity editing with Weave

Install [Weave](https://github.com/Ataraxy-Labs/weave) on the same host. Add a
separate `weave` server only if you want editing capabilities:

```json
{
  "type": "stdio",
  "command": "/absolute/path/to/weave-mcp",
  "args": [],
  "env": { "WEAVE_REPO": "/absolute/path/to/checkout" }
}
```

Keep normal write approvals enabled. `weave_edit` changes source files; inspect
the resulting Git diff and run the project's tests. Structural checks do not
prove behavioral correctness. This optional server was checked with Weave 0.7.0.

To disconnect, remove the named entries from the same MCP settings screen and
start a new Claude session. No Dr. Claw runtime or default configuration changes
are needed.
