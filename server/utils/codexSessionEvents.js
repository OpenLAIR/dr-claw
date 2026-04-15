export function buildCodexSessionCreatedEvent({
  sessionId,
  sessionMode = 'research',
  projectName = null,
}) {
  return {
    type: 'session-created',
    sessionId,
    provider: 'codex',
    mode: sessionMode || 'research',
    ...(projectName ? { projectName } : {}),
  };
}
