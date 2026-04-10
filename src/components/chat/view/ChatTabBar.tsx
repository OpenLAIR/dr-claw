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
  if (tabs.length <= 1) return null;

  return (
    <div className="flex items-center border-b border-border/50 bg-background/80 px-1 h-9 shrink-0 overflow-x-auto">
      {tabs.map(tab => {
        const isProcessing = tab.sessionId ? processingSessions.has(tab.sessionId) : false;
        return (
          <button
            key={tab.id}
            onClick={() => onSwitchTab(tab.id)}
            className={`
              flex items-center gap-1.5 px-3 h-7 rounded-md text-xs shrink-0 max-w-[180px]
              transition-colors group
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

            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              className="ml-1 opacity-0 group-hover:opacity-100 hover:bg-accent rounded p-0.5 cursor-pointer"
            >
              <X size={10} />
            </span>
          </button>
        );
      })}

      <button
        onClick={onNewTab}
        className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-accent/50 shrink-0"
        title="New chat tab"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
