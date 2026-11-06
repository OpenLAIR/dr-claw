import { describe, expect, it } from 'vitest';
import type { Project } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { matchesAllTerms, searchSidebar, tokenizeQuery } from '../sessionSearch';

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
