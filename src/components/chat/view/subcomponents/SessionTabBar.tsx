import React, { useCallback, useRef } from 'react';
import { X, Columns2, Loader2, CircleDot } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { useSessionTabsStore } from '../../../../stores/useSessionTabsStore';
import SessionProviderLogo from '../../../SessionProviderLogo';
import type { SessionTab } from '../../../../types/sessionTabs';

function tabDisplayName(tab: SessionTab): string {
  return tab.session.summary || tab.session.title || tab.session.name || tab.id.slice(0, 8);
}

function TabItem({
  tab,
  isActive,
  isSecondary,
  onActivate,
  onClose,
  onSplitOpen,
  dragIndex,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  tab: SessionTab;
  isActive: boolean;
  isSecondary: boolean;
  onActivate: () => void;
  onClose: (e: React.MouseEvent) => void;
  onSplitOpen: (e: React.MouseEvent) => void;
  dragIndex: number;
  onDragStart: (idx: number) => void;
  onDragOver: (e: React.DragEvent, idx: number) => void;
  onDrop: (e: React.DragEvent, idx: number) => void;
}) {
  const bgStatus = useSessionTabsStore((s) => s.backgroundStatus[tab.id]);
  const isLoading = bgStatus?.isLoading ?? false;
  const hasUnread = bgStatus?.hasUnread ?? false;
  const tokenCount = bgStatus?.tokenCount ?? 0;

  const statusIcon = isLoading ? (
    <Loader2 className="w-3 h-3 flex-shrink-0 animate-spin text-amber-500" />
  ) : hasUnread ? (
    <CircleDot className="w-3 h-3 flex-shrink-0 text-emerald-500" />
  ) : null;

  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer select-none border-b-2 transition-colors min-w-0 max-w-[200px] shrink-0',
        isActive && 'border-primary bg-accent/60 text-accent-foreground',
        isSecondary && !isActive && 'border-blue-400/60 bg-blue-50/30 dark:bg-blue-950/20 text-foreground/90',
        !isActive && !isSecondary && 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/30',
      )}
      draggable
      onDragStart={() => onDragStart(dragIndex)}
      onDragOver={(e) => onDragOver(e, dragIndex)}
      onDrop={(e) => onDrop(e, dragIndex)}
      onClick={onActivate}
      onContextMenu={(e) => {
        e.preventDefault();
        onSplitOpen(e);
      }}
      title={tabDisplayName(tab)}
    >
      <SessionProviderLogo provider={tab.provider} className="w-3.5 h-3.5 flex-shrink-0" />

      {statusIcon}

      <span className={cn('truncate', hasUnread && 'font-medium')}>{tabDisplayName(tab)}</span>

      {isLoading && tokenCount > 0 && (
        <span className="text-[10px] text-muted-foreground/70 tabular-nums flex-shrink-0">
          {tokenCount > 999 ? `${Math.round(tokenCount / 1000)}k` : tokenCount}
        </span>
      )}

      <button
        className="ml-auto flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-opacity"
        onClick={onClose}
        aria-label="Close tab"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export default function SessionTabBar() {
  const tabs = useSessionTabsStore((s) => s.tabs);
  const activeTabId = useSessionTabsStore((s) => s.activeTabId);
  const secondaryTabId = useSessionTabsStore((s) => s.secondaryTabId);
  const splitMode = useSessionTabsStore((s) => s.splitMode);
  const { setActiveTab, removeTab, reorderTab, enableSplit, disableSplit } = useSessionTabsStore();

  const dragIndexRef = useRef<number | null>(null);

  const handleDragStart = useCallback((idx: number) => {
    dragIndexRef.current = idx;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, _idx: number) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, toIdx: number) => {
      e.preventDefault();
      const fromIdx = dragIndexRef.current;
      if (fromIdx !== null && fromIdx !== toIdx) {
        reorderTab(fromIdx, toIdx);
      }
      dragIndexRef.current = null;
    },
    [reorderTab],
  );

  if (tabs.length <= 1) {
    return null;
  }

  return (
    <div className="flex items-center border-b border-border/40 bg-background/80 backdrop-blur-sm overflow-x-auto scrollbar-none">
      <div className="flex items-center min-w-0 flex-1">
        {tabs.map((tab, idx) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            isSecondary={splitMode && tab.id === secondaryTabId}
            onActivate={() => setActiveTab(tab.id)}
            onClose={(e) => {
              e.stopPropagation();
              removeTab(tab.id);
            }}
            onSplitOpen={(e) => {
              e.stopPropagation();
              if (splitMode && secondaryTabId === tab.id) {
                disableSplit();
              } else if (tab.id !== activeTabId) {
                enableSplit(tab.id);
              }
            }}
            dragIndex={idx}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          />
        ))}
      </div>

      {tabs.length >= 2 && (
        <button
          className={cn(
            'flex-shrink-0 p-1.5 mx-1 rounded hover:bg-accent/50 transition-colors',
            splitMode && 'text-primary bg-accent/40',
          )}
          onClick={() => {
            if (splitMode) {
              disableSplit();
            } else {
              const other = tabs.find((t) => t.id !== activeTabId);
              if (other) enableSplit(other.id);
            }
          }}
          title={splitMode ? 'Exit split view' : 'Split view'}
        >
          <Columns2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
