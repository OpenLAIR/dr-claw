import { useState, useCallback } from 'react';
import type { Project, ProjectSession, SessionProvider } from '../types/app';

export interface ChatTab {
  id: string;
  sessionId: string | null;
  provider: SessionProvider | null;
  projectName: string | null;
  title: string;
  isActive: boolean;
}

export interface UseChatTabsReturn {
  tabs: ChatTab[];
  activeTab: ChatTab | null;
  openTab: (session: ProjectSession, project: Project) => void;
  openNewTab: () => void;
  closeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  updateTabTitle: (tabId: string, title: string) => void;
}

export function useChatTabs(
  selectedProject: Project | null,
  onNavigateToSession: (sessionId: string, provider?: SessionProvider, projectName?: string) => void,
): UseChatTabsReturn {
  const [tabs, setTabs] = useState<ChatTab[]>([]);

  const openTab = useCallback((session: ProjectSession, project: Project) => {
    setTabs(prev => {
      const existing = prev.find(t => t.sessionId === session.id);
      if (existing) {
        if (existing.isActive) return prev;
        return prev.map(t => ({ ...t, isActive: t.id === existing.id }));
      }
      const newTab: ChatTab = {
        id: session.id || crypto.randomUUID(),
        sessionId: session.id || null,
        provider: session.__provider || null,
        projectName: project.name,
        title: session.name || session.title || `Session ${prev.length + 1}`,
        isActive: true,
      };
      return [...prev.map(t => ({ ...t, isActive: false })), newTab];
    });
  }, []);

  const openNewTab = useCallback(() => {
    setTabs(prev => {
      const newTab: ChatTab = {
        id: crypto.randomUUID(),
        sessionId: null,
        provider: null,
        projectName: selectedProject?.name || null,
        title: 'New Chat',
        isActive: true,
      };
      return [...prev.map(t => ({ ...t, isActive: false })), newTab];
    });
  }, [selectedProject?.name]);

  const closeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId);
      if (idx === -1) return prev;
      const closing = prev[idx];
      const next = prev.filter(t => t.id !== tabId);
      if (closing.isActive && next.length > 0) {
        const newActiveIdx = Math.min(idx, next.length - 1);
        next[newActiveIdx] = { ...next[newActiveIdx], isActive: true };
        const activated = next[newActiveIdx];
        if (activated.sessionId) {
          setTimeout(() => {
            onNavigateToSession(activated.sessionId!, activated.provider || undefined, activated.projectName || undefined);
          }, 0);
        }
      }
      return next;
    });
  }, [onNavigateToSession]);

  const switchTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const target = prev.find(t => t.id === tabId);
      if (!target || target.isActive) return prev;
      if (target.sessionId) {
        onNavigateToSession(target.sessionId, target.provider || undefined, target.projectName || undefined);
      }
      return prev.map(t => ({ ...t, isActive: t.id === tabId }));
    });
  }, [onNavigateToSession]);

  const updateTabTitle = useCallback((tabId: string, title: string) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, title } : t));
  }, []);

  const activeTab = tabs.find(t => t.isActive) || null;

  return {
    tabs,
    activeTab,
    openTab,
    openNewTab,
    closeTab,
    switchTab,
    updateTabTitle,
  };
}
