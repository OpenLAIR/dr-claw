import { create } from 'zustand';
import type { ProjectSession, SessionProvider } from '../types/app';
import type {
  BackgroundSessionStatus,
  SessionSnapshot,
  SessionTab,
} from '../types/sessionTabs';

interface SessionTabsState {
  /** Ordered list of open tabs */
  tabs: SessionTab[];
  /** ID of the currently active (visible) tab */
  activeTabId: string | null;
  /** Whether split-pane mode is on */
  splitMode: boolean;
  /** ID of the tab shown in the secondary (right) pane */
  secondaryTabId: string | null;
  /** Cached state snapshots keyed by session ID */
  snapshots: Record<string, SessionSnapshot>;
  /** Live status for background (non-visible) sessions */
  backgroundStatus: Record<string, BackgroundSessionStatus>;

  // --- Tab CRUD ---
  addTab: (session: ProjectSession, projectName: string) => void;
  removeTab: (sessionId: string) => void;
  setActiveTab: (sessionId: string) => void;
  reorderTab: (fromIndex: number, toIndex: number) => void;

  // --- Split pane ---
  enableSplit: (secondarySessionId: string) => void;
  disableSplit: () => void;

  // --- Snapshot cache ---
  saveSnapshot: (sessionId: string, snapshot: SessionSnapshot) => void;
  getSnapshot: (sessionId: string) => SessionSnapshot | undefined;
  clearSnapshot: (sessionId: string) => void;

  // --- Background status ---
  setBackgroundStatus: (sessionId: string, patch: Partial<BackgroundSessionStatus>) => void;
  clearBackgroundStatus: (sessionId: string) => void;
  /** Mark a tab as read (clear hasUnread and loading indicators) */
  markTabRead: (sessionId: string) => void;

  /** Replace the temporary new-session-* tab id with the real session id from the server */
  replaceTabSessionId: (oldId: string, realSession: ProjectSession, projectName: string) => void;
}

const MAX_OPEN_TABS = 20;

export const useSessionTabsStore = create<SessionTabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  splitMode: false,
  secondaryTabId: null,
  snapshots: {},
  backgroundStatus: {},

  addTab: (session, projectName) => {
    const { tabs } = get();
    const existing = tabs.find((t) => t.id === session.id);
    if (existing) {
      set({ activeTabId: session.id });
      return;
    }
    const newTab: SessionTab = {
      tabKey: (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      id: session.id,
      session,
      projectName,
      provider: session.__provider || 'claude',
      openedAt: Date.now(),
    };
    const next = [...tabs, newTab];
    if (next.length > MAX_OPEN_TABS) {
      const oldest = next.find((t) => t.id !== get().activeTabId && t.id !== get().secondaryTabId);
      if (oldest) {
        const idx = next.indexOf(oldest);
        next.splice(idx, 1);
        const { snapshots, backgroundStatus } = get();
        const { [oldest.id]: _s, ...restSnap } = snapshots;
        const { [oldest.id]: _b, ...restBg } = backgroundStatus;
        set({ tabs: next, activeTabId: session.id, snapshots: restSnap, backgroundStatus: restBg });
        return;
      }
    }
    set({ tabs: next, activeTabId: session.id });
  },

  removeTab: (sessionId) => {
    const { tabs, activeTabId, secondaryTabId, snapshots, backgroundStatus } = get();
    const idx = tabs.findIndex((t) => t.id === sessionId);
    if (idx === -1) return;
    const next = tabs.filter((t) => t.id !== sessionId);
    const { [sessionId]: _s, ...restSnap } = snapshots;
    const { [sessionId]: _b, ...restBg } = backgroundStatus;
    const updates: Partial<SessionTabsState> = { tabs: next, snapshots: restSnap, backgroundStatus: restBg };

    if (activeTabId === sessionId) {
      const neighbor = next[Math.min(idx, next.length - 1)] ?? null;
      updates.activeTabId = neighbor?.id ?? null;
    }
    if (secondaryTabId === sessionId) {
      updates.secondaryTabId = null;
      updates.splitMode = false;
    }
    set(updates);
  },

  setActiveTab: (sessionId) => {
    // Always clear background tracking when the tab becomes active.
    // If the session was loading in the background, the foreground loading
    // spinner will take over; there's no need to keep a background entry.
    const { [sessionId]: _, ...rest } = get().backgroundStatus;
    set({ activeTabId: sessionId, backgroundStatus: rest });
  },

  reorderTab: (fromIndex, toIndex) => {
    const { tabs } = get();
    if (fromIndex < 0 || fromIndex >= tabs.length || toIndex < 0 || toIndex >= tabs.length) return;
    const next = [...tabs];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    set({ tabs: next });
  },

  enableSplit: (secondarySessionId) => {
    const { tabs, activeTabId } = get();
    if (!tabs.find((t) => t.id === secondarySessionId)) return;
    if (secondarySessionId === activeTabId) return;
    set({ splitMode: true, secondaryTabId: secondarySessionId });
  },

  disableSplit: () => {
    set({ splitMode: false, secondaryTabId: null });
  },

  saveSnapshot: (sessionId, snapshot) => {
    set((state) => ({
      snapshots: { ...state.snapshots, [sessionId]: snapshot },
    }));
  },

  getSnapshot: (sessionId) => {
    return get().snapshots[sessionId];
  },

  clearSnapshot: (sessionId) => {
    const { [sessionId]: _, ...rest } = get().snapshots;
    set({ snapshots: rest });
  },

  setBackgroundStatus: (sessionId, patch) => {
    set((state) => {
      const prev = state.backgroundStatus[sessionId] || {
        isLoading: false,
        statusText: null,
        tokenCount: 0,
        hasUnread: false,
        messageSeq: 0,
      };
      return {
        backgroundStatus: {
          ...state.backgroundStatus,
          [sessionId]: { ...prev, ...patch },
        },
      };
    });
  },

  clearBackgroundStatus: (sessionId) => {
    const { [sessionId]: _, ...rest } = get().backgroundStatus;
    set({ backgroundStatus: rest });
  },

  markTabRead: (sessionId) => {
    const { [sessionId]: _, ...rest } = get().backgroundStatus;
    set({ backgroundStatus: rest });
  },

  replaceTabSessionId: (oldId, realSession, projectName) => {
    set((state) => {
      const tabs = state.tabs.map((t) =>
        t.id === oldId
          ? { ...t, id: realSession.id, session: realSession, projectName, provider: realSession.__provider || t.provider }
          : t,
      );
      const activeTabId = state.activeTabId === oldId ? realSession.id : state.activeTabId;
      const secondaryTabId = state.secondaryTabId === oldId ? realSession.id : state.secondaryTabId;

      const snapshots = { ...state.snapshots };
      if (snapshots[oldId]) {
        snapshots[realSession.id] = snapshots[oldId];
        delete snapshots[oldId];
      }
      const backgroundStatus = { ...state.backgroundStatus };
      if (backgroundStatus[oldId]) {
        backgroundStatus[realSession.id] = backgroundStatus[oldId];
        delete backgroundStatus[oldId];
      }
      return { tabs, activeTabId, secondaryTabId, snapshots, backgroundStatus };
    });
  },
}));
