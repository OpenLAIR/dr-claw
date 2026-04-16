export const TEMP_SESSION_PREFIX = 'new-session-';

export const isTemporarySessionId = (sessionId?: string | null): boolean =>
  typeof sessionId === 'string' && sessionId.startsWith(TEMP_SESSION_PREFIX);
