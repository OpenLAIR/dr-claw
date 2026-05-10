import { Badge } from '../../../ui/badge';
import { Button } from '../../../ui/button';
import { Check, Clock, Edit2, Loader2, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import { formatTimeAgo } from '../../../../utils/dateUtils';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type { SessionWithProvider, TouchHandlerFactory } from '../../types/types';
import { createSessionViewModel } from '../../utils/utils';
import SessionProviderLogo from '../../../SessionProviderLogo';
import { useSessionTabsStore } from '../../../../stores/useSessionTabsStore';

const STAGE_TAG_TONE_BY_KEY: Record<string, string> = {
  survey: 'border-sky-200/80 bg-sky-50 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-300',
  ideation: 'border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300',
  experiment: 'border-cyan-200/80 bg-cyan-50 text-cyan-700 dark:border-cyan-900/70 dark:bg-cyan-950/30 dark:text-cyan-300',
  publication: 'border-purple-200/80 bg-purple-50 text-purple-700 dark:border-purple-900/70 dark:bg-purple-950/30 dark:text-purple-300',
  promotion: 'border-pink-200/80 bg-pink-50 text-pink-700 dark:border-pink-900/70 dark:bg-pink-950/30 dark:text-pink-300',
};

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
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
  const bgStatus = useSessionTabsStore((s) => s.backgroundStatus[session.id]);
  const isBackgroundLoading = bgStatus?.isLoading ?? false;
  const hasUnread = bgStatus?.hasUnread ?? false;
  const bgTokenCount = bgStatus?.tokenCount ?? 0;

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
            'inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium',
            STAGE_TAG_TONE_BY_KEY[tag.tagKey || ''] || 'border-border/70 bg-background/70 text-foreground/75',
          )}
        >
          {tag.label}
        </span>
      ))}
      {hiddenStageCount > 0 ? (
        <span className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
          +{hiddenStageCount}
        </span>
      ) : null}
    </div>
  ) : null;

  const metadataRowClassName = 'flex items-center gap-1 mt-0.5 min-w-0';
  const rightMetaClassName = 'ml-auto flex items-center gap-1.5 flex-shrink-0';

  return (
    <div className="group relative">
      {sessionView.isActive && (
        <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        </div>
      )}

      <div className="md:hidden">
        <div
          className={cn(
            'p-2 mx-3 my-0.5 rounded-md bg-card border active:scale-[0.98] transition-all duration-150 relative',
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
              <div className={metadataRowClassName}>
                <Clock className="w-2.5 h-2.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {formatTimeAgo(sessionView.sessionTime, currentTime, t)}
                </span>
                <div className={rightMetaClassName}>
                  <Badge variant="secondary" className="text-xs px-1 py-0 min-w-[1.5rem] justify-center">
                    {sessionView.messageCount}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
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
                className="w-5 h-5 rounded-md bg-red-50 dark:bg-red-900/20 flex items-center justify-center active:scale-95 transition-transform opacity-70 ml-1"
                onClick={(event) => {
                  event.stopPropagation();
                  requestDeleteSession();
                }}
              >
                <Trash2 className="w-2.5 h-2.5 text-red-600 dark:text-red-400" />
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
              <div className="text-[14px] font-normal truncate text-foreground/90">{sessionView.sessionName}</div>
              <div className={metadataRowClassName}>
                <Clock className="w-2.5 h-2.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {formatTimeAgo(sessionView.sessionTime, currentTime, t)}
                </span>
                <div className={`${rightMetaClassName} group-hover:opacity-0 transition-opacity`}>
                  {isBackgroundLoading ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin text-amber-500" />
                      {bgTokenCount > 0 && (
                        <span className="text-[10px] tabular-nums text-amber-600 dark:text-amber-400">
                          {bgTokenCount > 999 ? `${Math.round(bgTokenCount / 1000)}k` : bgTokenCount}
                        </span>
                      )}
                    </>
                  ) : hasUnread ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                      <Badge
                        variant="secondary"
                        className="text-xs px-1 py-0 min-w-[1.5rem] justify-center"
                      >
                        {sessionView.messageCount}
                      </Badge>
                    </>
                  ) : (
                    <>
                      <Badge
                        variant="secondary"
                        className="text-xs px-1 py-0 min-w-[1.5rem] justify-center"
                      >
                        {sessionView.messageCount}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0"
                      >
                        {modeBadgeLabel}
                      </Badge>
                      <span className="opacity-70">
                        <SessionProviderLogo provider={session.__provider} className="w-3 h-3" />
                      </span>
                    </>
                  )}
                </div>
              </div>
              {stageTagBadges}
            </div>
          </div>
        </Button>

        {!sessionView.isCursorSession && (
          <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
            {editingSession === session.id && !sessionView.isCodexSession ? (
              <>
                <input
                  type="text"
                  value={editingSessionName}
                  onChange={(event) => onEditingSessionNameChange(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      saveEditedSession();
                    } else if (event.key === 'Escape') {
                      onCancelEditingSession();
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className="w-32 px-2 py-1 text-xs border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                <button
                  className="w-6 h-6 bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:hover:bg-green-900/40 rounded flex items-center justify-center"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveEditedSession();
                  }}
                  title={t('tooltips.save')}
                >
                  <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
                </button>
                <button
                  className="w-6 h-6 bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40 rounded flex items-center justify-center"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingSession();
                  }}
                  title={t('tooltips.cancel')}
                >
                  <X className="w-3 h-3 text-gray-600 dark:text-gray-400" />
                </button>
              </>
            ) : (
              <>
                {!sessionView.isCodexSession && (
                  <button
                    className="w-6 h-6 bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40 rounded flex items-center justify-center"
                    onClick={(event) => {
                      event.stopPropagation();
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
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
