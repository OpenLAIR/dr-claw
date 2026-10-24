import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Plus, X, Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { authenticatedFetch } from '../../../../utils/api';

type ModelOption = {
  value: string;
  label: string;
  contextLength?: number | null;
  isCustom?: boolean;
};

let _modelsCache: ModelOption[] | null = null;

function mergeAndPrioritizeModels(
  curated: Array<{ value: string; label: string }>,
  live: ModelOption[],
): ModelOption[] {
  const merged = new Map<string, ModelOption>();
  for (const model of curated) {
    merged.set(model.value, { ...model });
  }
  for (const model of live) {
    if (!model?.value) continue;
    if (!merged.has(model.value)) {
      merged.set(model.value, model);
    } else {
      const existing = merged.get(model.value)!;
      merged.set(model.value, {
        ...model,
        label: existing.label || model.label,
      });
    }
  }

  const curatedOrder = new Map(curated.map((m, i) => [m.value, i]));
  return Array.from(merged.values()).sort((a, b) => {
    const aCurated = curatedOrder.has(a.value);
    const bCurated = curatedOrder.has(b.value);
    if (aCurated && bCurated) return curatedOrder.get(a.value)! - curatedOrder.get(b.value)!;
    if (aCurated) return -1;
    if (bCurated) return 1;
    return a.label.localeCompare(b.label);
  });
}

interface OpenRouterModelInputProps {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}

export default function OpenRouterModelInput({
  value,
  options: fallbackOptions,
  onChange,
}: OpenRouterModelInputProps) {
  const { t } = useTranslation('chat');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [models, setModels] = useState<ModelOption[]>(_modelsCache || (fallbackOptions as ModelOption[]));
  const [loading, setLoading] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const customModels: ModelOption[] = JSON.parse(localStorage.getItem('openrouter-custom-models') || '[]');

  const fetchModels = useCallback(async () => {
    if (_modelsCache) {
      setModels(_modelsCache);
      return;
    }
    setLoading(true);
    try {
      const res = await authenticatedFetch('/api/settings/openrouter-models');
      if (res.ok) {
        const data = await res.json();
        if (data.models?.length) {
          const merged = mergeAndPrioritizeModels(fallbackOptions, data.models);
          _modelsCache = merged;
          setModels(merged);
          return;
        }
      }
    } catch {
      /* use fallback */
    } finally {
      setLoading(false);
    }
    const fallbackMerged = mergeAndPrioritizeModels(fallbackOptions, []);
    _modelsCache = fallbackMerged;
    setModels(fallbackMerged);
  }, [fallbackOptions]);

  useEffect(() => {
    if (open) {
      fetchModels();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, fetchModels]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowCustomInput(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const allModels = [
    ...customModels,
    ...models.filter((m) => !customModels.some((c) => c.value === m.value)),
  ];
  const filtered = search
    ? allModels.filter(
        (m) =>
          m.value.toLowerCase().includes(search.toLowerCase()) ||
          m.label.toLowerCase().includes(search.toLowerCase()),
      )
    : allModels;
  const displayLabel = allModels.find((o) => o.value === value)?.label || value;

  const addCustomModel = () => {
    const slug = customDraft.trim();
    if (!slug) return;
    const existing: ModelOption[] = JSON.parse(localStorage.getItem('openrouter-custom-models') || '[]');
    if (!existing.some((m) => m.value === slug)) {
      const updated = [...existing, { value: slug, label: slug, isCustom: true }];
      localStorage.setItem('openrouter-custom-models', JSON.stringify(updated));
    }
    onChange(slug);
    setCustomDraft('');
    setShowCustomInput(false);
    setOpen(false);
  };

  const removeCustomModel = (slug: string) => {
    const existing: ModelOption[] = JSON.parse(localStorage.getItem('openrouter-custom-models') || '[]');
    localStorage.setItem(
      'openrouter-custom-models',
      JSON.stringify(existing.filter((m) => m.value !== slug)),
    );
    if (value === slug) onChange(fallbackOptions[0]?.value || 'anthropic/claude-sonnet-4');
  };

  return (
    <div ref={containerRef} className="relative composer-select" onKeyDown={event => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
    }}>
      <span className="composer-select-label">{t('modelSelector.label')}</span>
      <button
        type="button"
        ref={triggerRef} aria-expanded={open} aria-label={`${t('modelSelector.label')}: ${displayLabel}`}
        onClick={() => setOpen(!open)} className="composer-select-trigger"
      >
        <span className="min-w-0 flex-1 truncate">{displayLabel}</span><ChevronDown aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
      </button>

      {open && (
        <div className="bottom-full composer-select-menu flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('modelSelector.search')} aria-label={t('modelSelector.search')}
              className="min-w-0 flex-1 bg-transparent py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {loading && <span className="text-xs text-muted-foreground">{t('modelSelector.loading')}</span>}
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {filtered.length === 0 && !loading && (
              <p className="px-3 py-4 text-sm text-muted-foreground text-center">{t('modelSelector.empty')}</p>
            )}
            {filtered.map(m => (
              <div key={m.value} className="flex items-center gap-1">
                <button type="button" aria-pressed={m.value === value} className="composer-select-option"
                  onClick={() => { onChange(m.value); setOpen(false); setSearch(''); triggerRef.current?.focus(); }}>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium">{m.label}</span>
                    {m.label !== m.value && <span className="composer-select-description">{m.value}</span>}
                  </span>
                  {m.contextLength && <span className="text-xs text-muted-foreground">{Math.round(m.contextLength / 1000)}k</span>}
                  <span className="w-4 shrink-0">{m.value === value && <Check aria-hidden="true" className="h-4 w-4" />}</span>
                </button>
                {m.isCustom && <button type="button" aria-label={t('modelSelector.removeCustom', { model: m.label })}
                  onClick={() => removeCustomModel(m.value)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive">
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>}
              </div>
            ))}
          </div>
          <div className="border-t border-border/60 px-3 py-2">
            {showCustomInput ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={customDraft}
                  onChange={(e) => setCustomDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addCustomModel(); }
                    if (e.key === 'Escape') setShowCustomInput(false);
                  }}
                  placeholder="e.g. provider/model-name"
                  aria-label={t('modelSelector.customId')} className="min-w-0 flex-1 bg-transparent text-sm text-foreground border border-border rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={addCustomModel}
                  className="min-h-11 px-2 text-sm font-medium text-foreground hover:bg-muted rounded-lg"
                >
                  {t('modelSelector.add')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowCustomInput(true)}
                className="composer-select-option"
              >
                <Plus className="w-3 h-3" />
                {t('modelSelector.addCustom')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
