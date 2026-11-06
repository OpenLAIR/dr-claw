import type { Project, SessionProvider } from '../../../types/app';
import type { SessionWithProvider } from '../types/types';

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
): PinnedSessionEntry[] => {
  const query = searchFilter.trim().toLowerCase();
  const projectsByName = new Map(projects.map((project) => [project.name, project]));
  const entries: PinnedSessionEntry[] = [];

  for (const pin of pins) {
    const project = projectsByName.get(pin.projectName);
    if (!project) continue;

    const loaded = getProjectSessions(project).find((session) => session.id === pin.sessionId);
    const session: SessionWithProvider = loaded ?? ({
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
      if (!haystack.includes(query)) continue;
    }

    entries.push({ project, session, pin });
  }

  return entries;
};

/** Split the (already sorted and filtered) project list into pinned and the rest. */
export const partitionPinnedProjects = (projects: Project[], isPinned: (projectName: string) => boolean) => {
  const pinned: Project[] = [];
  const others: Project[] = [];
  for (const project of projects) {
    (isPinned(project.name) ? pinned : others).push(project);
  }
  return { pinned, others };
};
