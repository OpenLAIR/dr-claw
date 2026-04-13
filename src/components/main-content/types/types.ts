import type { Dispatch, MouseEvent, RefObject, SetStateAction } from 'react';
import type {
  AppTab,
  ImportedProjectAnalysisPrompt,
  PendingAutoIntake,
  Project,
  ProjectSession,
  SessionMode,
  SessionNavigationSource,
  SessionProvider,
  TrashProject,
} from '../../../types/app';
import type { Reference } from '../../references/types';

export type SessionLifecycleHandler = (sessionId?: string | null) => void;

export interface DiffInfo {
  old_string?: string;
  new_string?: string;
  [key: string]: unknown;
}

export interface EditingFile {
  name: string;
  path: string;
  projectName?: string;
  diffInfo?: DiffInfo | null;
  [key: string]: unknown;
}

export interface TaskMasterTask {
  id: string | number;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  details?: string;
  testStrategy?: string;
  parentId?: string | number;
  dependencies?: Array<string | number>;
  subtasks?: TaskMasterTask[];
  [key: string]: unknown;
}

export interface TaskReference {
  id: string | number;
  title?: string;
  [key: string]: unknown;
}

export type TaskSelection = TaskMasterTask | TaskReference;

export interface PrdFile {
  name: string;
  content?: string;
  isExisting?: boolean;
  [key: string]: unknown;
}

export interface MainContentProps {
  projects: Project[];
  trashProjects: TrashProject[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  latestMessage: unknown;
  isMobile: boolean;
  onMenuClick: () => void;
  isLoading: boolean;
  isTrashLoading?: boolean;
  onInputFocusChange: (focused: boolean) => void;
  onSessionActive: SessionLifecycleHandler;
  onSessionInactive: SessionLifecycleHandler;
  onSessionProcessing: SessionLifecycleHandler;
  onSessionNotProcessing: SessionLifecycleHandler;
  processingSessions: Set<string>;
  onReplaceTemporarySession: SessionLifecycleHandler;
  onNavigateToSession: (
    targetSessionId: string,
    targetProvider?: SessionProvider,
    targetProjectName?: string,
    options?: { source?: SessionNavigationSource },
  ) => void;
  sessionNavigationSource: SessionNavigationSource;
  onResetNavigationSource: () => void;
  onShowSettings: () => void;
  externalMessageUpdate: number;
  pendingAutoIntake?: PendingAutoIntake | null;
  clearPendingAutoIntake?: () => void;
  importedProjectAnalysisPrompt?: ImportedProjectAnalysisPrompt | null;
  clearImportedProjectAnalysisPrompt?: () => void;
  onProjectSelect: (project: Project) => void;
  onStartWorkspaceQa?: (project: Project, prompt: string) => void;
  onChatFromReference?: (project: Project, ref: Reference) => void;
  newSessionMode?: SessionMode;
  onNewSessionModeChange?: (mode: SessionMode) => void;
  onNewSession?: (project: Project, mode?: SessionMode) => void;
}

export interface MainContentHeaderProps {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
  isMobile: boolean;
  onMenuClick: () => void;
}

export interface MainContentStateViewProps {
  mode: 'loading' | 'empty';
  isMobile: boolean;
  onMenuClick: () => void;
}

export interface MobileMenuButtonProps {
  onMenuClick: () => void;
  compact?: boolean;
}

export interface EditorSidebarProps {
  editingFile: EditingFile | null;
  isMobile: boolean;
  editorExpanded: boolean;
  editorWidth: number;
  resizeHandleRef: RefObject<HTMLDivElement>;
  onResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onCloseEditor: () => void;
  onToggleEditorExpand: () => void;
  projectPath?: string;
  selectedProject?: Project | null;
  onStartWorkspaceQa?: (project: Project, prompt: string) => void;
  fillSpace?: boolean;
}

export interface TaskMasterPanelProps {
  isVisible: boolean;
}
