import { useLayoutEffect, useRef } from 'react';
import SidebarRenameEditor from './SidebarRenameEditor';
import { Button } from '../../../ui/button';
import { ChevronDown, ChevronRight, Edit3, Folder, FolderOpen, Star, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import TaskIndicator from '../../../TaskIndicator';
import type { Project, ProjectSession, SessionMode, SessionProvider } from '../../../../types/app';
import type { MCPServerStatus, SessionWithProvider, TouchHandlerFactory } from '../../types/types';
import { getTaskIndicatorStatus } from '../../utils/utils';
import SidebarProjectSessions from './SidebarProjectSessions';

type SidebarProjectItemProps = {
  project: Project;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isExpanded: boolean;
  isDeleting: boolean;
  isStarred: boolean;
  editingProject: string | null;
  editingName: string;
  sessions: SessionWithProvider[];
  initialSessionsLoaded: boolean;
  isLoadingSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  renameFeedback: { pending: boolean; error: string };
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  onEditingNameChange: (name: string) => void;
  onToggleProject: (projectName: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectName: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
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
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: SessionProvider) => void;
  touchHandlerFactory: TouchHandlerFactory;
  t: TFunction;
};

const getSessionCountDisplay = (sessions: SessionWithProvider[], hasMoreSessions: boolean): string => {
  const sessionCount = sessions.length;
  if (hasMoreSessions && sessionCount >= 5) {
    return `${sessionCount}+`;
  }

  return `${sessionCount}`;
};

export default function SidebarProjectItem({
  project,
  selectedProject,
  selectedSession,
  isExpanded,
  isDeleting,
  isStarred,
  editingProject,
  editingName,
  sessions,
  initialSessionsLoaded,
  isLoadingSessions,
  currentTime,
  editingSession,
  editingSessionName,
  renameFeedback,
  tasksEnabled,
  mcpServerStatus,
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onDeleteSession,
  onLoadMoreSessions,
  onNewSession,
  newSessionMode,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  touchHandlerFactory,
  t,
}: SidebarProjectItemProps) {
  const isSelected = selectedProject?.name === project.name;
  const isEditing = editingProject === project.name;
  const renameTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreRenameFocus = useRef(false);
  useLayoutEffect(() => {
    if (!isEditing && restoreRenameFocus.current) {
      renameTrigger.current?.focus({ preventScroll: true });
      restoreRenameFocus.current = false;
    }
  }, [isEditing]);
  const beginRename = () => {
    if (renameFeedback.pending) return;
    restoreRenameFocus.current = true;
    onStartEditingProject(project);
  };
  const hasMoreSessions = project.sessionMeta?.hasMore === true;
  const sessionCountDisplay = getSessionCountDisplay(sessions, hasMoreSessions);
  const sessionCountLabel = t('sessions.count', { count: sessions.length, displayCount: sessionCountDisplay });
  const taskStatus = getTaskIndicatorStatus(project, mcpServerStatus);

  const toggleProject = () => onToggleProject(project.name);
  const toggleStarProject = () => onToggleStarProject(project.name);

  const saveProjectName = () => {
    onSaveProjectName(project.name);
  };

  const selectAndToggleProject = () => {
    onProjectSelect(project);
    if (!isExpanded) toggleProject();
  };

  return (
    <div className={cn('md:space-y-1', isDeleting && 'opacity-50 pointer-events-none')}>
      {isEditing ? (
        <SidebarRenameEditor label={t('projects.projectNamePlaceholder')} value={editingName}
          onChange={onEditingNameChange} onSave={saveProjectName} onCancel={onCancelEditingProject}
          feedback={renameFeedback} t={t} />
      ) : (
        <div className="group">
          <div className={cn('mx-3 border-b border-border py-2 md:hidden', isSelected && 'bg-muted/60')}>
            <button className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted"
              onClick={toggleProject} aria-expanded={isExpanded} onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); beginRename(); } }}>
              {isExpanded ? <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-medium text-foreground">{project.displayName}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{sessionCountLabel}</span>
              </span>
              {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </button>
            <div className="mt-1 flex items-center justify-end gap-1">
              <Button className="h-11 w-11 p-0" variant="ghost" onClick={toggleStarProject} aria-pressed={isStarred} aria-label={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}>
                <Star className={isStarred ? 'fill-current text-foreground' : 'text-muted-foreground'} />
              </Button>
              <Button ref={node => { if (node?.offsetParent) renameTrigger.current = node; }} className="h-11 w-11 p-0" variant="ghost" disabled={renameFeedback.pending} onClick={beginRename} aria-label={t('tooltips.renameProject')}><Edit3 className="text-muted-foreground" /></Button>
              <Button className="h-11 w-11 p-0" variant="ghost" onClick={() => onDeleteProject(project)} aria-label={t('tooltips.deleteProject')}><Trash2 className="text-red-600 dark:text-red-400" /></Button>
            </div>
          </div>
          <div className={cn('hidden md:block w-full rounded-md hover:bg-accent/50', isSelected && 'bg-accent text-accent-foreground')}>
            <Button variant="ghost" className="h-auto min-h-11 w-full min-w-0 justify-start gap-2 p-2 text-left font-normal" onClick={selectAndToggleProject} aria-expanded={isExpanded} onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); beginRename(); } }}>
              {isExpanded ? <FolderOpen className="h-4 w-4 shrink-0 text-primary" /> : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1">
                <span data-sidebar-project-name className="block whitespace-normal break-words text-sm font-semibold text-foreground" title={project.displayName}>{project.displayName}</span>
              </span>
              {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </Button>
            <div className="flex min-w-0 items-center gap-1 px-3 pb-1">
              <span className="min-w-0 flex-1 text-xs text-muted-foreground"><span className="block truncate">{sessionCountLabel}</span><span className="block truncate" title={project.fullPath}>{project.fullPath}</span></span>
              <Button className="h-8 w-8 shrink-0 p-0" variant="ghost" onClick={toggleStarProject} aria-pressed={isStarred} aria-label={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}><Star className={cn('h-3 w-3', isStarred && 'fill-current')} /></Button>
              <Button ref={node => { if (node?.offsetParent) renameTrigger.current = node; }} className="h-8 w-8 shrink-0 p-0" variant="ghost" disabled={renameFeedback.pending} onClick={beginRename} title={t('tooltips.renameProject')} aria-label={t('tooltips.renameProject')}><Edit3 className="h-3 w-3" /></Button>
              <Button className="h-8 w-8 shrink-0 p-0" variant="ghost" onClick={() => onDeleteProject(project)} title={t('tooltips.deleteProject')} aria-label={t('tooltips.deleteProject')}><Trash2 className="h-3 w-3 text-destructive" /></Button>
            </div>
          </div>
        </div>
      )}

      <SidebarProjectSessions
        project={project}
        isExpanded={isExpanded}
        sessions={sessions}
        selectedSession={selectedSession}
        initialSessionsLoaded={initialSessionsLoaded}
        isLoadingSessions={isLoadingSessions}
        currentTime={currentTime}
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
        onLoadMoreSessions={onLoadMoreSessions}
        onNewSession={onNewSession}
        newSessionMode={newSessionMode}
        touchHandlerFactory={touchHandlerFactory}
        t={t}
      />
    </div>
  );
}
