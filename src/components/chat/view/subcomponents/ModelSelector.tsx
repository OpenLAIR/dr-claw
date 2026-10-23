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
  onChange: (v: string) => void;
}

export default function ModelSelector({
  value,
  options,
  onChange,
}: ModelSelectorProps) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const displayLabel = options.find((o) => o.value === value)?.label || value;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handler);
      containerRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    }
    return () => {
      document.removeEventListener('mousedown', handler);
    };
  }, [open]);

  const renderOption = (opt: ModelSelectorOption) => {
    const active = opt.value === value;
    return (
      <button
        key={opt.value}
        type="button"
        role="option"
        aria-selected={active}
        title={opt.description || opt.value}
        onClick={() => { onChange(opt.value); setOpen(false); triggerRef.current?.focus(); }}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
          active
            ? 'bg-primary/8 text-foreground font-medium'
            : 'hover:bg-muted/50 text-muted-foreground'
        }`}
      >
        <span className="flex-1 truncate">{opt.label}</span>
        {opt.deprecated && (
          <span className="text-xs text-muted-foreground shrink-0">{t('modelSelector.notInCliList')}</span>
        )}
        {active && <Check className="w-3 h-3 text-primary shrink-0" />}
      </button>
    );
  };

  return (
    <div ref={containerRef} className="relative" onKeyDown={event => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      const items = Array.from(containerRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${t('modelSelector.label')}: ${displayLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors"
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
        <div role="listbox" aria-label={t('modelSelector.label')} className="absolute z-50 bottom-full mb-1 left-0 w-64 max-w-[calc(100vw-74px)] max-h-[280px] bg-popover border border-border rounded-lg shadow-xl overflow-y-auto">
          {options.map(renderOption)}
        </div>
      )}
    </div>
  );
}
