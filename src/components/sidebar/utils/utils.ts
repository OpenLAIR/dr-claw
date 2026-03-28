import type { TFunction } from 'i18next';
import type { Project } from '../../../types/app';
import { stripInternalContextPrefix } from '../../../utils/sessionFormatting';
import type {
  AdditionalSessionsByProject,
  ProjectSortOrder,
  SettingsProject,
  SessionViewModel,
  SessionWithProvider,
} from '../types/types';

export const readProjectSortOrder = (): ProjectSortOrder => {
  try {
    const rawSettings = localStorage.getItem('claude-settings');
    if (!rawSettings) {
      return 'date';
    }

    const settings = JSON.parse(rawSettings) as { projectSortOrder?: ProjectSortOrder };
    return settings.projectSortOrder === 'name' ? 'name' : 'date';
  } catch {
    return 'date';
  }
};

export const loadStarredProjects = (): Set<string> => {
  try {
    const saved = localStorage.getItem('starredProjects');
    return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
  } catch {
    return new Set<string>();
  }
};

export const persistStarredProjects = (starredProjects: Set<string>) => {
  try {
    localStorage.setItem('starredProjects', JSON.stringify([...starredProjects]));
  } catch {
    // Keep UI responsive even if storage fails.
  }
};

export const getSessionDate = (session: SessionWithProvider): Date => {
  if (session.__provider === 'cursor') {
    return new Date(session.createdAt || 0);
  }

  if (session.__provider === 'codex' || session.__provider === 'gemini') {
    return new Date(session.lastActivity || session.createdAt || 0);
  }

  return new Date(session.lastActivity || 0);
};

export const getSessionName = (session: SessionWithProvider, t: TFunction): string => {
  let name = '';
  if (session.__provider === 'cursor') {
    name = session.name || t('projects.untitledSession');
  } else if (session.__provider === 'codex') {
    name = session.summary || session.name || t('projects.codexSession');
  } else if (session.__provider === 'gemini') {
    name = session.summary || session.name || 'Gemini Session';
  } else {
    name = session.summary || t('projects.newSession');
  }
  
  return stripInternalContextPrefix(name) || t('projects.newSession');
};

export const getSessionMode = (session: SessionWithProvider) => {
  if (session.mode === 'workspace_qa' || session.mode === 'research') {
    return session.mode;
  }

  if (typeof window !== 'undefined' && session.__projectName) {
    const storedMode = window.localStorage.getItem(`session_mode_${session.__projectName}_${session.id}`);
    if (storedMode === 'workspace_qa') {
      return 'workspace_qa';
    }
  }

  return 'research';
};

export const getSessionTime = (session: SessionWithProvider): string => {
  if (session.__provider === 'cursor') {
    return String(session.createdAt || '');
  }

  if (session.__provider === 'codex' || session.__provider === 'gemini') {
    return String(session.lastActivity || session.createdAt || '');
  }

  return String(session.lastActivity || '');
};

export const createSessionViewModel = (
  session: SessionWithProvider,
  currentTime: Date,
  t: TFunction,
): SessionViewModel => {
  const sessionDate = getSessionDate(session);
  const diffInMinutes = Math.floor((currentTime.getTime() - sessionDate.getTime()) / (1000 * 60));

  return {
    isCursorSession: session.__provider === 'cursor',
    isCodexSession: session.__provider === 'codex',
    isGeminiSession: session.__provider === 'gemini',
    isActive: diffInMinutes < 10,
    sessionName: getSessionName(session, t),
    sessionTime: getSessionTime(session),
    messageCount: Number(session.messageCount || 0),
    mode: getSessionMode(session),
  };
};

export const getAllSessions = (
  project: Project,
  additionalSessions: AdditionalSessionsByProject,
): SessionWithProvider[] => {
  const claudeSessions = [
    ...(project.sessions || []),
    ...(additionalSessions[project.name] || []),
  ].map((session) => ({ ...session, __provider: 'claude' as const, __projectName: project.name }));

  const cursorSessions = (project.cursorSessions || []).map((session) => ({
    ...session,
    __provider: 'cursor' as const,
    __projectName: project.name,
  }));

  const codexSessions = (project.codexSessions || []).map((session) => ({
    ...session,
    __provider: 'codex' as const,
    __projectName: project.name,
  }));

  const geminiSessions = (project.geminiSessions || []).map((session) => ({
    ...session,
    __provider: 'gemini' as const,
    __projectName: project.name,
  }));

  const openrouterSessions = (project.openrouterSessions || []).map((session) => ({
    ...session,
    __provider: 'openrouter' as const,
    __projectName: project.name,
  }));

  return [...claudeSessions, ...cursorSessions, ...codexSessions, ...geminiSessions, ...openrouterSessions].sort(
    (a, b) => getSessionDate(b).getTime() - getSessionDate(a).getTime(),
  );
};

export const getProjectLastActivity = (
  project: Project,
  additionalSessions: AdditionalSessionsByProject,
): Date => {
  const sessions = getAllSessions(project, additionalSessions);
  if (sessions.length === 0) {
    if (project.createdAt) {
      return new Date(project.createdAt);
    }
    return new Date();
  }

  const latestSession = sessions.reduce((latest, session) => {
    const sessionDate = getSessionDate(session);
    return sessionDate > latest ? sessionDate : latest;
  }, new Date(0));

  // A project's creation time may be newer than its oldest session activity.
  // Use whichever is more recent so that freshly created projects with no
  // activity don't sink below older projects that happen to share the same day.
  if (project.createdAt) {
    const created = new Date(project.createdAt);
    return created > latestSession ? created : latestSession;
  }

  return latestSession;
};

export const sortProjects = (
  projects: Project[],
  projectSortOrder: ProjectSortOrder,
  starredProjects: Set<string>,
  additionalSessions: AdditionalSessionsByProject,
): Project[] => {
  const byName = [...projects];

  byName.sort((projectA, projectB) => {
    const aStarred = starredProjects.has(projectA.name);
    const bStarred = starredProjects.has(projectB.name);

    if (aStarred && !bStarred) {
      return -1;
    }

    if (!aStarred && bStarred) {
      return 1;
    }

    if (projectSortOrder === 'date') {
      return (
        getProjectLastActivity(projectB, additionalSessions).getTime() -
        getProjectLastActivity(projectA, additionalSessions).getTime()
      );
    }

    return (projectA.displayName || projectA.name).localeCompare(projectB.displayName || projectB.name);
  });

  return byName;
};

export const filterProjects = (projects: Project[], searchFilter: string): Project[] => {
  const normalizedSearch = searchFilter.trim().toLowerCase();
  if (!normalizedSearch) {
    return projects;
  }

  return projects.filter((project) => {
    const displayName = (project.displayName || project.name).toLowerCase();
    const projectName = project.name.toLowerCase();
    return displayName.includes(normalizedSearch) || projectName.includes(normalizedSearch);
  });
};

export const getTaskIndicatorStatus = (
  project: Project,
  mcpServerStatus: { hasMCPServer?: boolean; isConfigured?: boolean } | null,
) => {
  const projectConfigured = Boolean(project.taskmaster?.hasTaskmaster);
  const mcpConfigured = Boolean(mcpServerStatus?.hasMCPServer && mcpServerStatus?.isConfigured);

  if (projectConfigured && mcpConfigured) {
    return 'fully-configured';
  }

  if (projectConfigured) {
    return 'taskmaster-only';
  }

  if (mcpConfigured) {
    return 'mcp-only';
  }

  return 'not-configured';
};

export const normalizeProjectForSettings = (project: Project): SettingsProject => {
  const fallbackPath =
    typeof project.fullPath === 'string' && project.fullPath.length > 0
      ? project.fullPath
      : typeof project.path === 'string'
      ? project.path
      : '';

  return {
    name: project.name,
    displayName:
      typeof project.displayName === 'string' && project.displayName.trim().length > 0
        ? project.displayName
        : project.name,
    fullPath: fallbackPath,
    path:
      typeof project.path === 'string' && project.path.length > 0
        ? project.path
        : fallbackPath,
  };
};
