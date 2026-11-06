import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { TFunction } from 'i18next';
import { api } from '../../../utils/api';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';
import type {
  AdditionalSessionsByProject,
  DeleteProjectConfirmation,
  LoadingSessionsByProject,
  ProjectSortOrder,
  SessionDeleteConfirmation,
  SessionWithProvider,
} from '../types/types';
import {
  filterProjects,
  getAllSessions,
  loadStarredProjects,
  persistStarredProjects,
  readProjectSortOrder,
  sortProjects,
} from '../utils/utils';
import {
  isSessionPinned as isPinnedIn,
  loadPinnedSessions,
  partitionPinnedProjects,
  persistPinnedSessions,
  removePinnedSession,
  resolvePinnedSessions,
  togglePinnedSession,
  type PinnedSession,
} from '../utils/pinned';

type UseSidebarControllerArgs = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isLoading: boolean;
  isMobile: boolean;
  t: TFunction;
  onRefresh: () => Promise<void> | void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onSessionDelete?: (sessionId: string) => void;
  onProjectDelete?: (projectName: string) => void;
  setCurrentProject: (project: Project) => void;
  setSidebarVisible: (visible: boolean) => void;
  sidebarVisible: boolean;
};

export function useSidebarController({
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
  setSidebarVisible,
  sidebarVisible,
}: UseSidebarControllerArgs) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [renameFeedback, setRenameFeedback] = useState({ pending: false, error: '' });
  const renameLock = useRef(false);
  const [loadingSessions, setLoadingSessions] = useState<LoadingSessionsByProject>({});
  const [additionalSessions, setAdditionalSessions] = useState<AdditionalSessionsByProject>({});
  const [initialSessionsLoaded, setInitialSessionsLoaded] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(new Date());
  const [projectSortOrder, setProjectSortOrder] = useState<ProjectSortOrder>('date');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [projectHasMoreOverrides, setProjectHasMoreOverrides] = useState<Record<string, boolean>>({});
  const [editingSession, setEditingSession] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [deletingProjects, setDeletingProjects] = useState<Set<string>>(new Set());
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteProjectConfirmation | null>(null);
  const [sessionDeleteConfirmation, setSessionDeleteConfirmation] = useState<SessionDeleteConfirmation | null>(null);
  const [deletionPending, setDeletionPending] = useState<'project' | 'session' | null>(null);
  const deletionLock = useRef(false);
  const [projectDeleteError, setProjectDeleteError] = useState('');
  const [sessionDeleteError, setSessionDeleteError] = useState('');
  const [showVersionModal, setShowVersionModal] = useState(false);
  // Pinned projects keep the original `starredProjects` storage key so
  // existing favourites carry over as pins.
  const [starredProjects, setStarredProjects] = useState<Set<string>>(() => loadStarredProjects());
  const [pinnedSessions, setPinnedSessions] = useState<PinnedSession[]>(() => loadPinnedSessions());

  const isSidebarCollapsed = !isMobile && !sidebarVisible;

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setAdditionalSessions({});
    setInitialSessionsLoaded(new Set());
    setProjectHasMoreOverrides({});
  }, [projects]);

  useEffect(() => {
    if (selectedProject) {
      setExpandedProjects((prev) => {
        if (prev.has(selectedProject.name)) {
          return prev;
        }
        const next = new Set(prev);
        next.add(selectedProject.name);
        return next;
      });
    }
  }, [selectedSession, selectedProject]);

  useEffect(() => {
    if (projects.length > 0 && !isLoading) {
      const loadedProjects = new Set<string>();
      projects.forEach((project) => {
        if (project.sessions && project.sessions.length >= 0) {
          loadedProjects.add(project.name);
        }
      });
      setInitialSessionsLoaded(loadedProjects);
    }
  }, [projects, isLoading]);

  useEffect(() => {
    const loadSortOrder = () => {
      setProjectSortOrder(readProjectSortOrder());
    };

    loadSortOrder();

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'claude-settings') {
        loadSortOrder();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    const interval = setInterval(() => {
      if (document.hasFocus()) {
        loadSortOrder();
      }
    }, 30000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  const handleTouchClick = useCallback(
    (callback: () => void) =>
      (event: React.TouchEvent<HTMLElement>) => {
        const target = event.target as HTMLElement;
        if (target.closest('.overflow-y-auto') || target.closest('[data-scroll-container]')) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        callback();
      },
    [],
  );

  const toggleProject = useCallback((projectName: string) => {
    setExpandedProjects((prev) => {
      const next = new Set<string>();
      if (!prev.has(projectName)) {
        next.add(projectName);
      }
      return next;
    });
  }, []);

  const handleSessionClick = useCallback(
    (session: SessionWithProvider, projectName: string) => {
      onSessionSelect({ ...session, __projectName: projectName });
    },
    [onSessionSelect],
  );

  const toggleStarProject = useCallback((projectName: string) => {
    setStarredProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectName)) {
        next.delete(projectName);
      } else {
        next.add(projectName);
      }

      persistStarredProjects(next);
      return next;
    });
  }, []);

  const updatePinnedSessions = useCallback((update: (pins: PinnedSession[]) => PinnedSession[]) => {
    setPinnedSessions((prev) => {
      const next = update(prev);
      persistPinnedSessions(next);
      return next;
    });
  }, []);

  const togglePinSession = useCallback(
    (projectName: string, session: SessionWithProvider, title: string) => {
      updatePinnedSessions((prev) => togglePinnedSession(prev, {
        projectName,
        sessionId: session.id,
        provider: session.__provider,
        title,
      }));
    },
    [updatePinnedSessions],
  );

  const isSessionPinned = useCallback(
    (projectName: string, sessionId: string) => isPinnedIn(pinnedSessions, projectName, sessionId),
    [pinnedSessions],
  );

  const isProjectStarred = useCallback(
    (projectName: string) => starredProjects.has(projectName),
    [starredProjects],
  );

  const getProjectSessions = useCallback(
    (project: Project) => getAllSessions(project, additionalSessions),
    [additionalSessions],
  );

  const projectsWithSessionMeta = useMemo(
    () =>
      projects.map((project) => {
        const hasMoreOverride = projectHasMoreOverrides[project.name];
        if (hasMoreOverride === undefined) {
          return project;
        }

        return {
          ...project,
          sessionMeta: { ...project.sessionMeta, hasMore: hasMoreOverride },
        };
      }),
    [projectHasMoreOverrides, projects],
  );

  const sortedProjects = useMemo(
    () => sortProjects(projectsWithSessionMeta, projectSortOrder, starredProjects, additionalSessions),
    [additionalSessions, projectSortOrder, projectsWithSessionMeta, starredProjects],
  );

  const filteredProjects = useMemo(
    () => filterProjects(sortedProjects, searchFilter),
    [searchFilter, sortedProjects],
  );

  const { pinned: pinnedProjects, others: unpinnedProjects } = useMemo(
    () => partitionPinnedProjects(filteredProjects, (projectName) => starredProjects.has(projectName)),
    [filteredProjects, starredProjects],
  );

  const pinnedSessionEntries = useMemo(
    () => resolvePinnedSessions(pinnedSessions, projectsWithSessionMeta, getProjectSessions, searchFilter),
    [getProjectSessions, pinnedSessions, projectsWithSessionMeta, searchFilter],
  );

  const startEditing = useCallback((project: Project) => {
    if (renameLock.current) return;
    setEditingSession(null);
    setRenameFeedback({ pending: false, error: '' });
    setEditingProject(project.name);
    setEditingName(project.displayName);
  }, []);

  const startEditingSession = useCallback((sessionId: string, initialName: string) => {
    if (renameLock.current) return;
    setEditingProject(null);
    setRenameFeedback({ pending: false, error: '' });
    setEditingSession(sessionId);
    setEditingSessionName(initialName);
  }, []);

  const cancelEditing = useCallback(() => {
    if (renameLock.current) return;
    setEditingProject(null);
    setEditingName('');
    setRenameFeedback({ pending: false, error: '' });
  }, []);

  const cancelEditingSession = useCallback(() => {
    if (renameLock.current) return;
    setEditingSession(null);
    setEditingSessionName('');
    setRenameFeedback({ pending: false, error: '' });
  }, []);

  const saveRename = useCallback(async (name: string, request: () => Promise<Response>, close: () => void) => {
    if (renameLock.current) return;
    if (!name.trim()) {
      setRenameFeedback({ pending: false, error: t('messages.nameRequired') });
      return;
    }
    renameLock.current = true;
    setRenameFeedback({ pending: true, error: '' });
    try {
      const response = await request();
      if (!response.ok) throw new Error(`Rename failed: ${response.status}`);
      // Refresh failure must not offer a second write after a successful rename.
      try {
        // Sidebar refresh reconciles the selected project/session as well as
        // the list, so the chat header receives its new name too.
        await onRefresh();
      } catch (error) { console.error('Error refreshing after rename:', error); }
      close();
    } catch (error) {
      console.error('Error renaming:', error);
      setRenameFeedback({ pending: false, error: t('messages.renameFailed') });
    } finally {
      renameLock.current = false;
      setRenameFeedback(previous => ({ ...previous, pending: false }));
    }
  }, [onRefresh, t]);

  const saveProjectName = useCallback((projectName: string) => saveRename(
    editingName,
    () => api.renameProject(projectName, editingName.trim()),
    () => { setEditingProject(null); setEditingName(''); },
  ), [editingName, saveRename]);

  const showDeleteSessionConfirmation = useCallback(
    (
      projectName: string,
      sessionId: string,
      sessionTitle: string,
      provider: SessionDeleteConfirmation['provider'] = 'claude',
    ) => {
      setSessionDeleteError('');
      setSessionDeleteConfirmation({ projectName, sessionId, sessionTitle, provider });
    },
    [],
  );

  const confirmDeleteSession = useCallback(async () => {
    if (!sessionDeleteConfirmation || deletionLock.current) {
      return;
    }

    const { projectName, sessionId, provider } = sessionDeleteConfirmation;
    deletionLock.current = true;
    setDeletionPending('session');
    setSessionDeleteError('');

    try {
      const response =
        provider === 'codex'
          ? await api.deleteCodexSession(sessionId)
          : await api.deleteSession(projectName, sessionId, provider);

      if (response.ok) {
        setSessionDeleteConfirmation(null);
        updatePinnedSessions((prev) => removePinnedSession(prev, projectName, sessionId));
        onSessionDelete?.(sessionId);
      } else {
        setSessionDeleteError(t('messages.deleteSessionFailed'));
      }
    } catch (error) {
      console.error('[Sidebar] Error deleting session:', error);
      setSessionDeleteError(t('messages.deleteSessionError'));
    } finally {
      deletionLock.current = false;
      setDeletionPending(null);
    }
  }, [onSessionDelete, sessionDeleteConfirmation, t, updatePinnedSessions]);

  const requestProjectDelete = useCallback(
    (project: Project) => {
      setProjectDeleteError('');
      setDeleteConfirmation({
        project,
        sessionCount: getProjectSessions(project).length,
      });
    },
    [getProjectSessions],
  );

  const confirmDeleteProject = useCallback(async () => {
    if (!deleteConfirmation || deletionLock.current) {
      return;
    }

    const { project, sessionCount } = deleteConfirmation;
    const isEmpty = sessionCount === 0;

    deletionLock.current = true;
    setDeletionPending('project');
    setProjectDeleteError('');

    try {
      const response = await api.deleteProject(project.name, !isEmpty);

      if (!response.ok) {
        setProjectDeleteError(t('messages.deleteProjectFailed'));
        return;
      }

      setDeleteConfirmation(null);
      onProjectDelete?.(project.name);
      // A failed follow-up refresh must not make a successful deletion look
      // retryable. The selected project is only cleared after the DELETE succeeds.
      try {
        if (window.refreshTrashProjects) await window.refreshTrashProjects();
        else await onRefresh();
      } catch (error) {
        console.error('Error refreshing after project deletion:', error);
      }
    } catch (error) {
      console.error('Error deleting project:', error);
      setProjectDeleteError(t('messages.deleteProjectError'));
    } finally {
      deletionLock.current = false;
      setDeletionPending(null);
    }
  }, [deleteConfirmation, onProjectDelete, onRefresh, t]);

  const loadMoreSessions = useCallback(
    async (project: Project) => {
      const hasMoreOverride = projectHasMoreOverrides[project.name];
      const canLoadMore =
        hasMoreOverride !== undefined ? hasMoreOverride : project.sessionMeta?.hasMore === true;
      if (!canLoadMore || loadingSessions[project.name]) {
        return;
      }

      setLoadingSessions((prev) => ({ ...prev, [project.name]: true }));

      try {
        const currentSessionCount =
          (project.sessions?.length || 0) + (additionalSessions[project.name]?.length || 0);
        const response = await api.sessions(project.name, 5, currentSessionCount);

        if (!response.ok) {
          return;
        }

        const result = (await response.json()) as {
          sessions?: ProjectSession[];
          hasMore?: boolean;
        };

        setAdditionalSessions((prev) => ({
          ...prev,
          [project.name]: [...(prev[project.name] || []), ...(result.sessions || [])],
        }));

        if (result.hasMore === false) {
          // Keep hasMore state in local hook state instead of mutating the project prop object.
          setProjectHasMoreOverrides((prev) => ({ ...prev, [project.name]: false }));
        }
      } catch (error) {
        console.error('Error loading more sessions:', error);
      } finally {
        setLoadingSessions((prev) => ({ ...prev, [project.name]: false }));
      }
    },
    [additionalSessions, loadingSessions, projectHasMoreOverrides],
  );

  const handleProjectSelect = useCallback(
    (project: Project) => {
      onProjectSelect(project);
      setCurrentProject(project);
    },
    [onProjectSelect, setCurrentProject],
  );

  const refreshProjects = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefresh]);

  const updateSessionSummary = useCallback(
    (projectName: string, sessionId: string, summary: string, provider: SessionProvider = 'claude') => saveRename(
      summary,
      () => api.renameSession(projectName, sessionId, summary.trim(), provider),
      () => { setEditingSession(null); setEditingSessionName(''); },
    ), [saveRename],
  );

  const collapseSidebar = useCallback(() => {
    setSidebarVisible(false);
  }, [setSidebarVisible]);

  const expandSidebar = useCallback(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  return {
    isSidebarCollapsed,
    expandedProjects,
    editingProject,
    showNewProject,
    editingName,
    loadingSessions,
    additionalSessions,
    initialSessionsLoaded,
    currentTime,
    projectSortOrder,
    isRefreshing,
    editingSession,
    editingSessionName,
    searchFilter,
    deletingProjects,
    deleteConfirmation,
    sessionDeleteConfirmation,
    deletionPending,
    projectDeleteError,
    sessionDeleteError,
    showVersionModal,
    starredProjects,
    filteredProjects,
    pinnedProjects,
    unpinnedProjects,
    pinnedSessionEntries,
    togglePinSession,
    isSessionPinned,
    handleTouchClick,
    toggleProject,
    handleSessionClick,
    toggleStarProject,
    isProjectStarred,
    getProjectSessions,
    startEditing,
    startEditingSession,
    cancelEditingSession,
    renameFeedback,
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
    collapseSidebar,
    expandSidebar,
    setShowNewProject,
    setEditingName,
    setEditingSession,
    setEditingSessionName,
    setSearchFilter,
    setDeleteConfirmation,
    setSessionDeleteConfirmation,
    setShowVersionModal,
  };
}
