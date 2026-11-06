import type React from 'react';
import type { AppTab, LoadingProgress, Project, ProjectCreationOptions, ProjectSession, SessionMode, SessionProvider, TrashProject } from '../../../types/app';

export type ProjectSortOrder = 'name' | 'date';

export type SessionWithProvider = ProjectSession & {
  __provider: SessionProvider;
  /** Set on rows found by searching message text. */
  __searchMatch?: SessionSearchMatch;
};

export type SessionSearchMatch = {
  /** Excerpt of the matching message. */
  snippet: string;
  /** Lower-cased query words, to highlight in the snippet. */
  terms: string[];
};

export type AdditionalSessionsByProject = Record<string, ProjectSession[]>;
export type LoadingSessionsByProject = Record<string, boolean>;

export type DeleteProjectConfirmation = {
  project: Project;
  sessionCount: number;
};

export type DeleteTrashProjectConfirmation = {
  project: TrashProject;
};

export type SessionDeleteConfirmation = {
  projectName: string;
  sessionId: string;
  sessionTitle: string;
  provider: SessionProvider;
};

export type SidebarProps = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onNewSession: (project: Project, mode?: SessionMode) => void;
  onSessionDelete?: (sessionId: string) => void;
  onProjectDelete?: (projectName: string) => void;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  onRefresh: () => Promise<void> | void;
  onShowSettings: () => void;
  showSettings: boolean;
  settingsInitialTab: string;
  onCloseSettings: () => void;
  isMobile: boolean;
  onCloseMobile?: () => void;
  activeTab: AppTab;
  onOpenDashboard: () => void;
  onOpenTrash: () => void;
  onOpenSkills: () => void;
  onOpenAutoResearch: () => void;
  onOpenNews: () => void;
  onOpenCompute: () => void;
  onImportedProjectCreated?: (project: Project, options?: ProjectCreationOptions) => void;
  newSessionMode?: SessionMode;
  /** Sessions with a request in flight; shown as running in the list. */
  processingSessions?: ReadonlySet<string>;
};

export type SessionViewModel = {
  isCursorSession: boolean;
  isCodexSession: boolean;
  isGeminiSession: boolean;
  isActive: boolean;
  sessionName: string;
  sessionTime: string;
  messageCount: number;
  mode: SessionMode;
};

export type MCPServerStatus = {
  hasMCPServer?: boolean;
  isConfigured?: boolean;
} | null;

export type TouchHandlerFactory = (
  callback: () => void,
) => (event: React.TouchEvent<HTMLElement>) => void;

export type SettingsProject = Pick<Project, 'name' | 'displayName' | 'fullPath' | 'path'>;
