import CommandMenu from '../../../CommandMenu';
import ClaudeStatus from '../../../ClaudeStatus';
import { MicButton } from '../../../MicButton.jsx';
import ImageAttachment from './ImageAttachment';
import PermissionRequestsBanner from './PermissionRequestsBanner';
import ChatInputControls from './ChatInputControls';
import ReferencePicker from '../../../references/view/ReferencePicker';
import PromptBadgeDropdown from './PromptBadgeDropdown';
import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  SetStateAction,
  TouchEvent,
} from 'react';
import type { CodexReasoningEffortId } from '../../constants/codexReasoningEfforts';
import type { GeminiThinkingModeId } from '../../../../../shared/geminiThinkingSupport';
import type { AttachedPrompt, PendingPermissionRequest, PermissionMode, Provider, TokenBudget } from '../../types/types';
import type { ProviderAvailability } from '../../types/types';
import type { SessionMode, SessionProvider } from '../../../../types/app';
import { CLAUDE_MODELS, CURSOR_MODELS, CODEX_MODELS, GEMINI_MODELS, LOCAL_MODELS, OPENROUTER_MODELS } from '../../../../../shared/modelConstants';
import { authenticatedFetch } from '../../../../utils/api';

// New subcomponents
import SkillDropdown from './SkillDropdown';
import ModelSelector from './ModelSelector';
import AgentSelector, { type ProviderDef } from './AgentSelector';
import OpenRouterModelInput from './OpenRouterModelInput';

interface MentionableFile {
  name: string;
  path: string;
}

function getFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

const PROVIDERS: ProviderDef[] = [
  { id: 'claude', name: 'Claude Code', accent: 'border-primary', ring: 'ring-primary/15', check: 'bg-primary text-primary-foreground' },
  { id: 'gemini', name: 'Gemini CLI', accent: 'border-blue-500 dark:border-blue-400', ring: 'ring-blue-500/15', check: 'bg-blue-500 text-white' },
  { id: 'codex', name: 'Codex', accent: 'border-emerald-600 dark:border-emerald-400', ring: 'ring-emerald-600/15', check: 'bg-emerald-600 dark:bg-emerald-500 text-white' },
  { id: 'openrouter', name: 'OpenRouter', accent: 'border-violet-500 dark:border-violet-400', ring: 'ring-violet-500/15', check: 'bg-violet-500 text-white' },
  { id: 'local', name: 'Local GPU', accent: 'border-emerald-500 dark:border-emerald-400', ring: 'ring-emerald-500/15', check: 'bg-emerald-500 text-white' },
];

function getModelConfig(p: SessionProvider) {
  if (p === 'claude') return CLAUDE_MODELS;
  if (p === 'codex') return CODEX_MODELS;
  if (p === 'gemini') return GEMINI_MODELS;
  if (p === 'openrouter') return OPENROUTER_MODELS;
  if (p === 'local') return LOCAL_MODELS;
  return CURSOR_MODELS;
}

function getModelValue(p: SessionProvider, c: string, cu: string, co: string, g: string, or: string, lo: string) {
  if (p === 'claude') return c;
  if (p === 'codex') return co;
  if (p === 'gemini') return g;
  if (p === 'openrouter') return or;
  if (p === 'local') return lo;
  return cu;
}

interface ChatComposerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  claudeStatus: { text: string; tokens: number; can_interrupt: boolean } | null;
  isLoading: boolean;
  onAbortSession: () => void;
  provider: Provider | string;
  permissionMode: PermissionMode | string;
  onModeSwitch: () => void;
  codexModel: string;
  geminiModel: string;
  thinkingMode: string;
  setThinkingMode: Dispatch<SetStateAction<string>>;
  codexReasoningEffort: CodexReasoningEffortId;
  setCodexReasoningEffort: Dispatch<SetStateAction<CodexReasoningEffortId>>;
  geminiThinkingMode: GeminiThinkingModeId;
  setGeminiThinkingMode: Dispatch<SetStateAction<GeminiThinkingModeId>>;
  tokenBudget: TokenBudget | null;
  slashCommandsCount: number;
  onToggleCommandMenu: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  isUserScrolledUp: boolean;
  hasMessages: boolean;
  onScrollToBottom: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  attachedFiles: File[];
  onRemoveFile: (index: number) => void;
  uploadingFiles: Map<string, number>;
  fileErrors: Map<string, string>;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (command: SlashCommand, index: number, isHover: boolean) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  getRootProps: (...args: unknown[]) => Record<string, unknown>;
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  openFilePicker: () => void;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  onInputFocusChange?: (focused: boolean) => void;
  isInputFocused?: boolean;
  placeholder: string;
  isTextareaExpanded: boolean;
  sendByCtrlEnter?: boolean;
  onTranscript: (text: string) => void;
  projectName?: string;
  onReferenceContext?: (context: string) => void;
  attachedPrompt: AttachedPrompt | null;
  onRemoveAttachedPrompt: () => void;
  onUpdateAttachedPrompt: (promptText: string) => void;
  centered?: boolean;
  setAttachedPrompt?: (prompt: AttachedPrompt | null) => void;
  // Provider selection props
  setProvider?: (next: SessionProvider) => void;
  claudeModel?: string;
  setClaudeModel?: (model: string) => void;
  cursorModel?: string;
  setCursorModel?: (model: string) => void;
  setCodexModel?: (model: string) => void;
  setGeminiModel?: (model: string) => void;
  openrouterModel?: string;
  setOpenrouterModel?: (model: string) => void;
  localModel?: string;
  setLocalModel?: (model: string) => void;
  providerAvailability?: Record<SessionProvider, ProviderAvailability>;
  newSessionMode?: SessionMode;
  onNewSessionModeChange?: (mode: SessionMode) => void;
}

export default function ChatComposer({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  claudeStatus,
  isLoading,
  onAbortSession,
  provider,
  permissionMode,
  onModeSwitch,
  codexModel,
  geminiModel,
  thinkingMode,
  setThinkingMode,
  codexReasoningEffort,
  setCodexReasoningEffort,
  geminiThinkingMode,
  setGeminiThinkingMode,
  tokenBudget,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
  isUserScrolledUp,
  hasMessages,
  onScrollToBottom,
  onSubmit,
  isDragActive,
  attachedFiles,
  onRemoveFile,
  uploadingFiles,
  fileErrors,
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  getRootProps,
  getInputProps,
  openFilePicker,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
  setInput,
  onInputChange,
  onTextareaClick,
  onTextareaKeyDown,
  onTextareaPaste,
  onTextareaScrollSync,
  onTextareaInput,
  onInputFocusChange,
  isInputFocused,
  placeholder,
  isTextareaExpanded,
  sendByCtrlEnter,
  onTranscript,
  projectName,
  onReferenceContext,
  attachedPrompt,
  onRemoveAttachedPrompt,
  onUpdateAttachedPrompt,
  centered,
  setAttachedPrompt,
  setProvider,
  claudeModel: claudeModelProp,
  setClaudeModel,
  cursorModel: cursorModelProp,
  setCursorModel,
  setCodexModel,
  setGeminiModel,
  openrouterModel: openrouterModelProp,
  setOpenrouterModel,
  localModel: localModelProp,
  setLocalModel,
  providerAvailability,
  newSessionMode,
  onNewSessionModeChange,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const [showReferencePicker, setShowReferencePicker] = useState(false);
  const AnyCommandMenu = CommandMenu as any;
  const textareaRect = textareaRef.current?.getBoundingClientRect();
  const commandMenuPosition = {
    top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
    left: textareaRect ? textareaRect.left : 16,
    bottom: textareaRect ? window.innerHeight - textareaRect.top + 8 : 90,
  };

  // Detect if the AskUserQuestion interactive panel is active
  const hasQuestionPanel = pendingPermissionRequests.some(
    (r) => r.toolName === 'AskUserQuestion'
  );

  // On mobile, when input is focused, float the input box at the bottom
  const mobileFloatingClass = isInputFocused
    ? 'max-sm:fixed max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:z-50 max-sm:bg-background max-sm:shadow-[0_-4px_20px_rgba(0,0,0,0.15)]'
    : '';

  // Provider/model handling for centered mode
  const sessionProvider = provider as SessionProvider;
  const currentModel = getModelValue(sessionProvider, claudeModelProp || '', cursorModelProp || '', codexModel, geminiModel, openrouterModelProp || '', localModelProp || '');

  const [ollamaModels, setOllamaModels] = useState<Array<{ value: string; label: string }>>([]);
  const [isLoadingOllamaModels, setIsLoadingOllamaModels] = useState(false);

  useEffect(() => {
    if (sessionProvider !== 'local') return;
    setIsLoadingOllamaModels(true);
    const serverUrl = localStorage.getItem('local-gpu-server-url') || 'http://localhost:11434';
    authenticatedFetch(`/api/cli/local/models?serverUrl=${encodeURIComponent(serverUrl)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.models?.length) {
          const opts = data.models.map((m: any) => ({
            value: m.name,
            label: `${m.displayName || m.name}${m.size ? ` (${m.size})` : ''}`,
          }));
          setOllamaModels(opts);
          if (!localModelProp && opts.length > 0) {
            const small = data.models.find((m: any) => m.sizeB && m.sizeB <= 14);
            const pick = small ? small.name : opts[0].value;
            setLocalModel?.(pick);
            localStorage.setItem('local-model', pick);
          }
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadingOllamaModels(false));
  }, [sessionProvider, localModelProp, setLocalModel]);

  const rawModelConfig = getModelConfig(sessionProvider);
  const modelConfig = sessionProvider === 'local' && ollamaModels.length > 0
    ? { ...rawModelConfig, OPTIONS: ollamaModels }
    : rawModelConfig;

  const selectProvider = (next: SessionProvider) => {
    if (providerAvailability?.[next]?.cliAvailable === false) return;
    setProvider?.(next);
    localStorage.setItem('selected-provider', next);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleModelChange = (value: string) => {
    if (sessionProvider === 'claude') { setClaudeModel?.(value); localStorage.setItem('claude-model', value); }
    else if (sessionProvider === 'codex') { setCodexModel?.(value); localStorage.setItem('codex-model', value); }
    else if (sessionProvider === 'gemini') { setGeminiModel?.(value); localStorage.setItem('gemini-model', value); }
    else if (sessionProvider === 'openrouter') { setOpenrouterModel?.(value); localStorage.setItem('openrouter-model', value); }
    else if (sessionProvider === 'local') { setLocalModel?.(value); localStorage.setItem('local-model', value); }
    else { setCursorModel?.(value); localStorage.setItem('cursor-model', value); }
  };

  const sessionModeChoices: Array<{ id: SessionMode; titleKey: string }> = [
    { id: 'research', titleKey: 'session.mode.researchTitle' },
    { id: 'workspace_qa', titleKey: 'session.mode.workspaceQaTitle' },
  ];

  return (
    <div className={`p-2 sm:p-4 md:p-4 flex-shrink-0 ${centered ? 'pb-2 sm:pb-3' : 'pb-2 sm:pb-4 md:pb-6'} ${mobileFloatingClass}`}>
      <div className={`${centered ? 'max-w-3xl' : 'max-w-5xl'} mx-auto mb-3`}>
        <PermissionRequestsBanner
          provider={provider}
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
        />

        {!centered && !hasQuestionPanel && (
          <div className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
            <ClaudeStatus
              status={claudeStatus}
              isLoading={isLoading}
              onAbort={onAbortSession}
              provider={provider}
            />
            {isUserScrolledUp && hasMessages && (
              <button
                onClick={onScrollToBottom}
                className="w-7 h-7 sm:w-8 sm:h-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg shadow-sm flex items-center justify-center transition-all duration-200 hover:scale-105"
              >
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {!hasQuestionPanel && <form onSubmit={onSubmit as (event: FormEvent<HTMLFormElement>) => void} className={`relative mx-auto ${centered ? 'max-w-3xl' : 'max-w-5xl'}`}>
        {isDragActive && (
          <div className="absolute inset-0 bg-primary/15 border-2 border-dashed border-primary/50 rounded-3xl flex items-center justify-center z-50">
            <div className="bg-card rounded-xl p-4 shadow-lg border border-border/30">
              <svg className="w-8 h-8 text-primary mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <p className="text-sm font-medium">{t('input.dropFilesHere')}</p>
            </div>
          </div>
        )}

        {attachedFiles.length > 0 && (
          <div className="mb-2 p-2 bg-muted/40 rounded-xl">
            <div className="flex flex-wrap gap-2">
              {attachedFiles.map((file, index) => (
                <ImageAttachment
                  key={index}
                  file={file}
                  onRemove={() => onRemoveFile(index)}
                  uploadProgress={uploadingFiles.get(getFileKey(file))}
                />
              ))}
            </div>
          </div>
        )}

        {fileErrors.size > 0 && (
          <div className="mb-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-600">
            {[...new Set(fileErrors.values())].map((error) => (
              <div key={error} className="truncate">
                {error}
              </div>
            ))}
          </div>
        )}

        {showFileDropdown && filteredFiles.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-card/95 backdrop-blur-md border border-border/50 rounded-xl shadow-lg max-h-48 overflow-y-auto z-50">
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                className={`px-4 py-3 cursor-pointer border-b border-border/30 last:border-b-0 touch-manipulation ${
                  index === selectedFileIndex
                    ? 'bg-primary/8 text-primary'
                    : 'hover:bg-accent/50 text-foreground'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectFile(file);
                }}
              >
                <div className="font-medium text-sm">{file.name}</div>
                <div className="text-xs text-muted-foreground font-mono">{file.path}</div>
              </div>
            ))}
          </div>
        )}

        {showReferencePicker && projectName && onReferenceContext && (
          <ReferencePicker
            projectName={projectName}
            onSelect={(context) => {
              onReferenceContext?.(context);
            }}
            onClose={() => setShowReferencePicker(false)}
          />
        )}

        <AnyCommandMenu
          commands={filteredCommands}
          selectedIndex={selectedCommandIndex}
          onSelect={onCommandSelect}
          onClose={onCloseCommandMenu}
          position={commandMenuPosition}
          isOpen={isCommandMenuOpen}
          frequentCommands={frequentCommands}
        />

        <div
          {...getRootProps()}
          className={`relative bg-card/80 backdrop-blur-sm rounded-3xl shadow-sm border border-border/50 focus-within:shadow-md focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/15 transition-all duration-200 ${isTextareaExpanded ? 'chat-input-expanded' : ''}`}
        >
          <input {...getInputProps()} />
          {attachedPrompt && (
            <PromptBadgeDropdown
              prompt={attachedPrompt}
              onRemove={onRemoveAttachedPrompt}
              onUpdate={onUpdateAttachedPrompt}
            />
          )}
          <div aria-hidden="true" className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
            <div className={`chat-input-placeholder block w-full ${projectName ? 'pl-[5.5rem]' : 'pl-12'} ${centered ? 'pr-16 pt-4 pb-2 text-sm' : 'pr-20 sm:pr-40 py-1.5 sm:py-4 text-base'} text-transparent leading-6 whitespace-pre-wrap break-words`}>
              {renderInputWithMentions(input)}
            </div>
          </div>

          <div className="relative z-10">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={onInputChange}
              onClick={onTextareaClick}
              onKeyDown={onTextareaKeyDown}
              onPaste={onTextareaPaste}
              onScroll={(event) => onTextareaScrollSync(event.target as HTMLTextAreaElement)}
              onFocus={() => onInputFocusChange?.(true)}
              onBlur={() => onInputFocusChange?.(false)}
              onInput={onTextareaInput}
              placeholder={placeholder}
              disabled={isLoading}
              className={`chat-input-placeholder block w-full ${projectName ? 'pl-[5.5rem]' : 'pl-12'} ${centered ? 'pr-16 pt-4 pb-2 min-h-[56px] max-h-[200px] text-sm' : 'pr-20 sm:pr-40 py-1.5 sm:py-4 min-h-[50px] sm:min-h-[80px] max-h-[40vh] sm:max-h-[300px] text-base'} bg-transparent rounded-3xl focus:outline-none text-foreground placeholder-muted-foreground/50 disabled:opacity-50 resize-none overflow-y-auto leading-6 transition-all duration-200`}
              style={{ height: centered ? '56px' : '50px' }}
            />

            <div className="absolute left-1 top-1/2 transform -translate-y-1/2 flex items-center">
              <button
                type="button"
                onClick={openFilePicker}
                className="p-2 hover:bg-accent/60 rounded-xl transition-colors"
                title={t('input.attachFiles')}
              >
                <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                  />
                </svg>
              </button>
              {projectName && onReferenceContext && (
                <button
                  type="button"
                  onClick={() => setShowReferencePicker(!showReferencePicker)}
                  className="p-2 hover:bg-accent/60 rounded-xl transition-colors"
                  title={t('input.attachReferences')}
                >
                  <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </button>
              )}
            </div>

            <div className={`absolute ${centered ? 'right-11' : 'right-14'} top-1/2 transform -translate-y-1/2`}>
              <MicButton onTranscript={onTranscript} className={centered ? '!w-7 !h-7' : '!w-9 !h-9'} />
            </div>

            <button
              type="submit"
              disabled={(!input.trim() && attachedFiles.length === 0 && !attachedPrompt) || isLoading}
              onMouseDown={(event) => {
                event.preventDefault();
                onSubmit(event);
              }}
              onTouchStart={(event) => {
                event.preventDefault();
                onSubmit(event);
              }}
              className={`absolute right-2 top-1/2 transform -translate-y-1/2 ${centered ? 'w-8 h-8 rounded-lg' : 'w-10 h-10 sm:w-11 sm:h-11 rounded-xl'} bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-1 focus:ring-offset-background`}
            >
              <svg className={`${centered ? 'w-3.5 h-3.5' : 'w-4 h-4 sm:w-[18px] sm:h-[18px]'} text-primary-foreground transform rotate-90`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>

            {!centered && (
              <div
                className={`absolute bottom-1 ${projectName ? 'left-[5.5rem]' : 'left-12'} right-14 sm:right-40 text-xs text-muted-foreground/50 pointer-events-none hidden sm:block transition-opacity duration-200 ${
                  input.trim() ? 'opacity-0' : 'opacity-100'
                }`}
              >
                {sendByCtrlEnter ? t('input.hintText.ctrlEnter') : t('input.hintText.enter')}
              </div>
            )}
          </div>

          {/* Bottom toolbar inside text box */}
          {!hasQuestionPanel && (
            <div className="relative z-10 border-t border-border/30">
              {/* Controls row */}
              <div className="flex items-center gap-2 px-4 py-2">
                {/* Left side */}
                <div className="flex items-center gap-2.5">
                  {/* Session modes — only in empty state */}
                  {centered && onNewSessionModeChange && sessionModeChoices.map((choice) => {
                    const active = newSessionMode === choice.id;
                    const dotColor = choice.id === 'research' ? 'bg-sky-500' : 'bg-emerald-500';
                    return (
                      <button
                        key={choice.id}
                        type="button"
                        onClick={() => onNewSessionModeChange(choice.id)}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-all duration-150 ${
                          active
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'
                        }`}
                      >
                        <span className="flex items-center gap-1">
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${active ? dotColor : 'bg-muted-foreground/40'}`} />
                          {t(choice.titleKey)}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Right side */}
                <div className="flex items-center gap-1.5">
                  {/* Agent selector — only in empty state */}
                  {centered && providerAvailability && (
                    <AgentSelector
                      providers={PROVIDERS}
                      activeProvider={sessionProvider}
                      providerAvailability={providerAvailability}
                      onSelect={selectProvider}
                      t={t}
                    />
                  )}

                  {/* Skill shortcuts — only in normal chat mode */}
                  {!centered && (
                    <SkillDropdown
                      setInput={setInput}
                      textareaRef={textareaRef}
                      setAttachedPrompt={setAttachedPrompt}
                      t={t}
                    />
                  )}

                  {/* Model selector */}
                  {modelConfig && (
                    <>
                      {(modelConfig as any).ALLOWS_CUSTOM ? (
                        <OpenRouterModelInput value={currentModel} options={modelConfig.OPTIONS} onChange={handleModelChange} />
                      ) : (modelConfig as any).IS_LOCAL && modelConfig.OPTIONS.length === 0 ? (
                        <span className="text-[10px] text-muted-foreground/60 px-2 py-0.5 border border-border/50 rounded-lg">
                          {isLoadingOllamaModels ? 'Loading...' : 'No models'}
                        </span>
                      ) : (
                        <ModelSelector
                          value={currentModel}
                          options={modelConfig.OPTIONS}
                          onChange={handleModelChange}
                        />
                      )}
                    </>
                  )}

                  {centered && <div className="h-4 border-l border-border/40 mx-1" />}

                  <ChatInputControls
                    permissionMode={permissionMode}
                    onModeSwitch={onModeSwitch}
                    provider={provider}
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
                    onToggleCommandMenu={onToggleCommandMenu}
                    hasInput={hasInput}
                    onClearInput={onClearInput}
                    isUserScrolledUp={isUserScrolledUp}
                    hasMessages={hasMessages}
                    onScrollToBottom={onScrollToBottom}
                    hideCommandMenu
                    compact
                  />
                </div>
              </div>
            </div>
          )}

        </div>
      </form>}
    </div>
  );
}
