import type { SessionProvider } from '../types/app';
import { DEFAULT_PROVIDER, normalizeProvider } from './providerPolicy';

export interface SessionScope {
  projectName: string;
  provider: SessionProvider;
  sessionId: string;
}

export type SessionScopeKey = string;

export const SESSION_SCOPE_SEPARATOR = '::';

export function normalizeSessionScopeProvider(
  provider: SessionProvider | string | null | undefined,
): SessionProvider {
  return normalizeProvider((provider || DEFAULT_PROVIDER) as SessionProvider);
}

export function buildSessionScopeKey(
  projectName: string | null | undefined,
  provider: SessionProvider | string | null | undefined,
  sessionId: string | null | undefined,
): SessionScopeKey {
  if (!projectName || !sessionId) {
    return '';
  }

  const normalizedProvider = normalizeSessionScopeProvider(provider);
  return `${projectName}${SESSION_SCOPE_SEPARATOR}${normalizedProvider}${SESSION_SCOPE_SEPARATOR}${sessionId}`;
}

export function parseSessionScopeKey(scopeKey: string | null | undefined): SessionScope | null {
  if (!scopeKey || typeof scopeKey !== 'string') {
    return null;
  }

  const [projectName, provider, ...sessionIdParts] = scopeKey.split(SESSION_SCOPE_SEPARATOR);
  const sessionId = sessionIdParts.join(SESSION_SCOPE_SEPARATOR);
  if (!projectName || !provider || !sessionId) {
    return null;
  }

  return {
    projectName,
    provider: normalizeSessionScopeProvider(provider),
    sessionId,
  };
}

export function getSessionIdFromScopeKey(scopeKey: string | null | undefined): string | null {
  const parsed = parseSessionScopeKey(scopeKey);
  return parsed?.sessionId || null;
}

export function isTemporarySessionId(sessionId: string | null | undefined): boolean {
  return Boolean(sessionId && sessionId.startsWith('new-session-'));
}

export function isSessionScopeKeyTemporary(scopeKey: string | null | undefined): boolean {
  const parsed = parseSessionScopeKey(scopeKey);
  return isTemporarySessionId(parsed?.sessionId);
}

export function scopeKeyMatchesSessionId(
  scopeKey: string | null | undefined,
  sessionId: string | null | undefined,
): boolean {
  if (!scopeKey || !sessionId) {
    return false;
  }

  const parsed = parseSessionScopeKey(scopeKey);
  if (!parsed) {
    return scopeKey === sessionId;
  }

  return parsed.sessionId === sessionId;
}

export function scopeKeyMatchesScope(
  scopeKey: string | null | undefined,
  projectName: string | null | undefined,
  provider: SessionProvider | string | null | undefined,
  sessionId: string | null | undefined,
): boolean {
  if (!scopeKey || !projectName || !sessionId) {
    return false;
  }

  const normalizedProvider = normalizeSessionScopeProvider(provider);
  return scopeKey === buildSessionScopeKey(projectName, normalizedProvider, sessionId);
}
