import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QuickSettingsPanel from '../../QuickSettingsPanel';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { useTranslation } from 'react-i18next';
import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import BtwOverlay from './subcomponents/BtwOverlay';
import ChatContextSidebar from './subcomponents/ChatContextSidebar';
import { RESUMING_STATUS_TEXT } from '../types/types';
import type { ChatInterfaceProps } from '../types/types';
import type { ProviderAvailability } from '../types/types';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '../hooks/useChatComposerState';
import type { Provider } from '../types/types';
import { authenticatedFetch } from '../../../utils/api';
import { readCliAvailability, writeCliAvailability } from '../../../utils/cliAvailability';
import { Button } from '../../ui/button';
import type { PendingAutoIntake } from '../../../types/app';
import { CLAUDE_MODELS, CURSOR_MODELS, CODEX_MODELS, GEMINI_MODELS, LOCAL_MODELS, NANO_CLAUDE_CODE_MODELS, OPENROUTER_MODELS } from '../../../../shared/modelConstants';
import { getProviderDisplayName } from '../utils/chatFormatting';
import CodeEditor from '../../CodeEditor';
import type { EditingFile } from '../../main-content/types/types';
import { normalizePath, toRelativePath, isSafePath, fileNameFromPath } from '../../../utils/pathUtils';


const DEFAULT_PROVIDER_AVAILABILITY: Record<Provider, ProviderAvailability> = {
  claude: { cliAvailable: true, cliCommand: 'claude', installHint: null },
  cursor: { cliAvailable: true, cliCommand: 'agent', installHint: null },
  codex: { cliAvailable: true, cliCommand: 'codex', installHint: null },
  gemini: { cliAvailable: true, cliCommand: 'gemini', installHint: null },
  openrouter: { cliAvailable: true, cliCommand: 'openrouter', installHint: null },
  local: { cliAvailable: true, cliCommand: null, installHint: null },
  nano: { cliAvailable: true, cliCommand: 'nano-claude-code', installHint: null },
};

const INTAKE_GREETING = `Hello! I'm your Dr. Claw research assistant, here to help you set up your research pipeline.\n\nTo get started, could you tell me about your research field or topic?`;

const getAutoIntakePrompt = (pendingAutoIntake?: PendingAutoIntake | null) => {
  const prompt = pendingAutoIntake?.prompt?.trim();
  return prompt || null;
};

const getAutoIntakeTriggerId = (pendingAutoIntake?: PendingAutoIntake | null) => {
  const triggerId = pendingAutoIntake?.triggerId?.trim();
  return triggerId || null;
};

const getAutoIntakeStorageKey = (projectName: string, triggerId?: string | null) =>
  triggerId ? `intake_triggered_${projectName}_${triggerId}` : `intake_triggered_${projectName}`;

const getImportedProjectAnalysisStorageKey = (projectName: string) => `imported_project_analysis_prompt_${projectName}`;

const ANALYSIS_PROVIDERS: Array<{ id: Provider; label: string }> = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'gemini', label: 'Gemini CLI' },
  { id: 'codex', label: 'Codex' },
  { id: 'openrouter', label: 'OpenRouter' },
];

const getProviderModelConfig = (provider: Provider) => {
  if (provider === 'claude') return CLAUDE_MODELS;
  if (provider === 'codex') return CODEX_MODELS;
  if (provider === 'gemini') return GEMINI_MODELS;
  if (provider === 'openrouter') return OPENROUTER_MODELS;
  if (provider === 'local') return LOCAL_MODELS;
  if (provider === 'nano') return NANO_CLAUDE_CODE_MODELS;
  return CURSOR_MODELS;
};

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

function ChatInterface({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  latestMessage,
  onFileOpen,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  processingSessions,
  onReplaceTemporarySession,
  onNavigateToSession,
  onShowSettings,
  autoExpandTools,
  showRawParameters,
  showThinking,
  autoScrollToBottom,
  sendByCtrlEnter,
  externalMessageUpdate,
  onStartWorkspaceQa,
  pendingAutoIntake,
  clearPendingAutoIntake,
  importedProjectAnalysisPrompt,
  clearImportedProjectAnalysisPrompt,
  onOpenShellForSession,
  newSessionMode = 'research',
  onNewSessionModeChange,
}: ChatInterfaceProps) {
  const { refreshTasks } = useTaskMaster();
  const { t } = useTranslation('chat');
  const [isShellEditPromptOpen, setIsShellEditPromptOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<EditingFile | null>(null);

  const handleFilePreview = useCallback((filePath: string) => {
    const root = selectedProject?.fullPath || selectedProject?.path || '';
    const relative = toRelativePath(filePath, root);
    if (!relative || !isSafePath(relative)) return;
    const name = fileNameFromPath(normalizePath(filePath));
    setPreviewFile({ name, path: relative, projectName: selectedProject?.name });
  }, [selectedProject]);

  const handleClosePreview = useCallback(() => {
    setPreviewFile(null);
  }, []);

  const [sidebarTab, setSidebarTab] = useState<'context' | 'research' | 'files'>(() => {
    if (typeof window === 'undefined') return 'context';
    const stored = window.localStorage.getItem('chat-sidebar-active-tab');
    return (stored === 'research' || stored === 'files') ? stored : 'context';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('chat-sidebar-active-tab', sidebarTab);
    }
  }, [sidebarTab]);

  const streamBufferRef = useRef('');
  const streamTimerRef = useRef<number | null>(null);
  const pendingViewSessionRef = useRef<PendingViewSession | null>(null);

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    streamBufferRef.current = '';
  }, []);

  const {
    provider,
    setProvider,
    cursorModel,
    setCursorModel,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    geminiModel,
    setGeminiModel,
    openrouterModel,
    setOpenrouterModel,
    localModel,
    setLocalModel,
    nanoModel,
    setNanoModel,
    permissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  } = useChatProviderState({
    selectedSession,
  });

  const {
    chatMessages,
    setChatMessages,
    isLoading,
    setIsLoading,
    currentSessionId,
    setCurrentSessionId,
    sessionMessages,
    setSessionMessages,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    isSystemSessionChange,
    setIsSystemSessionChange,
    canAbortSession,
    setCanAbortSession,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    claudeStatus,
    setClaudeStatus,
    statusTextOverride,
    setStatusTextOverride,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    handleScroll,
    resolveSessionStatusCheck,
  } = useChatSessionState({
    selectedProject,
    selectedSession,
    ws,
    sendMessage,
    autoScrollToBottom,
    externalMessageUpdate,
    processingSessions,
    resetStreamingState,
    pendingViewSessionRef,
  });

  const chatMessagesForBtwRef = useRef(chatMessages);
  chatMessagesForBtwRef.current = chatMessages;
  const getChatMessagesForBtw = useCallback(() => chatMessagesForBtwRef.current, []);

  const {
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
    filteredFiles,
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
    openFilePicker,
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
  } = useChatComposerState({
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
    newSessionMode,
    getChatMessagesForBtw,
  });

  useChatRealtimeHandlers({
    latestMessage,
    provider,
    selectedProject,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    setChatMessages,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setStatusTextOverride,
    setTokenBudget,
    setIsSystemSessionChange,
    setPendingPermissionRequests,
    pendingViewSessionRef,
    streamBufferRef,
    streamTimerRef,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onSessionStatusResolved: resolveSessionStatusCheck,
    onReplaceTemporarySession,
    onNavigateToSession,
  });

  const handleRetry = useCallback(() => {
    const msgs = chatMessagesForBtwRef.current;
    let lastUserMessage: (typeof msgs)[number] | undefined;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].type === 'user') { lastUserMessage = msgs[i]; break; }
    }
    if (!lastUserMessage?.content) return;
    submitProgrammaticInput(lastUserMessage.content);
  }, [submitProgrammaticInput]);

  const autoIntakeTriggeredRef = useRef(false);
  const lastAutoIntakeTriggerIdRef = useRef<string | null>(null);
  const [importedProjectAnalysisProvider, setImportedProjectAnalysisProvider] = React.useState<Provider>('claude');
  const shouldShowImportedProjectAnalysisPrompt = useMemo(() => {
    if (!importedProjectAnalysisPrompt || !selectedProject || selectedSession || isLoading) {
      return false;
    }

    const targetProjectName = importedProjectAnalysisPrompt.project?.name;
    if (!targetProjectName || targetProjectName !== selectedProject.name) {
      return false;
    }

    if (chatMessages.length > 0) {
      return false;
    }

    if (typeof window === 'undefined') {
      return true;
    }

    const dismissedKey = getImportedProjectAnalysisStorageKey(selectedProject.name);
    return sessionStorage.getItem(dismissedKey) !== 'dismissed';
  }, [chatMessages.length, importedProjectAnalysisPrompt, isLoading, selectedProject, selectedSession]);
  const [providerAvailability, setProviderAvailability] = React.useState<Record<Provider, ProviderAvailability>>(() => {
    const cached = readCliAvailability();

    return {
      claude: cached.claude ?? DEFAULT_PROVIDER_AVAILABILITY.claude,
      cursor: cached.cursor ?? DEFAULT_PROVIDER_AVAILABILITY.cursor,
      codex: cached.codex ?? DEFAULT_PROVIDER_AVAILABILITY.codex,
      gemini: cached.gemini ?? DEFAULT_PROVIDER_AVAILABILITY.gemini,
      openrouter: cached.openrouter ?? DEFAULT_PROVIDER_AVAILABILITY.openrouter,
      local: cached.local ?? DEFAULT_PROVIDER_AVAILABILITY.local,
      nano: cached.nano ?? DEFAULT_PROVIDER_AVAILABILITY.nano,
    };
  });

  const importedProjectAnalysisModel = useMemo(() => {
    if (importedProjectAnalysisProvider === 'claude') return claudeModel;
    if (importedProjectAnalysisProvider === 'codex') return codexModel;
    if (importedProjectAnalysisProvider === 'gemini') return geminiModel;
    if (importedProjectAnalysisProvider === 'openrouter') return openrouterModel;
    if (importedProjectAnalysisProvider === 'local') return localModel;
    if (importedProjectAnalysisProvider === 'nano') return nanoModel;
    return cursorModel;
  }, [claudeModel, codexModel, cursorModel, geminiModel, openrouterModel, localModel, nanoModel, importedProjectAnalysisProvider]);

  const handleStartTaskInChat = useCallback((prompt?: string, task?: { stage?: string } | null) => {
    const nextPrompt = prompt && prompt.trim()
      ? prompt
      : t('tasks.nextTaskPrompt', { defaultValue: 'Start the next task' });
    setInput(nextPrompt);
    const stage = String(task?.stage || '').trim().toLowerCase();
    setPendingStageTagKeys(stage ? [stage] : []);
  }, [setInput, setPendingStageTagKeys, t]);

  useEffect(() => {
    let cancelled = false;

    const loadProviderAvailability = async () => {
      const checks: Array<{ provider: Provider; endpoint: string; fallbackCommand: string }> = [
        { provider: 'claude', endpoint: '/api/cli/claude/status', fallbackCommand: 'claude' },
        { provider: 'cursor', endpoint: '/api/cli/cursor/status', fallbackCommand: 'agent' },
        { provider: 'codex', endpoint: '/api/cli/codex/status', fallbackCommand: 'codex' },
        { provider: 'gemini', endpoint: '/api/cli/gemini/status', fallbackCommand: 'gemini' },
        { provider: 'openrouter', endpoint: '/api/cli/openrouter/status', fallbackCommand: 'openrouter' },
        { provider: 'nano', endpoint: '/api/cli/nano/status', fallbackCommand: 'nano-claude-code' },
      ];

      const results = await Promise.all(checks.map(async ({ provider: nextProvider, endpoint, fallbackCommand }) => {
        try {
          const response = await authenticatedFetch(endpoint);
          const data = await response.json();
          return [nextProvider, {
            cliAvailable: data.cliAvailable !== false,
            cliCommand: data.cliCommand || fallbackCommand,
            installHint: data.installHint || null,
          }] as const;
        } catch {
          return [nextProvider, {
            cliAvailable: true,
            cliCommand: fallbackCommand,
            installHint: null,
          }] as const;
        }
      }));

      if (cancelled) {
        return;
      }

      const nextAvailability = Object.fromEntries(results) as Record<Provider, ProviderAvailability>;
      for (const [nextProvider, availability] of Object.entries(nextAvailability) as Array<[Provider, ProviderAvailability]>) {
        writeCliAvailability(nextProvider, {
          cliAvailable: availability.cliAvailable,
          cliCommand: availability.cliCommand ?? null,
          installHint: availability.installHint ?? null,
        });
      }

      setProviderAvailability(nextAvailability);
    };

    void loadProviderAvailability();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (providerAvailability[provider]?.cliAvailable === false) {
      const fallbackProvider = (['claude', 'cursor', 'codex', 'gemini', 'openrouter', 'local', 'nano'] as const).find(
        (candidate) => providerAvailability[candidate]?.cliAvailable !== false,
      );

      if (fallbackProvider && fallbackProvider !== provider) {
        setProvider(fallbackProvider);
        localStorage.setItem('selected-provider', fallbackProvider);
      }
    }
  }, [provider, providerAvailability, setProvider]);

  useEffect(() => {
    if (providerAvailability[importedProjectAnalysisProvider]?.cliAvailable !== false) {
      return;
    }

    const fallbackProvider = ANALYSIS_PROVIDERS.find(
      ({ id }) => providerAvailability[id]?.cliAvailable !== false,
    )?.id;

    if (fallbackProvider && fallbackProvider !== importedProjectAnalysisProvider) {
      setImportedProjectAnalysisProvider(fallbackProvider);
    }
  }, [importedProjectAnalysisProvider, providerAvailability]);

  useEffect(() => {
    const triggerId = getAutoIntakeTriggerId(pendingAutoIntake);
    if (triggerId && lastAutoIntakeTriggerIdRef.current !== triggerId) {
      autoIntakeTriggeredRef.current = false;
      lastAutoIntakeTriggerIdRef.current = triggerId;
    }

    if (!pendingAutoIntake || newSessionMode !== 'research') {
      autoIntakeTriggeredRef.current = false;
      return;
    }

    if (
      autoIntakeTriggeredRef.current ||
      !selectedProject ||
      selectedSession ||
      isLoading ||
      chatMessages.length > 0
    ) return;

    const intakeKey = getAutoIntakeStorageKey(selectedProject.name, triggerId);
    if (sessionStorage.getItem(intakeKey)) {
      clearPendingAutoIntake?.();
      return;
    }

    autoIntakeTriggeredRef.current = true;
    sessionStorage.setItem(intakeKey, 'true');

    const autoIntakePrompt = getAutoIntakePrompt(pendingAutoIntake);

    if (autoIntakePrompt) {
      clearPendingAutoIntake?.();
      submitProgrammaticInput(autoIntakePrompt);
      return;
    }

    clearPendingAutoIntake?.();

    setIntakeGreeting(INTAKE_GREETING);
  }, [
    pendingAutoIntake,
    selectedProject,
    selectedSession,
    isLoading,
    chatMessages.length,
    clearPendingAutoIntake,
    setIntakeGreeting,
    submitProgrammaticInput,
    newSessionMode,
  ]);

  useEffect(() => {
    if (selectedSession?.mode) {
      onNewSessionModeChange?.(selectedSession.mode);
    }
  }, [onNewSessionModeChange, selectedSession?.id, selectedSession?.mode]);

  useEffect(() => {
    setIsShellEditPromptOpen(false);
  }, [selectedProject?.name, selectedSession?.id]);

  useEffect(() => {
    setPreviewFile(null);
  }, [selectedSession?.id, selectedProject?.name]);

  useEffect(() => {
    if (!isLoading || !canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession, isLoading]);

  const prevIsLoadingForProcessingRef = useRef(false);
  useEffect(() => {
    const processingSessionId = selectedSession?.id || currentSessionId;
    const shouldTrackAsProcessing = isLoading && claudeStatus?.text !== RESUMING_STATUS_TEXT;
    const loadingJustStarted = shouldTrackAsProcessing && !prevIsLoadingForProcessingRef.current;
    prevIsLoadingForProcessingRef.current = shouldTrackAsProcessing;
    if (processingSessionId && loadingJustStarted && onSessionProcessing) {
      onSessionProcessing(processingSessionId);
    }
  }, [claudeStatus?.text, currentSessionId, isLoading, onSessionProcessing, selectedSession?.id]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  useEffect(() => {
    if (!latestMessage?.type) {
      return;
    }

    if (
      latestMessage.type === 'claude-complete' ||
      latestMessage.type === 'cursor-result' ||
      latestMessage.type === 'codex-complete'
    ) {
      refreshTasks?.();
    }
  }, [latestMessage, refreshTasks]);

  const handleImportedProjectAnalysisDismiss = useCallback(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      sessionStorage.setItem(getImportedProjectAnalysisStorageKey(selectedProject.name), 'dismissed');
    }
    clearImportedProjectAnalysisPrompt?.();
  }, [clearImportedProjectAnalysisPrompt, selectedProject]);

  const handleImportedProjectAnalysisModelChange = useCallback((nextModel: string) => {
    if (importedProjectAnalysisProvider === 'claude') {
      setClaudeModel(nextModel);
      localStorage.setItem('claude-model', nextModel);
      return;
    }

    if (importedProjectAnalysisProvider === 'codex') {
      setCodexModel(nextModel);
      localStorage.setItem('codex-model', nextModel);
      return;
    }

    if (importedProjectAnalysisProvider === 'gemini') {
      setGeminiModel(nextModel);
      localStorage.setItem('gemini-model', nextModel);
      return;
    }

    setCursorModel(nextModel);
    localStorage.setItem('cursor-model', nextModel);
  }, [importedProjectAnalysisProvider, setClaudeModel, setCodexModel, setCursorModel, setGeminiModel]);

  const handleImportedProjectAnalysisConfirm = useCallback(() => {
    const prompt = importedProjectAnalysisPrompt?.prompt?.trim();
    if (!prompt || !selectedProject) {
      clearImportedProjectAnalysisPrompt?.();
      return;
    }

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(getImportedProjectAnalysisStorageKey(selectedProject.name));
    }

    setProvider(importedProjectAnalysisProvider);
    localStorage.setItem('selected-provider', importedProjectAnalysisProvider);

    clearImportedProjectAnalysisPrompt?.();
    submitProgrammaticInput(prompt);
  }, [
    clearImportedProjectAnalysisPrompt,
    importedProjectAnalysisPrompt?.prompt,
    importedProjectAnalysisProvider,
    selectedProject,
    setProvider,
    submitProgrammaticInput,
  ]);

  const handleOpenShellEditPrompt = useCallback(() => {
    if (!selectedSession || !onOpenShellForSession) {
      return;
    }
    setIsShellEditPromptOpen(true);
  }, [onOpenShellForSession, selectedSession]);

  const handleCloseShellEditPrompt = useCallback(() => {
    setIsShellEditPromptOpen(false);
  }, []);

  const handleConfirmOpenShell = useCallback(() => {
    setIsShellEditPromptOpen(false);
    onOpenShellForSession?.();
  }, [onOpenShellForSession]);

  if (!selectedProject) {
    const selectedProviderLabel = getProviderDisplayName(provider);

    return (
      <>
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-muted-foreground">
            <p className="text-sm">
              {t('projectSelection.startChatWithProvider', {
                provider: selectedProviderLabel,
                defaultValue: 'Select a project to start chatting with {{provider}}',
              })}
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="h-full flex min-h-0 flex-col xl:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {previewFile && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <CodeEditor
                file={previewFile}
                onClose={handleClosePreview}
                projectPath={selectedProject?.path}
                selectedProject={selectedProject}
                isSidebar
              />
            </div>
          )}
          <div className={previewFile ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
        {shouldShowImportedProjectAnalysisPrompt && (
          <div className="mx-auto mt-4 w-full max-w-3xl px-3 sm:px-4">
            <div className="rounded-xl border border-border bg-card/95 shadow-sm px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Analyze Imported Project?</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Start a new session to scan this workspace, analyze the project structure and implementation, and summarize next steps.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Provider</span>
                      <select
                        value={importedProjectAnalysisProvider}
                        onChange={(event) => setImportedProjectAnalysisProvider(event.target.value as Provider)}
                        className="min-w-[180px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        {ANALYSIS_PROVIDERS.map(({ id, label }) => {
                          const unavailable = providerAvailability[id]?.cliAvailable === false;
                          return (
                            <option key={id} value={id} disabled={unavailable}>
                              {unavailable ? `${label} (Not installed)` : label}
                            </option>
                          );
                        })}
                      </select>
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Model</span>
                      <select
                        value={importedProjectAnalysisModel}
                        onChange={(event) => handleImportedProjectAnalysisModelChange(event.target.value)}
                        className="min-w-[220px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        {getProviderModelConfig(importedProjectAnalysisProvider).OPTIONS.map(({ value, label }: { value: string; label: string }) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="flex gap-2 sm:flex-shrink-0">
                    <Button variant="outline" onClick={handleImportedProjectAnalysisDismiss}>
                      Not Now
                    </Button>
                    <Button onClick={handleImportedProjectAnalysisConfirm}>
                      Analyze Project
                    </Button>
                  </div>
                </div>

                {providerAvailability[importedProjectAnalysisProvider]?.cliAvailable === false && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {providerAvailability[importedProjectAnalysisProvider]?.installHint || 'Selected provider is not installed.'}
                  </p>
                )}

              </div>
            </div>
          </div>
        )}

        <ChatMessagesPane
          scrollContainerRef={scrollContainerRef}
          onWheel={handleScroll}
          onTouchMove={handleScroll}
          isLoadingSessionMessages={isLoadingSessionMessages}
          chatMessages={chatMessages}
          selectedSession={selectedSession}
          intakeGreeting={intakeGreeting}
          currentSessionId={currentSessionId}
          provider={provider}
          setProvider={(nextProvider) => setProvider(nextProvider as Provider)}
          textareaRef={textareaRef}
          setInput={setInput}
          setAttachedPrompt={setAttachedPrompt}
          claudeModel={claudeModel}
          setClaudeModel={setClaudeModel}
          cursorModel={cursorModel}
          setCursorModel={setCursorModel}
          codexModel={codexModel}
          setCodexModel={setCodexModel}
          geminiModel={geminiModel}
          setGeminiModel={setGeminiModel}
          openrouterModel={openrouterModel}
          setOpenrouterModel={setOpenrouterModel}
          localModel={localModel}
          setLocalModel={setLocalModel}
          nanoModel={nanoModel}
          setNanoModel={setNanoModel}
          isLoadingMoreMessages={isLoadingMoreMessages}
          hasMoreMessages={hasMoreMessages}
          totalMessages={totalMessages}
          sessionMessagesCount={sessionMessages.length}
          visibleMessageCount={visibleMessageCount}
          visibleMessages={visibleMessages}
          loadEarlierMessages={loadEarlierMessages}
          loadAllMessages={loadAllMessages}
          allMessagesLoaded={allMessagesLoaded}
          isLoadingAllMessages={isLoadingAllMessages}
          loadAllJustFinished={loadAllJustFinished}
          showLoadAllOverlay={showLoadAllOverlay}
          createDiff={createDiff}
          onFileOpen={handleFilePreview}
          onShowSettings={onShowSettings}
          onGrantToolPermission={handleGrantToolPermission}
          onSuggestShellEdit={handleOpenShellEditPrompt}
          autoExpandTools={autoExpandTools}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          selectedProject={selectedProject}
          isLoading={isLoading}
          statusText={statusTextOverride || claudeStatus?.text}
          providerAvailability={providerAvailability}
          newSessionMode={newSessionMode}
          onNewSessionModeChange={onNewSessionModeChange}
          onRetry={handleRetry}
        />

        <ChatComposer
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
          claudeStatus={claudeStatus ? { ...claudeStatus, text: statusTextOverride || claudeStatus.text } : claudeStatus}
          isLoading={isLoading}
          onAbortSession={handleAbortSession}
          provider={provider}
          permissionMode={permissionMode}
          onModeSwitch={cyclePermissionMode}
          codexModel={codexModel}
          geminiModel={geminiModel}
          thinkingMode={thinkingMode}
          setThinkingMode={setThinkingMode}
          codexReasoningEffort={codexReasoningEffort}
          setCodexReasoningEffort={setCodexReasoningEffort}
          geminiThinkingMode={geminiThinkingMode}
          setGeminiThinkingMode={setGeminiThinkingMode}
          tokenBudget={tokenBudget}
          slashCommandsCount={slashCommandsCount}
          onToggleCommandMenu={handleToggleCommandMenu}
          hasInput={Boolean(input.trim()) || attachedFiles.length > 0}
          onClearInput={handleClearInput}
          isUserScrolledUp={isUserScrolledUp}
          hasMessages={chatMessages.length > 0}
          onScrollToBottom={scrollToBottomAndReset}
          onSubmit={handleSubmit}
          isDragActive={isDragActive}
          attachedFiles={attachedFiles}
          onRemoveFile={removeAttachedFile}
          uploadingFiles={uploadingFiles}
          fileErrors={fileErrors}
          showFileDropdown={showFileDropdown}
          filteredFiles={filteredFiles}
          selectedFileIndex={selectedFileIndex}
          onSelectFile={selectFile}
          filteredCommands={filteredCommands}
          selectedCommandIndex={selectedCommandIndex}
          onCommandSelect={handleCommandSelect}
          onCloseCommandMenu={resetCommandMenuState}
          isCommandMenuOpen={showCommandMenu}
          frequentCommands={commandQuery ? [] : frequentCommands}
          getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
          getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
          openFilePicker={openFilePicker}
          inputHighlightRef={inputHighlightRef}
          renderInputWithMentions={renderInputWithMentions}
          textareaRef={textareaRef}
          input={input}
          onInputChange={handleInputChange}
          onTextareaClick={handleTextareaClick}
          onTextareaKeyDown={handleKeyDown}
          onTextareaPaste={handlePaste}
          onTextareaScrollSync={syncInputOverlayScroll}
          onTextareaInput={handleTextareaInput}
          onInputFocusChange={handleInputFocusChange}
          isInputFocused={isInputFocused}
          placeholder={t('input.placeholder', {
            provider: getProviderDisplayName(provider),
          })}
          isTextareaExpanded={isTextareaExpanded}
          sendByCtrlEnter={sendByCtrlEnter}
          onTranscript={handleTranscript}
          projectName={selectedProject?.name}
          onReferenceContext={(context) => {
            setInput((prev) => prev ? `${prev}\n\n${context}` : context);
          }}
          attachedPrompt={attachedPrompt}
          onRemoveAttachedPrompt={() => setAttachedPrompt(null)}
          onUpdateAttachedPrompt={(text) =>
            setAttachedPrompt((prev) => prev ? { ...prev, promptText: text } : null)
          }
        />

          </div>
        </div>

        <ChatContextSidebar
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          newSessionMode={newSessionMode}
          chatMessages={chatMessages}
          onFileOpen={handleFilePreview}
          activeSidebarTab={sidebarTab}
          onSidebarTabChange={setSidebarTab}
          onStartWorkspaceQa={onStartWorkspaceQa}
          onStartTask={handleStartTaskInChat}
        />
      </div>

      {isShellEditPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleCloseShellEditPrompt}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-background shadow-2xl">
            <div className="px-5 py-4">
              <h3 className="text-base font-semibold text-foreground">
                {t('shell.historyEdit.promptTitle')}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t('shell.historyEdit.promptDescription')}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
              <Button variant="outline" onClick={handleCloseShellEditPrompt}>
                {t('shell.historyEdit.cancel')}
              </Button>
              <Button onClick={handleConfirmOpenShell}>
                {t('shell.historyEdit.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <QuickSettingsPanel />
      <BtwOverlay state={btwOverlay} onClose={closeBtwOverlay} />
    </>
  );
}

export default React.memo(ChatInterface);
