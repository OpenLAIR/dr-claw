import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { Project, ProjectSession, SessionMode, SessionProvider } from '../../../../types/app';
import type { SessionWithProvider, TouchHandlerFactory } from '../../types/types';
import { SESSION_PREVIEW_COUNT, getKnownSessionTotal, getSessionPreview, isWideSidebarLayout } from '../../utils/sessionPreview';
import SidebarSessionItem from './SidebarSessionItem';

type SidebarProjectSessionsProps = {
  project: Project;
  isExpanded: boolean;
  sessions: SessionWithProvider[];
  selectedSession: ProjectSession | null;
  initialSessionsLoaded: boolean;
  isLoadingSessions: boolean;
  currentTime: Date;
  processingSessions?: ReadonlySet<string>;
  editingSession: string | null;
  editingSessionName: string;
  renameFeedback: { pending: boolean; error: string };
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: SessionProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
  ) => void;
  onLoadMoreSessions: (project: Project) => void;
  onNewSession: (project: Project, mode?: SessionMode) => void;
  newSessionMode?: SessionMode;
  touchHandlerFactory: TouchHandlerFactory;
  t: TFunction;
};

const secondaryRowClass =
  'flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 md:min-h-8';

function SessionListSkeleton() {
  return (
    <>
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="flex h-8 items-center gap-2 px-2">
          <div className="h-1.5 w-1.5 rounded-full bg-muted" />
          <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${55 + index * 20}%` }} />
        </div>
      ))}
    </>
  );
}

export default function SidebarProjectSessions({
  project,
  isExpanded,
  sessions,
  selectedSession,
  initialSessionsLoaded,
  isLoadingSessions,
  currentTime,
  processingSessions,
  editingSession,
  editingSessionName,
  renameFeedback,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  onLoadMoreSessions,
  onNewSession,
  newSessionMode = 'research',
  touchHandlerFactory,
  t,
}: SidebarProjectSessionsProps) {
  const [showAll, setShowAll] = useState(false);

  if (!isExpanded) {
    return null;
  }

  const hasSessions = sessions.length > 0;
  const { visible, hiddenCount } = getSessionPreview(sessions, {
    showAll,
    selectedSessionId: selectedSession?.id ?? null,
    knownTotal: getKnownSessionTotal(project, sessions),
  });
  const hiddenLoadedCount = sessions.length - visible.length;

  const showMore = () => {
    if (!showAll) setShowAll(true);
    // Everything loaded is already on screen: fetch the next page.
    if (showAll || hiddenLoadedCount === 0) onLoadMoreSessions(project);
  };

  const startNewSession = () => {
    if (!isWideSidebarLayout()) onProjectSelect(project);
    onNewSession(project, newSessionMode);
  };

  return (
    <div
      data-sidebar-session-tree
      className="relative ml-[17px] border-l border-border pl-1.5 md:ml-[15px]"
    >
      {!initialSessionsLoaded ? (
        <SessionListSkeleton />
      ) : !hasSessions && !isLoadingSessions ? (
        <button type="button" className={secondaryRowClass} onClick={startNewSession}>
          <Plus className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t('sessions.noSessions')} · {t('sessions.newSession')}</span>
        </button>
      ) : (
        visible.map((session) => (
          <SidebarSessionItem
            key={session.id}
            project={project}
            session={session}
            selectedSession={selectedSession}
            currentTime={currentTime}
            processingSessions={processingSessions}
            editingSession={editingSession}
            editingSessionName={editingSessionName}
            renameFeedback={renameFeedback}
            onEditingSessionNameChange={onEditingSessionNameChange}
            onStartEditingSession={onStartEditingSession}
            onCancelEditingSession={onCancelEditingSession}
            onSaveEditingSession={onSaveEditingSession}
            onProjectSelect={onProjectSelect}
            onSessionSelect={onSessionSelect}
            onDeleteSession={onDeleteSession}
            touchHandlerFactory={touchHandlerFactory}
            t={t}
          />
        ))
      )}

      {hasSessions && hiddenCount > 0 && (
        <button
          type="button"
          data-sidebar-more-sessions
          className={secondaryRowClass}
          onClick={showMore}
          disabled={isLoadingSessions}
          aria-busy={isLoadingSessions || undefined}
        >
          {isLoadingSessions ? (
            <div className="h-3 w-3 shrink-0 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
          ) : (
            // Lines the label up with session titles, which follow a status dot.
            <span className="w-1.5 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">
            {isLoadingSessions
              ? t('sessions.loading')
              : t('common:workbench.sidebar.moreSessions', { count: hiddenCount })}
          </span>
        </button>
      )}

      {showAll && sessions.length > SESSION_PREVIEW_COUNT && (
        <button type="button" className={secondaryRowClass} onClick={() => setShowAll(false)}>
          <span className="w-1.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t('common:workbench.sidebar.showFewerSessions')}</span>
        </button>
      )}
    </div>
  );
}
