# ACP Research State — schema and transport adapter

Dr. Claw research sessions accumulate structure that is bigger than a chat
transcript: open questions, tasks, evidence for and against claims, blockers,
and the decisions that moved the investigation forward. This document defines
a wire format — based on the [Agent Client Protocol](https://agentclientprotocol.com)
(ACP, v1) — for exposing that structure to any ACP-speaking client or agent,
plus the transport adapter skeleton that lets the server host ACP agents.

Status: **design + skeleton**. The adapter is dependency-free and is not yet
wired into the server process; see [Integration plan](#integration-plan).

## Research state objects

Four object types. All IDs are string identifiers unique within a session.

**ResearchNode** — one vertex of the investigation:

```json
{
  "nodeId": "n_7",
  "type": "question",
  "title": "Does provider X support streaming tool calls?",
  "details": "Optional longer description.",
  "status": "open"
}
```

| Field    | Value                                                                     |
| -------- | ------------------------------------------------------------------------- |
| `type`   | `question` \| `task` \| `evidence` \| `claim` \| `blocker`                 |
| `status` | `open` \| `resolved` \| `rejected` \| `blocked` (optional)                 |

**ResearchEdge** — a directed, typed relation between two nodes:

```json
{
  "edgeId": "e_3",
  "fromNodeId": "n_7",
  "toNodeId": "n_2",
  "relation": "answers"
}
```

| Field      | Value                                                |
| ---------- | ---------------------------------------------------- |
| `relation` | `answers` \| `supports` \| `contradicts` \| `depends_on` |

**DecisionEntry** — an immutable, append-only record of a decision:

```json
{
  "decisionId": "d_1",
  "decision": "Store research state on the agent side",
  "rationale": "It survives client restarts and session/load.",
  "alternatives": ["Client-side store", "Flat file per workspace"],
  "nodeId": "n_2"
}
```

`alternatives` preserves rejected options so the "why" trail is never lost;
corrections are new entries, never edits. `nodeId` optionally anchors the
decision in the graph.

**Claim → evidence** needs no fifth object: a `claim` node, its `evidence`
nodes, and `supports` / `contradicts` edges between them express it on the wire.

## Wire methods

ACP runs JSON-RPC 2.0 over stdio, newline-delimited, UTF-8 encoded. Two
methods carry research state. Agents declare support with a `researchState`
object in `agentCapabilities` during `initialize`.

### `session/record_research` (agent → client)

```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "method": "session/record_research",
  "params": {
    "sessionId": "sess_789xyz",
    "operations": [
      { "kind": "upsertNode", "node": { "nodeId": "n_7", "type": "question", "title": "..." } },
      { "kind": "addEdge", "edge": { "edgeId": "e_3", "fromNodeId": "n_7", "toNodeId": "n_2", "relation": "answers" } },
      { "kind": "recordDecision", "decision": { "decisionId": "d_1", "decision": "...", "rationale": "...", "alternatives": [] } },
      { "kind": "removeNode", "nodeId": "n_9" }
    ]
  }
}
```

Response: `{ "stateVersion": 5 }` — a monotonic counter the client bumps per
applied batch. `upsertNode` / `addEdge` are idempotent upserts by ID;
`recordDecision` appends; `removeNode` also drops edges referencing the node.

### `session/get_research_state` (client → agent)

Full hydration on session resume, fork, or after a detected version gap:

```json
{
  "jsonrpc": "2.0",
  "id": 13,
  "method": "session/get_research_state",
  "params": { "sessionId": "sess_789xyz" }
}
```

Response:

```json
{
  "stateVersion": 5,
  "nodes": [],
  "edges": [],
  "decisions": []
}
```

The same schema is proposed upstream to ACP as the "Research Process
Extensions" RFD (`docs/rfds/research-process-extensions.mdx` in the
agent-client-protocol repository). Keeping Dr. Claw's schema identical means a
Dr. Claw session rendered in any ACP client looks the same.

## Transport adapter skeleton

`server/acp-transport.js` implements the client side of an ACP session as a
spawnable provider, following the shape of the other provider adapters in
`server/`:

- `spawnAcpAgent(command, args, options)` — launches an ACP agent as a
  subprocess (stdio transport) and returns a client handle.
- `acpClient.request(method, params)` / `.notify(method, params)` — JSON-RPC
  plumbing (`initialize`, `session/new`, `session/prompt`, ...).
- Inbound `session/update` notifications surface through the `onEvent`
  callback, ready to be mapped onto the existing session event flow.
- `session/record_research` requests from the agent are answered by a small
  in-memory research-state mirror; `onResearchState` events let the UI render
  the task graph / decision log.

No new dependencies: Node core modules only (`child_process`, `readline`).
Plain JavaScript ES modules per `server/AGENTS.md`.

## Integration plan

1. Register the ACP provider alongside the existing CLI adapters (provider
   picker entry: "ACP agent (stdio)"), with the spawn command configurable.
2. Map `session/update` variants onto the existing session event pipeline
   (message chunks, tool calls, plan).
3. Persist the research-state mirror per session and render a task graph /
   decision log panel from the `researchState` events.
4. Track the upstream ACP RFD and align naming with whatever lands.

## License

This document and the adapter skeleton are original work contributed to this
repository under its license. The schema is authored from the public ACP
specification; no third-party code or text is included.
