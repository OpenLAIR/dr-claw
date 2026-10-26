// Reservations cover asynchronous initialization before provider active-session
// maps are populated. Shared across WebSocket connections, scoped per provider.
const pendingTurns = new Set();
const commandProviders = new Map([
  ['claude-command', 'claude'], ['cursor-command', 'cursor'], ['cursor-resume', 'cursor'],
  ['codex-command', 'codex'], ['gemini-command', 'gemini'], ['openrouter-command', 'openrouter'],
  ['local-command', 'local'], ['nano-command', 'nano'],
]);

export function providerForCommand(type) {
  return commandProviders.get(type);
}

export function reserveSessionTurn(provider, sessionId) {
  // New sessions have independent identities and must be allowed in parallel.
  if (!sessionId) return () => {};
  const key = JSON.stringify([provider, sessionId]);
  if (pendingTurns.has(key)) return null;
  pendingTurns.add(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pendingTurns.delete(key);
  };
}
