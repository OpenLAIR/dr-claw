import { describe, expect, it } from 'vitest';
import type { Project } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import {
  RECENT_ACTIVITY_WINDOW_MS,
  SESSION_PREVIEW_COUNT,
  getKnownSessionTotal,
  getSessionPreview,
  getSessionStatus,
  joinTooltipLines,
} from '../sessionPreview';
import { sortProjects } from '../utils';

const session = (id: string, provider: SessionWithProvider['__provider'] = 'claude'): SessionWithProvider =>
  ({ id, __provider: provider }) as SessionWithProvider;

const sessions = (count: number) => Array.from({ length: count }, (_, index) => session(`s${index + 1}`));

const project = (overrides: Partial<Project> = {}): Project =>
  ({ name: 'p', displayName: 'p', fullPath: '/tmp/p', ...overrides }) as Project;

describe('getSessionPreview', () => {
  it('shows the first three sessions and counts the rest', () => {
    const { visible, hiddenCount } = getSessionPreview(sessions(7));
    expect(SESSION_PREVIEW_COUNT).toBe(3);
    expect(visible.map((item) => item.id)).toEqual(['s1', 's2', 's3']);
    expect(hiddenCount).toBe(4);
  });

  it('hides nothing when the list fits', () => {
    expect(getSessionPreview(sessions(3))).toEqual({ visible: sessions(3), hiddenCount: 0 });
    expect(getSessionPreview([])).toEqual({ visible: [], hiddenCount: 0 });
  });

  it('shows every loaded session once expanded', () => {
    const { visible, hiddenCount } = getSessionPreview(sessions(7), { showAll: true });
    expect(visible).toHaveLength(7);
    expect(hiddenCount).toBe(0);
  });

  it('counts sessions the server has not sent yet', () => {
    expect(getSessionPreview(sessions(5), { knownTotal: 12 }).hiddenCount).toBe(9);
    expect(getSessionPreview(sessions(5), { knownTotal: 12, showAll: true }).hiddenCount).toBe(7);
  });

  it('never reports a negative count when the known total is stale', () => {
    expect(getSessionPreview(sessions(5), { knownTotal: 2 }).hiddenCount).toBe(2);
  });

  it('keeps a selected session visible while collapsed', () => {
    const { visible, hiddenCount } = getSessionPreview(sessions(7), { selectedSessionId: 's6' });
    expect(visible.map((item) => item.id)).toEqual(['s1', 's2', 's3', 's6']);
    expect(hiddenCount).toBe(3);
  });

  it('does not duplicate a selected session that is already visible', () => {
    const { visible } = getSessionPreview(sessions(7), { selectedSessionId: 's2' });
    expect(visible.map((item) => item.id)).toEqual(['s1', 's2', 's3']);
  });

  it('honours a custom limit', () => {
    expect(getSessionPreview(sessions(4), { limit: 1 }).visible.map((item) => item.id)).toEqual(['s1']);
  });
});

describe('getKnownSessionTotal', () => {
  it('adds unloaded Claude sessions when the server has more', () => {
    const loaded = [...sessions(5), session('c1', 'codex')];
    expect(getKnownSessionTotal(project({ sessionMeta: { total: 9, hasMore: true } }), loaded)).toBe(10);
  });

  it('uses the loaded list when nothing more is pending', () => {
    expect(getKnownSessionTotal(project({ sessionMeta: { total: 9, hasMore: false } }), sessions(3))).toBe(3);
    expect(getKnownSessionTotal(project(), sessions(2))).toBe(2);
  });
});

describe('getSessionStatus', () => {
  const now = new Date('2026-11-05T12:00:00Z');

  it('reports running sessions first', () => {
    expect(getSessionStatus('a', new Date(0), now, new Set(['a']))).toBe('running');
  });

  it('marks activity inside the recent window', () => {
    const recent = new Date(now.getTime() - RECENT_ACTIVITY_WINDOW_MS + 1000);
    const stale = new Date(now.getTime() - RECENT_ACTIVITY_WINDOW_MS - 1000);
    expect(getSessionStatus('a', recent, now)).toBe('recent');
    expect(getSessionStatus('a', stale, now, new Set(['b']))).toBe('idle');
  });

  it('treats an unknown time as idle', () => {
    expect(getSessionStatus('a', new Date(Number.NaN), now)).toBe('idle');
  });
});

describe('joinTooltipLines', () => {
  it('drops empty parts', () => {
    expect(joinTooltipLines('Name', '', null, undefined, false, '  ', '/path')).toBe('Name\n/path');
  });
});

describe('sortProjects', () => {
  it('keeps starred projects above the rest, then sorts by name', () => {
    const projects = ['beta', 'alpha', 'gamma', 'delta'].map((name) => project({ name, displayName: name }));
    const sorted = sortProjects(projects, 'name', new Set(['gamma', 'delta']), {});
    expect(sorted.map((item) => item.name)).toEqual(['delta', 'gamma', 'alpha', 'beta']);
  });

  it('sorts by latest activity within each group', () => {
    const projects = [
      project({ name: 'old', createdAt: '2026-01-01T00:00:00Z' }),
      project({ name: 'new', createdAt: '2026-06-01T00:00:00Z' }),
      project({ name: 'starred-old', createdAt: '2025-01-01T00:00:00Z' }),
    ];
    const sorted = sortProjects(projects, 'date', new Set(['starred-old']), {});
    expect(sorted.map((item) => item.name)).toEqual(['starred-old', 'new', 'old']);
  });
});
