export type SessionProvider = 'claude' | 'cursor' | 'codex' | 'gemini';

export type SessionMode = 'research' | 'workspace_qa';

export interface PendingAutoIntake {
  prompt?: string | null;
  triggerId?: string | null;
}

export interface ImportedProjectAnalysisPrompt {
  project: Project;
  prompt: string;
}

export interface ProjectCreationOptions {
  autoIntake?: PendingAutoIntake | null;
  importedProjectAnalysisPrompt?: ImportedProjectAnalysisPrompt | null;
}

export type AppTab = 'dashboard' | 'trash' | 'chat' | 'survey' | 'files' | 'shell' | 'git' | 'researchlab' | 'skills' | 'tasks' | 'preview' | 'compute' | 'news' | 'community-tools' | 'research-run';

export interface ProjectSession {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  mode?: SessionMode;
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number;
  __provider?: SessionProvider;
  __projectName?: string;
  [key: string]: unknown;
}

export interface ProjectSessionMeta {
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

export interface ProjectTaskmasterInfo {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Project {
  name: string;
  displayName: string;
  fullPath: string;
  path?: string;
  createdAt?: string;
  sessions?: ProjectSession[];
  cursorSessions?: ProjectSession[];
  codexSessions?: ProjectSession[];
  geminiSessions?: ProjectSession[];
  sessionMeta?: ProjectSessionMeta;
  taskmaster?: ProjectTaskmasterInfo;
  [key: string]: unknown;
}

export interface TrashProject {
  name: string;
  displayName: string;
  fullPath: string;
  path?: string;
  originalPath?: string;
  trashPath?: string;
  claudeTrashPath?: string;
  trashedAt: string;
  sessionCount?: number;
  canRestore?: boolean;
  filesExist?: boolean;
  [key: string]: unknown;
}

export interface LoadingProgress {
  type?: 'loading_progress';
  phase?: string;
  current: number;
  total: number;
  currentProject?: string;
  [key: string]: unknown;
}

export interface ProjectsUpdatedMessage {
  type: 'projects_updated';
  projects: Project[];
  changedFile?: string;
  [key: string]: unknown;
}

export interface LoadingProgressMessage extends LoadingProgress {
  type: 'loading_progress';
}

export type AppSocketMessage =
  | LoadingProgressMessage
  | ProjectsUpdatedMessage
  | { type?: string; [key: string]: unknown };
