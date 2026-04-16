import { useRef } from 'react';
import { X, Plus } from 'lucide-react';
import type { ChatTab } from '../../../hooks/useChatTabs';

interface ChatTabBarProps {
  tabs: ChatTab[];
  processingSessions: Set<string>;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
}

export default function ChatTabBar({ tabs, processingSessions, onSwitchTab, onCloseTab, onNewTab }: ChatTabBarProps) {
  const tablistRef = useRef<HTMLDivElement>(null);

  // Keep this sibling mounted even with zero tabs so ChatInterface does not
  // get remounted when the first real tab appears after session creation.
  if (tabs.length === 0) {
    return <div className="hidden" aria-hidden="true" />;
  }

  const focusTabAtIndex = (index: number) => {
    const tabButtons = tablistRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
    tabButtons?.[index]?.focus();
  };

  const handleTabKeyDown = (e: React.KeyboardEvent, tabIndex: number) => {
    // Delete/Backspace closes the focused tab
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onCloseTab(tabs[tabIndex].id);
      return;
    }

    let nextIndex: number | null = null;

    switch (e.key) {
      case 'ArrowRight':
        nextIndex = (tabIndex + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        nextIndex = (tabIndex - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    e.preventDefault();
    focusTabAtIndex(nextIndex);
    onSwitchTab(tabs[nextIndex].id);
  };

  return (
    <div ref={tablistRef} className="flex items-center border-b border-border/50 bg-background/80 px-1 h-9 shrink-0 overflow-x-auto" role="tablist">
      {tabs.map((tab, index) => {
        const isProcessing = tab.sessionId ? processingSessions.has(tab.sessionId) : false;
        return (
          <div key={tab.id} className="flex items-center shrink-0 group">
            <button
              type="button"
              role="tab"
              aria-selected={tab.isActive}
              tabIndex={tab.isActive ? 0 : -1}
              onClick={() => onSwitchTab(tab.id)}
              onKeyDown={(e) => handleTabKeyDown(e, index)}
              className={`
                flex items-center gap-1.5 px-3 h-7 rounded-l-md text-xs max-w-[160px]
                transition-colors
                ${tab.isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50'}
              `}
            >
              <span className="w-3 h-3 shrink-0 flex items-center justify-center">
                {isProcessing ? (
                  <span className="block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                ) : (
                  <span className="block w-1.5 h-1.5 rounded-full bg-current opacity-40" />
                )}
              </span>
              <span className="truncate">{tab.title}</span>
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Close ${tab.title}`}
              onClick={() => onCloseTab(tab.id)}
              className={`
                h-7 px-1 rounded-r-md transition-colors
                opacity-0 group-hover:opacity-100 focus:opacity-100
                ${tab.isActive
                  ? 'bg-accent text-accent-foreground hover:bg-accent/80'
                  : 'text-muted-foreground hover:bg-accent/50'}
              `}
            >
              <X size={10} />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={onNewTab}
        className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-accent/50 shrink-0"
        title="New chat tab"
        aria-label="New chat tab"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
