import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SkillShortcutsPanelProps {
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}

interface SkillCategory {
  key: string;
  icon: string;
  skills: string[];
}

const CATEGORIES: SkillCategory[] = [
  { key: 'deepResearch', icon: '🔍', skills: ['inno-deep-research', 'gemini-deep-research', 'academic-researcher', 'biorxiv-database', 'dataset-discovery', 'inno-code-survey'] },
  { key: 'ideation', icon: '💡', skills: ['inno-idea-generation', 'inno-idea-eval', 'brainstorming-research-ideas', 'creative-thinking-for-research'] },
  { key: 'pipeline', icon: '🗺️', skills: ['inno-pipeline-planner'] },
  { key: 'experiment', icon: '🧪', skills: ['inno-experiment-dev', 'inno-experiment-analysis', 'bioinformatics-init-analysis', 'inno-prepare-resources'] },
  { key: 'paperWriting', icon: '✏️', skills: ['inno-paper-writing', 'scientific-writing', 'ml-paper-writing', 'inno-figure-gen', 'inno-humanizer'] },
  { key: 'paperReview', icon: '📋', skills: ['inno-paper-reviewer', 'inno-rebuttal', 'inno-reference-audit', 'inno-rclone-to-overleaf'] },
  { key: 'grantWriting', icon: '📝', skills: ['inno-grant-proposal'] },
  { key: 'promotion', icon: '🎬', skills: ['making-academic-presentations'] },
];

export default function SkillShortcutsPanel({
  setInput,
  textareaRef,
}: SkillShortcutsPanelProps) {
  const { t } = useTranslation('chat');
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const inject = (prompt: string) => {
    const currentValue = textareaRef.current?.value || '';
    const newValue = currentValue ? `${currentValue}\n\n${prompt}` : prompt;
    setInput(newValue);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleSkillClick = (skill: string) => {
    inject(t('skillShortcuts.promptSingle', { skill }));
  };

  const handleUseAll = (category: SkillCategory) => {
    inject(t('skillShortcuts.promptMulti', { skills: category.skills.join(', ') }));
  };

  return (
    <div className="relative w-full mt-2 mb-2">
      {!isCollapsed && <div className="absolute bottom-full left-0 right-0 z-20 mb-2 rounded-xl border border-border/60 bg-card/95 shadow-xl backdrop-blur">
        <div className="px-4 pt-4 pb-3">
        <div className="grid grid-cols-3 gap-2">
          {CATEGORIES.map((cat) => {
            const isExpanded = expandedCategory === cat.key;
            return (
              <button
                key={cat.key}
                onClick={() => setExpandedCategory(isExpanded ? null : cat.key)}
                className={`
                  flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-left transition-all duration-150
                  ${isExpanded
                    ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/10'
                    : 'border-border/50 bg-card/60 hover:bg-card hover:border-border/80'
                  }
                `}
              >
                <span className="text-sm leading-none flex-shrink-0">{cat.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground leading-snug">
                    {t(`skillShortcuts.categories.${cat.key}`)}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                    {cat.skills.length} skills
                  </p>
                </div>
                <ChevronDown className={`w-3 h-3 text-muted-foreground flex-shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
            );
          })}
        </div>

        {expandedCategory && (() => {
          const cat = CATEGORIES.find((c) => c.key === expandedCategory);
          if (!cat) return null;
          return (
            <div className="mt-3 p-3 rounded-xl border border-border/40 bg-muted/30">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-sm font-medium text-foreground">
                  {cat.icon} {t(`skillShortcuts.categories.${cat.key}`)}
                </span>
                <button
                  onClick={() => handleUseAll(cat)}
                  className="text-xs font-medium text-primary hover:text-primary/80 transition-colors px-2.5 py-1 rounded-lg hover:bg-primary/5"
                >
                  {t('skillShortcuts.useAll')}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {cat.skills.map((skill) => (
                  <button
                    key={skill}
                    onClick={() => handleSkillClick(skill)}
                    className="px-3 py-1.5 text-xs font-medium rounded-full border border-border/50 bg-background hover:bg-muted hover:border-border transition-colors text-foreground"
                  >
                    {skill}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
        </div>
      </div>}

      <div className="rounded-xl border border-border/50 bg-card/60">
        <button
          onClick={() => setIsCollapsed((c) => !c)}
          className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-xl"
        >
          <h3 className="text-base font-semibold text-foreground">
            {t('skillShortcuts.title')}
          </h3>
          {isCollapsed ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
      </div>
    </div>
  );
}
