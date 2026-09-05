import React, { useState, useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface ModelSelectorOption {
  value: string;
  label: string;
  description?: string;
  deprecated?: boolean;
}

interface ModelSelectorProps {
  value: string;
  options: ModelSelectorOption[];
  /**
   * Entries kept out of the main list (the compiled-in table, once the harness
   * has reported its own menu). Reachable behind a toggle so nothing is lost,
   * but not in the way.
   */
  moreOptions?: ModelSelectorOption[];
  onChange: (v: string) => void;
}

export default function ModelSelector({
  value,
  options,
  moreOptions = [],
  onChange,
}: ModelSelectorProps) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const displayLabel = [...options, ...moreOptions].find((o) => o.value === value)?.label || value;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const renderOption = (opt: ModelSelectorOption) => {
    const active = opt.value === value;
    return (
      <button
        key={opt.value}
        type="button"
        title={opt.description || opt.value}
        onClick={() => { onChange(opt.value); setOpen(false); }}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors ${
          active
            ? 'bg-primary/8 text-foreground font-medium'
            : 'hover:bg-muted/50 text-muted-foreground'
        }`}
      >
        <span className="flex-1 truncate">{opt.label}</span>
        {opt.deprecated && (
          <span className="text-[9px] text-muted-foreground/60 shrink-0">{t('modelSelector.notInCliList')}</span>
        )}
        {active && <Check className="w-3 h-3 text-primary shrink-0" />}
      </button>
    );
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/50 text-[11px] font-medium text-foreground hover:bg-muted/40 transition-all duration-150"
      >
        <svg className="w-3 h-3 text-muted-foreground shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <span className="truncate max-w-[8rem]">{displayLabel}</span>
        <svg className="w-3 h-3 text-muted-foreground/60 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 bottom-full mb-1 left-0 w-52 max-h-[280px] bg-popover border border-border rounded-xl shadow-xl overflow-y-auto">
          {options.map(renderOption)}
          {moreOptions.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowMore((v) => !v)}
                className="w-full px-3 py-1.5 text-left text-[10px] text-muted-foreground/70 hover:bg-muted/50 border-t border-border/50"
              >
                {showMore
                  ? t('modelSelector.hideBuiltIn')
                  : t('modelSelector.showBuiltIn', { count: moreOptions.length })}
              </button>
              {showMore && moreOptions.map(renderOption)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
