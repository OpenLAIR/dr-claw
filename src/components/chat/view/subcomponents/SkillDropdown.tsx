import React, { useState } from 'react';
import { Sparkles, ChevronDown } from 'lucide-react';
import WorkbenchDialog from '../../../ui/WorkbenchDialog';
import { Button } from '../../../ui/button';
import type { AttachedPrompt } from '../../types/types';
import { SKILL_CATEGORIES } from '../../constants/skillCategories';

interface SkillDropdownProps {
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  setAttachedPrompt?: (prompt: AttachedPrompt | null) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export default function SkillDropdown({
  setInput,
  textareaRef,
  setAttachedPrompt,
  t,
}: SkillDropdownProps) {
  const [open, setOpen] = useState(false);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const inject = (prompt: string, icon: string, title: string, categoryKey: string) => {
    if (setAttachedPrompt) {
      setAttachedPrompt({
        scenarioId: `skill-${categoryKey}`,
        scenarioIcon: icon,
        scenarioTitle: title,
        promptText: prompt,
      });
      setTimeout(() => textareaRef.current?.focus(), 100);
    } else {
      setInput((prev: string) => prev ? `${prompt}\n\n${prev}` : prompt);
      setTimeout(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
      }, 100);
    }
    setOpen(false);
    setExpandedCat(null);
  };

  return (
    <div>
      <Button type="button" variant="outline" size="sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <Sparkles className="h-4 w-4" />{t('skillShortcuts.title')}<ChevronDown className="h-3 w-3" />
      </Button>

      {open && (
        <WorkbenchDialog title={t('skillShortcuts.title')} onClose={() => { setOpen(false); setExpandedCat(null); }}>
          {SKILL_CATEGORIES.map((cat) => {
            const isExpanded = expandedCat === cat.key;
            return (
              <div key={cat.key} className="border-b border-border">
                <button
                  type="button"
                  aria-expanded={isExpanded} onClick={() => setExpandedCat(isExpanded ? null : cat.key)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    isExpanded ? 'bg-muted text-foreground font-medium' : 'hover:bg-muted/50 text-muted-foreground'
                  }`}
                >

                  <span className="flex-1">{t(`skillShortcuts.categories.${cat.key}`)}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{cat.skills.length}</span>
                </button>
                {isExpanded && (
                  <div className="px-3 pb-2">
                    <div className="flex flex-wrap gap-1">
                      {cat.skills.map((skill) => (
                        <button
                          key={skill}
                          type="button"
                          onClick={() => inject(
                            t('skillShortcuts.promptSingle', { skill }),
                            cat.icon,
                            t(`skillShortcuts.categories.${cat.key}`),
                            cat.key,
                          )}
                          className="px-2 py-2 text-sm font-medium rounded-md border border-border/50 bg-background hover:bg-muted hover:border-border transition-colors text-foreground"
                        >
                          {skill}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => inject(
                        t('skillShortcuts.promptMulti', { skills: cat.skills.join(', ') }),
                        cat.icon,
                        t(`skillShortcuts.categories.${cat.key}`),
                        cat.key,
                      )}
                      className="mt-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                      {t('skillShortcuts.useAll')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </WorkbenchDialog>
      )}
    </div>
  );
}
