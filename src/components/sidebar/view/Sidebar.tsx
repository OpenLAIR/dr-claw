import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useVersionCheck } from '../../../hooks/useVersionCheck';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useSidebarController } from '../hooks/useSidebarController';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import { useAuth } from '../../../contexts/AuthContext';
import SidebarCollapsed from './subcomponents/SidebarCollapsed';
import SidebarContent from './subcomponents/SidebarContent';
import SidebarModals from './subcomponents/SidebarModals';
import ProjectCreationWizard from '../../ProjectCreationWizard';
import type { Project } from '../../../types/app';
import type { ProjectCreationOptions } from '../../../types/app';
import type { SidebarProjectListProps } from './subcomponents/SidebarProjectList';
import type { MCPServerStatus, SidebarProps } from '../types/types';

type TaskMasterSidebarContext = {
  setCurrentProject: (project: Project) => void;
  mcpServerStatus: MCPServerStatus;
};

function Sidebar({
  projects,
  selectedProject,
  selectedSession,
  onProjectSelect,
  onSessionSelect,
  onNewSession,
  onSessionDelete,
  onProjectDelete,
  isLoading,
  loadingProgress,
  onRefresh,
  onShowSettings,
  showSettings,
  settingsInitialTab,
  onCloseSettings,
  isMobile,
  activeTab,
  onOpenDashboard,
  onOpenTrash,
  onOpenSkills,
  onOpenNews,
  onImportedProjectCreated,
  newSessionMode,
}: SidebarProps) {
  const versionReminderStorageKey = 'dr-claw.versionReminder';
  const { t } = useTranslation(['sidebar', 'common']);
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const { updateAvailable, latestVersion, currentVersion, releaseInfo, installMode } = useVersionCheck(
    'OpenLAIR',
    'dr-claw',
  );
  const { preferences, setPreference } = useUiPreferences();
  const { sidebarVisible } = preferences;
  const { setCurrentProject, mcpServerStatus } = useTaskMaster() as TaskMasterSidebarContext;
  const { tasksEnabled } = useTasksSettings();
  const { logout } = useAuth();
  const [lastAutoPromptedVersion, setLastAutoPromptedVersion] = useState<string | null>(null);

  const {
    isSidebarCollapsed,
    expandedProjects,
    editingProject,
    showNewProject,
    editingName,
    loadingSessions,
    initialSessionsLoaded,
    currentTime,
    isRefreshing,
    editingSession,
    editingSessionName,
    searchFilter,
    deletingProjects,
    deleteConfirmation,
    sessionDeleteConfirmation,
    showVersionModal,
    filteredProjects,
    handleTouchClick,
    toggleProject,
    handleSessionClick,
    toggleStarProject,
    isProjectStarred,
    getProjectSessions,
    startEditing,
    cancelEditing,
    saveProjectName,
    showDeleteSessionConfirmation,
    confirmDeleteSession,
    requestProjectDelete,
    confirmDeleteProject,
    loadMoreSessions,
    handleProjectSelect,
    refreshProjects,
    updateSessionSummary,
    collapseSidebar: handleCollapseSidebar,
    expandSidebar: handleExpandSidebar,
    setShowNewProject,
    setEditingName,
    setEditingSession,
    setEditingSessionName,
    setSearchFilter,
    setDeleteConfirmation,
    setSessionDeleteConfirmation,
    setShowVersionModal,
  } = useSidebarController({
    projects,
    selectedProject,
    selectedSession,
    isLoading,
    isMobile,
    t,
    onRefresh,
    onProjectSelect,
    onSessionSelect,
    onSessionDelete,
    onProjectDelete,
    setCurrentProject,
    setSidebarVisible: (visible) => setPreference('sidebarVisible', visible),
    sidebarVisible,
  });

  useEffect(() => {
    if (!updateAvailable || !latestVersion || typeof window === 'undefined') {
      return;
    }

    const reminder = readVersionReminder(versionReminderStorageKey);
    const isSameVersionSnoozed =
      reminder?.version === latestVersion && reminder.remindAt > Date.now();

    if (isSameVersionSnoozed) {
      return;
    }

    if (lastAutoPromptedVersion === latestVersion) {
      return;
    }

    if (reminder?.version === latestVersion) {
      window.localStorage.removeItem(versionReminderStorageKey);
    }

    setShowVersionModal(true);
    setLastAutoPromptedVersion(latestVersion);
  }, [lastAutoPromptedVersion, latestVersion, setShowVersionModal, updateAvailable]);

  const dismissVersionReminder = () => {
    if (typeof window !== 'undefined' && latestVersion) {
      window.localStorage.setItem(
        versionReminderStorageKey,
        JSON.stringify({
          version: latestVersion,
          remindAt: Date.now() + VERSION_REMINDER_DELAY_MS,
        }),
      );
    }
    setShowVersionModal(false);
  };

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.classList.toggle('pwa-mode', isPWA);
    document.body.classList.toggle('pwa-mode', isPWA);
  }, [isPWA]);

  const [showWizard, setShowWizard] = useState(false);

  const projectListProps: SidebarProjectListProps = {
    projects,
    filteredProjects,
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
    editingSession,
    editingSessionName,
    deletingProjects,
    tasksEnabled,
    mcpServerStatus,
    getProjectSessions,
    isProjectStarred,
    onEditingNameChange: setEditingName,
    onToggleProject: toggleProject,
    onProjectSelect: handleProjectSelect,
    onToggleStarProject: toggleStarProject,
    onStartEditingProject: startEditing,
    onCancelEditingProject: cancelEditing,
    onSaveProjectName: (projectName) => {
      void saveProjectName(projectName);
    },
    onDeleteProject: requestProjectDelete,
    onSessionSelect: handleSessionClick,
    onDeleteSession: showDeleteSessionConfirmation,
    onLoadMoreSessions: (project) => {
      void loadMoreSessions(project);
    },
    onNewSession,
    newSessionMode,
    onEditingSessionNameChange: setEditingSessionName,
    onStartEditingSession: (sessionId, initialName) => {
      setEditingSession(sessionId);
      setEditingSessionName(initialName);
    },
    onCancelEditingSession: () => {
      setEditingSession(null);
      setEditingSessionName('');
    },
    onSaveEditingSession: (projectName, sessionId, summary, provider) => {
      void updateSessionSummary(projectName, sessionId, summary, provider);
    },
    touchHandlerFactory: handleTouchClick,
    t,
  };

  return (
    <>
      <SidebarModals
        projects={projects}
        showSettings={showSettings}
        settingsInitialTab={settingsInitialTab}
        onCloseSettings={onCloseSettings}
        deleteConfirmation={deleteConfirmation}
        onCancelDeleteProject={() => setDeleteConfirmation(null)}
        onConfirmDeleteProject={confirmDeleteProject}
        sessionDeleteConfirmation={sessionDeleteConfirmation}
        onCancelDeleteSession={() => setSessionDeleteConfirmation(null)}
        onConfirmDeleteSession={confirmDeleteSession}
        showVersionModal={showVersionModal}
        onCloseVersionModal={() => setShowVersionModal(false)}
        onLaterVersionModal={dismissVersionReminder}
        releaseInfo={releaseInfo}
        currentVersion={currentVersion}
        latestVersion={latestVersion}
        installMode={installMode}
        t={t}
      />

      {showWizard && (
        <ProjectCreationWizard
          onClose={() => setShowWizard(false)}
          onProjectCreated={(project: Project, options?: ProjectCreationOptions) => {
            setShowWizard(false);
            window.refreshProjects?.();
            if (options?.importedProjectAnalysisPrompt) {
              onImportedProjectCreated?.(project, options);
              return;
            }
            if (window.handleProjectCreatedWithIntake) {
              window.handleProjectCreatedWithIntake(project, options);
            } else {
              handleProjectSelect(project);
            }
          }}
        />
      )}

      {isSidebarCollapsed ? (
        <SidebarCollapsed
          onExpand={handleExpandSidebar}
          onShowSettings={onShowSettings}
          currentVersion={currentVersion}
          updateAvailable={updateAvailable}
          onShowVersionModal={() => setShowVersionModal(true)}
          t={t}
        />
      ) : (
        <>
          <SidebarContent
            isPWA={isPWA}
            isMobile={isMobile}
            isLoading={isLoading}
            projects={projects}
            searchFilter={searchFilter}
            onSearchFilterChange={setSearchFilter}
            onClearSearchFilter={() => setSearchFilter('')}
            onRefresh={() => {
              void refreshProjects();
            }}
            isRefreshing={isRefreshing}
            activeTab={activeTab}
            onOpenDashboard={onOpenDashboard}
            onOpenTrash={onOpenTrash}
            onOpenSkills={onOpenSkills}
            onOpenNews={onOpenNews}
            onCreateProject={() => setShowWizard(true)}
            onCollapseSidebar={handleCollapseSidebar}
            currentVersion={currentVersion}
            updateAvailable={updateAvailable}
            releaseInfo={releaseInfo}
            latestVersion={latestVersion}
            onShowVersionModal={() => setShowVersionModal(true)}
            onShowSettings={onShowSettings}
            onLogout={logout}
            projectListProps={projectListProps}
            t={t}
          />
        </>
      )}

    </>
  );
}

const VERSION_REMINDER_DELAY_MS = 24 * 60 * 60 * 1000;

function readVersionReminder(storageKey: string): { version: string; remindAt: number } | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawValue = window.localStorage.getItem(storageKey);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as { version?: string; remindAt?: number };
    if (!parsed.version || typeof parsed.remindAt !== 'number') {
      return null;
    }
    return { version: parsed.version, remindAt: parsed.remindAt };
  } catch {
    return null;
  }
}

export default Sidebar;
