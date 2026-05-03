import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Plus, X, Check } from 'lucide-react';
import { authenticatedFetch } from '../../../../utils/api';

type ModelOption = {
  value: string;
  label: string;
  contextLength?: number | null;
  isCustom?: boolean;
};

const modelsCacheByUrl = new Map<string, ModelOption[]>();

interface OpenRouterModelInputProps {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  storageKey?: string;
  fetchUrl?: string | null;
  searchPlaceholder?: string;
  customModelPlaceholder?: string;
  addCustomLabel?: string;
}

export default function OpenRouterModelInput({
  value,
  options: fallbackOptions,
  onChange,
  storageKey = 'openrouter-custom-models',
  fetchUrl = '/api/settings/openrouter-models',
  searchPlaceholder = 'Search models...',
  customModelPlaceholder = 'e.g. provider/model-name',
  addCustomLabel = 'Add custom model',
}: OpenRouterModelInputProps) {
  const initialModels = fetchUrl ? modelsCacheByUrl.get(fetchUrl) || (fallbackOptions as ModelOption[]) : (fallbackOptions as ModelOption[]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [models, setModels] = useState<ModelOption[]>(initialModels);
  const [loading, setLoading] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const customModels: ModelOption[] = JSON.parse(localStorage.getItem(storageKey) || '[]');

  const fetchModels = useCallback(async () => {
    if (!fetchUrl) {
      setModels(fallbackOptions as ModelOption[]);
      return;
    }
    const cachedModels = modelsCacheByUrl.get(fetchUrl);
    if (cachedModels?.length) {
      setModels(cachedModels);
      return;
    }
    setLoading(true);
    try {
      const res = await authenticatedFetch(fetchUrl);
      if (res.ok) {
        const data = await res.json();
        if (data.models?.length) {
          modelsCacheByUrl.set(fetchUrl, data.models);
          setModels(data.models);
        } else {
          setModels(fallbackOptions as ModelOption[]);
        }
      }
    } catch {
      /* use fallback */
    }
    if (!modelsCacheByUrl.get(fetchUrl)?.length) {
      setModels(fallbackOptions as ModelOption[]);
    }
    setLoading(false);
  }, [fallbackOptions, fetchUrl]);

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
    const existing: ModelOption[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!existing.some((m) => m.value === slug)) {
      const updated = [...existing, { value: slug, label: slug, isCustom: true }];
      localStorage.setItem(storageKey, JSON.stringify(updated));
    }
    onChange(slug);
    setCustomDraft('');
    setShowCustomInput(false);
    setOpen(false);
  };

  const removeCustomModel = (slug: string) => {
    const existing: ModelOption[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
    localStorage.setItem(
      storageKey,
      JSON.stringify(existing.filter((m) => m.value !== slug)),
    );
    if (value === slug) onChange(fallbackOptions[0]?.value || 'anthropic/claude-sonnet-4');
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="bg-transparent pl-2 pr-4 py-0.5 text-[10px] font-medium border border-border/50 rounded-lg text-foreground cursor-pointer hover:bg-muted/40 transition-colors text-left max-w-[200px] truncate"
      >
        {displayLabel} <span className="text-muted-foreground/50 ml-0.5">&#9662;</span>
      </button>

      {open && (
        <div className="absolute z-50 bottom-full mb-1 left-0 w-[380px] max-h-[360px] bg-popover border border-border rounded-xl shadow-xl flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
            />
            {loading && <span className="text-[10px] text-muted-foreground animate-pulse">Loading...</span>}
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {filtered.length === 0 && !loading && (
              <p className="px-3 py-4 text-[11px] text-muted-foreground text-center">No models found</p>
            )}
            {filtered.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => {
                  onChange(m.value);
                  setOpen(false);
                  setSearch('');
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors group ${
                  m.value === value ? 'bg-primary/8' : ''
                }`}
              >
                <span className="w-3.5 shrink-0">
                  {m.value === value && <Check className="w-3 h-3 text-primary" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[11px] font-medium text-foreground truncate">
                    {m.label}
                  </span>
                  {m.label !== m.value && (
                    <span className="block text-[9px] text-muted-foreground/60 truncate">
                      {m.value}
                    </span>
                  )}
                </span>
                {m.contextLength && (
                  <span className="text-[9px] text-muted-foreground/50 shrink-0">
                    {Math.round(m.contextLength / 1000)}k
                  </span>
                )}
                {m.isCustom && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCustomModel(m.value);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </button>
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
                    if (e.key === 'Enter') addCustomModel();
                    if (e.key === 'Escape') setShowCustomInput(false);
                  }}
                  placeholder={customModelPlaceholder}
                  className="flex-1 bg-transparent text-[11px] text-foreground border border-border/60 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <button
                  type="button"
                  onClick={addCustomModel}
                  className="text-[10px] font-medium text-primary hover:text-primary/80"
                >
                  Add
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowCustomInput(true)}
                className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="w-3 h-3" />
                {addCustomLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
