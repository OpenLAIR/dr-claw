import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  GUIDED_PROMPT_SCENARIOS,
  AUTO_RESEARCH_SCENARIOS,
  type GuidedPromptScenario,
} from '../../constants/guidedPromptScenarios';
import { AUTO_RESEARCH_PACKS, type LocaleKey } from '../../../../constants/autoResearchPacks';
import { api } from '../../../../utils/api';
import type { AttachedPrompt } from '../../types/types';

function resolveLocaleKey(lang: string): LocaleKey {
  if (lang.startsWith('zh')) return 'zh';
  if (lang.startsWith('ko')) return 'ko';
  return 'en';
}

interface GuidedPromptStarterProps {
  projectName: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  setAttachedPrompt?: (prompt: AttachedPrompt | null) => void;
}

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
  return t('guidedStarter.template.intro', {
    scenario: t(scenario.titleKey),
    skills: skills.join(', '),
  });
}

export default function GuidedPromptStarter({
  projectName: _projectName,
  setInput,
  textareaRef,
  setAttachedPrompt,
}: GuidedPromptStarterProps) {
  const { t, i18n } = useTranslation('chat');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [availableSkills, setAvailableSkills] = useState<Set<string> | null>(null);
  const [autoResearchOpen, setAutoResearchOpen] = useState(false);
  const [expandedGuidedPack, setExpandedGuidedPack] = useState<string | null>(null);
  const autoResearchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (autoResearchRef.current && !autoResearchRef.current.contains(e.target as Node)) {
        setAutoResearchOpen(false);
        setExpandedGuidedPack(null);
      }
    };
    if (autoResearchOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [autoResearchOpen]);

  useEffect(() => {
    let cancelled = false;

    const normalize = (value: string) => value.trim().toLowerCase();
    const discovered = new Set<string>();

    const collect = (nodes: SkillTreeNode[]) => {
      for (const node of nodes) {
        if (node.type !== 'directory') {
          continue;
        }
        const hasSkillMd = (node.children || []).some(
          (child) => child.type === 'file' && child.name === 'SKILL.md',
        );
        if (hasSkillMd) {
          discovered.add(normalize(node.name));
        }
        if (Array.isArray(node.children) && node.children.length > 0) {
          collect(node.children);
        }
      }
    };

    const fetchSkills = async () => {
      try {
        const response = await api.getGlobalSkills();
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as SkillTreeNode[];
        collect(payload);
        if (!cancelled && discovered.size > 0) {
          setAvailableSkills(discovered);
        }
      } catch {
        // Keep static list as fallback.
      }
    };

    fetchSkills();
    return () => {
      cancelled = true;
    };
  }, []);

  const injectTemplate = (scenario: GuidedPromptScenario, skills: string[]) => {
    const nextValue = buildTemplate(t, scenario, skills);
    if (setAttachedPrompt) {
      setAttachedPrompt({
        scenarioId: scenario.id,
        scenarioIcon: scenario.icon,
        scenarioTitle: t(scenario.titleKey),
        promptText: nextValue,
      });
      setTimeout(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
      }, 100);
    } else {
      setInput(prev => prev ? `${nextValue}\n\n${prev}` : nextValue);
      setTimeout(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const cursor = el.value.length;
        el.setSelectionRange(cursor, cursor);
      }, 100);
    }
  };

  const handleScenarioSelect = (scenario: GuidedPromptScenario) => {
    setSelectedScenarioId(scenario.id);
    setAutoResearchOpen(false);

    // Auto Research scenarios inject slash command as AttachedPrompt
    if (scenario.slashCommand) {
      if (setAttachedPrompt) {
        setAttachedPrompt({
          scenarioId: scenario.id,
          scenarioIcon: scenario.icon,
          scenarioTitle: t(scenario.titleKey),
          promptText: scenario.slashCommand,
        });
        setTimeout(() => textareaRef.current?.focus(), 100);
      } else {
        setInput((prev: string) => prev ? `${scenario.slashCommand} ${prev}` : `${scenario.slashCommand} `);
        setTimeout(() => textareaRef.current?.focus(), 100);
      }
      return;
    }

    const matchedSkills = availableSkills
      ? scenario.skills.filter((skill) => availableSkills.has(skill.toLowerCase()))
      : [];
    injectTemplate(scenario, matchedSkills.length > 0 ? matchedSkills : scenario.skills);
  };

  return (
    <div className="flex flex-wrap justify-center gap-2.5 max-w-3xl mx-auto px-4 mt-6">
      {/* Auto Research dropdown button — reads from Research Hub packs */}
      <div ref={autoResearchRef} className="relative">
        <button
          type="button"
          onClick={() => setAutoResearchOpen(!autoResearchOpen)}
          className={`rounded-full border px-3 py-2 text-left transition-colors ${
            autoResearchOpen
              ? 'border-purple-500/50 bg-purple-500/12 text-foreground dark:border-purple-400/70 dark:bg-purple-400/14 dark:text-white'
              : 'border-purple-300/50 bg-purple-50/40 text-purple-700 hover:bg-purple-100/60 dark:border-purple-700/40 dark:bg-purple-950/20 dark:text-purple-300 dark:hover:bg-purple-900/30'
          }`}
        >
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <span className="text-sm leading-none">🧪</span>
            Auto Research
            <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={autoResearchOpen ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
            </svg>
          </p>
        </button>
        {autoResearchOpen && (() => {
          const loc = resolveLocaleKey(i18n.language || 'en');
          const COLORS = [
            { dot: 'bg-purple-500', text: 'text-purple-700 dark:text-purple-300', hover: 'hover:bg-purple-50/80 dark:hover:bg-purple-950/30', bg: 'bg-purple-50/50 dark:bg-purple-950/15', border: 'border-purple-200/50 dark:border-purple-800/30' },
            { dot: 'bg-teal-500', text: 'text-teal-700 dark:text-teal-300', hover: 'hover:bg-teal-50/80 dark:hover:bg-teal-950/30', bg: 'bg-teal-50/50 dark:bg-teal-950/15', border: 'border-teal-200/50 dark:border-teal-800/30' },
            { dot: 'bg-blue-500', text: 'text-blue-700 dark:text-blue-300', hover: 'hover:bg-blue-50/80 dark:hover:bg-blue-950/30', bg: 'bg-blue-50/50 dark:bg-blue-950/15', border: 'border-blue-200/50 dark:border-blue-800/30' },
          ];
          return (
            <div className="absolute z-50 top-full mt-1 left-1/2 -translate-x-1/2 w-80 max-h-[420px] bg-popover border border-border rounded-xl shadow-xl overflow-y-auto">
              <div className="px-3 py-2 border-b border-border/50">
                <p className="text-[11px] font-bold text-foreground">Auto Research</p>
              </div>
              {AUTO_RESEARCH_PACKS.map((pack, idx) => {
                const c = COLORS[idx % COLORS.length];
                const isExp = expandedGuidedPack === pack.name;
                return (
                  <div key={pack.name} className={isExp ? c.bg : ''}>
                    <button
                      type="button"
                      onClick={() => setExpandedGuidedPack(isExp ? null : pack.name)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${c.hover}`}
                    >
                      <span className={`h-2 w-2 rounded-full shrink-0 ${c.dot}`} />
                      <span className={`flex-1 text-[12px] font-bold ${c.text}`}>{pack.name}</span>
                      <span className="text-[9px] text-muted-foreground">{pack.workflows.length}</span>
                      <svg className="w-3 h-3 text-muted-foreground shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isExp ? 'M19 9l-7 7-7-7' : 'M9 5l7 7-7 7'} />
                      </svg>
                    </button>
                    {isExp && (
                      <div className={`border-t ${c.border} pb-1`}>
                        {pack.workflows.map((wf) => (
                          <button
                            key={wf.command}
                            type="button"
                            onClick={() => {
                              setAutoResearchOpen(false);
                              setExpandedGuidedPack(null);
                              setSelectedScenarioId(wf.command);
                              if (setAttachedPrompt) {
                                setAttachedPrompt({
                                  scenarioId: `autoresearch-${wf.command}`,
                                  scenarioIcon: '🧪',
                                  scenarioTitle: `${pack.name}: ${wf.name}`,
                                  promptText: wf.command,
                                });
                                setTimeout(() => textareaRef.current?.focus(), 100);
                              } else {
                                setInput((prev: string) => prev ? `${wf.command} ${prev}` : `${wf.command} `);
                                setTimeout(() => textareaRef.current?.focus(), 100);
                              }
                            }}
                            className={`w-full flex items-center gap-2 px-4 py-2 text-left transition-colors ${c.hover}`}
                          >
                            <span className={`h-1 w-1 rounded-full shrink-0 ${c.dot} opacity-50`} />
                            <div className="min-w-0">
                              <span className="text-[11px] font-semibold text-foreground">{wf.name}</span>
                              <span className="ml-1.5 text-[10px] text-muted-foreground">{wf.description[loc]}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* Existing scenario buttons */}
      {GUIDED_PROMPT_SCENARIOS.map((scenario) => {
        const isActive = selectedScenarioId === scenario.id;
        return (
          <button
            key={scenario.id}
            type="button"
            onClick={() => handleScenarioSelect(scenario)}
            className={`rounded-full border px-3 py-2 text-left transition-colors ${
              isActive
                ? 'border-cyan-500/50 bg-cyan-500/12 text-foreground dark:border-cyan-400/70 dark:bg-cyan-400/14 dark:text-white'
                : 'border-border/70 bg-card/60 text-foreground/80 hover:bg-accent hover:text-foreground dark:border-white/8 dark:bg-white/[0.04] dark:text-white/78 dark:hover:bg-white/[0.08] dark:hover:text-white'
            }`}
          >
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <span className="text-sm leading-none">{scenario.icon}</span>
              {t(scenario.titleKey)}
            </p>
          </button>
        );
      })}
    </div>
  );
}
