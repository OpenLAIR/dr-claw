import type { SessionMode } from '../types/app';

/**
 * Which mode the composer uses for the next brand-new session.
 *
 * Opening an existing session shows that session's mode, but that is a
 * property of the old session, not a choice about the next one. So every
 * "start something new" entry point (New Session in the sidebar, a new chat
 * tab, a freshly created project) resets to research mode. Workspace Q&A is
 * only entered on purpose: the "Ask about this file" actions
 * (`start-workspace-qa`) or the mode toggle in the composer (`choose`).
 */
export type NewSessionModeEvent =
  | { type: 'open-session'; mode?: SessionMode }
  | { type: 'new-session' }
  | { type: 'project-created' }
  | { type: 'chat-from-reference' }
  | { type: 'start-workspace-qa' }
  | { type: 'choose'; mode: SessionMode };

export const DEFAULT_NEW_SESSION_MODE: SessionMode = 'research';
export const NEW_SESSION_MODE_STORAGE_KEY = 'dr-claw-new-session-mode';

export const isSessionMode = (value: string | null | undefined): value is SessionMode =>
  value === 'research' || value === 'workspace_qa';

export function nextNewSessionMode(current: SessionMode, event: NewSessionModeEvent): SessionMode {
  switch (event.type) {
    case 'open-session':
      return event.mode ?? current;
    case 'new-session':
    case 'project-created':
    case 'chat-from-reference':
      return DEFAULT_NEW_SESSION_MODE;
    case 'start-workspace-qa':
      return 'workspace_qa';
    case 'choose':
      return event.mode;
  }
}

type ModeStorage = Pick<Storage, 'getItem' | 'setItem'>;

const defaultStorage = (): ModeStorage | null =>
  typeof window === 'undefined' ? null : window.sessionStorage;

export function readStoredNewSessionMode(storage: ModeStorage | null = defaultStorage()): SessionMode {
  const stored = storage?.getItem(NEW_SESSION_MODE_STORAGE_KEY);
  return isSessionMode(stored) ? stored : DEFAULT_NEW_SESSION_MODE;
}

export function persistNewSessionMode(mode: SessionMode, storage: ModeStorage | null = defaultStorage()): void {
  storage?.setItem(NEW_SESSION_MODE_STORAGE_KEY, mode);
}
