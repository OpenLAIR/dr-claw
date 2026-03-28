export type SessionProvider = 'claude' | 'cursor' | 'codex' | 'gemini' | 'openrouter';

export type SessionMode = 'research' | 'workspace_qa';

export interface SessionTag {
  id: number;
  projectName?: string;
  tagKey: string;
  tagType: 'stage' | string;
  label: string;
  color?: string | null;
  sortOrder?: number;
  metadata?: Record<string, unknown> | null;
  source?: string | null;
  linkedBy?: string | null;
  linkedAt?: string | null;
  linkMetadata?: Record<string, unknown> | null;
  createdAt?: string;
}

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

export type AppTab = 'dashboard' | 'trash' | 'chat' | 'survey' | 'files' | 'shell' | 'git' | 'researchlab' | 'skills' | 'tasks' | 'preview' | 'compute' | 'news';

export interface ProjectSession {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  mode?: SessionMode;
  tags?: SessionTag[];
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
  openrouterSessions?: ProjectSession[];
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
