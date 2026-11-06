import { describe, expect, it } from 'vitest';
import type { Project } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import {
  isSessionPinned,
  parsePinnedSessions,
  removePinnedSession,
  resolvePinnedSessions,
  separatePinnedSessions,
  togglePinnedSession,
  type PinnedSession,
} from '../pinned';

const project = (name: string, displayName = name): Project =>
  ({ name, displayName, fullPath: `/tmp/${name}` }) as Project;

const pin = (projectName: string, sessionId: string, title = sessionId): PinnedSession =>
  ({ projectName, sessionId, provider: 'claude', title });

describe('togglePinnedSession', () => {
  it('appends new pins and removes existing ones', () => {
    const once = togglePinnedSession([], pin('a', 's1'));
    const twice = togglePinnedSession(once, pin('a', 's2'));
    expect(twice.map((item) => item.sessionId)).toEqual(['s1', 's2']);
    expect(togglePinnedSession(twice, pin('a', 's1')).map((item) => item.sessionId)).toEqual(['s2']);
  });

  it('treats the same session id in another project as a different pin', () => {
    const pins = [pin('a', 's1')];
    expect(isSessionPinned(pins, 'a', 's1')).toBe(true);
    expect(isSessionPinned(pins, 'b', 's1')).toBe(false);
    expect(togglePinnedSession(pins, pin('b', 's1'))).toHaveLength(2);
  });

  it('removes a pin by project and session', () => {
    expect(removePinnedSession([pin('a', 's1'), pin('a', 's2')], 'a', 's1')).toEqual([pin('a', 's2')]);
  });
});

describe('parsePinnedSessions', () => {
  it('ignores missing, broken and malformed data', () => {
    expect(parsePinnedSessions(null)).toEqual([]);
    expect(parsePinnedSessions('{oops')).toEqual([]);
    expect(parsePinnedSessions('{"a":1}')).toEqual([]);
    expect(parsePinnedSessions(JSON.stringify([pin('a', 's1'), { sessionId: 'x' }, null]))).toEqual([pin('a', 's1')]);
  });
});

describe('resolvePinnedSessions', () => {
  const alpha = project('alpha', 'Alpha study');
  const beta = project('beta');
  const loaded: Record<string, SessionWithProvider[]> = {
    alpha: [{ id: 's1', summary: 'Renamed title', __provider: 'claude', __projectName: 'alpha' } as SessionWithProvider],
    beta: [],
  };
  const getSessions = (item: Project) => loaded[item.name] ?? [];

  it('keeps pin order, prefers loaded sessions and falls back to the snapshot', () => {
    const entries = resolvePinnedSessions([pin('beta', 's9', 'Old run'), pin('alpha', 's1', 'Old title')], [alpha, beta], getSessions);
    expect(entries.map((entry) => entry.session.id)).toEqual(['s9', 's1']);
    expect(entries[0].session).toMatchObject({ summary: 'Old run', __provider: 'claude', __projectName: 'beta' });
    expect(entries[1].session.summary).toBe('Renamed title');
  });

  it('drops pins whose project no longer exists', () => {
    expect(resolvePinnedSessions([pin('gone', 's1')], [alpha], getSessions)).toEqual([]);
  });

  it('filters by session title or project name', () => {
    const pins = [pin('alpha', 's1'), pin('beta', 's9', 'Ablation run')];
    expect(resolvePinnedSessions(pins, [alpha, beta], getSessions, 'renamed').map((entry) => entry.session.id)).toEqual(['s1']);
    expect(resolvePinnedSessions(pins, [alpha, beta], getSessions, 'ALPHA').map((entry) => entry.session.id)).toEqual(['s1']);
    expect(resolvePinnedSessions(pins, [alpha, beta], getSessions, 'ablation').map((entry) => entry.session.id)).toEqual(['s9']);
  });

  it('keeps pins whose messages matched, with the snippet', () => {
    const pins = [pin('alpha', 's1'), pin('beta', 's9', 'Ablation run')];
    const match = { snippet: '…the zebrafish baseline…', terms: ['zebrafish'] };
    const entries = resolvePinnedSessions(pins, [alpha, beta], getSessions, 'zebrafish', new Map([['beta:s9', match]]));
    expect(entries.map((entry) => entry.session.id)).toEqual(['s9']);
    expect(entries[0].session.__searchMatch).toEqual(match);
  });

  it('does not attach a snippet to a pin that matched by title', () => {
    const matches = new Map([['alpha:s1', { snippet: 'x', terms: ['renamed'] }]]);
    const entries = resolvePinnedSessions([pin('alpha', 's1')], [alpha], getSessions, 'renamed', matches);
    expect(entries[0].session.__searchMatch).toBeUndefined();
  });
});

describe('separatePinnedSessions', () => {
  const sessions = (ids: string[]) =>
    ids.map((id) => ({ id, __provider: 'claude', __projectName: 'p' }) as SessionWithProvider);
  const withMeta = (total: number, hasMore: boolean) =>
    ({ ...project('p'), sessionMeta: { total, hasMore } }) as Project;

  it('leaves projects without pins alone', () => {
    const result = separatePinnedSessions(withMeta(7, true), sessions(['a', 'b', 'c', 'd', 'e']), [pin('other', 'a')]);
    expect(result.sessions).toHaveLength(5);
    expect(result.knownTotal).toBe(7);
  });

  it('drops pinned sessions and their share of the total', () => {
    // 7 sessions on the server, 5 loaded; two loaded ones and one unloaded one are pinned.
    const pins = [pin('p', 'a'), pin('p', 'c'), pin('p', 'unloaded')];
    const result = separatePinnedSessions(withMeta(7, true), sessions(['a', 'b', 'c', 'd', 'e']), pins);
    expect(result.sessions.map((item) => item.id)).toEqual(['b', 'd', 'e']);
    expect(result.knownTotal).toBe(4);
  });

  it('ignores an unloaded pin once every page is loaded', () => {
    const pins = [pin('p', 'a'), pin('p', 'deleted-elsewhere')];
    const result = separatePinnedSessions(withMeta(3, false), sessions(['a', 'b', 'c']), pins);
    expect(result.sessions.map((item) => item.id)).toEqual(['b', 'c']);
    expect(result.knownTotal).toBe(2);
  });
});
