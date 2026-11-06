import type { Project } from '../../../types/app';
import type { SessionWithProvider } from '../types/types';

/** Sessions shown under a project before the "N more" row. */
export const SESSION_PREVIEW_COUNT = 3;

/** A session counts as recently active for this long after its last activity. */
export const RECENT_ACTIVITY_WINDOW_MS = 10 * 60 * 1000;

export type SessionPreview = {
  visible: SessionWithProvider[];
  /** Sessions not rendered, including ones the server has not sent yet. */
  hiddenCount: number;
};

/**
 * Sessions known to exist for a project. Only Claude sessions are paginated
 * by the server (`sessionMeta.total`); other providers arrive in full.
 */
export const getKnownSessionTotal = (project: Project, sessions: SessionWithProvider[]): number => {
  const loadedClaude = sessions.filter((session) => session.__provider === 'claude').length;
  const claudeTotal = Number(project.sessionMeta?.total ?? 0);
  const notYetLoaded = project.sessionMeta?.hasMore === true ? Math.max(0, claudeTotal - loadedClaude) : 0;
  return sessions.length + notYetLoaded;
};

/**
 * Pick the rows to render for a project's session list. Collapsed lists keep
 * the newest `limit` sessions, plus the selected one if it would be hidden.
 */
export const getSessionPreview = (
  sessions: SessionWithProvider[],
  {
    limit = SESSION_PREVIEW_COUNT,
    showAll = false,
    selectedSessionId = null,
    knownTotal = sessions.length,
  }: {
    limit?: number;
    showAll?: boolean;
    selectedSessionId?: string | null;
    knownTotal?: number;
  } = {},
): SessionPreview => {
  const total = Math.max(knownTotal, sessions.length);
  let visible: SessionWithProvider[];

  if (showAll) {
    visible = sessions;
  } else {
    visible = sessions.slice(0, Math.max(0, limit));
    const selectedIndex = selectedSessionId
      ? sessions.findIndex((session) => session.id === selectedSessionId)
      : -1;
    if (selectedIndex >= visible.length) {
      visible = [...visible, sessions[selectedIndex]];
    }
  }

  return { visible, hiddenCount: Math.max(0, total - visible.length) };
};

export type SessionStatus = 'running' | 'recent' | 'idle';

export const getSessionStatus = (
  sessionId: string,
  lastActivity: Date,
  currentTime: Date,
  processingSessions?: ReadonlySet<string>,
): SessionStatus => {
  if (processingSessions?.has(sessionId)) {
    return 'running';
  }

  const elapsed = currentTime.getTime() - lastActivity.getTime();
  if (Number.isFinite(elapsed) && elapsed < RECENT_ACTIVITY_WINDOW_MS) {
    return 'recent';
  }

  return 'idle';
};

/** Multi-line native tooltip; empty parts are dropped. */
export const joinTooltipLines = (...lines: Array<string | null | undefined | false>): string =>
  lines.filter((line): line is string => typeof line === 'string' && line.trim().length > 0).join('\n');

/** Matches the `md` breakpoint where the sidebar switches from the phone layout. */
export const isWideSidebarLayout = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(min-width: 768px)').matches
    : true;
