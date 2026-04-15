import { describe, expect, it } from 'vitest';

import type { ProjectSession } from '../../../../types/app';
import {
  getAllSessions,
  prependSelectedSessionIfMissing,
} from '../utils';

describe('sidebar session list behavior', () => {
  it('preserves provider from additional sessions instead of forcing claude', () => {
    const sessions = getAllSessions(
      {
        name: 'proj-a',
        displayName: 'proj-a',
        fullPath: 'C:\\proj-a',
        sessions: [],
        codexSessions: [],
      },
      {
        'proj-a': [
          {
            id: 'sess-1',
            summary: 'Codex temp',
            __provider: 'codex',
            __projectName: 'proj-a',
            createdAt: '2026-04-12T10:00:00.000Z',
            lastActivity: '2026-04-12T10:00:00.000Z',
          },
        ],
      },
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0].__provider).toBe('codex');
  });

  it('injects selected session immediately when it is missing from project list', () => {
    const baseSessions = getAllSessions(
      {
        name: 'proj-a',
        displayName: 'proj-a',
        fullPath: 'C:\\proj-a',
        sessions: [],
      },
      {},
    );

    const selectedSession: ProjectSession = {
      id: 'new-session-123',
      summary: 'New Session',
      __provider: 'codex',
      __projectName: 'proj-a',
      createdAt: '2026-04-12T10:00:00.000Z',
      lastActivity: '2026-04-12T10:00:00.000Z',
    };

    const merged = prependSelectedSessionIfMissing(
      baseSessions,
      'proj-a',
      selectedSession,
      'proj-a',
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('new-session-123');
    expect(merged[0].__provider).toBe('codex');
  });

  it('does not duplicate when same project/provider/session already exists', () => {
    const baseSessions = getAllSessions(
      {
        name: 'proj-a',
        displayName: 'proj-a',
        fullPath: 'C:\\proj-a',
        codexSessions: [
          {
            id: 'sess-1',
            summary: 'Existing',
            createdAt: '2026-04-12T10:00:00.000Z',
            lastActivity: '2026-04-12T10:00:00.000Z',
          },
        ],
      },
      {},
    );

    const selectedSession: ProjectSession = {
      id: 'sess-1',
      summary: 'Existing',
      __provider: 'codex',
      __projectName: 'proj-a',
    };

    const merged = prependSelectedSessionIfMissing(
      baseSessions,
      'proj-a',
      selectedSession,
      'proj-a',
    );

    expect(merged).toHaveLength(1);
  });

  it('treats same session id under different providers as different identities', () => {
    const baseSessions = getAllSessions(
      {
        name: 'proj-a',
        displayName: 'proj-a',
        fullPath: 'C:\\proj-a',
        codexSessions: [
          {
            id: 'sess-1',
            summary: 'Codex existing',
            createdAt: '2026-04-12T10:00:00.000Z',
            lastActivity: '2026-04-12T10:00:00.000Z',
          },
        ],
      },
      {},
    );

    const selectedSession: ProjectSession = {
      id: 'sess-1',
      summary: 'Gemini selected',
      __provider: 'gemini',
      __projectName: 'proj-a',
      createdAt: '2026-04-12T10:01:00.000Z',
      lastActivity: '2026-04-12T10:01:00.000Z',
    };

    const merged = prependSelectedSessionIfMissing(
      baseSessions,
      'proj-a',
      selectedSession,
      'proj-a',
    );

    expect(merged).toHaveLength(2);
    expect(
      merged.some((session) => session.id === 'sess-1' && session.__provider === 'gemini'),
    ).toBe(true);
    expect(
      merged.some((session) => session.id === 'sess-1' && session.__provider === 'codex'),
    ).toBe(true);
  });
});
