import type {
  ImportedProjectAnalysisPrompt,
  PendingAutoIntake,
  Project,
  ProjectSession,
  SessionMode,
  SessionNavigationSource,
  SessionProvider,
} from '../../../types/app';

export type Provider = SessionProvider;

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

export const RESUMING_STATUS_TEXT = 'Resuming...';

export interface ChatImage {
  data: string;
  name: string;
  mimeType?: string;
}

export interface ChatAttachment {
  name: string;
  kind: 'image' | 'pdf' | 'file';
  mimeType?: string;
  path?: string;
  extractedTextPreview?: string;
}

export interface ToolResult {
  content?: unknown;
  isError?: boolean;
  timestamp?: string | number | Date;
  toolUseResult?: unknown;
  [key: string]: unknown;
}

export interface SubagentChildTool {
  toolId: string;
  toolName: string;
  toolInput: unknown;
  toolResult?: ToolResult | null;
  timestamp: Date;
}

export interface AttachedPrompt {
  scenarioId: string;
  scenarioIcon: string;
  scenarioTitle: string;
  promptText: string;
}

export interface ChatMessage {
  type: string;
  content?: string;
  submittedContent?: string;
  timestamp: string | number | Date;
  images?: ChatImage[];
  attachments?: ChatAttachment[];
  reasoning?: string;
  isThinking?: boolean;
  isStreaming?: boolean;
  isInteractivePrompt?: boolean;
  isSkillContent?: boolean;
  isToolUse?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  toolId?: string;
  toolCallId?: string;
  isSubagentContainer?: boolean;
  subagentState?: {
    childTools: SubagentChildTool[];
    currentToolIndex: number;
    isComplete: boolean;
  };
  attachedPrompt?: AttachedPrompt;
  errorType?: 'usage_limit' | 'overloaded' | 'network' | 'auth' | 'unknown';
  isRetryable?: boolean;
  [key: string]: unknown;
}

export interface ProviderSettings {
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
  projectSortOrder: string;
  lastUpdated?: string;
  [key: string]: unknown;
}

export interface PermissionSuggestion {
  toolName: string;
  entry: string;
  isAllowed: boolean;
}

export interface PermissionGrantResult {
  success: boolean;
  alreadyAllowed?: boolean;
  updatedSettings?: ProviderSettings;
}

export interface PendingPermissionRequest {
  requestId: string;
  toolName: string;
  input?: unknown;
  context?: unknown;
  sessionId?: string | null;
  receivedAt?: Date;
}

export interface TokenBudget {
  used?: number | null;
  total?: number | null;
  unsupportedContext?: boolean;
  message?: string;
  lifetimeTokens?: number;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface ChatInterfaceProps {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  latestMessage: any;
  onInputFocusChange?: (focused: boolean) => void;
  onSessionActive?: (sessionId?: string | null) => void;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  processingSessions?: Set<string>;
  onReplaceTemporarySession?: (sessionId?: string | null) => void;
  onNavigateToSession?: (
    targetSessionId: string,
    targetProvider?: SessionProvider,
    targetProjectName?: string,
    options?: { source?: SessionNavigationSource },
  ) => void;
  onShowSettings?: () => void;
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  autoScrollToBottom?: boolean;
  sendByCtrlEnter?: boolean;
  externalMessageUpdate?: number;
  onTaskClick?: (...args: unknown[]) => void;
  onStartWorkspaceQa?: (project: Project, prompt: string) => void;
  pendingAutoIntake?: PendingAutoIntake | null;
  clearPendingAutoIntake?: () => void;
  importedProjectAnalysisPrompt?: ImportedProjectAnalysisPrompt | null;
  clearImportedProjectAnalysisPrompt?: () => void;
  initialInputDraft?: string | null;
  onOpenShellForSession?: () => void;
  newSessionMode?: SessionMode;
  onNewSessionModeChange?: (mode: SessionMode) => void;
}

export interface ProviderAvailability {
  cliAvailable: boolean;
  cliCommand?: string | null;
  installHint?: string | null;
}
