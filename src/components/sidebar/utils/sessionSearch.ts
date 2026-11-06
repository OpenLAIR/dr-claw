import type { Project, SessionProvider } from '../../../types/app';
import type { SessionSearchMatch, SessionWithProvider } from '../types/types';

/** Lower-cased words of a query; every word has to match. */
export const tokenizeQuery = (query: string): string[] =>
  query.trim().toLowerCase().split(/\s+/).filter(Boolean);

export const matchesAllTerms = (text: string, terms: string[]): boolean => {
  const haystack = text.toLowerCase();
  return terms.every((term) => haystack.includes(term));
};

export type SidebarSearchResult = {
  projects: Project[];
  /** Matching sessions per project name; `null` when no search is active. */
  sessionMatches: Map<string, SessionWithProvider[]> | null;
};

/**
 * Search sessions by title. A project is listed when any of its sessions
 * match (and then shows only those), or when its own name matches.
 */
export const searchSidebar = (
  projects: Project[],
  getSessions: (project: Project) => SessionWithProvider[],
  getSessionTitle: (session: SessionWithProvider) => string,
  query: string,
): SidebarSearchResult => {
  const terms = tokenizeQuery(query);
  if (terms.length === 0) {
    return { projects, sessionMatches: null };
  }

  const sessionMatches = new Map<string, SessionWithProvider[]>();
  const matchedProjects: Project[] = [];

  for (const project of projects) {
    const matches = getSessions(project).filter((session) => matchesAllTerms(getSessionTitle(session), terms));
    const nameMatches = matchesAllTerms(`${project.displayName || ''} ${project.name}`, terms);
    if (matches.length > 0) {
      sessionMatches.set(project.name, matches);
    }
    if (matches.length > 0 || nameMatches) {
      matchedProjects.push(project);
    }
  }

  return { projects: matchedProjects, sessionMatches };
};

/** One session whose messages matched, as returned by `/api/sessions/search`. */
export type ContentSearchHit = {
  projectName: string;
  sessionId: string;
  provider: SessionProvider;
  title?: string;
  snippet: string;
  lastActivity?: string;
};

export const contentHitKey = (projectName: string, sessionId: string) => `${projectName}:${sessionId}`;

/** Content matches keyed by `contentHitKey`. */
export const indexContentHits = (hits: ContentSearchHit[], terms: string[]): Map<string, SessionSearchMatch> =>
  new Map(hits.map((hit) => [contentHitKey(hit.projectName, hit.sessionId), { snippet: hit.snippet, terms }]));

export type SnippetPart = { text: string; hit: boolean };

/** Split a snippet into plain and matching parts, for highlighting. */
export const splitSnippet = (snippet: string, terms: string[]): SnippetPart[] => {
  const words = terms.filter(Boolean);
  if (words.length === 0) return [{ text: snippet, hit: false }];
  const escaped = words
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  return snippet
    .split(pattern)
    .filter(Boolean)
    .map((text) => ({ text, hit: words.includes(text.toLowerCase()) }));
};

/**
 * The row for a content hit: the loaded session when there is one, otherwise
 * a stand-in built from the hit (like an unloaded pin) so it can be opened.
 */
export const contentHitToSession = (
  hit: ContentSearchHit,
  loaded: SessionWithProvider | undefined,
  terms: string[],
): SessionWithProvider => ({
  ...(loaded ?? ({
    id: hit.sessionId,
    summary: hit.title || undefined,
    name: hit.title || undefined,
    lastActivity: hit.lastActivity,
    __provider: hit.provider,
    __projectName: hit.projectName,
  } as SessionWithProvider)),
  __searchMatch: { snippet: hit.snippet, terms },
});

/**
 * Add sessions whose messages matched to a title search result. Title matches
 * stay first; a session that matched both is listed once, as a title match.
 * Pinned sessions are left out (the Pinned section lists them), as are hits
 * in projects that are not shown. Projects keep their order in `projects`.
 */
export const mergeContentMatches = (
  result: SidebarSearchResult,
  projects: Project[],
  hits: ContentSearchHit[],
  getSessions: (project: Project) => SessionWithProvider[],
  isPinned: (projectName: string, sessionId: string) => boolean,
  terms: string[],
): SidebarSearchResult => {
  if (!result.sessionMatches || hits.length === 0) return result;

  const projectsByName = new Map(projects.map((project) => [project.name, project]));
  const sessionMatches = new Map(result.sessionMatches);
  const added = new Set<string>();

  for (const hit of hits) {
    const project = projectsByName.get(hit.projectName);
    if (!project || isPinned(hit.projectName, hit.sessionId)) continue;
    const key = contentHitKey(hit.projectName, hit.sessionId);
    const current = sessionMatches.get(project.name) ?? [];
    if (added.has(key) || current.some((session) => session.id === hit.sessionId)) continue;
    added.add(key);
    const loaded = getSessions(project).find((session) => session.id === hit.sessionId);
    sessionMatches.set(project.name, [...current, contentHitToSession(hit, loaded, terms)]);
  }

  if (added.size === 0) return result;
  const listed = new Set(result.projects.map((project) => project.name));
  return {
    projects: projects.filter((project) => listed.has(project.name) || sessionMatches.has(project.name)),
    sessionMatches,
  };
};
