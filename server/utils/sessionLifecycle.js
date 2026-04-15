/**
 * Session lifecycle helpers — extracted from server/index.js for testability.
 *
 * These pure-ish functions handle:
 *   - provider inference from message type prefixes
 *   - project-name resolution (with optional filesystem + DB validation)
 *   - session-event payload enrichment
 *   - lifecycle message construction from completion/error payloads
 */

/**
 * Infer the canonical provider name from a message-type prefix.
 * Falls back to `fallbackProvider` when no prefix matches.
 */
export function inferProviderFromMessageType(type, fallbackProvider = null) {
  const messageType = String(type || '');
  if (messageType.startsWith('claude-')) return 'claude';
  if (messageType.startsWith('cursor-')) return 'cursor';
  if (messageType.startsWith('codex-')) return 'codex';
  if (messageType.startsWith('gemini-')) return 'gemini';
  if (messageType.startsWith('openrouter-')) return 'openrouter';
  if (messageType.startsWith('localgpu-')) return 'local';
  if (messageType.startsWith('nano-')) return 'nano';
  return fallbackProvider || null;
}

/**
 * Resolve a human-readable project name from either an explicit name or a
 * filesystem path.  When `isKnownPath` and `encodePath` callbacks are
 * provided the function validates the path before encoding; otherwise it
 * performs a simple passthrough (useful in unit tests that don't need a
 * real filesystem).
 *
 * @param {string|null} projectName  - explicit project name (returned as-is when non-empty)
 * @param {string|null} projectPath  - filesystem path to resolve from
 * @param {object}      [deps]       - optional dependency overrides for testing
 * @param {function}    [deps.isKnownPath]  - (path) => boolean
 * @param {function}    [deps.encodePath]   - (path) => string
 */
export function resolveProjectName(
  projectName = null,
  projectPath = null,
  deps = {},
) {
  if (typeof projectName === 'string' && projectName.trim().length > 0) {
    return projectName;
  }

  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    return null;
  }

  const { isKnownPath, encodePath } = deps;

  // When no validators are injected we cannot resolve from path alone.
  if (typeof isKnownPath !== 'function' || typeof encodePath !== 'function') {
    return null;
  }

  if (!isKnownPath(projectPath)) {
    return null;
  }

  try {
    return encodePath(projectPath);
  } catch {
    return null;
  }
}

/**
 * Enrich a session-event payload with a resolved `projectName` when the
 * original payload is missing one.
 */
export function enrichSessionEventPayload(payload, fallbackProjectPath = null, deps = {}) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const messageType = String(payload.type || '');
  if (!messageType.startsWith('session-')) {
    return payload;
  }

  const resolvedProjectName = resolveProjectName(
    payload.projectName,
    payload.projectPath || fallbackProjectPath || null,
    deps,
  );
  if (!resolvedProjectName || payload.projectName === resolvedProjectName) {
    return payload;
  }

  return {
    ...payload,
    projectName: resolvedProjectName,
  };
}

/**
 * Build a normalised `session-state-changed` lifecycle message from a
 * provider completion or error payload.
 *
 * Returns `null` when the payload does not represent a terminal state.
 */
export function buildLifecycleMessageFromPayload(
  payload,
  fallbackProvider = null,
  fallbackProjectName = null,
  deps = {},
) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const messageType = String(payload.type || '');
  let state = null;

  if (messageType === 'cursor-result' || messageType.endsWith('-complete')) {
    state = 'completed';
  } else if (messageType.endsWith('-error')) {
    state = 'failed';
  }

  if (!state) {
    return null;
  }

  const provider = inferProviderFromMessageType(
    messageType,
    typeof payload.provider === 'string' ? payload.provider : fallbackProvider,
  );
  const projectName = resolveProjectName(
    payload.projectName || fallbackProjectName || null,
    payload.projectPath || null,
    deps,
  );

  return {
    type: 'session-state-changed',
    provider,
    sessionId: payload.actualSessionId || payload.sessionId || null,
    state,
    reason: messageType,
    changedAt: Date.now(),
    ...(projectName ? { projectName } : {}),
  };
}
