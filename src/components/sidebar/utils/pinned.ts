import type { Project, SessionProvider } from '../../../types/app';
import type { SessionSearchMatch, SessionWithProvider } from '../types/types';
import { getKnownSessionTotal } from './sessionPreview';

const PINNED_SESSIONS_KEY = 'dr-claw.pinnedSessions';

/**
 * A pinned session is stored with a snapshot of what the sidebar needs to
 * show and open it, because older sessions may not be loaded yet.
 */
export type PinnedSession = {
  projectName: string;
  sessionId: string;
  provider: SessionProvider;
  title: string;
};

export type PinnedSessionEntry = {
  project: Project;
  session: SessionWithProvider;
  pin: PinnedSession;
};

const isPinnedSession = (value: unknown): value is PinnedSession => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.projectName === 'string'
    && typeof candidate.sessionId === 'string'
    && typeof candidate.provider === 'string'
    && typeof candidate.title === 'string';
};

export const parsePinnedSessions = (raw: string | null): PinnedSession[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPinnedSession) : [];
  } catch {
    return [];
  }
};

export const loadPinnedSessions = (): PinnedSession[] => {
  try {
    return parsePinnedSessions(localStorage.getItem(PINNED_SESSIONS_KEY));
  } catch {
    return [];
  }
};

export const persistPinnedSessions = (pins: PinnedSession[]) => {
  try {
    localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(pins));
  } catch {
    // Keep UI responsive even if storage fails.
  }
};

const samePin = (a: Pick<PinnedSession, 'projectName' | 'sessionId'>, b: Pick<PinnedSession, 'projectName' | 'sessionId'>) =>
  a.projectName === b.projectName && a.sessionId === b.sessionId;

export const isSessionPinned = (pins: PinnedSession[], projectName: string, sessionId: string) =>
  pins.some((pin) => samePin(pin, { projectName, sessionId }));

/** Pin at the end of the list, or unpin if already pinned. */
export const togglePinnedSession = (pins: PinnedSession[], pin: PinnedSession): PinnedSession[] =>
  isSessionPinned(pins, pin.projectName, pin.sessionId)
    ? pins.filter((existing) => !samePin(existing, pin))
    : [...pins, pin];

export const removePinnedSession = (pins: PinnedSession[], projectName: string, sessionId: string) =>
  pins.filter((pin) => !samePin(pin, { projectName, sessionId }));

/**
 * Turn stored pins into rows. Pins whose project is gone are skipped; loaded
 * sessions win over the stored snapshot so renames show up.
 */
export const resolvePinnedSessions = (
  pins: PinnedSession[],
  projects: Project[],
  getProjectSessions: (project: Project) => SessionWithProvider[],
  searchFilter = '',
  /** Sessions whose messages matched the search, by `project:session`. */
  contentMatches: ReadonlyMap<string, SessionSearchMatch> = new Map(),
): PinnedSessionEntry[] => {
  const query = searchFilter.trim().toLowerCase();
  const projectsByName = new Map(projects.map((project) => [project.name, project]));
  const entries: PinnedSessionEntry[] = [];

  for (const pin of pins) {
    const project = projectsByName.get(pin.projectName);
    if (!project) continue;

    const loaded = getProjectSessions(project).find((session) => session.id === pin.sessionId);
    let session: SessionWithProvider = loaded ?? ({
      id: pin.sessionId,
      summary: pin.title,
      name: pin.title,
      __provider: pin.provider,
      __projectName: project.name,
    } as SessionWithProvider);

    if (query) {
      const haystack = [
        loaded?.summary,
        loaded?.name,
        pin.title,
        project.displayName,
        project.name,
      ].filter(Boolean).join('\n').toLowerCase();
      if (!haystack.includes(query)) {
        const match = contentMatches.get(`${pin.projectName}:${pin.sessionId}`);
        if (!match) continue;
        session = { ...session, __searchMatch: match };
      }
    }

    entries.push({ project, session, pin });
  }

  return entries;
};

/**
 * A pinned session is listed only in the Pinned section. Returns the rest of
 * a project's sessions and how many of those exist in total, for "N more".
 */
export const separatePinnedSessions = (
  project: Project,
  sessions: SessionWithProvider[],
  pins: PinnedSession[],
): { sessions: SessionWithProvider[]; knownTotal: number } => {
  const projectPins = pins.filter((pin) => pin.projectName === project.name);
  if (projectPins.length === 0) {
    return { sessions, knownTotal: getKnownSessionTotal(project, sessions) };
  }

  const pinnedIds = new Set(projectPins.map((pin) => pin.sessionId));
  const loadedIds = new Set(sessions.map((session) => session.id));
  const unpinned = sessions.filter((session) => !pinnedIds.has(session.id));
  // An unloaded pin counts towards the server total only while more pages
  // remain; once everything is loaded it points at a session that is gone.
  const hasMore = project.sessionMeta?.hasMore === true;
  const pinnedInTotal = projectPins.filter((pin) => loadedIds.has(pin.sessionId) || hasMore).length;

  return {
    sessions: unpinned,
    knownTotal: Math.max(unpinned.length, getKnownSessionTotal(project, sessions) - pinnedInTotal),
  };
};
