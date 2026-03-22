import React from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SessionProviderLogo from '../../../SessionProviderLogo';
import { CLAUDE_MODELS, CURSOR_MODELS, CODEX_MODELS, GEMINI_MODELS } from '../../../../../shared/modelConstants';
import type { ProjectSession, SessionMode, SessionProvider } from '../../../../types/app';
import GuidedPromptStarter from './GuidedPromptStarter';
import type { AttachedPrompt, ProviderAvailability } from '../../types/types';

interface ProviderSelectionEmptyStateProps {
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: SessionProvider;
  setProvider: (next: SessionProvider) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  claudeModel: string;
  setClaudeModel: (model: string) => void;
  cursorModel: string;
  setCursorModel: (model: string) => void;
  codexModel: string;
  setCodexModel: (model: string) => void;
  geminiModel: string;
  setGeminiModel: (model: string) => void;
  projectName: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  setAttachedPrompt?: (prompt: AttachedPrompt | null) => void;
  providerAvailability: Record<SessionProvider, ProviderAvailability>;
  newSessionMode: SessionMode;
  onNewSessionModeChange?: (mode: SessionMode) => void;
}

type ProviderDef = {
  id: SessionProvider;
  name: string;
  infoKey: string;
  accent: string;
  ring: string;
  check: string;
};

const PROVIDERS: ProviderDef[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    infoKey: 'providerSelection.providerInfo.anthropic',
    accent: 'border-primary',
    ring: 'ring-primary/15',
    check: 'bg-primary text-primary-foreground',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    infoKey: 'providerSelection.providerInfo.google',
    accent: 'border-blue-500 dark:border-blue-400',
    ring: 'ring-blue-500/15',
    check: 'bg-blue-500 text-white',
  },
  // Cursor temporarily hidden — will re-add when content is ready
  // {
  //   id: 'cursor',
  //   name: 'Cursor',
  //   infoKey: 'providerSelection.providerInfo.cursorEditor',
  //   accent: 'border-violet-500 dark:border-violet-400',
  //   ring: 'ring-violet-500/15',
  //   check: 'bg-violet-500 text-white',
  // },
  {
    id: 'codex',
    name: 'Codex',
    infoKey: 'providerSelection.providerInfo.openai',
    accent: 'border-emerald-600 dark:border-emerald-400',
    ring: 'ring-emerald-600/15',
    check: 'bg-emerald-600 dark:bg-emerald-500 text-white',
  },
];

function getModelConfig(p: SessionProvider) {
  if (p === 'claude') return CLAUDE_MODELS;
  if (p === 'codex') return CODEX_MODELS;
  if (p === 'gemini') return GEMINI_MODELS;
  return CURSOR_MODELS;
}

function getModelValue(p: SessionProvider, c: string, cu: string, co: string, g: string) {
  if (p === 'claude') return c;
  if (p === 'codex') return co;
  if (p === 'gemini') return g;
  return cu;
}

export default function ProviderSelectionEmptyState({
  selectedSession,
  currentSessionId,
  provider,
  setProvider,
  textareaRef,
  claudeModel,
  setClaudeModel,
  cursorModel,
  setCursorModel,
  codexModel,
  setCodexModel,
  geminiModel,
  setGeminiModel,
  projectName,
  setInput,
  setAttachedPrompt,
  providerAvailability,
  newSessionMode,
  onNewSessionModeChange,
}: ProviderSelectionEmptyStateProps) {
  const { t } = useTranslation('chat');

  const sessionModeChoices: Array<{ id: SessionMode; titleKey: string; descriptionKey: string }> = [
    {
      id: 'research',
      titleKey: 'session.mode.researchTitle',
      descriptionKey: 'session.mode.researchDescription',
    },
    {
      id: 'workspace_qa',
      titleKey: 'session.mode.workspaceQaTitle',
      descriptionKey: 'session.mode.workspaceQaDescription',
    },
  ];

  const selectProvider = (next: SessionProvider) => {
    if (providerAvailability[next]?.cliAvailable === false) {
      return;
    }

    setProvider(next);
    localStorage.setItem('selected-provider', next);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleModelChange = (value: string) => {
    if (provider === 'claude') { setClaudeModel(value); localStorage.setItem('claude-model', value); }
    else if (provider === 'codex') { setCodexModel(value); localStorage.setItem('codex-model', value); }
    else if (provider === 'gemini') { setGeminiModel(value); localStorage.setItem('gemini-model', value); }
    else { setCursorModel(value); localStorage.setItem('cursor-model', value); }
  };

  const modelConfig = getModelConfig(provider);
  const currentModel = getModelValue(provider, claudeModel, cursorModel, codexModel, geminiModel);
  const readyPromptKey =
    provider === 'claude'
      ? 'providerSelection.readyPrompt.claude'
      : provider === 'codex'
        ? 'providerSelection.readyPrompt.codex'
        : provider === 'gemini'
          ? 'providerSelection.readyPrompt.gemini'
          : provider === 'cursor'
            ? 'providerSelection.readyPrompt.cursor'
            : 'providerSelection.readyPrompt.default';

  if (!selectedSession && !currentSessionId) {
    return (
      <div className="flex items-center justify-center min-h-[56vh] px-4 py-8">
        <div className="w-full max-w-2xl">
          <div className="max-w-2xl mx-auto">
            <div className="max-w-2xl mx-auto mb-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-[11px] sm:text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground/75">
                  {t('session.mode.title')}
                </h2>
                <span className="rounded-full border border-border/70 bg-card/70 px-2 py-1 text-[10px] font-medium text-muted-foreground">
                  2 modes
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground/75 mb-3">
                {t('session.mode.subtitle')}
              </p>

              <div className="grid items-start gap-2 sm:grid-cols-2">
                {sessionModeChoices.map((choice) => {
                  const active = newSessionMode === choice.id;
                  const tone = choice.id === 'research'
                    ? 'from-sky-500/14 to-cyan-500/8 dark:from-sky-400/14 dark:to-cyan-400/8'
                    : 'from-emerald-500/14 to-teal-500/8 dark:from-emerald-400/14 dark:to-teal-400/8';
                  const accent = choice.id === 'research'
                    ? 'text-sky-700 dark:text-sky-300'
                    : 'text-emerald-700 dark:text-emerald-300';
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      onClick={() => onNewSessionModeChange?.(choice.id)}
                      className={`group h-full rounded-xl border px-3.5 py-3 align-top text-left transition-all duration-150 ${active
                        ? 'border-primary/60 bg-card shadow-sm ring-1 ring-primary/10'
                        : 'border-border/70 bg-card/45 hover:border-border hover:bg-card/80'
                      }`}
                    >
                      <div className="flex h-full items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 self-start">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex h-2.5 w-2.5 rounded-full bg-gradient-to-br ${tone}`} />
                            <p className="text-sm font-semibold text-foreground leading-none">
                              {t(choice.titleKey)}
                            </p>
                          </div>
                          <p className={`mt-2 text-[11px] font-medium ${accent}`}>
                            {choice.id === 'research' ? t('session.mode.research') : t('session.mode.workspaceQa')}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {t(choice.descriptionKey)}
                          </p>
                        </div>
                        <span className={`mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border transition-all ${active
                          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                          : 'border-border/80 bg-background text-transparent group-hover:border-primary/40'
                        }`}>
                          <Check className="w-3 h-3" strokeWidth={3} />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {newSessionMode === 'research' && (
              <GuidedPromptStarter
                projectName={projectName}
                setInput={setInput}
                textareaRef={textareaRef}
                setAttachedPrompt={setAttachedPrompt}
              />
            )}

            <div className="max-w-xl mx-auto mt-8 sm:mt-10">
              <div className="text-center mb-3">
                <h2 className="text-[11px] sm:text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground/75">
                  {t('providerSelection.title')}
                </h2>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5 mb-3">
                {PROVIDERS.map((p) => {
                  const active = provider === p.id;
                  const unavailable = providerAvailability[p.id]?.cliAvailable === false;
                  const unavailableReason = providerAvailability[p.id]?.installHint
                    || t('providerSelection.installRequired', { provider: p.name });

                  return (
                    <button
                      key={p.id}
                      onClick={() => selectProvider(p.id)}
                      type="button"
                      disabled={unavailable}
                      title={unavailable ? unavailableReason : undefined}
                      className={`
                        relative flex items-center justify-center gap-2 px-3 py-2
                        rounded-full border transition-all duration-150
                        ${unavailable
                          ? 'border-border/60 bg-muted/25 opacity-45 cursor-not-allowed grayscale'
                          : 'active:scale-[0.97]'
                        }
                        ${!unavailable && active
                          ? `${p.accent} ${p.ring} ring-1 bg-card/90 shadow-sm`
                          : !unavailable
                            ? 'border-border/70 bg-card/35 hover:bg-card/55 hover:border-border'
                            : ''
                        }
                      `}
                    >
                      <SessionProviderLogo
                        provider={p.id}
                        className={`w-[18px] h-[18px] shrink-0 transition-transform duration-150 ${active ? 'scale-105' : ''}`}
                      />
                      <div className="flex flex-col items-start text-left">
                        <p className="text-[11px] font-medium text-foreground leading-none">{p.name}</p>
                        {unavailable && (
                          <p className="text-[9px] text-muted-foreground leading-none mt-1">
                            {t('providerSelection.notInstalled')}
                          </p>
                        )}
                      </div>
                      {active && (
                        <div className={`absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ${p.check} flex items-center justify-center shadow-sm`}>
                          <Check className="w-2 h-2" strokeWidth={3} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className={`transition-all duration-200 ${provider ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 pointer-events-none'}`}>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="text-[11px] text-muted-foreground">{t('providerSelection.selectModel')}</span>
                  <div className="relative">
                    <select
                      value={currentModel}
                      onChange={(e) => handleModelChange(e.target.value)}
                      tabIndex={-1}
                      className="bg-transparent pl-3 pr-6 py-1 text-[11px] font-medium border border-border/60 rounded-lg text-foreground cursor-pointer hover:bg-muted/40 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      {modelConfig.OPTIONS.map(({ value, label }: { value: string; label: string }) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <p className="text-center text-[10px] text-muted-foreground/60">
                  {t(readyPromptKey, { model: currentModel })}
                </p>
                {newSessionMode === 'workspace_qa' && (
                  <p className="text-center text-[10px] text-muted-foreground/60 mt-1.5">
                    {t('session.mode.workspaceQaHint')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (selectedSession) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center px-6 max-w-2xl">
          <div className="max-w-md mx-auto">
            <p className="text-lg font-semibold text-foreground mb-1.5">{t('session.continue.title')}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{t('session.continue.description')}</p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
