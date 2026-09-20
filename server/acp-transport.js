// ACP transport adapter skeleton — Agent Client Protocol over stdio.
//
// Speaks newline-delimited JSON-RPC 2.0 per the ACP v1 transport spec
// (https://agentclientprotocol.com). Dependency-free: Node core modules only.
//
// Status: SKELETON — not yet wired into server/index.js. See
// docs/acp-research-state.md for the schema and the integration plan.

import { spawn } from 'child_process';
import { createInterface } from 'readline';

const PROTOCOL_VERSION = 1;

/**
 * Wrap a pair of streams as an ACP JSON-RPC peer.
 *
 * @param {import('stream').Readable} input
 * @param {import('stream').Writable} output
 * @param {object} [options]
 * @param {(event: object) => void} [options.onEvent] Peer notifications (e.g. `session/update`).
 * @param {Record<string, (params: object) => Promise<object>>} [options.handlers] Requests this peer answers.
 */
export function createAcpPeer(input, output, { onEvent, handlers = {} } = {}) {
  let nextId = 0;
  const pending = new Map(); // id -> { resolve, reject }

  const send = (message) => output.write(JSON.stringify(message) + '\n');

  function request(method, params) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ jsonrpc: '2.0', id, method, params });
    });
  }

  const notify = (method, params) => send({ jsonrpc: '2.0', method, params });

  function reply(id, result) {
    send({ jsonrpc: '2.0', id, result });
  }

  function replyError(id, code, message) {
    send({ jsonrpc: '2.0', id, error: { code, message } });
  }

  async function dispatch(message) {
    const { id, method, params } = message;
    const handler = handlers[method];
    if (!handler) {
      replyError(id, -32601, `Method not found: ${method}`);
      return;
    }
    try {
      reply(id, (await handler(params || {})) || {});
    } catch (error) {
      replyError(id, -32000, error.message);
    }
  }

  const lines = createInterface({ input });
  lines.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return; // ACP frames MUST NOT contain embedded newlines; skip bad frames
    }
    if (message.method && message.id !== undefined) {
      dispatch(message);
    } else if (message.method) {
      if (onEvent) onEvent(message); // peer notification (e.g. session/update)
    } else if (message.id !== undefined && pending.has(message.id)) {
      const pendingCall = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) pendingCall.reject(new Error(message.error.message));
      else pendingCall.resolve(message.result);
    }
  });

  return {
    request,
    notify,
    close() {
      lines.close();
    },
  };
}

/**
 * Spawn an ACP agent as a subprocess (stdio transport) and run the client
 * side of the session: initialize handshake, prompt turns, and the
 * research-state mirror from docs/acp-research-state.md.
 *
 * @param {string} command Agent executable (an ACP-speaking agent process)
 * @param {string[]} [args]
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {Record<string, string>} [options.env]
 * @param {(event: object) => void} [options.onEvent] `session/update` and other peer notifications.
 * @param {(state: object) => void} [options.onResearchState] Snapshot after each research-state batch.
 */
export function spawnAcpAgent(command, args = [], options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // In-memory mirror of the agent's research state (task graph + decisions).
  const researchState = { stateVersion: 0, nodes: new Map(), edges: new Map(), decisions: [] };
  const bump = () => ++researchState.stateVersion;

  const peer = createAcpPeer(child.stdout, child.stdin, {
    onEvent: options.onEvent,
    handlers: {
      // Agent -> client: apply research mutations, acknowledge with a version.
      'session/record_research': async (params) => {
        for (const op of params.operations || []) {
          if (op.kind === 'upsertNode') {
            researchState.nodes.set(op.node.nodeId, op.node);
          } else if (op.kind === 'addEdge') {
            researchState.edges.set(op.edge.edgeId, op.edge);
          } else if (op.kind === 'recordDecision') {
            researchState.decisions.push(op.decision);
          } else if (op.kind === 'removeNode') {
            researchState.nodes.delete(op.nodeId);
            for (const [edgeId, edge] of researchState.edges) {
              if (edge.fromNodeId === op.nodeId || edge.toNodeId === op.nodeId) {
                researchState.edges.delete(edgeId);
              }
            }
          }
          bump();
        }
        const snapshot = {
          stateVersion: researchState.stateVersion,
          nodes: [...researchState.nodes.values()],
          edges: [...researchState.edges.values()],
          decisions: researchState.decisions,
        };
        if (options.onResearchState) options.onResearchState(snapshot);
        return { stateVersion: researchState.stateVersion };
      },
    },
  });

  async function initialize(clientCapabilities = {}) {
    return peer.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities });
  }

  async function newSession(cwd, mcpServers = []) {
    return peer.request('session/new', { cwd, mcpServers });
  }

  async function prompt(sessionId, promptContent) {
    return peer.request('session/prompt', { sessionId, prompt: promptContent });
  }

  return {
    peer,
    initialize,
    newSession,
    prompt,
    researchState,
    kill() {
      child.kill();
      peer.close();
    },
  };
}

export default { createAcpPeer, spawnAcpAgent };
