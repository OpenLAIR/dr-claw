import type { TFunction } from 'i18next';
import type { LoadingProgress, Project, ProjectSession, SessionMode, SessionProvider } from '../../../../types/app';
import type {
  LoadingSessionsByProject,
  MCPServerStatus,
  SessionWithProvider,
  TouchHandlerFactory,
} from '../../types/types';
import type { PinnedSessionEntry } from '../../utils/pinned';
import SidebarProjectItem from './SidebarProjectItem';
import SidebarProjectsState from './SidebarProjectsState';
import SidebarSection from './SidebarSection';
import SidebarSessionItem from './SidebarSessionItem';

export type SidebarProjectListProps = {
  projects: Project[];
  filteredProjects: Project[];
  pinnedProjects: Project[];
  unpinnedProjects: Project[];
  pinnedSessionEntries: PinnedSessionEntry[];
  isSessionPinned: (projectName: string, sessionId: string) => boolean;
  onTogglePinSession: (projectName: string, session: SessionWithProvider, title: string) => void;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  expandedProjects: Set<string>;
  editingProject: string | null;
  editingName: string;
  loadingSessions: LoadingSessionsByProject;
  initialSessionsLoaded: Set<string>;
  currentTime: Date;
  processingSessions?: ReadonlySet<string>;
  editingSession: string | null;
  editingSessionName: string;
  renameFeedback: { pending: boolean; error: string };
  deletingProjects: Set<string>;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  getProjectSessions: (project: Project) => SessionWithProvider[];
  isProjectStarred: (projectName: string) => boolean;
  onEditingNameChange: (value: string) => void;
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

export default function SidebarProjectList({
  projects,
  filteredProjects,
  pinnedProjects,
  unpinnedProjects,
  pinnedSessionEntries,
  isSessionPinned,
  onTogglePinSession,
  selectedProject,
  selectedSession,
  isLoading,
  loadingProgress,
  expandedProjects,
  editingProject,
  editingName,
  loadingSessions,
  initialSessionsLoaded,
  currentTime,
  processingSessions,
  editingSession,
  editingSessionName,
  renameFeedback,
  deletingProjects,
  tasksEnabled,
  mcpServerStatus,
  getProjectSessions,
  isProjectStarred,
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
}: SidebarProjectListProps) {
  const state = (
    <SidebarProjectsState
      isLoading={isLoading}
      loadingProgress={loadingProgress}
      projectsCount={projects.length}
      filteredProjectsCount={filteredProjects.length + pinnedSessionEntries.length}
      t={t}
    />
  );

  const showProjects =
    !isLoading && projects.length > 0 && (filteredProjects.length > 0 || pinnedSessionEntries.length > 0);
  const hasPinned = pinnedProjects.length > 0 || pinnedSessionEntries.length > 0;

  const renderProject = (project: Project) => (
    <SidebarProjectItem
      key={project.name}
      project={project}
      selectedProject={selectedProject}
      selectedSession={selectedSession}
      isExpanded={expandedProjects.has(project.name)}
      isDeleting={deletingProjects.has(project.name)}
      isStarred={isProjectStarred(project.name)}
      editingProject={editingProject}
      editingName={editingName}
      sessions={getProjectSessions(project)}
      initialSessionsLoaded={initialSessionsLoaded.has(project.name)}
      isLoadingSessions={Boolean(loadingSessions[project.name])}
      currentTime={currentTime}
      processingSessions={processingSessions}
      editingSession={editingSession}
      editingSessionName={editingSessionName}
      renameFeedback={renameFeedback}
      tasksEnabled={tasksEnabled}
      mcpServerStatus={mcpServerStatus}
      onEditingNameChange={onEditingNameChange}
      onToggleProject={onToggleProject}
      onProjectSelect={onProjectSelect}
      onToggleStarProject={onToggleStarProject}
      onStartEditingProject={onStartEditingProject}
      onCancelEditingProject={onCancelEditingProject}
      onSaveProjectName={onSaveProjectName}
      onDeleteProject={onDeleteProject}
      onSessionSelect={onSessionSelect}
      onDeleteSession={onDeleteSession}
      onLoadMoreSessions={onLoadMoreSessions}
      onNewSession={onNewSession}
      newSessionMode={newSessionMode}
      onEditingSessionNameChange={onEditingSessionNameChange}
      onStartEditingSession={onStartEditingSession}
      onCancelEditingSession={onCancelEditingSession}
      onSaveEditingSession={onSaveEditingSession}
      isSessionPinned={isSessionPinned}
      onTogglePinSession={onTogglePinSession}
      touchHandlerFactory={touchHandlerFactory}
      t={t}
    />
  );

  return (
    <div className="flex flex-col gap-px pb-safe-area-inset-bottom">
      {!showProjects ? state : (
        <>
          {hasPinned && (
            <SidebarSection id="pinned" title={t('common:workbench.sidebar.pinned')}>
              {pinnedProjects.map(renderProject)}
              {pinnedSessionEntries.map(({ project, session }) => (
                <SidebarSessionItem
                  key={`${project.name}:${session.id}`}
                  variant="pinned"
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
                  isPinned
                  onTogglePin={onTogglePinSession}
                  touchHandlerFactory={touchHandlerFactory}
                  t={t}
                />
              ))}
            </SidebarSection>
          )}
          {/* Always mounted so pinning the first item does not remount every row. */}
          <SidebarSection
            id="projects"
            title={t('common:workbench.projects')}
            showHeader={hasPinned && unpinnedProjects.length > 0}
          >
            {unpinnedProjects.map(renderProject)}
          </SidebarSection>
        </>
      )}
    </div>
  );
}
