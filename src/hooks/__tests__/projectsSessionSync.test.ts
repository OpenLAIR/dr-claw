import { describe, expect, it } from 'vitest';

import type { Project } from '../../types/app';
import {
  hasTrackedTemporarySession,
  isTrackedSessionActive,
  resolveProjectSessionArrayKey,
  upsertProjectSession,
} from '../projectsSessionSync';

function buildBaseProject(overrides: Partial<Project> = {}): Project {
  return {
    name: 'proj-a',
    displayName: 'proj-a',
    fullPath: 'C:\\proj-a',
    sessions: [],
    cursorSessions: [],
    codexSessions: [],
    geminiSessions: [],
    openrouterSessions: [],
    localSessions: [],
    nanoSessions: [],
    ...overrides,
  };
}

describe('projectsSessionSync', () => {
  it('upserts sessions into the correct list for every supported provider', () => {
    const providerCases = [
      ['claude', 'sessions'],
      ['cursor', 'cursorSessions'],
      ['codex', 'codexSessions'],
      ['gemini', 'geminiSessions'],
      ['openrouter', 'openrouterSessions'],
      ['local', 'localSessions'],
      ['nano', 'nanoSessions'],
    ] as const;

    for (const [provider, targetKey] of providerCases) {
      const project = buildBaseProject();
      const next = upsertProjectSession(project, {
        projectName: 'proj-a',
        provider,
        sessionId: `${provider}-session-1`,
        mode: 'research',
        displayName: `${provider}-session`,
        createdAt: '2026-04-12T15:00:00.000Z',
      });

      expect(next[targetKey]).toHaveLength(1);
      expect(next[targetKey]?.[0]).toEqual(
        expect.objectContaining({
          id: `${provider}-session-1`,
          __provider: provider,
          __projectName: 'proj-a',
        }),
      );
    }
  });

  it('resolves project session array keys for all providers', () => {
    expect(resolveProjectSessionArrayKey('claude')).toBe('sessions');
    expect(resolveProjectSessionArrayKey('cursor')).toBe('cursorSessions');
    expect(resolveProjectSessionArrayKey('codex')).toBe('codexSessions');
    expect(resolveProjectSessionArrayKey('gemini')).toBe('geminiSessions');
    expect(resolveProjectSessionArrayKey('openrouter')).toBe('openrouterSessions');
    expect(resolveProjectSessionArrayKey('local')).toBe('localSessions');
    expect(resolveProjectSessionArrayKey('nano')).toBe('nanoSessions');
  });

  it('injects optimistic sessions immediately into the matching provider list', () => {
    const project = buildBaseProject();
    const next = upsertProjectSession(project, {
      projectName: 'proj-a',
      provider: 'codex',
      sessionId: 'new-session-123',
      mode: 'research',
      displayName: 'Optimistic Session',
      createdAt: '2026-04-12T15:00:00.000Z',
    });

    expect(next.codexSessions).toHaveLength(1);
    expect(next.codexSessions?.[0]).toEqual(
      expect.objectContaining({
        id: 'new-session-123',
        summary: 'Optimistic Session',
        __provider: 'codex',
        __projectName: 'proj-a',
      }),
    );
  });

  it('replaces temporary optimistic session identity with settled session id', () => {
    const project = buildBaseProject({
      codexSessions: [
        {
          id: 'new-session-123',
          summary: 'Temporary',
          __provider: 'codex',
          __projectName: 'proj-a',
        },
      ],
    });

    const next = upsertProjectSession(project, {
      projectName: 'proj-a',
      provider: 'codex',
      sessionId: '019d82e8-1ee3-7860-baa1-24603f424ade',
      temporarySessionId: 'new-session-123',
      mode: 'research',
      displayName: 'Settled Session',
      createdAt: '2026-04-12T15:01:00.000Z',
    });

    expect(next.codexSessions).toHaveLength(1);
    expect(next.codexSessions?.[0].id).toBe('019d82e8-1ee3-7860-baa1-24603f424ade');
    expect(next.codexSessions?.[0].summary).toBe('Settled Session');
  });

  it('treats same session id under different providers as separate identities', () => {
    const project = buildBaseProject({
      codexSessions: [
        {
          id: 'sess-1',
          summary: 'Codex',
          __provider: 'codex',
          __projectName: 'proj-a',
        },
      ],
    });

    const next = upsertProjectSession(project, {
      projectName: 'proj-a',
      provider: 'gemini',
      sessionId: 'sess-1',
      mode: 'research',
      displayName: 'Gemini',
      createdAt: '2026-04-12T15:02:00.000Z',
    });

    expect(next.codexSessions).toHaveLength(1);
    expect(next.geminiSessions).toHaveLength(1);
    expect(next.codexSessions?.[0].id).toBe('sess-1');
    expect(next.geminiSessions?.[0].id).toBe('sess-1');
  });

  it('matches active sessions from scoped tracking keys', () => {
    const activeSessions = new Set<string>([
      'proj-a::codex::sess-1',
      'proj-b::gemini::sess-2',
    ]);

    expect(
      isTrackedSessionActive(activeSessions, {
        sessionId: 'sess-1',
        provider: 'codex',
        projectName: 'proj-a',
      }),
    ).toBe(true);

    expect(
      isTrackedSessionActive(activeSessions, {
        sessionId: 'sess-1',
        provider: 'gemini',
        projectName: 'proj-a',
      }),
    ).toBe(false);
  });

  it('detects temporary sessions from both raw and scoped tracking keys', () => {
    expect(hasTrackedTemporarySession(new Set(['new-session-1']))).toBe(true);
    expect(hasTrackedTemporarySession(new Set(['proj-a::codex::new-session-2']))).toBe(true);
    expect(hasTrackedTemporarySession(new Set(['proj-a::codex::sess-1']))).toBe(false);
  });
});
