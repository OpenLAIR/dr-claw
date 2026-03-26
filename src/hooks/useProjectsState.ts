import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { api } from '../utils/api';
import { queueWorkspaceQaDraft } from '../utils/workspaceQa';
import type {
  AppSocketMessage,
  AppTab,
  ImportedProjectAnalysisPrompt,
  LoadingProgress,
  ProjectCreationOptions,
  Project,
  ProjectSession,
  ProjectsUpdatedMessage,
  PendingAutoIntake,
  SessionMode,
  TrashProject,
} from '../types/app';

declare global {
  interface Window {
    handleProjectCreatedWithIntake?: (project: Project, options?: ProjectCreationOptions) => void;
    refreshProjects?: () => Promise<void>;
    refreshTrashProjects?: () => Promise<void>;
  }
}

const SESSION_MODE_STORAGE_KEY = 'dr-claw-new-session-mode';

const isSessionMode = (value: string | null | undefined): value is SessionMode =>
  value === 'research' || value === 'workspace_qa';

const readStoredNewSessionMode = (): SessionMode => {
  if (typeof window === 'undefined') {
    return 'research';
  }

  const stored = window.sessionStorage.getItem(SESSION_MODE_STORAGE_KEY);
  return isSessionMode(stored) ? stored : 'research';
};

const persistNewSessionMode = (mode: SessionMode) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(SESSION_MODE_STORAGE_KEY, mode);
};

type UseProjectsStateArgs = {
  sessionId?: string;
  navigate: NavigateFunction;
  latestMessage: AppSocketMessage | null;
  isMobile: boolean;
  activeSessions: Set<string>;
};

const serialize = (value: unknown) => JSON.stringify(value ?? null);

const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
  includeExternalSessions: boolean,
): boolean => {
  if (prevProjects.length !== nextProjects.length) {
    return true;
  }

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) {
      return true;
    }

    const baseChanged =
      nextProject.name !== prevProject.name ||
      nextProject.displayName !== prevProject.displayName ||
      nextProject.fullPath !== prevProject.fullPath ||
      serialize(nextProject.sessionMeta) !== serialize(prevProject.sessionMeta) ||
      serialize(nextProject.sessions) !== serialize(prevProject.sessions);

    if (baseChanged) {
      return true;
    }

    if (!includeExternalSessions) {
      return false;
    }

    return (
      serialize(nextProject.cursorSessions) !== serialize(prevProject.cursorSessions) ||
      serialize(nextProject.codexSessions) !== serialize(prevProject.codexSessions)
    );
  });
};

const getProjectSessions = (project: Project): ProjectSession[] => {
  return [
    ...(project.sessions ?? []),
    ...(project.codexSessions ?? []),
    ...(project.cursorSessions ?? []),
    ...(project.geminiSessions ?? []),
  ];
};

const isUpdateAdditive = (
  currentProjects: Project[],
  updatedProjects: Project[],
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): boolean => {
  if (!selectedProject || !selectedSession) {
    return true;
  }

  const currentSelectedProject = currentProjects.find((project) => project.name === selectedProject.name);
  const updatedSelectedProject = updatedProjects.find((project) => project.name === selectedProject.name);

  if (!currentSelectedProject || !updatedSelectedProject) {
    return false;
  }

  const currentSelectedSession = getProjectSessions(currentSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );
  const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );

  if (!currentSelectedSession || !updatedSelectedSession) {
    return false;
  }

  return (
    currentSelectedSession.id === updatedSelectedSession.id &&
    currentSelectedSession.title === updatedSelectedSession.title &&
    currentSelectedSession.created_at === updatedSelectedSession.created_at &&
    currentSelectedSession.updated_at === updatedSelectedSession.updated_at
  );
};

  const buildTransientSession = (
    sessionId: string,
    provider: ProjectSession['__provider'] = 'claude',
    projectName?: string,
  ): ProjectSession => ({
    id: sessionId,
    name: 'Auto Research Session',
    summary: 'Auto Research Session',
    mode: 'research',
    __provider: provider,
    __projectName: projectName,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  });

export function useProjectsState({
  sessionId,
  navigate,
  latestMessage,
  isMobile,
  activeSessions,
}: UseProjectsStateArgs) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [trashProjects, setTrashProjects] = useState<TrashProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingTrashProjects, setIsLoadingTrashProjects] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('agents');
  const [externalMessageUpdate, setExternalMessageUpdate] = useState(0);
  const [pendingAutoIntake, setPendingAutoIntake] = useState<PendingAutoIntake | null>(null);
  const [importedProjectAnalysisPrompt, setImportedProjectAnalysisPrompt] = useState<ImportedProjectAnalysisPrompt | null>(null);
  const [newSessionMode, setNewSessionMode] = useState<SessionMode>(() => readStoredNewSessionMode());

  const [selectedResearchTool, setSelectedResearchTool] = useState<string | null>(null);
  const [selectedResearchRun, setSelectedResearchRun] = useState<string | null>(null);

  const [communityToolTerminal, setCommunityToolTerminal] = useState<{
    toolId: string;
    toolName: string;
    installDir: string;
    setupDir: string;
    initialCommand?: string;
  } | null>(null);

  const openCommunityToolTerminal = useCallback((config: {
    toolId: string;
    toolName: string;
    installDir: string;
    setupDir: string;
    initialCommand?: string;
  }) => {
    setCommunityToolTerminal(config);
  }, []);

  const closeCommunityToolTerminal = useCallback(() => {
    setCommunityToolTerminal(null);
  }, []);

  const loadingProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectsUpdateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProjectsMessageRef = useRef<ProjectsUpdatedMessage | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setIsLoadingProjects(true);
      const projectsResponse = await api.projects();
      const projectData = (await projectsResponse.json()) as Project[];

      setProjects((prevProjects) => {
        if (prevProjects.length === 0) {
          return projectData;
        }

        return projectsHaveChanges(prevProjects, projectData, true)
          ? projectData
          : prevProjects;
      });
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setIsLoadingProjects(false);
    }
  }, []);

  const fetchTrashProjects = useCallback(async () => {
    try {
      setIsLoadingTrashProjects(true);
      const response = await api.trashedProjects();
      if (!response.ok) {
        return;
      }

      const trashData = (await response.json()) as TrashProject[];
      setTrashProjects(trashData);
    } catch (error) {
      console.error('Error fetching trashed projects:', error);
    } finally {
      setIsLoadingTrashProjects(false);
    }
  }, []);

  const openSettings = useCallback((tab = 'tools') => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (activeTab === 'trash') {
      void fetchTrashProjects();
    }
  }, [activeTab, fetchTrashProjects]);

  useEffect(() => {
    if (!latestMessage) {
      return;
    }

    if (latestMessage.type === 'session-created' && latestMessage.sessionId && latestMessage.provider) {
      const rawMode = latestMessage.mode;
      const modeValue = typeof rawMode === 'string' ? rawMode : null;
      const sessionMode: SessionMode = isSessionMode(modeValue) ? modeValue : 'research';

      setProjects((prevProjects) => prevProjects.map((project) => {
        const updateSessionList = (
          sessions: ProjectSession[] | undefined,
          provider: ProjectSession['__provider'],
        ): ProjectSession[] | undefined => {
          if (!Array.isArray(sessions)) {
            return sessions;
          }

          let changed = false;
          const nextSessions = sessions.map((session) => {
            if (session.id !== latestMessage.sessionId) {
              return session;
            }

            changed = true;
            return {
              ...session,
              mode: sessionMode,
              __provider: session.__provider || provider,
            };
          });

          return changed ? nextSessions : sessions;
        };

        const nextProject = {
          ...project,
          sessions: updateSessionList(project.sessions, 'claude'),
          cursorSessions: updateSessionList(project.cursorSessions, 'cursor'),
          codexSessions: updateSessionList(project.codexSessions, 'codex'),
          geminiSessions: updateSessionList(project.geminiSessions, 'gemini'),
        };

        return nextProject;
      }));

      setSelectedSession((previous) => {
        if (!previous || previous.id !== latestMessage.sessionId) {
          return previous;
        }

        return {
          ...previous,
          mode: sessionMode,
        };
      });
    }

    if (latestMessage.type === 'loading_progress') {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }

      setLoadingProgress(latestMessage as LoadingProgress);

      if (latestMessage.phase === 'complete') {
        loadingProgressTimeoutRef.current = setTimeout(() => {
          setLoadingProgress(null);
          loadingProgressTimeoutRef.current = null;
        }, 500);
      }

      return;
    }

    if (latestMessage.type !== 'projects_updated') {
      return;
    }

    pendingProjectsMessageRef.current = latestMessage as ProjectsUpdatedMessage;

    if (projectsUpdateDebounceRef.current) {
      return;
    }

    projectsUpdateDebounceRef.current = setTimeout(() => {
      projectsUpdateDebounceRef.current = null;
      const projectsMessage = pendingProjectsMessageRef.current;
      pendingProjectsMessageRef.current = null;

      if (!projectsMessage) {
        return;
      }

      if (projectsMessage.changedFile && selectedSession && selectedProject) {
        const normalized = projectsMessage.changedFile.replace(/\\/g, '/');
        const changedFileParts = normalized.split('/');

        if (changedFileParts.length >= 2) {
          const filename = changedFileParts[changedFileParts.length - 1];
          const changedSessionId = filename.replace('.jsonl', '');

          if (changedSessionId === selectedSession.id) {
            const isSessionActive = activeSessions.has(selectedSession.id);

            if (!isSessionActive) {
              setExternalMessageUpdate((prev) => prev + 1);
            }
          }
        }
      }

      const hasActiveSession =
        (selectedSession && activeSessions.has(selectedSession.id)) ||
        (activeSessions.size > 0 && Array.from(activeSessions).some((id) => id.startsWith('new-session-')));

      const updatedProjects = projectsMessage.projects;

      if (
        hasActiveSession &&
        !isUpdateAdditive(projects, updatedProjects, selectedProject, selectedSession)
      ) {
        return;
      }

      setProjects(updatedProjects);
      if (activeTab === 'trash') {
        void fetchTrashProjects();
      }

      if (!selectedProject) {
        return;
      }

      const updatedSelectedProject = updatedProjects.find(
        (project) => project.name === selectedProject.name,
      );

      if (!updatedSelectedProject) {
        return;
      }

      if (serialize(updatedSelectedProject) !== serialize(selectedProject)) {
        setSelectedProject(updatedSelectedProject);
      }

      if (!selectedSession) {
        return;
      }

      const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
        (session) => session.id === selectedSession.id,
      );

      if (!updatedSelectedSession) {
        setSelectedSession(null);
      }
    }, 250);
  }, [activeTab, activeSessions, fetchTrashProjects, latestMessage, projects, selectedProject, selectedSession]);

  useEffect(() => {
    return () => {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }
      if (projectsUpdateDebounceRef.current) {
        clearTimeout(projectsUpdateDebounceRef.current);
        projectsUpdateDebounceRef.current = null;
      }
      pendingProjectsMessageRef.current = null;
    };
  }, []);

  const handleNavigateToSession = useCallback((
    targetSessionId: string,
    targetProvider?: ProjectSession['__provider'],
    targetProjectName?: string,
  ) => {
    if (!targetSessionId) {
      return;
    }

    const shouldSwitchTab = !selectedSession || selectedSession.id !== targetSessionId;
    let matchedProject: Project | null = null;
    let matchedSession: ProjectSession | null = null;

    const targetProject = targetProjectName
      ? projects.find((project) => project.name === targetProjectName)
      : null;

    for (const project of projects) {
      const claudeSession = project.sessions?.find((session) => session.id === targetSessionId);
      if (claudeSession) {
        matchedProject = project;
        matchedSession = { ...claudeSession, __provider: 'claude' };
        break;
      }

      const cursorSession = project.cursorSessions?.find((session) => session.id === targetSessionId);
      if (cursorSession) {
        matchedProject = project;
        matchedSession = { ...cursorSession, __provider: 'cursor' };
        break;
      }

      const codexSession = project.codexSessions?.find((session) => session.id === targetSessionId);
      if (codexSession) {
        matchedProject = project;
        matchedSession = { ...codexSession, __provider: 'codex' };
        break;
      }

      const geminiSession = project.geminiSessions?.find((session) => session.id === targetSessionId);
      if (geminiSession) {
        matchedProject = project;
        matchedSession = { ...geminiSession, __provider: 'gemini' };
        break;
      }
    }

    const providerHint = targetProvider ?? matchedSession?.__provider;
    const sessionToSelect =
      matchedSession
      || (targetProvider ? buildTransientSession(targetSessionId, providerHint, targetProject?.name || selectedProject?.name) : null);

    const projectToSelect = matchedProject || targetProject;
    if (projectToSelect && selectedProject?.name !== projectToSelect.name) {
      setSelectedProject(projectToSelect);
    }

    if (sessionToSelect && (selectedSession?.id !== targetSessionId || selectedSession.__provider !== sessionToSelect.__provider)) {
      setSelectedSession(sessionToSelect);
    }

    if (shouldSwitchTab) {
      setActiveTab('chat');
    }

    if (sessionToSelect) {
      navigate(`/session/${targetSessionId}`);
    }
  }, [navigate, projects, selectedProject?.name, selectedSession?.id, selectedSession?.__provider]);

  useEffect(() => {
    if (!sessionId || projects.length === 0) {
      return;
    }

    handleNavigateToSession(sessionId);
  }, [sessionId, projects, handleNavigateToSession]);

  const handleProjectSelect = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      // Keep selectedResearchRun/Tool alive so ResearchRunViewer stays mounted
      // (preserves terminal logs & polling). CSS hidden handles visibility.
      setActiveTab((currentTab) =>
        currentTab === 'dashboard' || currentTab === 'trash' || currentTab === 'news' || currentTab === 'skills' || currentTab === 'research-run'
          ? 'chat'
          : currentTab,
      );
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleSessionSelect = useCallback(
    (session: ProjectSession) => {
      setSelectedSession(session);

      if (session.mode) {
        persistNewSessionMode(session.mode);
        setNewSessionMode(session.mode);
      }

      if (activeTab !== 'git' && activeTab !== 'preview') {
        setActiveTab('chat');
      }

      const provider = localStorage.getItem('selected-provider') || 'claude';
      if (provider === 'cursor') {
        sessionStorage.setItem('cursorSessionId', session.id);
      }

      if (isMobile) {
        const sessionProjectName = session.__projectName;
        const currentProjectName = selectedProject?.name;

        if (sessionProjectName !== currentProjectName) {
          setSidebarOpen(false);
        }
      }

      navigate(`/session/${session.id}`);
    },
    [activeTab, isMobile, navigate, selectedProject?.name],
  );

  const handleNewSession = useCallback(
    (project: Project, mode: SessionMode = 'research') => {
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      persistNewSessionMode(mode);
      setNewSessionMode(mode);
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleStartWorkspaceQa = useCallback(
    (project: Project, prompt: string) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      persistNewSessionMode('workspace_qa');
      setNewSessionMode('workspace_qa');
      queueWorkspaceQaDraft(project.name, prompt);
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleProjectCreatedWithIntake = useCallback(
    (project: Project, options?: ProjectCreationOptions) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      setPendingAutoIntake(options?.autoIntake ?? null);
      setImportedProjectAnalysisPrompt(options?.importedProjectAnalysisPrompt ?? null);
      navigate('/');
      if (isMobile) setSidebarOpen(false);
    },
    [isMobile, navigate],
  );

  const clearPendingAutoIntake = useCallback(() => setPendingAutoIntake(null), []);
  const clearImportedProjectAnalysisPrompt = useCallback(() => setImportedProjectAnalysisPrompt(null), []);

  const handleOpenDashboard = useCallback(() => {
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab('dashboard');
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const handleOpenTrash = useCallback(() => {
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab('trash');
    void fetchTrashProjects();
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [fetchTrashProjects, isMobile, navigate]);

  const handleOpenSkills = useCallback(() => {
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab('skills');
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const handleOpenNews = useCallback(() => {
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab('news');
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const [runConfigToolId, setRunConfigToolId] = useState<string | null>(null);

  const handleStartResearchRun = useCallback((toolId: string) => {
    setRunConfigToolId(toolId);
  }, []);

  const handleOpenCommunityTools = useCallback(() => {
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab('community-tools');
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const handleDeleteResearchRun = useCallback(async (toolId: string, runPath: string) => {
    const res = await api.communityTools.deleteRun(toolId, runPath);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to delete run');
    }
    // If the deleted run is currently selected, clear selection
    if (selectedResearchRun === runPath && selectedResearchTool === toolId) {
      setSelectedResearchRun(null);
      setSelectedResearchTool(null);
      setActiveTab('dashboard');
      navigate('/');
    }
  }, [selectedResearchRun, selectedResearchTool, navigate]);

  const handleSelectResearchRun = useCallback((toolId: string, runPath: string) => {
    setSelectedResearchTool(toolId);
    setSelectedResearchRun(runPath);
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab('research-run');
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const handleSessionDelete = useCallback(
    (sessionIdToDelete: string) => {
      if (selectedSession?.id === sessionIdToDelete) {
        setSelectedSession(null);
        navigate('/');
      }

      setProjects((prevProjects) =>
        prevProjects.map((project) => ({
          ...project,
          sessions: project.sessions?.filter((session) => session.id !== sessionIdToDelete) ?? [],
          sessionMeta: {
            ...project.sessionMeta,
            total: Math.max(0, (project.sessionMeta?.total as number | undefined ?? 0) - 1),
          },
        })),
      );
    },
    [navigate, selectedSession?.id],
  );

  const handleSidebarRefresh = useCallback(async () => {
    try {
      const [projectsResponse, trashResponse] = await Promise.all([
        api.projects(),
        api.trashedProjects(),
      ]);
      const freshProjects = (await projectsResponse.json()) as Project[];
      const freshTrashProjects = trashResponse.ok ? await trashResponse.json() as TrashProject[] : [];

      setProjects((prevProjects) =>
        projectsHaveChanges(prevProjects, freshProjects, true) ? freshProjects : prevProjects,
      );
      setTrashProjects(freshTrashProjects);

      if (!selectedProject) {
        return;
      }

      const refreshedProject = freshProjects.find((project) => project.name === selectedProject.name);
      if (!refreshedProject) {
        return;
      }

      if (serialize(refreshedProject) !== serialize(selectedProject)) {
        setSelectedProject(refreshedProject);
      }

      if (!selectedSession) {
        return;
      }

      const refreshedSession = getProjectSessions(refreshedProject).find(
        (session) => session.id === selectedSession.id,
      );

      if (refreshedSession) {
        // Keep provider metadata stable when refreshed payload doesn't include __provider.
        const normalizedRefreshedSession =
          refreshedSession.__provider || !selectedSession.__provider
            ? refreshedSession
            : { ...refreshedSession, __provider: selectedSession.__provider };

        if (serialize(normalizedRefreshedSession) !== serialize(selectedSession)) {
          setSelectedSession(normalizedRefreshedSession);
        }
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  }, [selectedProject, selectedSession]);

  const handleProjectDelete = useCallback(
    (projectName: string) => {
      if (selectedProject?.name === projectName) {
        setSelectedProject(null);
        setSelectedSession(null);
        navigate('/');
      }

      setProjects((prevProjects) => prevProjects.filter((project) => project.name !== projectName));
    },
    [navigate, selectedProject?.name],
  );

  const sidebarSharedProps = useMemo(
    () => ({
      projects,
      selectedProject,
      selectedSession,
      onProjectSelect: handleProjectSelect,
      onSessionSelect: handleSessionSelect,
      onNewSession: handleNewSession,
      onSessionDelete: handleSessionDelete,
      onProjectDelete: handleProjectDelete,
      isLoading: isLoadingProjects,
      isTrashLoading: isLoadingTrashProjects,
      loadingProgress,
      onRefresh: handleSidebarRefresh,
      onShowSettings: () => setShowSettings(true),
      showSettings,
      settingsInitialTab,
      onCloseSettings: () => setShowSettings(false),
      isMobile,
      activeTab,
      onOpenDashboard: handleOpenDashboard,
      onOpenTrash: handleOpenTrash,
      onOpenSkills: handleOpenSkills,
      onOpenNews: handleOpenNews,
      onOpenCommunityTools: handleOpenCommunityTools,
      onStartResearchRun: handleStartResearchRun,
      onSelectResearchRun: handleSelectResearchRun,
      onDeleteResearchRun: handleDeleteResearchRun,
      selectedResearchTool,
      selectedResearchRun,
      onImportedProjectCreated: handleProjectCreatedWithIntake,
      importedProjectAnalysisPrompt,
      onDismissImportedProjectAnalysisPrompt: clearImportedProjectAnalysisPrompt,
      newSessionMode,
    }),
    [
      activeTab,
      clearImportedProjectAnalysisPrompt,
      handleNewSession,
      handleDeleteResearchRun,
      handleOpenDashboard,
      handleOpenNews,
      handleOpenCommunityTools,
      handleStartResearchRun,
      handleSelectResearchRun,
      handleOpenSkills,
      handleOpenTrash,
      handleProjectCreatedWithIntake,
      handleProjectDelete,
      handleProjectSelect,
      handleSessionDelete,
      handleSessionSelect,
      handleSidebarRefresh,
      importedProjectAnalysisPrompt,
      isLoadingProjects,
      isLoadingTrashProjects,
      isMobile,
      loadingProgress,
      newSessionMode,
      projects,
      selectedProject,
      selectedResearchRun,
      selectedResearchTool,
      selectedSession,
      settingsInitialTab,
      showSettings,
    ],
  );

  return {
    projects,
    trashProjects,
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    isLoadingTrashProjects,
    loadingProgress,
    isInputFocused,
    showSettings,
    settingsInitialTab,
    externalMessageUpdate,
    importedProjectAnalysisPrompt,
    newSessionMode,
    setNewSessionMode,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    runConfigToolId,
    setRunConfigToolId,
    fetchProjects,
    fetchTrashProjects,
    sidebarSharedProps,
    handleProjectSelect,
    handleSessionSelect,
    handleNavigateToSession,
    handleOpenDashboard,
    handleOpenTrash,
    handleOpenSkills,
    handleOpenNews,
    handleNewSession,
    handleStartWorkspaceQa,
    handleSessionDelete,
    handleProjectDelete,
    handleSidebarRefresh,
    pendingAutoIntake,
    handleProjectCreatedWithIntake,
    clearPendingAutoIntake,
    clearImportedProjectAnalysisPrompt,
    communityToolTerminal,
    openCommunityToolTerminal,
    closeCommunityToolTerminal,
    selectedResearchTool,
    selectedResearchRun,
    handleSelectResearchRun,
    handleDeleteResearchRun,
  };
}
