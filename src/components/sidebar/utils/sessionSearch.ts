import type { Project } from '../../../types/app';
import type { SessionWithProvider } from '../types/types';

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
