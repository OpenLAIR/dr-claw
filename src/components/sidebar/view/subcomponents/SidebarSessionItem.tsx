import { useLayoutEffect, useRef } from 'react';
import SidebarRenameEditor from './SidebarRenameEditor';
import { Badge } from '../../../ui/badge';
import { Button } from '../../../ui/button';
import { Clock, Edit2, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import { formatTimeAgo } from '../../../../utils/dateUtils';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type { SessionWithProvider, TouchHandlerFactory } from '../../types/types';
import { createSessionViewModel } from '../../utils/utils';
import SessionProviderLogo from '../../../SessionProviderLogo';

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  currentTime: Date;
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

export default function SidebarSessionItem({
  project,
  session,
  selectedSession,
  currentTime,
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
  touchHandlerFactory,
  t,
}: SidebarSessionItemProps) {
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;
  const isEditing = editingSession === session.id;
  const renameTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreRenameFocus = useRef(false);
  useLayoutEffect(() => {
    if (!isEditing && restoreRenameFocus.current) {
      renameTrigger.current?.focus({ preventScroll: true });
      restoreRenameFocus.current = false;
    }
  }, [isEditing]);

  const selectMobileSession = () => {
    onProjectSelect(project);
    onSessionSelect(session, project.name);
  };

  const saveEditedSession = () => {
    onSaveEditingSession(project.name, session.id, editingSessionName, session.__provider);
  };

  const requestDeleteSession = () => {
    onDeleteSession(project.name, session.id, sessionView.sessionName, session.__provider);
  };

  const modeBadgeLabel =
    sessionView.mode === 'workspace_qa' ? t('sessions.mode.workspaceQa') : t('sessions.mode.research');
  const stageTags = Array.isArray(session.tags)
    ? session.tags.filter((tag) => tag?.tagType === 'stage')
    : [];
  const visibleStageTags = stageTags.slice(0, 2);
  const hiddenStageCount = Math.max(0, stageTags.length - visibleStageTags.length);

  const stageTagBadges = stageTags.length > 0 ? (
    <div className="mt-1 flex flex-wrap gap-1">
      {visibleStageTags.map((tag) => (
        <span
          key={`${session.id}-${tag.id}`}
          className={cn(
            'inline-flex items-center rounded-full border px-1.5 py-0 text-[11px] font-medium',
            'border-border bg-muted text-muted-foreground',
          )}
        >
          {tag.label}
        </span>
      ))}
      {hiddenStageCount > 0 ? (
        <span className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-1.5 py-0 text-[11px] font-medium text-muted-foreground">
          +{hiddenStageCount}
        </span>
      ) : null}
    </div>
  ) : null;

  const metadataRowClassName = 'flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 min-w-0';
  const rightMetaClassName = 'flex max-w-full flex-wrap items-center gap-1.5';

  if (isEditing) return <SidebarRenameEditor label={t('sessions.renameSession')} value={editingSessionName}
    onChange={onEditingSessionNameChange} onSave={saveEditedSession} onCancel={onCancelEditingSession}
    feedback={renameFeedback} t={t} />;

  return (
    <div className="group relative">
      {sessionView.isActive && (
        <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1">
          <div className="w-2 h-2 bg-green-500 rounded-full" />
        </div>
      )}

      <div className="md:hidden">
        <div
          className={cn(
            'p-2 mx-3 my-0.5 rounded-md bg-card border active:scale-[0.98] transition-[transform,background-color,border-color,opacity] duration-150 relative',
            isSelected ? 'bg-primary/5 border-primary/20' : '',
            !isSelected && sessionView.isActive
              ? 'border-green-500/30 bg-green-50/5 dark:bg-green-900/5'
              : 'border-border/30',
          )}
          onClick={selectMobileSession}
        >
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0',
                isSelected ? 'bg-primary/10' : 'bg-muted/50',
              )}
            >
              <SessionProviderLogo provider={session.__provider} className="w-3 h-3" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate text-foreground">{sessionView.sessionName}</div>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
                <Clock className="w-2.5 h-2.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {formatTimeAgo(sessionView.sessionTime, currentTime, t)}
                </span>
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  <Badge variant="secondary" className="text-xs px-1 py-0 min-w-[1.5rem] justify-center">
                    {sessionView.messageCount}
                  </Badge>
                  <Badge variant="outline" className="text-[11px] px-1.5 py-0">
                    {modeBadgeLabel}
                  </Badge>
                  <span className="opacity-70">
                    <SessionProviderLogo provider={session.__provider} className="w-3 h-3" />
                  </span>
                </div>
              </div>
              {stageTagBadges}
            </div>

            {!sessionView.isCursorSession && (
              <button
                type="button"
                aria-label={t('tooltips.deleteSession')}
                className="w-11 h-11 shrink-0 rounded-md text-destructive hover:bg-accent flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ml-1"
                onClick={(event) => {
                  event.stopPropagation();
                  requestDeleteSession();
                }}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="hidden md:block">
        <Button
          variant="ghost"
          className={cn(
            'w-full justify-start p-2 h-auto font-normal text-left hover:bg-accent/50 transition-colors duration-200',
            isSelected && 'bg-accent text-accent-foreground',
          )}
          onClick={() => onSessionSelect(session, project.name)}
        >
          <div className="flex items-start gap-2 min-w-0 w-full">
            <SessionProviderLogo provider={session.__provider} className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div title={sessionView.sessionName} className="text-[14px] font-normal truncate text-foreground/90">{sessionView.sessionName}</div>
              <div className={metadataRowClassName} data-session-metadata>
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <Clock className="w-2.5 h-2.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {formatTimeAgo(sessionView.sessionTime, currentTime, t)}
                </span>
                </span>
                <div className={`${rightMetaClassName} group-hover:opacity-0 group-focus-within:opacity-0 transition-opacity`}>
                  <Badge
                    variant="secondary"
                    className="text-xs px-1 py-0 min-w-[1.5rem] justify-center"
                  >
                    {sessionView.messageCount}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-[11px] px-1.5 py-0"
                  >
                    {modeBadgeLabel}
                  </Badge>
                  <span className="opacity-70">
                    <SessionProviderLogo provider={session.__provider} className="w-3 h-3" />
                  </span>
                </div>
              </div>
              {stageTagBadges}
            </div>
          </div>
        </Button>

        {!sessionView.isCursorSession && (
          <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-[transform,background-color,border-color,opacity] duration-200">
                {!sessionView.isCodexSession && (
                  <button
                    className="w-6 h-6 bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40 rounded flex items-center justify-center"
                    ref={renameTrigger}
                    disabled={renameFeedback.pending}
                    onClick={(event) => {
                      event.stopPropagation();
                      restoreRenameFocus.current = true;
                      onStartEditingSession(session.id, session.summary || t('projects.newSession'));
                    }}
                    title={t('tooltips.editSessionName')}
                  >
                    <Edit2 className="w-3 h-3 text-gray-600 dark:text-gray-400" />
                  </button>
                )}
                <button
                  className="w-6 h-6 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded flex items-center justify-center"
                  onClick={(event) => {
                    event.stopPropagation();
                    requestDeleteSession();
                  }}
                  title={t('tooltips.deleteSession')}
                >
                  <Trash2 className="w-3 h-3 text-red-600 dark:text-red-400" />
                </button>
          </div>
        )}
      </div>
    </div>
  );
}
