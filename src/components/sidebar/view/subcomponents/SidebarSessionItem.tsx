import { useLayoutEffect, useRef, useState } from 'react';
import SidebarRenameEditor from './SidebarRenameEditor';
import SidebarRowMenu, { revealRowActionsClass } from './SidebarRowMenu';
import { Edit2, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import { formatTimeAgo } from '../../../../utils/dateUtils';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type { SessionWithProvider, TouchHandlerFactory } from '../../types/types';
import { createSessionViewModel, getSessionDate } from '../../utils/utils';
import { getSessionStatus, isWideSidebarLayout, joinTooltipLines, type SessionStatus } from '../../utils/sessionPreview';

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
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
  touchHandlerFactory: TouchHandlerFactory;
  t: TFunction;
};

const STATUS_DOT_CLASS: Record<SessionStatus, string> = {
  running: 'bg-blue-500 animate-pulse',
  recent: 'bg-green-500',
  idle: 'bg-transparent',
};

const rowActionClass =
  'flex h-9 w-9 md:h-6 md:w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function SidebarSessionItem({
  project,
  session,
  selectedSession,
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
  t,
}: SidebarSessionItemProps) {
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;
  const isEditing = editingSession === session.id;
  const [menuOpen, setMenuOpen] = useState(false);
  const rowButton = useRef<HTMLButtonElement | null>(null);
  const restoreRenameFocus = useRef(false);
  useLayoutEffect(() => {
    if (!isEditing && restoreRenameFocus.current) {
      rowButton.current?.focus({ preventScroll: true });
      restoreRenameFocus.current = false;
    }
  }, [isEditing]);

  const status = getSessionStatus(session.id, getSessionDate(session), currentTime, processingSessions);
  const statusLabel =
    status === 'running' ? t('common:workbench.sidebar.statusRunning')
      : status === 'recent' ? t('common:workbench.sidebar.statusRecent')
        : '';

  const selectSession = () => {
    // The phone layout also selects the project so the drawer can close on it.
    if (!isWideSidebarLayout()) onProjectSelect(project);
    onSessionSelect(session, project.name);
  };

  const saveEditedSession = () => {
    onSaveEditingSession(project.name, session.id, editingSessionName, session.__provider);
  };

  const startRename = () => {
    if (renameFeedback.pending) return;
    restoreRenameFocus.current = true;
    onStartEditingSession(session.id, session.summary || t('projects.newSession'));
  };

  const requestDeleteSession = () => {
    onDeleteSession(project.name, session.id, sessionView.sessionName, session.__provider);
  };

  const modeLabel =
    sessionView.mode === 'workspace_qa' ? t('sessions.mode.workspaceQa') : t('sessions.mode.research');
  const stageLabels = Array.isArray(session.tags)
    ? session.tags.filter((tag) => tag?.tagType === 'stage').map((tag) => tag.label)
    : [];
  const tooltip = joinTooltipLines(
    sessionView.sessionName,
    [formatTimeAgo(sessionView.sessionTime, currentTime, t), modeLabel, session.__provider].join(' · '),
    stageLabels.join(', '),
    statusLabel,
  );

  if (isEditing) return <SidebarRenameEditor label={t('sessions.renameSession')} value={editingSessionName}
    onChange={onEditingSessionNameChange} onSave={saveEditedSession} onCancel={onCancelEditingSession}
    feedback={renameFeedback} t={t} />;

  const canRename = !sessionView.isCursorSession && !sessionView.isCodexSession;
  const canDelete = !sessionView.isCursorSession;

  return (
    <div
      data-sidebar-session
      className={cn(
        'group relative flex min-h-11 items-center rounded-md md:min-h-8',
        'hover:bg-accent/50',
        isSelected && 'bg-accent text-accent-foreground hover:bg-accent',
      )}
    >
      <button
        type="button"
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8"
        ref={rowButton}
        onClick={selectSession}
        onKeyDown={(event) => {
          if (event.key === 'F2' && canRename) {
            event.preventDefault();
            startRename();
          }
        }}
        title={tooltip}
        aria-current={isSelected ? 'true' : undefined}
      >
        <span
          data-session-status={status}
          role={statusLabel ? 'img' : undefined}
          aria-label={statusLabel || undefined}
          aria-hidden={statusLabel ? undefined : true}
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT_CLASS[status])}
        />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[13px]',
            isSelected ? 'font-medium text-foreground' : 'text-foreground/85',
          )}
        >
          {sessionView.sessionName}
        </span>
      </button>

      {(canRename || canDelete) && (
        // Touch layouts always show the menu button; pointer layouts reveal it on
        // hover or keyboard focus, and keep it while the menu is open.
        <div
          className={cn(
            'flex shrink-0 items-center pr-1',
            revealRowActionsClass(menuOpen),
          )}
        >
          <SidebarRowMenu
            label={t('common:workbench.sidebar.rowActions', { name: sessionView.sessionName })}
            triggerClassName={rowActionClass}
            onOpenChange={setMenuOpen}
            items={[
              ...(canRename ? [{
                key: 'rename',
                label: t('actions.rename'),
                icon: Edit2,
                disabled: renameFeedback.pending,
                onSelect: startRename,
              }] : []),
              ...(canDelete ? [{
                key: 'delete',
                label: t('actions.delete'),
                icon: Trash2,
                destructive: true,
                onSelect: requestDeleteSession,
              }] : []),
            ]}
          />
        </div>
      )}
    </div>
  );
}
