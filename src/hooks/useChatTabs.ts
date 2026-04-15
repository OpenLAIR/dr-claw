import { useState, useCallback } from 'react';
import type {
  Project,
  ProjectSession,
  SessionNavigationSource,
  SessionProvider,
} from '../types/app';

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
  updateActiveTabSession: (session: ProjectSession, project: Project) => void;
}

type ChatTabNavigationTarget =
  | { kind: 'none' }
  | { kind: 'root' }
  | {
      kind: 'session';
      sessionId: string;
      provider?: SessionProvider;
      projectName?: string;
    };

export function getChatTabNavigationTarget(
  tab?: Pick<ChatTab, 'sessionId' | 'provider' | 'projectName'> | null,
): ChatTabNavigationTarget {
  if (!tab) {
    return { kind: 'none' };
  }

  if (!tab.sessionId) {
    return { kind: 'root' };
  }

  return {
    kind: 'session',
    sessionId: tab.sessionId,
    provider: tab.provider || undefined,
    projectName: tab.projectName || undefined,
  };
}

export function useChatTabs(
  selectedProject: Project | null,
  onNavigateToSession: (
    sessionId: string,
    provider?: SessionProvider,
    projectName?: string,
    options?: { source?: SessionNavigationSource },
  ) => void,
  onActivateBlankTab?: () => void,
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
        const navigationTarget = getChatTabNavigationTarget(next[newActiveIdx]);
        if (navigationTarget.kind === 'session') {
          onNavigateToSession(
            navigationTarget.sessionId,
            navigationTarget.provider,
            navigationTarget.projectName,
            { source: 'user' },
          );
        } else if (navigationTarget.kind === 'root') {
          onActivateBlankTab?.();
        }
      }
      return next;
    });
  }, [onActivateBlankTab, onNavigateToSession]);

  const switchTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const target = prev.find(t => t.id === tabId);
      if (!target || target.isActive) return prev;
      const navigationTarget = getChatTabNavigationTarget(target);
      if (navigationTarget.kind === 'session') {
        onNavigateToSession(
          navigationTarget.sessionId,
          navigationTarget.provider,
          navigationTarget.projectName,
          { source: 'user' },
        );
      } else if (navigationTarget.kind === 'root') {
        onActivateBlankTab?.();
      }
      return prev.map(t => ({ ...t, isActive: t.id === tabId }));
    });
  }, [onActivateBlankTab, onNavigateToSession]);

  const updateTabTitle = useCallback((tabId: string, title: string) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, title } : t));
  }, []);

  // Update the active tab's sessionId when server assigns a real ID to a new conversation.
  // This prevents a new tab from being created when the session-created event fires.
  const updateActiveTabSession = useCallback((session: ProjectSession, project: Project) => {
    setTabs(prev => {
      const active = prev.find(t => t.isActive);
      if (!active) return prev;
      // If the active tab already has this sessionId, no change needed
      if (active.sessionId === session.id) return prev;
      // If another tab already has this sessionId, just switch to it
      const existing = prev.find(t => t.sessionId === session.id);
      if (existing) {
        return prev.map(t => ({ ...t, isActive: t.id === existing.id }));
      }
      // Otherwise update the active tab in-place (new session ID assigned to current conversation)
      return prev.map(t => t.isActive ? {
        ...t,
        id: session.id || t.id,
        sessionId: session.id || null,
        provider: session.__provider || t.provider,
        projectName: project.name,
        title: session.name || session.title || t.title,
      } : t);
    });
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
    updateActiveTabSession,
  };
}
