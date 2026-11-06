import { useLayoutEffect, useRef, useState } from 'react';
import SidebarRenameEditor from './SidebarRenameEditor';
import { ChevronRight, Edit3, Folder, FolderOpen, Plus, Star, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, SessionMode, SessionProvider } from '../../../../types/app';
import type { MCPServerStatus, SessionWithProvider, TouchHandlerFactory } from '../../types/types';
import { getKnownSessionTotal, isWideSidebarLayout, joinTooltipLines } from '../../utils/sessionPreview';
import SidebarProjectSessions from './SidebarProjectSessions';
import SidebarRowMenu, { revealRowActionsClass } from './SidebarRowMenu';

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
  processingSessions?: ReadonlySet<string>;
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

const rowActionClass =
  'flex h-9 w-9 md:h-6 md:w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

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
  processingSessions,
  editingSession,
  editingSessionName,
  renameFeedback,
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
  const [menuOpen, setMenuOpen] = useState(false);
  const rowButton = useRef<HTMLButtonElement | null>(null);
  const restoreRenameFocus = useRef(false);
  useLayoutEffect(() => {
    if (!isEditing && restoreRenameFocus.current) {
      rowButton.current?.focus({ preventScroll: true });
      restoreRenameFocus.current = false;
    }
  }, [isEditing]);
  const beginRename = () => {
    if (renameFeedback.pending) return;
    restoreRenameFocus.current = true;
    onStartEditingProject(project);
  };

  const sessionTotal = getKnownSessionTotal(project, sessions);
  const sessionCountLabel = t('sessions.count', { count: sessionTotal, displayCount: sessionTotal });
  const tooltip = joinTooltipLines(project.displayName, project.fullPath, sessionCountLabel);
  // Highlight the session instead of its project once one is open.
  const hasSelectedSession = Boolean(selectedSession && sessions.some((session) => session.id === selectedSession.id));
  const isRowHighlighted = isSelected && !hasSelectedSession;

  const toggleProject = () => onToggleProject(project.name);

  const activateRow = () => {
    // Phones only expand the project; wider layouts also open its overview.
    if (!isWideSidebarLayout()) {
      toggleProject();
      return;
    }
    onProjectSelect(project);
    if (!isExpanded) toggleProject();
  };

  const startNewSession = () => {
    if (!isWideSidebarLayout()) onProjectSelect(project);
    onNewSession(project, newSessionMode);
  };

  const FolderIcon = isExpanded ? FolderOpen : Folder;
  const expandLabel = isExpanded
    ? t('common:workbench.sidebar.collapseProject', { name: project.displayName })
    : t('common:workbench.sidebar.expandProject', { name: project.displayName });

  return (
    <div data-sidebar-project={project.name} className={cn(isDeleting && 'pointer-events-none opacity-50')}>
      {isEditing ? (
        <SidebarRenameEditor label={t('projects.projectNamePlaceholder')} value={editingName}
          onChange={onEditingNameChange} onSave={() => onSaveProjectName(project.name)} onCancel={onCancelEditingProject}
          feedback={renameFeedback} t={t} />
      ) : (
        <div
          data-sidebar-project-row
          className={cn(
            'group relative flex min-h-11 items-center rounded-md md:min-h-8',
            'hover:bg-accent/50',
            isRowHighlighted && 'bg-accent text-accent-foreground hover:bg-accent',
          )}
        >
          <button
            type="button"
            className="flex h-11 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8 md:w-6"
            onClick={toggleProject}
            aria-expanded={isExpanded}
            aria-label={expandLabel}
            title={expandLabel}
          >
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform duration-150', isExpanded && 'rotate-90')} />
          </button>
          <button
            ref={rowButton}
            type="button"
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md pr-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8"
            onClick={activateRow}
            onKeyDown={(event) => {
              if (event.key === 'F2') {
                event.preventDefault();
                beginRename();
              }
            }}
            title={tooltip}
            aria-current={isSelected ? 'true' : undefined}
          >
            <FolderIcon className={cn('h-4 w-4 shrink-0', isExpanded ? 'text-primary' : 'text-muted-foreground')} />
            <span
              data-sidebar-project-name
              className={cn('min-w-0 flex-1 truncate text-sm', isSelected ? 'font-semibold text-foreground' : 'font-medium text-foreground/90')}
            >
              {project.displayName}
            </span>
            {isStarred && (
              <Star
                aria-label={t('projects.starred')}
                role="img"
                className="h-3 w-3 shrink-0 fill-current text-amber-500 md:group-hover:hidden md:group-has-[:focus-visible]:hidden"
              />
            )}
          </button>

          {/* Touch layouts always show these; pointer layouts reveal them on
              hover or keyboard focus, and keep them while the menu is open. */}
          <div
            data-sidebar-project-actions
            className={cn(
              'flex shrink-0 items-center gap-0.5 pr-1',
              revealRowActionsClass(menuOpen),
            )}
          >
            <button type="button" className={rowActionClass} onClick={startNewSession}
              title={t('sessions.newSession')} aria-label={t('sessions.newSession')}>
              <Plus className="h-4 w-4 md:h-3.5 md:w-3.5" />
            </button>
            <SidebarRowMenu
              label={t('common:workbench.sidebar.rowActions', { name: project.displayName })}
              triggerClassName={rowActionClass}
              onOpenChange={setMenuOpen}
              items={[
                {
                  key: 'star',
                  label: isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites'),
                  icon: Star,
                  iconClassName: isStarred ? 'fill-current text-amber-500' : undefined,
                  onSelect: () => onToggleStarProject(project.name),
                },
                {
                  key: 'rename',
                  label: t('actions.rename'),
                  icon: Edit3,
                  disabled: renameFeedback.pending,
                  onSelect: beginRename,
                },
                {
                  key: 'delete',
                  label: t('common:workbench.sidebar.moveToTrash'),
                  icon: Trash2,
                  destructive: true,
                  onSelect: () => onDeleteProject(project),
                },
              ]}
            />
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
        onLoadMoreSessions={onLoadMoreSessions}
        onNewSession={onNewSession}
        newSessionMode={newSessionMode}
        touchHandlerFactory={touchHandlerFactory}
        t={t}
      />
    </div>
  );
}
