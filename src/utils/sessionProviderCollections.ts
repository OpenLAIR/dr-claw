import type { Project, SessionProvider } from '../types/app';

export type SessionCollectionKey = keyof Pick<
  Project,
  | 'sessions'
  | 'cursorSessions'
  | 'codexSessions'
  | 'geminiSessions'
  | 'openrouterSessions'
  | 'localSessions'
  | 'nanoSessions'
  | 'piSessions'
>;

const SESSION_COLLECTION_BY_PROVIDER: Record<SessionProvider, SessionCollectionKey> = {
  claude: 'sessions',
  cursor: 'cursorSessions',
  codex: 'codexSessions',
  gemini: 'geminiSessions',
  openrouter: 'openrouterSessions',
  local: 'localSessions',
  nano: 'nanoSessions',
  pi: 'piSessions',
};

export function getSessionCollectionKey(provider: SessionProvider): SessionCollectionKey {
  return SESSION_COLLECTION_BY_PROVIDER[provider];
}
