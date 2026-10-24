import { ComposerToolsContext } from './ComposerMoreTools';
import React, { useContext, useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, FlaskConical, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AUTO_RESEARCH_PACKS, type LocaleKey } from '../../../../constants/autoResearchPacks';
import WorkbenchDialog from '../../../ui/WorkbenchDialog';
import { Button } from '../../../ui/button';
import type { AttachedPrompt } from '../../types/types';

function resolveLocaleKey(lang: string): LocaleKey {
  if (lang.startsWith('zh')) return 'zh';
  if (lang.startsWith('ko')) return 'ko';
  return 'en';
}

interface AutoResearchDropdownProps {
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  setAttachedPrompt?: (prompt: AttachedPrompt | null) => void;
  onNavigateToHub?: () => void;
}

export default function AutoResearchDropdown({
  setInput,
  textareaRef,
  setAttachedPrompt,
  onNavigateToHub,
}: AutoResearchDropdownProps) {
  const { t, i18n } = useTranslation('chat');
  const locale = useMemo(() => resolveLocaleKey(i18n.language || 'en'), [i18n.language]);
  const [open, setOpen] = useState(false);
  const closeTools = useContext(ComposerToolsContext);
  const [expandedPack, setExpandedPack] = useState<string | null>(null);
  const select = (command: string, packName: string, wfName: string) => {
    if (setAttachedPrompt) {
      setAttachedPrompt({
        scenarioId: `autoresearch-${command}`,
        scenarioIcon: '',
        scenarioTitle: `${packName}: ${wfName}`,
        promptText: command,
      });
    } else {
      setInput((prev: string) => prev ? `${command} ${prev}` : `${command} `);
    }
    setTimeout(() => textareaRef.current?.focus(), 100);
    setOpen(false);
    closeTools();
    setExpandedPack(null);
  };

  return (
    <div>
      <Button type="button" variant="outline" size="sm" className="min-h-11 px-2 lg:min-h-8" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <FlaskConical className="h-4 w-4" />{t('autoResearchPicker.title')}<ChevronDown className="h-3 w-3" />
      </Button>

      {open && (
        <WorkbenchDialog title={t('autoResearchPicker.title')} onClose={() => { setOpen(false); setExpandedPack(null); }}>
          {/* Header */}
          <div className="px-3 py-2 border-b border-border/50">

            <p className="text-xs text-muted-foreground">
              {t('autoResearchPicker.description')}
            </p>
          </div>

          {/* Packs */}
          {AUTO_RESEARCH_PACKS.map((pack) => {
            const isExpanded = expandedPack === pack.name;

            return (
              <div key={pack.name} className="border-b border-border">
                {/* Pack header — click to expand/collapse */}
                <button
                  type="button"
                  onClick={() => setExpandedPack(isExpanded ? null : pack.name)}
                  aria-expanded={isExpanded} className="w-full flex items-center gap-2.5 px-3 py-3 text-left hover:bg-muted"
                >

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground">{pack.name}</span>
                      {pack.mcp.length > 0 && (
                        <span className="rounded-full bg-amber-100/80 px-1.5 py-px text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          {t('autoResearchPicker.setup')}
                        </span>
                      )}
                      {pack.mcp.length === 0 && (
                        <span className="rounded-full bg-green-100/80 px-1.5 py-px text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300">
                          {t('autoResearchPicker.ready')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground ">{pack.description[locale]}</p>
                  </div>
                  {isExpanded
                    ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                    : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                </button>

                {/* Expanded workflows */}
                {isExpanded && (
                  <div className="border-t border-border pb-1">
                    {pack.workflows.map((wf) => (
                      <button
                        key={wf.command}
                        type="button"
                        onClick={() => select(wf.command, pack.name, wf.name)}
                        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted"
                      >

                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-semibold text-foreground">{wf.name}</span>
                          <span className="ml-1.5 text-xs text-muted-foreground">{wf.description[locale]}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Configure link */}
          {onNavigateToHub && (
            <button
              type="button"
              onClick={() => { setOpen(false); setExpandedPack(null); onNavigateToHub(); }}
              className="w-full flex items-center gap-2 px-3 py-3 text-sm font-medium hover:bg-muted"
            >
              <Settings className="w-3 h-3" />
              {t('autoResearchPicker.configure')}
            </button>
          )}
        </WorkbenchDialog>
      )}
    </div>
  );
}
