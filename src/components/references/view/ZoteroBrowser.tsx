import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Folder, FolderOpen, Loader2, CheckCircle, Check, Library } from 'lucide-react';
import { Button } from '../../ui/button';
import { cn } from '../../../lib/utils';
import { useReferenceImport } from '../hooks/useReferenceImport';
import type { ZoteroCollection, ZoteroItem } from '../types';
import { formatAuthors } from '../types';

type Step = 'collections' | 'items' | 'importing';

interface ZoteroBrowserProps {
  projectName?: string;
  onClose: () => void;
  onImportComplete: () => void;
}

interface CollectionNode extends ZoteroCollection {
  children: CollectionNode[];
}

function buildTree(collections: ZoteroCollection[]): CollectionNode[] {
  const map = new Map<string, CollectionNode>();
  for (const c of collections) {
    map.set(c.key, { ...c, children: [] });
  }
  const roots: CollectionNode[] = [];
  for (const node of map.values()) {
    if (node.parentKey && map.has(node.parentKey)) {
      map.get(node.parentKey)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function CollectionTreeItem({
  node,
  depth,
  onSelect,
}: {
  node: CollectionNode;
  depth: number;
  onSelect: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors"
        style={{ paddingLeft: depth * 16 + 12 }}
        onClick={() => {
          if (hasChildren) setExpanded(!expanded);
          onSelect(node.key);
        }}
      >
        {expanded && hasChildren ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-amber-500" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {expanded &&
        node.children.map((child) => (
          <CollectionTreeItem key={child.key} node={child} depth={depth + 1} onSelect={onSelect} />
        ))}
    </>
  );
}

export default function ZoteroBrowser({ projectName, onClose, onImportComplete }: ZoteroBrowserProps) {
  const { t } = useTranslation('references');
  const { syncZotero, fetchZoteroCollections, fetchZoteroItems } = useReferenceImport(projectName);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [step, setStep] = useState<Step>('collections');
  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [items, setItems] = useState<ZoteroItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedCollectionKey, setSelectedCollectionKey] = useState<string | undefined>();
  const [loadingCollections, setLoadingCollections] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importCount, setImportCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tree = useMemo(() => buildTree(collections), [collections]);

  useEffect(() => {
    let cancelled = false;
    setLoadingCollections(true);
    fetchZoteroCollections()
      .then((cols) => {
        if (!cancelled) setCollections(cols);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load collections');
      })
      .finally(() => {
        if (!cancelled) setLoadingCollections(false);
      });
    return () => { cancelled = true; };
  }, [fetchZoteroCollections]);

  const handleSelectCollection = useCallback(
    async (collectionKey?: string) => {
      setSelectedCollectionKey(collectionKey);
      setStep('items');
      setLoadingItems(true);
      setSelected(new Set());
      setError(null);
      try {
        const fetchedItems = await fetchZoteroItems(collectionKey);
        setItems(fetchedItems);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load items');
      } finally {
        setLoadingItems(false);
      }
    },
    [fetchZoteroItems],
  );

  const toggleItem = useCallback((sourceId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.sourceId)));
    }
  }, [items, selected.size]);

  const handleImport = useCallback(async () => {
    if (selected.size === 0) return;
    setStep('importing');
    setImporting(true);
    setError(null);
    try {
      const data = await syncZotero({
        collectionKey: selectedCollectionKey,
        sourceIds: Array.from(selected),
      });
      setImportCount(data.synced);
      setImporting(false);
      // Brief pause to show success, then return
      setTimeout(() => {
        if (mountedRef.current) {
          onImportComplete();
        }
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setImporting(false);
      setStep('items');
    }
  }, [selected, selectedCollectionKey, syncZotero, onImportComplete]);

  // -- Collections step --
  if (step === 'collections') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Library className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{t('browser.title')}</h3>
        </div>

        {loadingCollections ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('browser.loadingCollections')}
          </div>
        ) : error ? (
          <div className="py-4 text-center text-sm text-destructive">{error}</div>
        ) : (
          <div className="max-h-[350px] overflow-y-auto rounded-lg border border-border/40">
            {/* My Library (All) */}
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-t-lg px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/50 transition-colors border-b border-border/30"
              onClick={() => handleSelectCollection(undefined)}
            >
              <Library className="h-4 w-4 shrink-0 text-muted-foreground" />
              {t('browser.myLibrary')}
            </button>
            {tree.length > 0 ? (
              tree.map((node) => (
                <CollectionTreeItem key={node.key} node={node} depth={0} onSelect={handleSelectCollection} />
              ))
            ) : (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {t('browser.noCollections')}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
        </div>
      </div>
    );
  }

  // -- Items step --
  if (step === 'items') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setStep('collections')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h3 className="text-sm font-semibold text-foreground">{t('browser.title')}</h3>
        </div>

        {loadingItems ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('browser.loadingItems')}
          </div>
        ) : items.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t('browser.noItems')}</div>
        ) : (
          <>
            {/* Select all / deselect header */}
            <div className="flex items-center justify-between px-1">
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={toggleAll}
              >
                {selected.size === items.length ? t('browser.deselectAll') : t('browser.selectAll')}
              </button>
              {selected.size > 0 && (
                <span className="text-xs text-muted-foreground">
                  {selected.size} / {items.length}
                </span>
              )}
            </div>

            <div className="max-h-[320px] space-y-1 overflow-y-auto rounded-lg border border-border/40 p-1">
              {items.map((item) => {
                const isSelected = selected.has(item.sourceId);
                return (
                  <button
                    key={item.sourceId}
                    type="button"
                    className={cn(
                      'flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                      isSelected
                        ? 'bg-primary/10 border border-primary/30'
                        : 'hover:bg-muted/50 border border-transparent',
                    )}
                    onClick={() => toggleItem(item.sourceId)}
                  >
                    <div
                      className={cn(
                        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background',
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-foreground line-clamp-2">{item.title}</span>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {item.authors.length > 0 && (
                          <span className="truncate">{formatAuthors(item.authors, 2)}</span>
                        )}
                        {item.year && <span>{item.year}</span>}
                        {item.journal && <span className="truncate max-w-[150px]">{item.journal}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {error && <div className="text-sm text-destructive">{error}</div>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            size="sm"
            disabled={selected.size === 0}
            onClick={handleImport}
          >
            {t('browser.importSelected', { count: selected.size })}
          </Button>
        </div>
      </div>
    );
  }

  // -- Importing step --
  return (
    <div className="flex flex-col items-center justify-center py-10 space-y-3">
      {importing ? (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t('browser.importingItems')}</p>
        </>
      ) : importCount !== null ? (
        <>
          <CheckCircle className="h-8 w-8 text-green-500" />
          <p className="text-sm text-green-600 dark:text-green-400">
            {t('browser.importSuccess', { count: importCount })}
          </p>
        </>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
