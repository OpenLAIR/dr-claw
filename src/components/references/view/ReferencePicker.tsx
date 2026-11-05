import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Search, Check, FileText, Loader2 } from 'lucide-react';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { cn } from '../../../lib/utils';
import { api } from '../../../utils/api';
import type { Reference } from '../types';
import { formatAuthors, formatReferenceChatPrompt } from '../types';

interface ReferencePickerProps {
  projectName: string;
  onSelect: (contextText: string) => void;
  onClose: () => void;
}

export default function ReferencePicker({ projectName, onSelect, onClose }: ReferencePickerProps) {
  const { t } = useTranslation('references');
  const [search, setSearch] = useState('');
  const [references, setReferences] = useState<Reference[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Fetch project references
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.references.projectRefs(projectName);
        if (cancelled) return;
        const data = await res.json();
        setReferences(data.references || []);
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [projectName]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    const chosen = references.filter((r) => selected.has(r.id));
    if (chosen.length === 0) {
      onClose();
      return;
    }
    const contextParts = chosen.map((r) => formatReferenceChatPrompt(r));
    onSelect(contextParts.join('\n\n'));
    onClose();
  }, [selected, references, onSelect, onClose]);

  // Client-side filter on project refs
  const displayRefs = references.filter((r) => {
    if (!search) return true;
    const hay = `${r.title} ${formatAuthors(r.authors)} ${r.journal || ''} ${r.keywords.join(' ')}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  });

  return (
    <div
      className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-[420px] overflow-hidden rounded-lg border border-border/50 bg-popover shadow-xl"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('picker.title')}</span>
          {selected.size > 0 && (
            <Badge variant="secondary">{selected.size}</Badge>
          )}
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Search */}
      <div className="border-b border-border/40 px-4 py-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('picker.searchPlaceholder')}
            className="h-8 pl-9 text-sm"
            autoFocus
          />
        </div>
      </div>

      {/* List */}
      <div className="max-h-[280px] overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('picker.loading')}
          </div>
        ) : displayRefs.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t('picker.noResults')}
          </div>
        ) : (
          displayRefs.map((ref) => {
            const isSelected = selected.has(ref.id);
            return (
              <button
                key={ref.id}
                type="button"
                onClick={() => toggleSelect(ref.id)}
                className={cn(
                  'mb-1 flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors last:mb-0',
                  isSelected
                    ? 'bg-primary/10 border border-primary/30'
                    : 'hover:bg-muted/50 border border-transparent',
                )}
              >
                <div className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                  isSelected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background',
                )}>
                  {isSelected && <Check className="h-3 w-3" />}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="truncate text-sm font-medium text-foreground">{ref.title}</span>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {formatAuthors(ref.authors)}
                    {ref.year ? ` (${ref.year})` : ''}
                    {ref.journal ? ` — ${ref.journal}` : ''}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border/40 px-4 py-2.5">
        <span className="text-xs text-muted-foreground">
          {t('picker.selectedCount', { count: selected.size })}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={selected.size === 0}>
            {t('picker.addToMessage')}
          </Button>
        </div>
      </div>
    </div>
  );
}
