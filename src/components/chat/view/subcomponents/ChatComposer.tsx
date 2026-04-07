import CommandMenu from '../../../CommandMenu';
import ClaudeStatus from '../../../ClaudeStatus';
import { MicButton } from '../../../MicButton.jsx';
import ImageAttachment from './ImageAttachment';
import PermissionRequestsBanner from './PermissionRequestsBanner';
import PromptBadgeDropdown from './PromptBadgeDropdown';
import SessionProviderLogo from '../../../SessionProviderLogo';
import ThinkingModeSelector from './ThinkingModeSelector';
import CodexReasoningEffortSelector from './CodexReasoningEffortSelector';
import GeminiThinkingSelector from './GeminiThinkingSelector';
import TokenUsagePie from './TokenUsagePie';
import { supportsExplicitCodexReasoningEffort } from '../../constants/codexReasoningSupport';
import { supportsExplicitGeminiThinkingMode } from '../../../../../shared/geminiThinkingSupport';
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useRef } from 'react';
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
import { Check, ChevronDown, Sparkles, Plus, Wrench } from 'lucide-react';
import { CLAUDE_MODELS, CURSOR_MODELS, CODEX_MODELS, GEMINI_MODELS, LOCAL_MODELS, OPENROUTER_MODELS } from '../../../../../shared/modelConstants';
import { authenticatedFetch } from '../../../../utils/api';
import { api } from '../../../../utils/api';
import {
  GUIDED_PROMPT_SCENARIOS,
  type GuidedPromptScenario,
} from '../../constants/guidedPromptScenarios';
import type { CodexReasoningEffortId } from '../../constants/codexReasoningEfforts';
import type { GeminiThinkingModeId } from '../../../../../shared/geminiThinkingSupport';
import type { AttachedPrompt, PendingPermissionRequest, PermissionMode, Provider, ProviderAvailability, TokenBudget } from '../../types/types';
import type { SessionProvider } from '../../../../types/app';

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

/* ── Skills menu scenarios ── */
const SKILLS_SCENARIOS = GUIDED_PROMPT_SCENARIOS;

/* ── Primary skill chips (shown below input on empty state) ── */
const PRIMARY_SCENARIO_IDS = [
  'start-full-project',
  'paper-reproduction',
  'literature-survey',
  'presentation-promotion',
  'grant-proposal',
];
const PRIMARY_SCENARIOS = GUIDED_PROMPT_SCENARIOS.filter((s) =>
  PRIMARY_SCENARIO_IDS.includes(s.id),
);

interface SkillTreeNode {
  name: string;
  type: 'directory' | 'file';
  children?: SkillTreeNode[];
}

/* ── Provider definitions ── */
type ProviderDef = {
  id: SessionProvider;
  name: string;
};

const PROVIDERS: ProviderDef[] = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'gemini', name: 'Gemini CLI' },
  { id: 'codex', name: 'Codex' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'local', name: 'Local GPU' },
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

function buildSkillTemplate(
  t: (key: string, options?: Record<string, unknown>) => string,
  scenario: GuidedPromptScenario,
  skills: string[],
) {
  return [
    t('guidedStarter.template.intro', {
      scenario: t(scenario.titleKey),
      skills: skills.join(', '),
    }),
    '',
  ].join('\n');
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
  /* ── New props for provider/model selection & Skills ── */
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
  setAttachedPrompt?: (prompt: AttachedPrompt | null) => void;
  selectedScenarioId?: string | null;
  onScenarioSelect?: (scenario: GuidedPromptScenario) => void;
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
  getInputProps: getInputPropsDropzone,
  openFilePicker,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
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
  attachedPrompt,
  onRemoveAttachedPrompt,
  onUpdateAttachedPrompt,
  /* new props */
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
  setAttachedPrompt,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const AnyCommandMenu = CommandMenu as any;
  const textareaRect = textareaRef.current?.getBoundingClientRect();
  const commandMenuPosition = {
    top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
    left: textareaRect ? textareaRect.left : 16,
    bottom: textareaRect ? window.innerHeight - textareaRect.top + 8 : 90,
  };

  const hasQuestionPanel = pendingPermissionRequests.some(
    (r) => r.toolName === 'AskUserQuestion'
  );

  const mobileFloatingClass = isInputFocused
    ? 'max-sm:fixed max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:z-50 max-sm:bg-background max-sm:shadow-[0_-4px_20px_rgba(0,0,0,0.15)]'
    : '';

  /* ── Skills menu state ── */
  const [skillsMenuOpen, setSkillsMenuOpen] = useState(false);
  const skillsMenuRef = useRef<HTMLDivElement>(null);
  const [availableSkills, setAvailableSkills] = useState<Set<string> | null>(null);
  const [selectedChipId, setSelectedChipId] = useState<string | null>('start-full-project');

  useEffect(() => {
    let cancelled = false;
    const normalize = (v: string) => v.trim().toLowerCase();
    const discovered = new Set<string>();
    const collect = (nodes: SkillTreeNode[]) => {
      for (const node of nodes) {
        if (node.type !== 'directory') continue;
        const hasSkillMd = (node.children || []).some(
          (child) => child.type === 'file' && child.name === 'SKILL.md',
        );
        if (hasSkillMd) discovered.add(normalize(node.name));
        if (Array.isArray(node.children) && node.children.length > 0) collect(node.children);
      }
    };
    const fetchSkills = async () => {
      try {
        const response = await api.getGlobalSkills();
        if (!response.ok) return;
        const payload = (await response.json()) as SkillTreeNode[];
        collect(payload);
        if (!cancelled && discovered.size > 0) setAvailableSkills(discovered);
      } catch { /* fallback */ }
    };
    fetchSkills();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = (e: globalThis.MouseEvent) => {
      if (skillsMenuRef.current && !skillsMenuRef.current.contains(e.target as Node)) {
        setSkillsMenuOpen(false);
      }
    };
    if (skillsMenuOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [skillsMenuOpen]);

  const injectSkill = (scenario: GuidedPromptScenario) => {
    const matchedSkills = availableSkills
      ? scenario.skills.filter((skill) => availableSkills.has(skill.toLowerCase()))
      : [];
    const skills = matchedSkills.length > 0 ? matchedSkills : scenario.skills;
    const nextValue = buildSkillTemplate(t, scenario, skills);
    if (setAttachedPrompt) {
      setAttachedPrompt({
        scenarioId: scenario.id,
        scenarioIcon: scenario.icon,
        scenarioTitle: t(scenario.titleKey),
        promptText: nextValue,
      });
    }
    setSkillsMenuOpen(false);
    setSelectedChipId(scenario.id);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  /* ── Tools menu state (slash commands) ── */
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: globalThis.MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setToolsMenuOpen(false);
      }
    };
    if (toolsMenuOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [toolsMenuOpen]);

  /* ── Provider menu state ── */
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const providerMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: globalThis.MouseEvent) => {
      if (providerMenuRef.current && !providerMenuRef.current.contains(e.target as Node)) {
        setProviderMenuOpen(false);
      }
    };
    if (providerMenuOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [providerMenuOpen]);

  /* ── Model menu state ── */
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [ollamaModels, setOllamaModels] = useState<Array<{ value: string; label: string }>>([]);

  useEffect(() => {
    if (provider !== 'local') return;
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
        }
      })
      .catch(() => {});
  }, [provider]);

  useEffect(() => {
    const handler = (e: globalThis.MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    if (modelMenuOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelMenuOpen]);

  const rawModelConfig = getModelConfig(provider as SessionProvider);
  const modelConfig = provider === 'local' && ollamaModels.length > 0
    ? { ...rawModelConfig, OPTIONS: ollamaModels }
    : rawModelConfig;
  const currentModel = getModelValue(
    provider as SessionProvider,
    claudeModelProp || '',
    cursorModelProp || '',
    codexModel,
    geminiModel,
    openrouterModelProp || '',
    localModelProp || '',
  );

  const handleProviderSelect = (next: SessionProvider) => {
    if (providerAvailability?.[next]?.cliAvailable === false) return;
    setProvider?.(next);
    localStorage.setItem('selected-provider', next);
    setProviderMenuOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleModelSelect = (value: string) => {
    const p = provider as SessionProvider;
    if (p === 'claude') { setClaudeModel?.(value); localStorage.setItem('claude-model', value); }
    else if (p === 'codex') { setCodexModel?.(value); localStorage.setItem('codex-model', value); }
    else if (p === 'gemini') { setGeminiModel?.(value); localStorage.setItem('gemini-model', value); }
    else if (p === 'openrouter') { setOpenrouterModel?.(value); localStorage.setItem('openrouter-model', value); }
    else if (p === 'local') { setLocalModel?.(value); localStorage.setItem('local-model', value); }
    else { setCursorModel?.(value); localStorage.setItem('cursor-model', value); }
    setModelMenuOpen(false);
  };

  const currentProviderDef = PROVIDERS.find((p) => p.id === provider);
  const currentModelLabel = modelConfig.OPTIONS.find((o: { value: string; label: string }) => o.value === currentModel)?.label || currentModel || 'Select model';

  /* ── Thinking mode visibility ── */
  const showClaudeThinking = provider === 'claude';
  const showCodexReasoning = provider === 'codex' && supportsExplicitCodexReasoningEffort(codexModel);
  const showGeminiThinking = provider === 'gemini' && supportsExplicitGeminiThinkingMode(geminiModel);

  return (
    <div className={`p-2 sm:p-4 md:p-4 flex-shrink-0 pb-2 sm:pb-4 md:pb-6 ${mobileFloatingClass}`}>
      {/* Permission requests banner */}
      <div className="max-w-5xl mx-auto mb-2">
        <PermissionRequestsBanner
          provider={provider}
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
        />

        {/* Claude status (loading indicator) - compact, only when active */}
        {!hasQuestionPanel && (isLoading || claudeStatus) && (
          <div className="flex items-center justify-center mb-2">
            <ClaudeStatus
              status={claudeStatus}
              isLoading={isLoading}
              onAbort={onAbortSession}
              provider={provider}
            />
          </div>
        )}
      </div>

      {!hasQuestionPanel && <form onSubmit={onSubmit as (event: FormEvent<HTMLFormElement>) => void} className="relative max-w-5xl mx-auto">
        {isDragActive && (
          <div className="absolute inset-0 bg-primary/15 border-2 border-dashed border-primary/50 rounded-2xl flex items-center justify-center z-50">
            <div className="bg-card rounded-xl p-4 shadow-lg border border-border/30">
              <svg className="w-8 h-8 text-primary mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
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
              <div key={error} className="truncate">{error}</div>
            ))}
          </div>
        )}

        {showFileDropdown && filteredFiles.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-card/95 backdrop-blur-md border border-border/50 rounded-xl shadow-lg max-h-48 overflow-y-auto z-50">
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                className={`px-4 py-3 cursor-pointer border-b border-border/30 last:border-b-0 touch-manipulation ${
                  index === selectedFileIndex ? 'bg-primary/8 text-primary' : 'hover:bg-accent/50 text-foreground'
                }`}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSelectFile(file); }}
              >
                <div className="font-medium text-sm">{file.name}</div>
                <div className="text-xs text-muted-foreground font-mono">{file.path}</div>
              </div>
            ))}
          </div>
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

        {/* ── Input card ── */}
        <div
          {...getRootProps()}
          className={`relative bg-card/80 backdrop-blur-sm rounded-2xl shadow-sm border border-border/50 focus-within:shadow-md focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/15 transition-all duration-200 overflow-visible ${
            isTextareaExpanded ? 'chat-input-expanded' : ''
          }`}
        >
          <input {...getInputPropsDropzone()} />
          {attachedPrompt && (
            <PromptBadgeDropdown
              prompt={attachedPrompt}
              onRemove={onRemoveAttachedPrompt}
              onUpdate={onUpdateAttachedPrompt}
            />
          )}
          <div ref={inputHighlightRef} aria-hidden="true" className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
            <div className="chat-input-placeholder block w-full pl-4 pr-16 py-1.5 sm:py-4 text-transparent text-base leading-6 whitespace-pre-wrap break-words">
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
              className="chat-input-placeholder block w-full pl-4 pr-16 py-1.5 sm:py-4 bg-transparent rounded-2xl focus:outline-none text-foreground placeholder-muted-foreground/50 disabled:opacity-50 resize-none min-h-[50px] sm:min-h-[60px] max-h-[40vh] sm:max-h-[300px] overflow-y-auto text-base leading-6 transition-all duration-200"
              style={{ height: '50px' }}
            />

            {/* Send button */}
            <button
              type="submit"
              disabled={(!input.trim() && attachedFiles.length === 0 && !attachedPrompt) || isLoading}
              onMouseDown={(event) => { event.preventDefault(); onSubmit(event); }}
              onTouchStart={(event) => { event.preventDefault(); onSubmit(event); }}
              className="absolute right-2 top-3 sm:top-4 w-9 h-9 bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed rounded-xl flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-1 focus:ring-offset-background"
            >
              <svg className="w-4 h-4 text-primary-foreground transform rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>

          {/* ── Unified toolbar below textarea ── */}
          <div className="flex items-center justify-between px-2 py-1.5 border-t border-border/30">
            {/* Left side: + | Skills | Bypass Permissions | Tools */}
            <div className="flex items-center gap-0.5">
              {/* Attachment */}
              <button
                type="button"
                onClick={openFilePicker}
                className="p-1.5 hover:bg-accent/60 rounded-lg transition-colors"
                title={t('input.attachFiles')}
              >
                <Plus className="w-4 h-4 text-muted-foreground" />
              </button>

              {/* Skills menu */}
              <div ref={skillsMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setSkillsMenuOpen(!skillsMenuOpen)}
                  className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-accent/60 rounded-lg transition-colors text-muted-foreground hover:text-foreground"
                >
                  <Sparkles className="w-4 h-4" />
                  <span className="text-xs font-medium hidden sm:inline">Skills</span>
                </button>
                {skillsMenuOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-64 max-h-[320px] bg-popover border border-border rounded-xl shadow-xl overflow-y-auto z-50">
                    <div className="py-1">
                      {SKILLS_SCENARIOS.map((scenario) => (
                        <button
                          key={scenario.id}
                          type="button"
                          onClick={() => injectSkill(scenario)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                        >
                          <span className="text-base leading-none">{scenario.icon}</span>
                          <span className="text-[13px] font-medium text-foreground">{t(scenario.titleKey)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Bypass / Permission mode */}
              <button
                type="button"
                onClick={onModeSwitch}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium border transition-all duration-200 ${
                  permissionMode === 'default'
                    ? 'bg-muted/50 text-muted-foreground border-border/60 hover:bg-muted'
                    : permissionMode === 'acceptEdits'
                      ? 'bg-green-50 dark:bg-green-900/15 text-green-700 dark:text-green-300 border-green-300/60 dark:border-green-600/40 hover:bg-green-100 dark:hover:bg-green-900/25'
                      : permissionMode === 'bypassPermissions'
                        ? 'bg-orange-50 dark:bg-orange-900/15 text-orange-700 dark:text-orange-300 border-orange-300/60 dark:border-orange-600/40 hover:bg-orange-100 dark:hover:bg-orange-900/25'
                        : 'bg-primary/5 text-primary border-primary/20 hover:bg-primary/10'
                }`}
                title={t('input.clickToChangeMode')}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${
                  permissionMode === 'default' ? 'bg-muted-foreground'
                  : permissionMode === 'acceptEdits' ? 'bg-green-500'
                  : permissionMode === 'bypassPermissions' ? 'bg-orange-500'
                  : 'bg-primary'
                }`} />
                <span className="hidden sm:inline">
                  {permissionMode === 'default' && (provider === 'gemini' ? 'Approval' : t('codex.modes.default'))}
                  {permissionMode === 'acceptEdits' && (provider === 'gemini' ? 'Auto Edit' : t('codex.modes.acceptEdits'))}
                  {permissionMode === 'bypassPermissions' && (provider === 'gemini' ? 'YOLO' : t('codex.modes.bypassPermissions'))}
                  {permissionMode === 'plan' && (provider === 'gemini' ? 'Plan' : t('codex.modes.plan'))}
                </span>
              </button>

              {/* Tools (slash commands) */}
              <div ref={toolsMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setToolsMenuOpen(!toolsMenuOpen);
                    onToggleCommandMenu();
                  }}
                  className="relative flex items-center gap-1.5 px-2 py-1.5 hover:bg-accent/60 rounded-lg transition-colors text-muted-foreground hover:text-foreground"
                  title={t('input.showAllCommands')}
                >
                  <Wrench className="w-4 h-4" />
                  <span className="text-xs font-medium hidden sm:inline">Tools</span>
                  {slashCommandsCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                      {slashCommandsCount}
                    </span>
                  )}
                </button>
              </div>

              {/* Token usage */}
              <TokenUsagePie
                used={tokenBudget?.used}
                total={tokenBudget?.total || parseInt(import.meta.env.VITE_CONTEXT_WINDOW) || 160000}
                unsupportedContext={tokenBudget?.unsupportedContext}
                message={tokenBudget?.message}
              />
            </div>

            {/* Right side: Provider | Model | Thinking Mode | mic */}
            <div className="flex items-center gap-0.5">
              {/* Provider selector */}
              {setProvider && (
                <div ref={providerMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setProviderMenuOpen(!providerMenuOpen)}
                    className="flex items-center gap-1.5 px-2 py-1 hover:bg-accent/60 rounded-lg transition-colors"
                  >
                    <SessionProviderLogo provider={provider as SessionProvider} className="w-4 h-4 shrink-0" />
                    <span className="text-xs font-medium text-foreground hidden sm:inline">{currentProviderDef?.name || provider}</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </button>
                  {providerMenuOpen && (
                    <div className="absolute bottom-full right-0 mb-2 w-52 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden">
                      <div className="py-1">
                        {PROVIDERS.map((p) => {
                          const active = provider === p.id;
                          const unavailable = providerAvailability?.[p.id]?.cliAvailable === false;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              disabled={unavailable}
                              onClick={() => handleProviderSelect(p.id)}
                              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                                unavailable ? 'opacity-40 cursor-not-allowed' : 'hover:bg-muted/50'
                              } ${active ? 'bg-primary/8' : ''}`}
                            >
                              <SessionProviderLogo provider={p.id} className="w-4 h-4 shrink-0" />
                              <span className="flex-1 text-[13px] font-medium text-foreground">{p.name}</span>
                              {active && <Check className="w-3.5 h-3.5 text-primary" />}
                              {unavailable && <span className="text-[10px] text-muted-foreground">Not installed</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Model selector */}
              {setProvider && (
                <div ref={modelMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setModelMenuOpen(!modelMenuOpen)}
                    className="flex items-center gap-1 px-2 py-1 hover:bg-accent/60 rounded-lg transition-colors"
                  >
                    <span className="text-xs font-medium text-foreground max-w-[120px] truncate">{currentModelLabel}</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </button>
                  {modelMenuOpen && (
                    <div className="absolute bottom-full right-0 mb-2 w-64 max-h-[320px] bg-popover border border-border rounded-xl shadow-xl overflow-y-auto z-50">
                      <div className="py-1">
                        {modelConfig.OPTIONS.length === 0 ? (
                          <p className="px-3 py-3 text-xs text-muted-foreground text-center">
                            {provider === 'local' ? 'No models — run ollama pull qwen3:8b' : 'No models available'}
                          </p>
                        ) : (
                          modelConfig.OPTIONS.map((m: { value: string; label: string }) => {
                            const active = m.value === currentModel;
                            return (
                              <button
                                key={m.value}
                                type="button"
                                onClick={() => handleModelSelect(m.value)}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors ${active ? 'bg-primary/8' : ''}`}
                              >
                                <span className="w-4 shrink-0">
                                  {active && <Check className="w-3.5 h-3.5 text-primary" />}
                                </span>
                                <span className="text-[13px] font-medium text-foreground">{m.label}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Thinking mode selectors (right of model) */}
              {showClaudeThinking && (
                <ThinkingModeSelector selectedMode={thinkingMode} onModeChange={setThinkingMode} onClose={() => {}} className="" />
              )}
              {showCodexReasoning && (
                <CodexReasoningEffortSelector
                  model={codexModel}
                  selectedEffort={codexReasoningEffort}
                  onEffortChange={setCodexReasoningEffort}
                  onClose={() => {}}
                  className=""
                />
              )}
              {showGeminiThinking && (
                <GeminiThinkingSelector
                  model={geminiModel}
                  selectedMode={geminiThinkingMode}
                  onModeChange={setGeminiThinkingMode}
                  onClose={() => {}}
                  className=""
                />
              )}

              {/* Mic button */}
              <MicButton onTranscript={onTranscript} className="!w-8 !h-8" />
            </div>
          </div>
        </div>

        {/* ── Skill chips below input (only on empty state) ── */}
        {!hasMessages && (
          <div className="flex flex-wrap items-center justify-center gap-2.5 mt-4">
            {PRIMARY_SCENARIOS.map((scenario) => {
              const isActive = selectedChipId === scenario.id;
              return (
                <button
                  key={scenario.id}
                  type="button"
                  onClick={() => injectSkill(scenario)}
                  className={`rounded-full border px-4 py-2.5 transition-colors ${
                    isActive
                      ? 'border-cyan-500/50 bg-cyan-500/12 text-foreground dark:border-cyan-400/70 dark:bg-cyan-400/14 dark:text-white'
                      : 'border-border/70 bg-card/60 text-foreground/80 hover:bg-accent hover:text-foreground dark:border-white/8 dark:bg-white/[0.04] dark:text-white/78 dark:hover:bg-white/[0.08] dark:hover:text-white'
                  }`}
                >
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="text-base leading-none">{scenario.icon}</span>
                    {t(scenario.titleKey)}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {/* Keyboard hint */}
        <div className={`text-center mt-1 text-xs text-muted-foreground/50 transition-opacity duration-200 ${
          input.trim() ? 'opacity-0' : 'opacity-100'
        }`}>
          {sendByCtrlEnter ? t('input.hintText.ctrlEnter') : t('input.hintText.enter')}
        </div>

        {/* Scroll to bottom floating button */}
        {isUserScrolledUp && hasMessages && (
          <button
            type="button"
            onClick={onScrollToBottom}
            className="fixed bottom-24 right-8 w-8 h-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105 z-40"
            title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        )}
      </form>}
    </div>
  );
}
