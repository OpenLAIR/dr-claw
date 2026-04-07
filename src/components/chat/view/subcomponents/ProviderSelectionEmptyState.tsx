import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Check, Search, Plus, X, Compass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SessionProviderLogo from '../../../SessionProviderLogo';
import { CLAUDE_MODELS, CURSOR_MODELS, CODEX_MODELS, GEMINI_MODELS, LOCAL_MODELS, OPENROUTER_MODELS } from '../../../../../shared/modelConstants';
import { authenticatedFetch } from '../../../../utils/api';
import { useAuth } from '../../../../contexts/AuthContext';
import { api } from '../../../../utils/api';
import {
  GUIDED_PROMPT_SCENARIOS,
  type GuidedPromptScenario,
} from '../../constants/guidedPromptScenarios';
import type { ProjectSession, SessionMode, SessionProvider } from '../../../../types/app';
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
  openrouterModel: string;
  setOpenrouterModel: (model: string) => void;
  localModel: string;
  setLocalModel: (model: string) => void;
  projectName: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  setAttachedPrompt?: (prompt: AttachedPrompt | null) => void;
  providerAvailability: Record<SessionProvider, ProviderAvailability>;
  newSessionMode: SessionMode;
  onNewSessionModeChange?: (mode: SessionMode) => void;
}

/* ── Primary skill chips shown below the greeting ── */
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

function buildTemplate(
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

export default function ProviderSelectionEmptyState({
  selectedSession,
  currentSessionId,
  provider,
  textareaRef,
  projectName,
  setInput,
  setAttachedPrompt,
}: ProviderSelectionEmptyStateProps) {
  const { t } = useTranslation('chat');
  const { user } = useAuth();
  const username = (user as { username?: string } | null)?.username ?? null;
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [availableSkills, setAvailableSkills] = useState<Set<string> | null>(null);
  const autoSelectedRef = useRef(false);

  /* Fetch available skills */
  useEffect(() => {
    let cancelled = false;
    const normalize = (value: string) => value.trim().toLowerCase();
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

  const injectTemplate = useCallback(
    (scenario: GuidedPromptScenario, skills: string[]) => {
      const nextValue = buildTemplate(t, scenario, skills);
      if (setAttachedPrompt) {
        setAttachedPrompt({
          scenarioId: scenario.id,
          scenarioIcon: scenario.icon,
          scenarioTitle: t(scenario.titleKey),
          promptText: nextValue,
        });
        setTimeout(() => textareaRef.current?.focus(), 100);
      } else {
        setInput((prev) => (prev ? `${nextValue}\n\n${prev}` : nextValue));
        setTimeout(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          const cursor = el.value.length;
          el.setSelectionRange(cursor, cursor);
        }, 100);
      }
    },
    [t, setAttachedPrompt, setInput, textareaRef],
  );

  /* Auto-select "Start a Project" on mount */
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (selectedSession || currentSessionId) return;

    const startProject = GUIDED_PROMPT_SCENARIOS.find((s) => s.id === 'start-full-project');
    if (!startProject) return;

    autoSelectedRef.current = true;
    setSelectedScenarioId(startProject.id);

    const matchedSkills = availableSkills
      ? startProject.skills.filter((skill) => availableSkills.has(skill.toLowerCase()))
      : [];
    injectTemplate(startProject, matchedSkills.length > 0 ? matchedSkills : startProject.skills);
  }, [availableSkills, currentSessionId, injectTemplate, selectedSession]);

  const handleScenarioSelect = (scenario: GuidedPromptScenario) => {
    setSelectedScenarioId(scenario.id);
    const matchedSkills = availableSkills
      ? scenario.skills.filter((skill) => availableSkills.has(skill.toLowerCase()))
      : [];
    injectTemplate(scenario, matchedSkills.length > 0 ? matchedSkills : scenario.skills);
  };

  /* ── New session: Gemini-style centered greeting + skill chips ── */
  if (!selectedSession && !currentSessionId) {
    return (
      <div className="flex items-center justify-center px-4 py-4">
        <div className="w-full max-w-2xl flex flex-col items-center">
          {/* Greeting */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="mb-4 flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 via-sky-500 to-emerald-400 flex items-center justify-center shadow-[0_8px_24px_rgba(34,211,238,0.25)]">
              <Compass className="w-5 h-5 text-white" />
            </div>
            {username && (
              <p className="text-base font-medium text-foreground/70 dark:text-white/70">
                {t('guidedStarter.greeting', { username })}
              </p>
            )}
            <p className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground dark:text-white mt-1">
              {t('guidedStarter.title')}
            </p>
          </div>

          {/* Skill chips moved to ChatComposer toolbar area */}
        </div>
      </div>
    );
  }

  /* ── Existing session: continue prompt ── */
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
