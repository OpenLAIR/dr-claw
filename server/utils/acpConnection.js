/**
 * Minimal Agent Client Protocol (ACP) client: JSON-RPC 2.0 over newline-
 * delimited JSON on a child process's stdin/stdout.
 *
 * - `request(method, params)` sends a request and resolves with its result.
 * - Notifications from the agent (e.g. `session/update`) go to `onNotification`.
 * - Requests from the agent (e.g. `session/request_permission`) go to
 *   `onRequest`; its return value is sent back as the result, a thrown error
 *   becomes a JSON-RPC error.
 */

export class AcpRequestError extends Error {
  constructor(method, error) {
    super(error?.message ? `${method}: ${error.message}` : `${method} failed`);
    this.name = 'AcpRequestError';
    this.code = error?.code;
    this.data = error?.data;
  }
}

export function createAcpConnection({ stdin, stdout, onNotification, onRequest, onInvalidLine } = {}) {
  let nextId = 1;
  let buffer = '';
  let closed = false;
  let closeReason = null;
  const pending = new Map();

  const write = (message) => {
    if (closed) return false;
    try {
      stdin.write(`${JSON.stringify(message)}\n`);
      return true;
    } catch {
      return false;
    }
  };

  const respond = (id, payload) => write({ jsonrpc: '2.0', id, ...payload });

  const handleAgentRequest = async (message) => {
    if (!onRequest) {
      respond(message.id, { error: { code: -32601, message: `Method not supported: ${message.method}` } });
      return;
    }
    try {
      const result = await onRequest(message.method, message.params || {});
      respond(message.id, { result: result ?? null });
    } catch (error) {
      respond(message.id, {
        error: {
          code: Number.isInteger(error?.code) ? error.code : -32603,
          message: error?.message || 'Request failed',
        },
      });
    }
  };

  const handleLine = (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      onInvalidLine?.(line);
      return;
    }
    if (!message || typeof message !== 'object') return;

    const isResponse = message.id !== undefined && message.method === undefined;
    if (isResponse) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new AcpRequestError(entry.method, message.error));
      else entry.resolve(message.result);
      return;
    }

    if (message.method && message.id !== undefined) {
      handleAgentRequest(message);
      return;
    }

    if (message.method) {
      onNotification?.(message.method, message.params || {});
    }
  };

  stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      handleLine(line);
    }
  });

  const close = (reason = 'connection closed') => {
    if (closed) return;
    if (buffer.trim()) {
      const rest = buffer;
      buffer = '';
      handleLine(rest);
    }
    closed = true;
    closeReason = reason;
    for (const [, entry] of pending) {
      entry.reject(new AcpRequestError(entry.method, { message: reason }));
    }
    pending.clear();
  };

  const request = (method, params) => {
    if (closed) return Promise.reject(new AcpRequestError(method, { message: closeReason || 'connection closed' }));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { method, resolve, reject });
      if (!write({ jsonrpc: '2.0', id, method, params })) {
        pending.delete(id);
        reject(new AcpRequestError(method, { message: 'could not write to agent' }));
      }
    });
  };

  const notify = (method, params) => write({ jsonrpc: '2.0', method, params });

  return { request, notify, close, isClosed: () => closed };
}
