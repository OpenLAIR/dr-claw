import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  SetStateAction,
  TouchEvent,
} from 'react';
import { useDropzone } from 'react-dropzone';
import type { FileRejection } from 'react-dropzone';
import { useTranslation } from 'react-i18next';
import { authenticatedFetch } from '../../../utils/api';
import { isTelemetryEnabled } from '../../../utils/telemetry';
import { TEMP_SESSION_PREFIX, isTemporarySessionId } from '../../../constants/session';

import { thinkingModes } from '../constants/thinkingModes';
import type { CodexReasoningEffortId } from '../constants/codexReasoningEfforts';
import { getSupportedCodexReasoningEfforts } from '../constants/codexReasoningSupport';
import type { GeminiThinkingModeId } from '../../../../shared/geminiThinkingSupport';
import { getSupportedGeminiThinkingModes } from '../../../../shared/geminiThinkingSupport';

import { grantToolPermission } from '../utils/chatPermissions';
import { applyEditedMessageToHistory, createChatMessageId } from '../utils/chatMessages';
import { clearSessionTimerStart, getProviderSettingsKey, persistSessionTimerStart, safeLocalStorage } from '../utils/chatStorage';
import { hasUnsavedComposerDraft, normalizeProgrammaticDraft, resolveLineHeightPx } from '../utils/composerUtils';
import { consumeWorkspaceQaDraft, WORKSPACE_QA_DRAFT_EVENT } from '../../../utils/workspaceQa';
import { consumeReferenceChatDraft, REFERENCE_CHAT_DRAFT_EVENT } from '../../../utils/referenceChatDraft';
import { consumeSkillCommandDraft, SKILL_COMMAND_DRAFT_EVENT } from '../../../utils/skillCommandDraft';
import type {
  AttachedPrompt,
  ChatAttachment,
  ChatImage,
  ChatMessage,
  PendingPermissionRequest,
  PermissionMode,
  TokenBudget,
} from '../types/types';
import { useFileMentions } from './useFileMentions';
import { type SlashCommand, useSlashCommands } from './useSlashCommands';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';
import { escapeRegExp } from '../utils/chatFormatting';
import { isAutoResearchScenario } from '../utils/autoResearch';
import { emitAutoresearchEvent } from '../../../utils/autoresearchTelemetry';
import type { SessionMode } from '../../../types/app';
import type { BtwOverlayState } from '../view/subcomponents/BtwOverlay';

const CLOSED_BTW_OVERLAY: BtwOverlayState = {
  open: false,
  question: '',
  answer: '',
  loading: false,
  error: null,
};

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

interface UseChatComposerStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: SessionProvider;
  permissionMode: PermissionMode | string;
  cyclePermissionMode: () => void;
  cursorModel: string;
  claudeModel: string;
  codexModel: string;
  geminiModel: string;
  openrouterModel: string;
  localModel: string;
  nanoModel: string;
  isLoading: boolean;
  canAbortSession: boolean;
  tokenBudget: TokenBudget | null;
  sendMessage: (message: unknown) => void;
  sendByCtrlEnter?: boolean;
  onSessionActive?: (sessionId?: string | null) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  pendingViewSessionRef: { current: PendingViewSession | null };
  scrollToBottom: () => void;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSessionMessages?: Dispatch<SetStateAction<any[]>>;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: Dispatch<SetStateAction<{ text: string; tokens: number; can_interrupt: boolean; startTime?: number } | null>>;
  setIsUserScrolledUp: (isScrolledUp: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  newSessionMode?: SessionMode;
  /** Current chat messages for /btw context. */
  getChatMessagesForBtw?: () => ChatMessage[];
}

interface MentionableFile {
  name: string;
  path: string;
}

interface CommandExecutionResult {
  type: 'builtin' | 'custom';
  action?: string;
  data?: any;
  content?: string;
  hasBashCommands?: boolean;
  hasFileIncludes?: boolean;
}

interface UploadedProjectFile {
  name?: string;
  path?: string;
  size?: number;
}

interface ProgrammaticMessageDraft {
  content?: string;
  attachedPrompt?: AttachedPrompt | null;
  editingMessageId?: string | null;
}

const createFakeSubmitEvent = () => {
  return { preventDefault: () => undefined } as unknown as FormEvent<HTMLFormElement>;
};

const PROGRAMMATIC_SUBMIT_MAX_RETRIES = 12;
const PROGRAMMATIC_SUBMIT_RETRY_DELAY_MS = 50;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;
const CODEX_ATTACHMENT_DIR = '.dr-claw/chat-attachments';

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.heic',
  '.heif',
]);

const PDF_EXTENSION = '.pdf';

function getAttachmentKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function getFileExtension(file: File) {
  const lowerName = file.name.toLowerCase();
  const lastDot = lowerName.lastIndexOf('.');
  return lastDot >= 0 ? lowerName.slice(lastDot) : '';
}

function isImageAttachment(file: File) {
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.has(getFileExtension(file));
}

function isPdfAttachment(file: File) {
  return file.type === 'application/pdf' || getFileExtension(file) === PDF_EXTENSION;
}

function getAttachmentKind(file: File) {
  if (isImageAttachment(file)) {
    return 'image';
  }
  if (isPdfAttachment(file)) {
    return 'pdf';
  }
  return 'file';
}

function formatRejectedFileMessage(rejection: FileRejection) {
  const attachmentKey = getAttachmentKey(rejection.file);
  const name = rejection.file?.name || 'Unknown file';
  const messages = rejection.errors.map((error) => {
    if (error.code === 'file-too-large') {
      return 'File too large (max 50MB)';
    }
    if (error.code === 'too-many-files') {
      return 'Too many files (max 5)';
    }
    return error.message;
  });

  return {
    attachmentKey,
    message: `${name}: ${messages.join(', ') || 'File rejected'}`,
  };
}

const BTW_TRANSCRIPT_MAX_CHARS = 120_000;

function buildBtwTranscript(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.type !== 'user' && m.type !== 'assistant') {
      continue;
    }
    const raw = typeof m.content === 'string' ? m.content : '';
    const text = raw.trim();
    if (!text) {
      continue;
    }
    const label = m.type === 'user' ? 'User' : 'Assistant';
    lines.push(`${label}: ${text}`);
  }
  let out = lines.join('\n\n');
  if (out.length > BTW_TRANSCRIPT_MAX_CHARS) {
    let cutPos = out.length - BTW_TRANSCRIPT_MAX_CHARS;
    const nextBoundary = out.indexOf('\n\n', cutPos);
    if (nextBoundary !== -1 && nextBoundary < cutPos + 2000) {
      cutPos = nextBoundary + 2;
    }
    out = '…(earlier messages omitted)\n\n' + out.slice(cutPos);
  }
  return out;
}

const getRouteSessionId = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const match = window.location.pathname.match(/^\/session\/([^/]+)$/);
  if (!match?.[1]) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

export function useChatComposerState({
  selectedProject,
  selectedSession,
  currentSessionId,
  provider,
  permissionMode,
  cyclePermissionMode,
  cursorModel,
  claudeModel,
  codexModel,
  geminiModel,
  openrouterModel,
  localModel,
  nanoModel,
  isLoading,
  canAbortSession,
  tokenBudget,
  sendMessage,
  sendByCtrlEnter,
  onSessionActive,
  onInputFocusChange,
  onFileOpen,
  onShowSettings,
  pendingViewSessionRef,
  scrollToBottom,
  setChatMessages,
  setSessionMessages,
  setIsLoading,
  setCanAbortSession,
  setClaudeStatus,
  setIsUserScrolledUp,
  setPendingPermissionRequests,
  newSessionMode = 'research',
  getChatMessagesForBtw,
}: UseChatComposerStateArgs) {
  const { t } = useTranslation('chat');
  const [input, setInput] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      return safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    }
    return '';
  });
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, number>>(new Map());
  const [fileErrors, setFileErrors] = useState<Map<string, string>>(new Map());
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [thinkingMode, setThinkingMode] = useState('none');
  const [codexReasoningEffort, setCodexReasoningEffort] = useState<CodexReasoningEffortId>(() => {
    const savedValue = safeLocalStorage.getItem('codex-reasoning-effort');
    switch (savedValue) {
      case 'minimal':
      case 'low':
      case 'medium':
      case 'high':
      case 'xhigh':
      case 'default':
        return savedValue;
      default:
        return 'default';
      }
  });
  const [geminiThinkingMode, setGeminiThinkingMode] = useState<GeminiThinkingModeId>(() => {
    const savedValue = safeLocalStorage.getItem('gemini-thinking-mode');
    switch (savedValue) {
      case 'default':
      case 'minimal':
      case 'low':
      case 'medium':
      case 'high':
      case 'dynamic':
      case 'off':
      case 'light':
      case 'balanced':
      case 'deep':
      case 'max':
        return savedValue;
      default:
        return 'default';
    }
  });
  const [intakeGreeting, setIntakeGreeting] = useState<string | null>(null);
  const [btwOverlay, setBtwOverlay] = useState<BtwOverlayState>(CLOSED_BTW_OVERLAY);
  const btwAbortRef = useRef<AbortController | null>(null);
  const closeBtwOverlay = useCallback(() => {
    btwAbortRef.current?.abort();
    btwAbortRef.current = null;
    setBtwOverlay(CLOSED_BTW_OVERLAY);
  }, []);
  const [pendingStageTagKeys, setPendingStageTagKeys] = useState<string[]>([]);
  const [attachedPrompt, setAttachedPrompt] = useState<AttachedPrompt | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputHighlightRef = useRef<HTMLDivElement>(null);
  const handleSubmitRef = useRef<
    ((event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>) => Promise<void>) | null
  >(null);
  // Programmatic draft loads and async submit callbacks must read the latest composer state
  // without waiting for a rerender, so the mutable refs intentionally mirror state here.
  const inputValueRef = useRef(input);
  const attachedFilesRef = useRef<File[]>([]);
  const attachedPromptRef = useRef<AttachedPrompt | null>(null);
  const pendingStageTagKeysRef = useRef<string[]>([]);
  const abortTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaLayoutTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEditedMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (abortTimeoutRef.current) {
        clearTimeout(abortTimeoutRef.current);
        abortTimeoutRef.current = null;
      }
      if (textareaLayoutTimeoutRef.current) {
        clearTimeout(textareaLayoutTimeoutRef.current);
        textareaLayoutTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setPendingStageTagKeys([]);
    pendingEditedMessageIdRef.current = null;
  }, [selectedProject?.name, selectedSession?.id]);

  useEffect(() => {
    attachedFilesRef.current = attachedFiles;
  }, [attachedFiles]);

  useEffect(() => {
    attachedPromptRef.current = attachedPrompt;
  }, [attachedPrompt]);

  useEffect(() => {
    pendingStageTagKeysRef.current = pendingStageTagKeys;
  }, [pendingStageTagKeys]);

  useEffect(() => {
    safeLocalStorage.setItem('codex-reasoning-effort', codexReasoningEffort);
  }, [codexReasoningEffort]);

  useEffect(() => {
    safeLocalStorage.setItem('gemini-thinking-mode', geminiThinkingMode);
  }, [geminiThinkingMode]);

  useEffect(() => {
    const supportedEfforts = getSupportedCodexReasoningEfforts(codexModel);
    if (!supportedEfforts.includes(codexReasoningEffort)) {
      setCodexReasoningEffort('default');
    }
  }, [codexModel, codexReasoningEffort]);

  useEffect(() => {
    const supportedModes = getSupportedGeminiThinkingModes(geminiModel);
    if (!supportedModes.includes(geminiThinkingMode)) {
      setGeminiThinkingMode('default');
    }
  }, [geminiModel, geminiThinkingMode]);

  const handleBuiltInCommand = useCallback(
    (result: CommandExecutionResult) => {
      const { action, data } = result;
      switch (action) {
        case 'clear':
          setChatMessages([]);
          setSessionMessages?.([]);
          break;

        case 'help':
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'assistant',
              content: data.content,
              timestamp: Date.now(),
            },
          ]);
          break;

        case 'model':
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'assistant',
              content: `**Current Model**: ${data.current.model}\n\n**Available Models**:\n\nClaude: ${data.available.claude.join(', ')}\n\nCursor: ${data.available.cursor.join(', ')}`,
              timestamp: Date.now(),
            },
          ]);
          break;

        case 'cost': {
          const costMessage = `**Token Usage**: ${data.tokenUsage.used.toLocaleString()} / ${data.tokenUsage.total.toLocaleString()} (${data.tokenUsage.percentage}%)\n\n**Estimated Cost**:\n- Input: $${data.cost.input}\n- Output: $${data.cost.output}\n- **Total**: $${data.cost.total}\n\n**Model**: ${data.model}`;
          setChatMessages((previous) => [
            ...previous,
            { type: 'assistant', content: costMessage, timestamp: Date.now() },
          ]);
          break;
        }

        case 'status': {
          const statusMessage = `**System Status**\n\n- Version: ${data.version}\n- Uptime: ${data.uptime}\n- Model: ${data.model}\n- Provider: ${data.provider}\n- Node.js: ${data.nodeVersion}\n- Platform: ${data.platform}`;
          setChatMessages((previous) => [
            ...previous,
            { type: 'assistant', content: statusMessage, timestamp: Date.now() },
          ]);
          break;
        }

        case 'memory':
          if (data.error) {
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content: `⚠️ ${data.message}`,
                timestamp: Date.now(),
              },
            ]);
          } else {
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content: `📝 ${data.message}\n\nPath: \`${data.path}\``,
                timestamp: Date.now(),
              },
            ]);
            if (data.exists && onFileOpen) {
              onFileOpen(data.path);
            }
          }
          break;

        case 'config':
          onShowSettings?.();
          break;

        case 'rewind':
          if (data.error) {
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content: `⚠️ ${data.message}`,
                timestamp: Date.now(),
              },
            ]);
          } else {
            setChatMessages((previous) => previous.slice(0, -data.steps * 2));
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content: `⏪ ${data.message}`,
                timestamp: Date.now(),
              },
            ]);
          }
          break;

        default:
          console.warn('Unknown built-in command action:', action);
      }
    },
    [onFileOpen, onShowSettings, setChatMessages, setSessionMessages],
  );

  const handleCustomCommand = useCallback(async (result: CommandExecutionResult) => {
    const { content, hasBashCommands } = result;

    if (hasBashCommands) {
      const confirmed = window.confirm(
        'This command contains bash commands that will be executed. Do you want to proceed?',
      );
      if (!confirmed) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'assistant',
            content: '❌ Command execution cancelled',
            timestamp: Date.now(),
          },
        ]);
        return;
      }
    }

    const commandContent = content || '';
    setInput(commandContent);
    inputValueRef.current = commandContent;

    // Defer submit to next tick so the command text is reflected in UI before dispatching.
    setTimeout(() => {
      if (handleSubmitRef.current) {
        handleSubmitRef.current(createFakeSubmitEvent());
      }
    }, 0);
  }, [setChatMessages]);

  const executeCommand = useCallback(
    async (command: SlashCommand, rawInput?: string) => {
      if (!command || !selectedProject) {
        return;
      }

      try {
        const effectiveInput = rawInput ?? input;
        const commandMatch = effectiveInput.match(new RegExp(`${escapeRegExp(command.name)}\\s*(.*)`));
        const args =
          commandMatch && commandMatch[1] ? commandMatch[1].trim().split(/\s+/) : [];

        const context = {
          projectPath: selectedProject.fullPath || selectedProject.path,
          projectName: selectedProject.name,
          sessionId: currentSessionId,
          provider,
          model:
            provider === 'cursor'
              ? cursorModel
              : provider === 'codex'
                ? codexModel
                : provider === 'gemini'
                  ? geminiModel
                  : provider === 'openrouter'
                    ? openrouterModel
                    : provider === 'local'
                      ? localModel
                      : provider === 'nano'
                        ? nanoModel
                        : claudeModel,
          tokenUsage: tokenBudget,
        };

        const response = await authenticatedFetch('/api/commands/execute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            commandName: command.name,
            commandPath: command.path,
            args,
            context,
          }),
        });

        if (!response.ok) {
          let errorMessage = `Failed to execute command (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage = errorData?.message || errorData?.error || errorMessage;
          } catch {
            // Ignore JSON parse failures and use fallback message.
          }
          throw new Error(errorMessage);
        }

        const result = (await response.json()) as CommandExecutionResult;
        if (result.type === 'builtin' && result.action === 'btw') {
          const { data } = result;
          setInput('');
          inputValueRef.current = '';
          if (data?.error) {
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content: `⚠️ ${data.error}`,
                timestamp: Date.now(),
              },
            ]);
            return;
          }
          const btwSupportedProviders = new Set(['claude', 'gemini', 'codex']);
          if (!btwSupportedProviders.has(provider)) {
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content:
                  '`/btw` is available with Claude, Gemini, and Codex providers. Switch to one of them in the chat controls, then try again.',
                timestamp: Date.now(),
              },
            ]);
            return;
          }
          const question = typeof data?.question === 'string' ? data.question.trim() : '';
          if (!question) {
            return;
          }
          btwAbortRef.current?.abort();
          const abortController = new AbortController();
          btwAbortRef.current = abortController;
          setBtwOverlay({
            open: true,
            question,
            answer: '',
            loading: true,
            error: null,
          });
          try {
            const transcript = buildBtwTranscript(getChatMessagesForBtw?.() ?? []);
            const btwModel =
              provider === 'gemini'
                ? geminiModel
                : provider === 'codex'
                  ? codexModel
                  : claudeModel;
            const btwResponse = await authenticatedFetch('/api/btw', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                question,
                transcript,
                projectPath: selectedProject.fullPath || selectedProject.path,
                model: btwModel,
                provider,
              }),
              signal: abortController.signal,
            });
            const payload = (await btwResponse.json().catch(() => ({}))) as {
              answer?: string;
              error?: string;
              message?: string;
            };
            if (!btwResponse.ok) {
              throw new Error(payload?.error || payload?.message || `Request failed (${btwResponse.status})`);
            }
            setBtwOverlay((previous) => ({
              ...previous,
              loading: false,
              answer: typeof payload.answer === 'string' ? payload.answer : '',
              error: null,
            }));
          } catch (btwErr) {
            if (abortController.signal.aborted) {
              return;
            }
            const msg = btwErr instanceof Error ? btwErr.message : 'Unknown error';
            setBtwOverlay((previous) => ({
              ...previous,
              loading: false,
              error: msg,
              answer: '',
            }));
          }
          return;
        }
        if (result.type === 'builtin') {
          handleBuiltInCommand(result);
          setInput('');
          inputValueRef.current = '';
        } else if (result.type === 'custom') {
          await handleCustomCommand(result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error executing command:', error);
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'assistant',
            content: `Error executing command: ${message}`,
            timestamp: Date.now(),
          },
        ]);
      }
    },
    [
      claudeModel,
      codexModel,
      currentSessionId,
      cursorModel,
      getChatMessagesForBtw,
      geminiModel,
      openrouterModel,
      localModel,
      nanoModel,
      handleBuiltInCommand,
      handleCustomCommand,
      input,
      provider,
      selectedProject,
      setChatMessages,
      tokenBudget,
    ],
  );

  const {
    slashCommands,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
  } = useSlashCommands({
    selectedProject,
    input,
    setInput,
    textareaRef,
    onExecuteCommand: executeCommand,
  });

  const applyProgrammaticDraft = useCallback((draft: ProgrammaticMessageDraft) => {
    if (
      hasUnsavedComposerDraft(
        inputValueRef.current,
        attachedFilesRef.current,
        attachedPromptRef.current,
      )
    ) {
      const confirmed = window.confirm(
        t('messageActions.confirmReplaceDraft', {
          defaultValue: 'Replace your current unsent draft with this message?',
        }),
      );
      if (!confirmed) {
        return false;
      }
    }

    const normalizedDraft = normalizeProgrammaticDraft(draft);

    setInput(normalizedDraft.content);
    inputValueRef.current = normalizedDraft.content;
    setAttachedPrompt(normalizedDraft.attachedPrompt);
    attachedPromptRef.current = normalizedDraft.attachedPrompt;

    setAttachedFiles([]);
    attachedFilesRef.current = [];
    setUploadingFiles(new Map());
    setFileErrors(new Map());
    setPendingStageTagKeys([]);
    pendingStageTagKeysRef.current = [];
    pendingEditedMessageIdRef.current = draft.editingMessageId ?? null;
    resetCommandMenuState();
    return true;
  }, [resetCommandMenuState, t]);

  const submitProgrammaticMessage = useCallback((draft: ProgrammaticMessageDraft) => {
    const didApplyDraft = applyProgrammaticDraft(draft);
    if (!didApplyDraft) {
      return false;
    }

    const attemptSubmit = (attempt = 0) => {
      if (handleSubmitRef.current) {
        handleSubmitRef.current(createFakeSubmitEvent());
        return;
      }

      if (attempt >= PROGRAMMATIC_SUBMIT_MAX_RETRIES) {
        console.warn('[Chat] Programmatic submit skipped because handleSubmit was not ready');
        return;
      }

      setTimeout(() => {
        attemptSubmit(attempt + 1);
      }, PROGRAMMATIC_SUBMIT_RETRY_DELAY_MS);
    };

    setTimeout(() => {
      attemptSubmit();
    }, 0);
    return true;
  }, [applyProgrammaticDraft]);

  const submitProgrammaticInput = useCallback((content: string, options?: { attachedPrompt?: AttachedPrompt | null }) => {
    submitProgrammaticMessage({
      content,
      attachedPrompt: options?.attachedPrompt ?? null,
    });
  }, [submitProgrammaticMessage]);

  const {
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    setCursorPosition,
    handleFileMentionsKeyDown,
  } = useFileMentions({
    selectedProject,
    input,
    setInput,
    textareaRef,
  });

  const syncInputOverlayScroll = useCallback((target: HTMLTextAreaElement) => {
    if (!inputHighlightRef.current || !target) {
      return;
    }
    inputHighlightRef.current.scrollTop = target.scrollTop;
    inputHighlightRef.current.scrollLeft = target.scrollLeft;
  }, []);

  const syncTextareaLayout = useCallback((nextValue: string, focus: boolean) => {
    if (textareaLayoutTimeoutRef.current) {
      clearTimeout(textareaLayoutTimeoutRef.current);
    }

    textareaLayoutTimeoutRef.current = setTimeout(() => {
      textareaLayoutTimeoutRef.current = null;
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }

      if (focus) {
        textarea.focus();
      }

      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
      const cursor = nextValue.length;
      textarea.setSelectionRange(cursor, cursor);
      syncInputOverlayScroll(textarea);

      const computedStyle = window.getComputedStyle(textarea);
      const lineHeight = resolveLineHeightPx(computedStyle.lineHeight, computedStyle.fontSize);
      setIsTextareaExpanded(textarea.scrollHeight > lineHeight * 2);
    }, 0);
  }, [syncInputOverlayScroll]);

  const loadMessageIntoComposer = useCallback((draft: ProgrammaticMessageDraft) => {
    const didApplyDraft = applyProgrammaticDraft(draft);
    if (!didApplyDraft) {
      return false;
    }

    const normalizedDraft = normalizeProgrammaticDraft(draft);
    syncTextareaLayout(normalizedDraft.content, true);
    return true;
  }, [applyProgrammaticDraft, syncTextareaLayout]);

  const handleAttachmentFiles = useCallback((files: File[]) => {
    const validFiles: File[] = [];

    files.forEach((file) => {
      try {
        if (!file || typeof file !== 'object') {
          console.warn('Invalid file object:', file);
          return;
        }

        const attachmentKey = getAttachmentKey(file);

        if (!file.size) {
          setFileErrors((previous) => {
            const next = new Map(previous);
            next.set(attachmentKey, `${file.name || 'Unknown file'}: Empty files are not supported`);
            return next;
          });
          return;
        }

        if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
          setFileErrors((previous) => {
            const next = new Map(previous);
            next.set(attachmentKey, `${file.name || 'Unknown file'}: File too large (max 50MB)`);
            return next;
          });
          return;
        }

        validFiles.push(file);
      } catch (error) {
        console.error('Error validating file:', error, file);
      }
    });

    if (validFiles.length > 0) {
      setFileErrors((previous) => {
        const next = new Map(previous);
        validFiles.forEach((file) => {
          next.delete(getAttachmentKey(file));
        });
        return next;
      });

      setAttachedFiles((previous) => {
        const deduped = [...previous];
        validFiles.forEach((file) => {
          const nextKey = getAttachmentKey(file);
          if (!deduped.some((existing) => getAttachmentKey(existing) === nextKey)) {
            deduped.push(file);
          }
        });
        return deduped.slice(0, MAX_ATTACHMENTS);
      });
    }
  }, []);

  const handleRejectedFiles = useCallback((rejections: FileRejection[]) => {
    if (!Array.isArray(rejections) || rejections.length === 0) {
      return;
    }

    setFileErrors((previous) => {
      const next = new Map(previous);
      rejections.forEach((rejection) => {
        const { attachmentKey, message } = formatRejectedFileMessage(rejection);
        next.set(attachmentKey, message);
      });
      return next;
    });
  }, []);

  const removeAttachedFile = useCallback((index: number) => {
    setAttachedFiles((previous) => {
      const next = [...previous];
      const [removedFile] = next.splice(index, 1);

      if (removedFile) {
        const attachmentKey = getAttachmentKey(removedFile);
        setFileErrors((previousErrors) => {
          const nextErrors = new Map(previousErrors);
          nextErrors.delete(attachmentKey);
          return nextErrors;
        });
        setUploadingFiles((previousUploads) => {
          const nextUploads = new Map(previousUploads);
          nextUploads.delete(attachmentKey);
          return nextUploads;
        });
      }

      return next;
    });
  }, []);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData.items);

      items.forEach((item) => {
        if (item.kind !== 'file') {
          return;
        }
        const file = item.getAsFile();
        if (file) {
          handleAttachmentFiles([file]);
        }
      });

      if (items.length === 0 && event.clipboardData.files.length > 0) {
        const files = Array.from(event.clipboardData.files);
        if (files.length > 0) {
          handleAttachmentFiles(files);
        }
      }
    },
    [handleAttachmentFiles],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    maxSize: MAX_ATTACHMENT_SIZE_BYTES,
    maxFiles: MAX_ATTACHMENTS,
    onDrop: handleAttachmentFiles,
    onDropRejected: handleRejectedFiles,
    noClick: true,
    noKeyboard: true,
  });

  const uploadPreviewImages = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return [];
      }

      const formData = new FormData();
      files.forEach((file) => {
        formData.append('images', file);
      });

      const response = await authenticatedFetch(`/api/projects/${encodeURIComponent(selectedProject?.name || '')}/upload-images`, {
        method: 'POST',
        headers: {},
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload images');
      }

      const result = await response.json();
      return Array.isArray(result.images) ? (result.images as ChatImage[]) : [];
    },
    [selectedProject?.name],
  );

  const uploadFilesToProject = useCallback(
    async (files: File[]) => {
      if (!selectedProject || files.length === 0) {
        return [];
      }

      const formData = new FormData();
      const targetDir = `${CODEX_ATTACHMENT_DIR}/${Date.now()}`;
      formData.append('targetDir', targetDir);
      files.forEach((file) => {
        formData.append('files', file);
      });

      const response = await authenticatedFetch(`/api/projects/${encodeURIComponent(selectedProject.name)}/upload-files`, {
        method: 'POST',
        headers: {},
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload files');
      }

      const result = await response.json();
      return Array.isArray(result.files) ? (result.files as UploadedProjectFile[]) : [];
    },
    [selectedProject],
  );

  const handleSubmit = useCallback(
    async (
      event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
    ) => {
      event.preventDefault();
      const currentInput = inputValueRef.current;
      const currentAttachedFiles = attachedFilesRef.current;
      const currentAttachedPrompt = attachedPromptRef.current;
      const currentStageTagKeys = pendingStageTagKeysRef.current;

      if ((!currentInput.trim() && currentAttachedFiles.length === 0 && !currentAttachedPrompt) || isLoading || !selectedProject) {
        return;
      }

      const trimmedInput = currentInput.trim();
      if (trimmedInput.startsWith('/')) {
        const firstSpace = trimmedInput.indexOf(' ');
        const commandName = firstSpace > 0 ? trimmedInput.slice(0, firstSpace) : trimmedInput;
        const matchedCommand = slashCommands.find((command: SlashCommand) => command.name === commandName);

        if (matchedCommand) {
          if (isLoading && commandName !== '/btw') {
            return;
          }
          await executeCommand(matchedCommand, trimmedInput);
          setInput('');
          inputValueRef.current = '';
          setAttachedPrompt(null);
          attachedPromptRef.current = null;
          pendingEditedMessageIdRef.current = null;
          setAttachedFiles([]);
          attachedFilesRef.current = [];
          setUploadingFiles(new Map());
          setFileErrors(new Map());
          setPendingStageTagKeys([]);
          pendingStageTagKeysRef.current = [];
          resetCommandMenuState();
          setIsTextareaExpanded(false);
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
          }
          return;
        }
      }

      if (isLoading) {
        return;
      }

      const normalizedInput =
        currentInput.trim() ||
        t('input.attachmentOnlyFallback', {
          defaultValue: 'Please inspect the attached files and help me with them.',
        });
      let messageContent = normalizedInput;

      // Prepend attached prompt text if present
      if (currentAttachedPrompt) {
        if (currentInput.trim()) {
          messageContent = `${currentAttachedPrompt.promptText}\n\n${normalizedInput}`;
        } else {
          messageContent = currentAttachedPrompt.promptText;
        }
      }

      // Auto-bypass permissions for autoresearch workflows
      const isAutoresearchMessage = isAutoResearchScenario(attachedPrompt?.scenarioId);
      const effectivePermissionMode = isAutoresearchMessage
        ? 'bypassPermissions'
        : permissionMode;

      if (isAutoresearchMessage) {
        const scenarioId = attachedPrompt?.scenarioId ?? null;
        const commandFromScenario = scenarioId?.startsWith('autoresearch-')
          ? scenarioId.slice('autoresearch-'.length)
          : null;
        emitAutoresearchEvent('autoresearch_message_sent', {
          scenario_id: scenarioId,
          command: commandFromScenario,
          input_length: currentInput.trim().length,
          has_attachments: currentAttachedFiles.length > 0,
          attachment_count: currentAttachedFiles.length,
          provider,
        });
      }

      const selectedThinkingMode = thinkingModes.find((mode: { id: string; prefix?: string }) => mode.id === thinkingMode);
      if (selectedThinkingMode && selectedThinkingMode.prefix) {
        messageContent = `${selectedThinkingMode.prefix}: ${messageContent}`;
      }

      // Inject intake greeting context for the first message after auto-intake
      if (intakeGreeting) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'assistant',
            content: intakeGreeting,
            timestamp: new Date(),
          },
        ]);
        messageContent = `[Context: You have already greeted me as Dr. Claw's research assistant and asked about my research project. Continue the intake conversation without re-greeting.]\n\n${messageContent}`;
        setIntakeGreeting(null);
      }

      let uploadedImages: ChatImage[] = [];
      let codexAttachmentPayload:
        | {
            imagePaths: string[];
            documentPaths: string[];
          }
        | undefined;
      let messageAttachments: ChatAttachment[] = [];

      if (currentAttachedFiles.length > 0) {
        let uploadedFiles: UploadedProjectFile[] = [];

        try {
          uploadedFiles = await uploadFilesToProject(currentAttachedFiles);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('File upload failed:', error);
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'error',
              content: `Failed to upload files: ${message}`,
              timestamp: new Date(),
            },
          ]);
          return;
        }

        messageAttachments = currentAttachedFiles.map((file, index) => {
          const uploadedFile = uploadedFiles[index];
          const uploadedPath = uploadedFile?.path && typeof uploadedFile.path === 'string' ? uploadedFile.path : undefined;

          return {
            name: file.name,
            kind: getAttachmentKind(file),
            mimeType: file.type || undefined,
            path: uploadedPath,
          };
        });

        if (uploadedFiles.length > 0) {
          const fileNote = `\n\n[Files available at the following paths]\n${uploadedFiles
            .map((file, index) => `${index + 1}. ${file.path}`)
            .join('\n')}`;
          messageContent = `${messageContent}${fileNote}`;
        }

        if (provider === 'codex') {
          codexAttachmentPayload = uploadedFiles.reduce(
            (
              accumulator: {
                imagePaths: string[];
                documentPaths: string[];
              },
              uploadedFile: UploadedProjectFile,
              index: number,
            ) => {
              const sourceFile = currentAttachedFiles[index];
              const uploadedPath =
                uploadedFile?.path && typeof uploadedFile.path === 'string' ? uploadedFile.path : null;

              if (!sourceFile || !uploadedPath) {
                return accumulator;
              }

              if (isImageAttachment(sourceFile)) {
                accumulator.imagePaths.push(uploadedPath);
              } else if (isPdfAttachment(sourceFile)) {
                accumulator.documentPaths.push(uploadedPath);
              }

              return accumulator;
            },
            {
              imagePaths: [] as string[],
              documentPaths: [] as string[],
            },
          );
        }

        const imageFiles = currentAttachedFiles.filter((file) => isImageAttachment(file));
        if (imageFiles.length > 0) {
          try {
            uploadedImages = await uploadPreviewImages(imageFiles);
          } catch (error) {
            console.error('Image preview upload failed:', error);
          }
        }
      }

      const editedMessageId = pendingEditedMessageIdRef.current;
      const userMessageId = createChatMessageId();
      const userMessage: ChatMessage = {
        messageId: userMessageId,
        type: 'user',
        content: normalizedInput,
        submittedContent: messageContent,
        images: uploadedImages.length > 0 ? uploadedImages : undefined,
        attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
        timestamp: new Date(),
        ...(editedMessageId ? { editedFromMessageId: editedMessageId } : {}),
        ...(currentAttachedPrompt ? { attachedPrompt: currentAttachedPrompt } : {}),
      };

      setChatMessages((previous) => applyEditedMessageToHistory(previous, userMessage, editedMessageId));
      pendingEditedMessageIdRef.current = null;
      if (abortTimeoutRef.current) {
        clearTimeout(abortTimeoutRef.current);
        abortTimeoutRef.current = null;
      }
      const turnStartTime = Date.now();
      setIsLoading(true);
      setCanAbortSession(true);
      setClaudeStatus({
        text: 'Processing',
        tokens: 0,
        can_interrupt: true,
        startTime: turnStartTime,
      });

      setIsUserScrolledUp(false);
      setTimeout(() => scrollToBottom(), 100);

      // Reuse the session currently represented by the route or pending view state.
      // This prevents interrupted chats from being treated as brand new sessions.
      const routedSessionId = getRouteSessionId();
      
      // If we're on the root path with no routed session AND no selected session, 
      // treat it as an explicit new session start and clear any stale provider-specific session IDs.
      const isExplicitNewSessionStart = window.location.pathname === '/' && !routedSessionId && !selectedSession?.id;
      if (isExplicitNewSessionStart && typeof window !== 'undefined') {
        sessionStorage.removeItem('geminiSessionId');
        sessionStorage.removeItem('cursorSessionId');
        sessionStorage.removeItem('pendingSessionId');
      }

      const providerSessionId =
        provider === 'gemini'
          ? sessionStorage.getItem('geminiSessionId')
          : provider === 'cursor'
          ? sessionStorage.getItem('cursorSessionId')
          : null;
      const pendingViewSessionId = pendingViewSessionRef.current?.sessionId || null;
      const effectiveSessionId =
        currentSessionId ||
        selectedSession?.id ||
        routedSessionId ||
        pendingViewSessionId ||
        providerSessionId;
      const isNewSession = !effectiveSessionId;
      const sessionToActivate = effectiveSessionId || `${TEMP_SESSION_PREFIX}${Date.now()}`;

      if (!effectiveSessionId && !selectedSession?.id) {
        if (typeof window !== 'undefined') {
          // Reset stale pending IDs from previous interrupted runs before creating a new one.
          sessionStorage.removeItem('pendingSessionId');
        }
        pendingViewSessionRef.current = { sessionId: null, startedAt: Date.now() };
      }
      persistSessionTimerStart(sessionToActivate, turnStartTime);
      onSessionActive?.(sessionToActivate);

      const getToolsSettings = () => {
        try {
          const settingsKey = getProviderSettingsKey(provider);
          const savedSettings = safeLocalStorage.getItem(settingsKey);
          if (savedSettings) {
            return JSON.parse(savedSettings);
          }
        } catch (error) {
          console.error('Error loading tools settings:', error);
        }

        return {
          allowedTools: [],
          disallowedTools: [],
          skipPermissions: false,
        };
      };

      const toolsSettings = getToolsSettings();
      const resolvedProjectPath = selectedProject.fullPath || selectedProject.path || '';
      const telemetryEnabled = isTelemetryEnabled();

      console.log('[DEBUG] useChatComposerState - provider:', provider);
      console.log('[DEBUG] useChatComposerState - effectiveSessionId:', effectiveSessionId);

      if (isNewSession) {
        const sessionModeContext = newSessionMode === 'workspace_qa'
          ? '[Context: session-mode=workspace_qa]\n[Context: Treat this as a lightweight workspace Q&A session. Focus on answering questions about files, code, and project structure. Do not start the research intake or pipeline workflow unless the user explicitly asks for it.]\n\n'
          : '[Context: session-mode=research]\n[Context: This is a research workflow session. Follow the normal project research instructions and pipeline behavior.]\n\n';
        messageContent = `${sessionModeContext}${messageContent}`;
      }

      if (provider === 'cursor') {
        console.log('[DEBUG] Sending cursor-command');
        sendMessage({
          type: 'cursor-command',
          command: messageContent,
          sessionId: effectiveSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            model: cursorModel,
            skipPermissions: toolsSettings?.skipPermissions || false,
            toolsSettings,
            telemetryEnabled,
            sessionMode: isNewSession ? newSessionMode : selectedSession?.mode,
            stageTagKeys: currentStageTagKeys,
            stageTagSource: 'task_context',
          },
        });
      } else if (provider === 'gemini') {
        console.log('[DEBUG] Sending gemini-command');
        sendMessage({
          type: 'gemini-command',
          command: messageContent,
          sessionId: effectiveSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            model: geminiModel,
            permissionMode: effectivePermissionMode,
            thinkingMode: geminiThinkingMode,
            images: uploadedImages.length > 0 ? uploadedImages : undefined,
            toolsSettings,
            telemetryEnabled,
            sessionMode: isNewSession ? newSessionMode : selectedSession?.mode,
            stageTagKeys: currentStageTagKeys,
            stageTagSource: 'task_context',
          },
        });
      } else if (provider === 'codex') {
        console.log('[DEBUG] Sending codex-command');
        sendMessage({
          type: 'codex-command',
          command: messageContent,
          sessionId: effectiveSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            model: codexModel,
            permissionMode: effectivePermissionMode === 'plan' ? 'default' : effectivePermissionMode,
            modelReasoningEffort: codexReasoningEffort === 'default' ? undefined : codexReasoningEffort,
            attachments: codexAttachmentPayload,
            images: uploadedImages,
            telemetryEnabled,
            sessionMode: isNewSession ? newSessionMode : selectedSession?.mode,
            stageTagKeys: currentStageTagKeys,
            stageTagSource: 'task_context',
          },
        });
      } else if (provider === 'openrouter') {
        console.log('[DEBUG] Sending openrouter-command');
        sendMessage({
          type: 'openrouter-command',
          command: messageContent,
          sessionId: effectiveSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            model: openrouterModel,
            permissionMode: effectivePermissionMode,
            toolsSettings,
            telemetryEnabled,
            sessionMode: isNewSession ? newSessionMode : selectedSession?.mode,
            stageTagKeys: currentStageTagKeys,
            stageTagSource: 'task_context',
          },
        });
      } else if (provider === 'local') {
        console.log('[DEBUG] Sending local-command');
        sendMessage({
          type: 'local-command',
          command: messageContent,
          sessionId: effectiveSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            model: localModel,
            serverUrl: localStorage.getItem('local-gpu-server-url') || 'http://localhost:11434',
            gpuId: localStorage.getItem('local-gpu-selected') || undefined,
            permissionMode: effectivePermissionMode,
            toolsSettings,
            telemetryEnabled,
            sessionMode: isNewSession ? newSessionMode : selectedSession?.mode,
            stageTagKeys: pendingStageTagKeys,
            stageTagSource: 'task_context',
          },
        });
      } else if (provider === 'nano') {
        console.log('[DEBUG] Sending nano-command');
        sendMessage({
          type: 'nano-command',
          command: messageContent,
          sessionId: effectiveSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            model: nanoModel,
            toolsSettings,
            telemetryEnabled,
            sessionMode: isNewSession ? newSessionMode : selectedSession?.mode,
            stageTagKeys: currentStageTagKeys,
            stageTagSource: 'task_context',
          },
        });
      } else {
        console.log('[DEBUG] Sending claude-command');
        sendMessage({
          type: 'claude-command',
          command: messageContent,
          options: {
            projectPath: resolvedProjectPath,
            cwd: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            toolsSettings,
            permissionMode: effectivePermissionMode,
            model: claudeModel,
            images: uploadedImages.length > 0 ? uploadedImages : undefined,
            telemetryEnabled,
            sessionMode: isNewSession ? newSessionMode : selectedSession?.mode,
            stageTagKeys: currentStageTagKeys,
            stageTagSource: 'task_context',
          },
        });
      }

      setInput('');
      inputValueRef.current = '';
      setPendingStageTagKeys([]);
      pendingStageTagKeysRef.current = [];
      resetCommandMenuState();
      setAttachedFiles([]);
      attachedFilesRef.current = [];
      setUploadingFiles(new Map());
      setFileErrors(new Map());
      setIsTextareaExpanded(false);
      setThinkingMode('none');
      setAttachedPrompt(null);
      attachedPromptRef.current = null;
      pendingEditedMessageIdRef.current = null;

      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    },
    [
      attachedFiles,
      attachedPrompt,
      claudeModel,
      codexModel,
      codexReasoningEffort,
      currentSessionId,
      cursorModel,
      executeCommand,
      geminiThinkingMode,
      geminiModel,
      openrouterModel,
      localModel,
      nanoModel,
      isLoading,
      onSessionActive,
      pendingViewSessionRef,
      permissionMode,
      provider,
      resetCommandMenuState,
      scrollToBottom,
      selectedProject,
      selectedSession?.id,
      sendMessage,
      setCanAbortSession,
      setChatMessages,
      setClaudeStatus,
      setIsLoading,
      setIsUserScrolledUp,
      slashCommands,
      thinkingMode,
      t,
      intakeGreeting,
      uploadFilesToProject,
      uploadPreviewImages,
    ],
  );

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    const savedInput = safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    setInput((previous) => {
      const next = previous === savedInput ? previous : savedInput;
      inputValueRef.current = next;
      return next;
    });
  }, [selectedProject?.name]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    const applyDraft = (draft: string) => {
      setInput(draft);
      inputValueRef.current = draft;
      syncTextareaLayout(draft, true);
    };

    const applyQueuedDraft = () => {
      const skillDraft = consumeSkillCommandDraft();
      if (skillDraft) {
        applyDraft(skillDraft);
        return;
      }
      const wqDraft = consumeWorkspaceQaDraft(selectedProject.name);
      if (wqDraft) {
        applyDraft(wqDraft);
        return;
      }
      const refDraft = consumeReferenceChatDraft(selectedProject.name);
      if (refDraft) {
        applyDraft(refDraft.text);

        if (refDraft.pdfCached && refDraft.referenceId) {
          (async () => {
            try {
              const res = await authenticatedFetch(`/api/references/${refDraft.referenceId}/pdf`);
              if (res.ok) {
                const blob = await res.blob();
                const file = new File([blob], `${refDraft.referenceId}.pdf`, { type: 'application/pdf' });
                setAttachedFiles((prev: File[]) => [...prev, file].slice(0, 5));
              }
            } catch {
              // PDF fetch failed — user still has text context
            }
          })();
        }
      }
    };

    applyQueuedDraft();

    const handleQueuedDraft = (event: Event) => {
      const customEvent = event as CustomEvent<{ projectName?: string }>;
      if (customEvent.detail?.projectName !== selectedProject.name) {
        return;
      }
      applyQueuedDraft();
    };

    window.addEventListener(WORKSPACE_QA_DRAFT_EVENT, handleQueuedDraft);
    window.addEventListener(REFERENCE_CHAT_DRAFT_EVENT, handleQueuedDraft);
    window.addEventListener(SKILL_COMMAND_DRAFT_EVENT, handleQueuedDraft);
    return () => {
      window.removeEventListener(WORKSPACE_QA_DRAFT_EVENT, handleQueuedDraft);
      window.removeEventListener(REFERENCE_CHAT_DRAFT_EVENT, handleQueuedDraft);
      window.removeEventListener(SKILL_COMMAND_DRAFT_EVENT, handleQueuedDraft);
    };
  }, [selectedProject?.name, setInput]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    if (input !== '') {
      safeLocalStorage.setItem(`draft_input_${selectedProject.name}`, input);
    } else {
      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    }
  }, [input, selectedProject]);

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    // Re-run when input changes so restored drafts get the same autosize behavior as typed text.
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    const computedStyle = window.getComputedStyle(textareaRef.current);
    const lineHeight = resolveLineHeightPx(computedStyle.lineHeight, computedStyle.fontSize);
    const expanded = textareaRef.current.scrollHeight > lineHeight * 2;
    setIsTextareaExpanded(expanded);
  }, [input]);

  useEffect(() => {
    if (!textareaRef.current || input.trim()) {
      return;
    }
    textareaRef.current.style.height = 'auto';
    setIsTextareaExpanded(false);
  }, [input]);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value;
      const cursorPos = event.target.selectionStart;

      setInput(newValue);
      inputValueRef.current = newValue;
      setCursorPosition(cursorPos);

      if (!newValue.trim()) {
        setPendingStageTagKeys([]);
        event.target.style.height = 'auto';
        setIsTextareaExpanded(false);
        resetCommandMenuState();
        return;
      }

      handleCommandInputChange(newValue, cursorPos);
    },
    [handleCommandInputChange, resetCommandMenuState, setCursorPosition],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleCommandMenuKeyDown(event)) {
        return;
      }

      if (handleFileMentionsKeyDown(event)) {
        return;
      }

      if (event.key === 'Tab' && !showFileDropdown && !showCommandMenu) {
        event.preventDefault();
        cyclePermissionMode();
        return;
      }

      if (event.key === 'Enter') {
        if (event.nativeEvent.isComposing) {
          return;
        }

        if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
          event.preventDefault();
          handleSubmit(event);
        } else if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !sendByCtrlEnter) {
          event.preventDefault();
          handleSubmit(event);
        }
      }
    },
    [
      cyclePermissionMode,
      handleCommandMenuKeyDown,
      handleFileMentionsKeyDown,
      handleSubmit,
      sendByCtrlEnter,
      showCommandMenu,
      showFileDropdown,
    ],
  );

  const handleTextareaClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      setCursorPosition(event.currentTarget.selectionStart);
    },
    [setCursorPosition],
  );

  const handleTextareaInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      target.style.height = 'auto';
      target.style.height = `${target.scrollHeight}px`;
      setCursorPosition(target.selectionStart);
      syncInputOverlayScroll(target);

      const computedStyle = window.getComputedStyle(target);
      const lineHeight = resolveLineHeightPx(computedStyle.lineHeight, computedStyle.fontSize);
      setIsTextareaExpanded(target.scrollHeight > lineHeight * 2);
    },
    [setCursorPosition, syncInputOverlayScroll],
  );

  const handleClearInput = useCallback(() => {
    setInput('');
    inputValueRef.current = '';
    setPendingStageTagKeys([]);
    pendingStageTagKeysRef.current = [];
    setAttachedFiles([]);
    attachedFilesRef.current = [];
    setUploadingFiles(new Map());
    setFileErrors(new Map());
    setAttachedPrompt(null);
    attachedPromptRef.current = null;
    pendingEditedMessageIdRef.current = null;
    resetCommandMenuState();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
    setIsTextareaExpanded(false);
  }, [resetCommandMenuState]);

  const handleAbortSession = useCallback(() => {
    if (!canAbortSession) {
      // Force-reset the UI when Stop is clicked but no active abort is possible.
      // This handles stale state after server restarts or lost WebSocket connections.
      if (isLoading) {
        setIsLoading(false);
        setCanAbortSession(false);
        setClaudeStatus(null);
        setPendingPermissionRequests([]);
        const sessionId = currentSessionId || selectedSession?.id;
        if (sessionId) clearSessionTimerStart(sessionId);
      }
      return;
    }

    setCanAbortSession(false);

    const pendingSessionId =
      typeof window !== 'undefined' ? sessionStorage.getItem('pendingSessionId') : null;
    const cursorSessionId =
      typeof window !== 'undefined' ? sessionStorage.getItem('cursorSessionId') : null;

    const candidateSessionIds = [
      currentSessionId,
      pendingViewSessionRef.current?.sessionId || null,
      pendingSessionId,
      provider === 'cursor' ? cursorSessionId : null,
      selectedSession?.id || null,
    ];

    const targetSessionId =
      candidateSessionIds.find((sessionId) => Boolean(sessionId) && !isTemporarySessionId(sessionId)) || null;

    if (!targetSessionId) {
      setIsLoading(false);
      setClaudeStatus(null);
      setChatMessages((previous) => [
        ...previous,
        {
          type: 'error',
          content: 'Could not stop session: no active session found.',
          timestamp: new Date(),
        },
      ]);
      return;
    }

    sendMessage({
      type: 'abort-session',
      sessionId: targetSessionId,
      provider,
    });

    if (abortTimeoutRef.current) {
      clearTimeout(abortTimeoutRef.current);
    }
    abortTimeoutRef.current = setTimeout(() => {
      abortTimeoutRef.current = null;
      setIsLoading(false);
      setCanAbortSession(false);
      setClaudeStatus(null);
      if (targetSessionId) clearSessionTimerStart(targetSessionId);
    }, 5000);
  }, [canAbortSession, currentSessionId, isLoading, pendingViewSessionRef, provider, selectedSession?.id, sendMessage, setCanAbortSession, setChatMessages, setClaudeStatus, setIsLoading, setPendingPermissionRequests]);

  const handleTranscript = useCallback((text: string) => {
    if (!text.trim()) {
      return;
    }

    setInput((previousInput) => {
      const newInput = previousInput.trim() ? `${previousInput} ${text}` : text;
      inputValueRef.current = newInput;
      syncTextareaLayout(newInput, false);

      return newInput;
    });
  }, [syncTextareaLayout]);

  const handleGrantToolPermission = useCallback(
    (suggestion: { entry: string; toolName: string }) => {
      if (!suggestion || (provider !== 'claude' && provider !== 'gemini')) {
        return { success: false };
      }
      return grantToolPermission(suggestion.entry, provider);
    },
    [provider],
  );

  const handlePermissionDecision = useCallback(
    (
      requestIds: string | string[],
      decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
    ) => {
      const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
      const validIds = ids.filter(Boolean);
      if (validIds.length === 0) {
        return;
      }

      validIds.forEach((requestId) => {
        sendMessage({
          type: 'claude-permission-response',
          requestId,
          allow: Boolean(decision?.allow),
          updatedInput: decision?.updatedInput,
          message: decision?.message,
          rememberEntry: decision?.rememberEntry,
        });
      });

      // Update the local chatMessage toolInput so answered questions render with selections
      if (decision?.updatedInput && typeof decision.updatedInput === 'object' && 'answers' in (decision.updatedInput as Record<string, unknown>)) {
        const updated = decision.updatedInput as Record<string, unknown>;
        setChatMessages((previous) => {
          const msgs = [...previous];
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].toolName === 'AskUserQuestion' && msgs[i].isToolUse) {
              msgs[i] = { ...msgs[i], toolInput: updated };
              break;
            }
          }
          return msgs;
        });
      }

      setPendingPermissionRequests((previous) => {
        const next = previous.filter((request) => !validIds.includes(request.requestId));
        if (next.length === 0) {
          setClaudeStatus(null);
        }
        return next;
      });
    },
    [sendMessage, setChatMessages, setClaudeStatus, setPendingPermissionRequests],
  );

  const [isInputFocused, setIsInputFocused] = useState(false);

  const handleInputFocusChange = useCallback(
    (focused: boolean) => {
      setIsInputFocused(focused);
      onInputFocusChange?.(focused);
    },
    [onInputFocusChange],
  );

  return {
    input,
    setInput,
    attachedPrompt,
    setAttachedPrompt,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    thinkingMode,
    setThinkingMode,
    codexReasoningEffort,
    setCodexReasoningEffort,
    geminiThinkingMode,
    setGeminiThinkingMode,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles: filteredFiles as MentionableFile[],
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedFiles,
    removeAttachedFile,
    uploadingFiles,
    fileErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openFilePicker: open,
    handleSubmit,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handleTranscript,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
    intakeGreeting,
    setIntakeGreeting,
    setPendingStageTagKeys,
    submitProgrammaticInput,
    btwOverlay,
    closeBtwOverlay,
    submitProgrammaticMessage,
    loadMessageIntoComposer,
  };
}
