import { describe, expect, it } from 'vitest';
import type { Project } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import {
  contentHitToSession,
  indexContentHits,
  matchesAllTerms,
  mergeContentMatches,
  searchSidebar,
  splitSnippet,
  tokenizeQuery,
  type ContentSearchHit,
} from '../sessionSearch';

const project = (name: string, displayName = name): Project =>
  ({ name, displayName, fullPath: `/tmp/${name}` }) as Project;

const session = (id: string, summary: string): SessionWithProvider =>
  ({ id, summary, __provider: 'claude' }) as SessionWithProvider;

const sessions: Record<string, SessionWithProvider[]> = {
  survey: [session('s1', 'Survey chain-of-thought papers'), session('s2', 'Fix BibTeX duplicates')],
  protein: [session('p1', 'Debug OOM on A100 run'), session('p2', 'Plot pLDDT distributions')],
  empty: [],
};
const projects = [project('survey', 'llm-reasoning-survey'), project('protein', 'protein-folding'), project('empty', 'empty-notes')];
const search = (query: string) =>
  searchSidebar(projects, (item) => sessions[item.name] ?? [], (item) => item.summary ?? '', query);

describe('tokenizeQuery', () => {
  it('splits on whitespace and lower-cases', () => {
    expect(tokenizeQuery('  Debug   OOM ')).toEqual(['debug', 'oom']);
    expect(tokenizeQuery('   ')).toEqual([]);
  });
});

describe('matchesAllTerms', () => {
  it('needs every term, in any order', () => {
    expect(matchesAllTerms('Debug OOM on A100 run', ['a100', 'debug'])).toBe(true);
    expect(matchesAllTerms('Debug OOM on A100 run', ['debug', 'h100'])).toBe(false);
  });
});

describe('searchSidebar', () => {
  it('returns everything untouched without a query', () => {
    expect(search('  ')).toEqual({ projects, sessionMatches: null });
  });

  it('lists only projects with matching sessions, and only those sessions', () => {
    const result = search('oom');
    expect(result.projects.map((item) => item.name)).toEqual(['protein']);
    expect(result.sessionMatches?.get('protein')?.map((item) => item.id)).toEqual(['p1']);
  });

  it('matches several words across a title', () => {
    expect(search('plot distributions').sessionMatches?.get('protein')?.map((item) => item.id)).toEqual(['p2']);
  });

  it('still finds projects by name, without narrowing their sessions', () => {
    const result = search('empty');
    expect(result.projects.map((item) => item.name)).toEqual(['empty']);
    expect(result.sessionMatches?.has('empty')).toBe(false);
  });

  it('keeps project order', () => {
    expect(search('e').projects.map((item) => item.name)).toEqual(['survey', 'protein', 'empty']);
  });

  it('returns nothing when nothing matches', () => {
    const result = search('transformer');
    expect(result.projects).toEqual([]);
    expect(result.sessionMatches?.size).toBe(0);
  });
});

describe('mergeContentMatches', () => {
  const hit = (projectName: string, sessionId: string, snippet = `…${sessionId} snippet…`, title = ''): ContentSearchHit =>
    ({ projectName, sessionId, provider: 'claude', snippet, title, lastActivity: '2026-01-02T00:00:00.000Z' });
  const getSessions = (item: Project) => sessions[item.name] ?? [];
  const notPinned = () => false;

  it('leaves the result alone when not searching or without hits', () => {
    const idle = search('');
    expect(mergeContentMatches(idle, projects, [hit('survey', 's1')], getSessions, notPinned, ['oom'])).toBe(idle);
    const result = search('oom');
    expect(mergeContentMatches(result, projects, [], getSessions, notPinned, ['oom'])).toBe(result);
  });

  it('lists title matches first, then content-only matches with their snippet', () => {
    const merged = mergeContentMatches(search('oom'), projects, [hit('protein', 'p2'), hit('protein', 'p1')], getSessions, notPinned, ['oom']);
    const protein = merged.sessionMatches?.get('protein') ?? [];
    expect(protein.map((item) => item.id)).toEqual(['p1', 'p2']);
    expect(protein[0].__searchMatch).toBeUndefined();
    expect(protein[1]).toMatchObject({ summary: 'Plot pLDDT distributions', __searchMatch: { snippet: '…p2 snippet…', terms: ['oom'] } });
  });

  it('adds projects that only matched by content, keeping project order', () => {
    const merged = mergeContentMatches(search('oom'), projects, [hit('survey', 's2')], getSessions, notPinned, ['oom']);
    expect(merged.projects.map((item) => item.name)).toEqual(['survey', 'protein']);
    expect(merged.sessionMatches?.get('survey')?.map((item) => item.id)).toEqual(['s2']);
  });

  it('builds a stand-in for sessions that are not loaded yet', () => {
    const merged = mergeContentMatches(search('zzz'), projects, [hit('empty', 'old-1', '…match…', 'Old title')], getSessions, notPinned, ['zzz']);
    expect(merged.sessionMatches?.get('empty')).toEqual([{
      id: 'old-1',
      summary: 'Old title',
      name: 'Old title',
      lastActivity: '2026-01-02T00:00:00.000Z',
      __provider: 'claude',
      __projectName: 'empty',
      __searchMatch: { snippet: '…match…', terms: ['zzz'] },
    }]);
  });

  it('skips pinned sessions, unknown projects and duplicate hits', () => {
    const merged = mergeContentMatches(
      search('zzz'),
      projects,
      [hit('survey', 's1'), hit('gone', 'x1'), hit('protein', 'p1'), hit('protein', 'p1')],
      getSessions,
      (projectName, sessionId) => projectName === 'survey' && sessionId === 's1',
      ['zzz'],
    );
    expect(merged.projects.map((item) => item.name)).toEqual(['protein']);
    expect(merged.sessionMatches?.get('protein')?.map((item) => item.id)).toEqual(['p1']);
  });
});

describe('contentHitToSession', () => {
  it('keeps the loaded session and adds the snippet', () => {
    const loaded = session('p1', 'Debug OOM on A100 run');
    const row = contentHitToSession({ projectName: 'protein', sessionId: 'p1', provider: 'claude', snippet: 's' }, loaded, ['oom']);
    expect(row).toEqual({ ...loaded, __searchMatch: { snippet: 's', terms: ['oom'] } });
    expect(loaded.__searchMatch).toBeUndefined();
  });
});

describe('indexContentHits', () => {
  it('keys snippets by project and session', () => {
    const index = indexContentHits([{ projectName: 'a', sessionId: '1', provider: 'codex', snippet: 'x' }], ['x']);
    expect(index.get('a:1')).toEqual({ snippet: 'x', terms: ['x'] });
  });
});

describe('splitSnippet', () => {
  it('marks every occurrence of every term, case-insensitively', () => {
    expect(splitSnippet('The Quokka met a quokka near dataset', ['quokka', 'dataset'])).toEqual([
      { text: 'The ', hit: false },
      { text: 'Quokka', hit: true },
      { text: ' met a ', hit: false },
      { text: 'quokka', hit: true },
      { text: ' near ', hit: false },
      { text: 'dataset', hit: true },
    ]);
  });

  it('treats regex characters in terms literally', () => {
    expect(splitSnippet('use c++ (fast)', ['c++', '(fast)'])).toEqual([
      { text: 'use ', hit: false },
      { text: 'c++', hit: true },
      { text: ' ', hit: false },
      { text: '(fast)', hit: true },
    ]);
  });

  it('returns the snippet as one part without terms', () => {
    expect(splitSnippet('plain', [])).toEqual([{ text: 'plain', hit: false }]);
  });
});
