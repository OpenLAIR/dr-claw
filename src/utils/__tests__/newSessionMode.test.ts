import { describe, expect, it } from 'vitest';
import type { SessionMode } from '../../types/app';
import {
  DEFAULT_NEW_SESSION_MODE,
  NEW_SESSION_MODE_STORAGE_KEY,
  nextNewSessionMode,
  persistNewSessionMode,
  readStoredNewSessionMode,
  type NewSessionModeEvent,
} from '../newSessionMode';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

// Mirrors useProjectsState: read the stored mode once, then apply each event
// and persist the result.
function replay(events: NewSessionModeEvent[], storage = memoryStorage()): SessionMode {
  let mode = readStoredNewSessionMode(storage);
  for (const event of events) {
    mode = nextNewSessionMode(mode, event);
    persistNewSessionMode(mode, storage);
  }
  return mode;
}

describe('new session mode', () => {
  it('defaults to research mode', () => {
    expect(DEFAULT_NEW_SESSION_MODE).toBe('research');
    expect(readStoredNewSessionMode(memoryStorage())).toBe('research');
    expect(readStoredNewSessionMode(memoryStorage({ [NEW_SESSION_MODE_STORAGE_KEY]: 'bogus' }))).toBe('research');
    expect(readStoredNewSessionMode(null)).toBe('research');
  });

  it('shows the mode of a session the user opens', () => {
    expect(nextNewSessionMode('research', { type: 'open-session', mode: 'workspace_qa' })).toBe('workspace_qa');
    expect(nextNewSessionMode('workspace_qa', { type: 'open-session', mode: 'research' })).toBe('research');
    expect(nextNewSessionMode('workspace_qa', { type: 'open-session' })).toBe('workspace_qa');
  });

  it('starts the first session of a new project in research mode after a Workspace Q&A session was open', () => {
    // Rehearsal bug: a Workspace Q&A session was opened last, then a project
    // was created and New Session clicked in the sidebar.
    const storage = memoryStorage();
    const mode = replay(
      [
        { type: 'open-session', mode: 'workspace_qa' },
        { type: 'project-created' },
        { type: 'new-session' },
      ],
      storage,
    );
    expect(mode).toBe('research');
    expect(storage.getItem(NEW_SESSION_MODE_STORAGE_KEY)).toBe('research');
  });

  it('ignores Workspace Q&A left in sessionStorage by an earlier page load', () => {
    const storage = memoryStorage({ [NEW_SESSION_MODE_STORAGE_KEY]: 'workspace_qa' });
    expect(replay([{ type: 'new-session' }], storage)).toBe('research');
    expect(storage.getItem(NEW_SESSION_MODE_STORAGE_KEY)).toBe('research');
  });

  it('every "start new" entry point resets to research', () => {
    for (const type of ['new-session', 'project-created', 'chat-from-reference'] as const) {
      expect(nextNewSessionMode('workspace_qa', { type })).toBe('research');
    }
  });

  it('still enters Workspace Q&A when the user asks for it', () => {
    // "Ask about this file" from the file tree or editor.
    expect(replay([{ type: 'new-session' }, { type: 'start-workspace-qa' }])).toBe('workspace_qa');
    // Mode toggle in the composer's "…" menu, and back again.
    expect(replay([{ type: 'new-session' }, { type: 'choose', mode: 'workspace_qa' }])).toBe('workspace_qa');
    expect(
      replay([
        { type: 'choose', mode: 'workspace_qa' },
        { type: 'choose', mode: 'research' },
      ]),
    ).toBe('research');
  });
});
