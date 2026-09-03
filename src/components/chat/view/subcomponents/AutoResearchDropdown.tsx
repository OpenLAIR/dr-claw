import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, ChevronRight, FlaskConical, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AUTO_RESEARCH_PACKS, type LocaleKey } from '../../../../constants/autoResearchPacks';
import { emitAutoresearchEvent } from '../../../../utils/autoresearchTelemetry';
import type { AttachedPrompt } from '../../types/types';

function resolveLocaleKey(lang: string): LocaleKey {
  if (lang.startsWith('zh')) return 'zh';
  if (lang.startsWith('ko')) return 'ko';
  return 'en';
}

// Distinct accent per pack index
const PACK_COLORS = [
  { dot: 'bg-purple-500', text: 'text-purple-700 dark:text-purple-300', bg: 'bg-purple-50/60 dark:bg-purple-950/20', hoverBg: 'hover:bg-purple-50/80 dark:hover:bg-purple-950/30', border: 'border-purple-200/60 dark:border-purple-800/30' },
  { dot: 'bg-teal-500', text: 'text-teal-700 dark:text-teal-300', bg: 'bg-teal-50/60 dark:bg-teal-950/20', hoverBg: 'hover:bg-teal-50/80 dark:hover:bg-teal-950/30', border: 'border-teal-200/60 dark:border-teal-800/30' },
  { dot: 'bg-blue-500', text: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50/60 dark:bg-blue-950/20', hoverBg: 'hover:bg-blue-50/80 dark:hover:bg-blue-950/30', border: 'border-blue-200/60 dark:border-blue-800/30' },
  { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50/60 dark:bg-amber-950/20', hoverBg: 'hover:bg-amber-50/80 dark:hover:bg-amber-950/30', border: 'border-amber-200/60 dark:border-amber-800/30' },
];

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
  const { i18n } = useTranslation();
  const locale = useMemo(() => resolveLocaleKey(i18n.language || 'en'), [i18n.language]);
  const [open, setOpen] = useState(false);
  const [expandedPack, setExpandedPack] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setExpandedPack(null);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const select = (command: string, packName: string, wfName: string) => {
    emitAutoresearchEvent('autoresearch_workflow_selected', {
      pack: packName,
      workflow_name: wfName,
      command,
      source: 'chat-dropdown',
    });
    if (setAttachedPrompt) {
      setAttachedPrompt({
        scenarioId: `autoresearch-${command}`,
        scenarioIcon: '🧪',
        scenarioTitle: `${packName}: ${wfName}`,
        promptText: command,
      });
    } else {
      setInput((prev: string) => prev ? `${command} ${prev}` : `${command} `);
    }
    setTimeout(() => textareaRef.current?.focus(), 100);
    setOpen(false);
    setExpandedPack(null);
  };

  const togglePackExpanded = (packName: string, isExpanded: boolean) => {
    emitAutoresearchEvent('autoresearch_pack_expanded', {
      pack: packName,
      expanded: !isExpanded,
      source: 'chat-dropdown',
    });
    setExpandedPack(isExpanded ? null : packName);
  };

  const toggleDropdown = () => {
    const willOpen = !open;
    emitAutoresearchEvent('autoresearch_dropdown_toggled', {
      open: willOpen,
      source: 'chat-dropdown',
    });
    setOpen(willOpen);
    if (!willOpen) setExpandedPack(null);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggleDropdown}
        data-telemetry-id="autoresearch-dropdown-toggle"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-purple-300/50 text-[11px] font-medium text-purple-600 hover:text-purple-700 hover:bg-purple-50/60 dark:border-purple-700/40 dark:text-purple-400 dark:hover:text-purple-300 dark:hover:bg-purple-950/30 transition-all duration-150"
      >
        <FlaskConical className="w-3 h-3" />
        <span>Auto Research</span>
        <svg className="w-3 h-3 opacity-60 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={open ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 bottom-full mb-1 left-0 w-80 max-h-[420px] bg-popover border border-border rounded-xl shadow-xl overflow-y-auto">
          {/* Header */}
          <div className="px-3 py-2 border-b border-border/50">
            <p className="text-[11px] font-bold text-foreground">Auto Research</p>
            <p className="text-[9px] text-muted-foreground">
              {locale === 'zh' ? '选择工具包和工作流，然后输入研究主题' : 'Pick a pack & workflow, then type your topic'}
            </p>
          </div>

          {/* Packs */}
          {AUTO_RESEARCH_PACKS.map((pack, idx) => {
            const color = PACK_COLORS[idx % PACK_COLORS.length];
            const isExpanded = expandedPack === pack.name;

            return (
              <div key={pack.name} className={isExpanded ? color.bg : ''}>
                {/* Pack header — click to expand/collapse */}
                <button
                  type="button"
                  onClick={() => togglePackExpanded(pack.name, isExpanded)}
                  data-telemetry-id={`autoresearch-dropdown-pack-${pack.name}`}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${color.hoverBg}`}
                >
                  <span className={`h-2 w-2 rounded-full shrink-0 ${color.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[12px] font-bold ${color.text}`}>{pack.name}</span>
                      {pack.mcp.length > 0 && (
                        <span className="rounded-full bg-amber-100/80 px-1.5 py-px text-[8px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          {locale === 'zh' ? '需配置' : 'Setup'}
                        </span>
                      )}
                      {pack.mcp.length === 0 && (
                        <span className="rounded-full bg-green-100/80 px-1.5 py-px text-[8px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300">
                          {locale === 'zh' ? '即用' : 'Ready'}
                        </span>
                      )}
                    </div>
                    <p className="text-[9px] text-muted-foreground truncate">{pack.description[locale]}</p>
                  </div>
                  {isExpanded
                    ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                    : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                </button>

                {/* Expanded workflows */}
                {isExpanded && (
                  <div className={`border-t ${color.border} pb-1`}>
                    {pack.workflows.map((wf) => (
                      <button
                        key={wf.command}
                        type="button"
                        onClick={() => select(wf.command, pack.name, wf.name)}
                        data-telemetry-id={`autoresearch-dropdown-workflow-${pack.name}-${wf.command}`}
                        className={`w-full flex items-center gap-2 px-4 py-2 text-left transition-colors ${color.hoverBg}`}
                      >
                        <span className={`h-1 w-1 rounded-full shrink-0 ${color.dot} opacity-50`} />
                        <div className="flex-1 min-w-0">
                          <span className="text-[11px] font-semibold text-foreground">{wf.name}</span>
                          <span className="ml-1.5 text-[10px] text-muted-foreground">{wf.description[locale]}</span>
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
              onClick={() => {
                emitAutoresearchEvent('autoresearch_hub_opened', { source: 'chat-dropdown-configure' });
                setOpen(false);
                setExpandedPack(null);
                onNavigateToHub();
              }}
              data-telemetry-id="autoresearch-dropdown-goto-hub"
              className="w-full flex items-center gap-2 px-3 py-2.5 border-t border-border/50 text-[11px] font-medium text-purple-600 hover:bg-purple-50/40 dark:text-purple-400 dark:hover:bg-purple-950/20 transition-colors"
            >
              <Settings className="w-3 h-3" />
              {locale === 'zh' ? '在 Research Hub 中配置' : 'Configure in Research Hub'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
