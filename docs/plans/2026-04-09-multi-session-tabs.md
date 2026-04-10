# Multi-Session Tab Management Implementation Spec

> **For Codex / Claude:** Execute this spec task-by-task. Each task builds on the previous.

**Goal:** Add browser-style tab management to the chat area so users can open multiple sessions simultaneously. Background tabs track session lifecycle (loading/complete indicators) so users know when a background agent finishes. No server changes required.

**Architecture:** Add a `ChatTabBar` above the existing `ChatInterface`. Tab state lives in a new `useChatTabs` hook. When switching tabs, swap `selectedSession` prop to ChatInterface — the existing component handles the rest. Background session lifecycle is already tracked by `handleBackgroundLifecycle` in `useChatRealtimeHandlers.ts:436-444`.

**Tech Stack:** React, TypeScript, Tailwind CSS. No new dependencies.

---

## Server Readiness (No Changes)

Verified — all response messages include `sessionId` across all 6 providers. Different sessionIds can run concurrently on the same WebSocket. Background lifecycle events (`*-complete`, `*-error`) already trigger `onSessionInactive()` and `onSessionNotProcessing()` for non-active sessions (useChatRealtimeHandlers.ts:504-505, 517-518). The `processingSessions` Set in AppContent already tracks which sessions are actively streaming.

---

## Key Design Decisions

1. **Tab switches = change `selectedSession` prop** — ChatInterface is NOT modified internally. It already handles selectedSession changes gracefully (loads messages, resets state).

2. **Background tabs don't receive streaming content** — only lifecycle events (complete/error). This matches current behavior via `handleBackgroundLifecycle`. When user switches back, messages load from server/localStorage.

3. **`processingSessions` Set already exists** — AppContent.tsx tracks which sessions are actively processing. We use this to show loading indicators on background tabs.

4. **No URL route changes for v1** — URL still shows `/session/:activeTabSessionId`. Tab state is in-memory only. Simpler, avoids breaking existing URLs/bookmarks.

---

## Task 1: `useChatTabs` Hook

**Files:**
- Create: `src/hooks/useChatTabs.ts`

**Types:**
```typescript
export interface ChatTab {
  id: string;                          // unique tab ID (crypto.randomUUID or sessionId)
  sessionId: string | null;            // null = new session tab (shows provider picker)
  provider: SessionProvider | null;
  projectName: string | null;
  title: string;                       // display name in tab bar
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
  reorderTabs: (fromIndex: number, toIndex: number) => void;
}
```

**Implementation:**

```typescript
import { useState, useCallback, useRef } from 'react';
import type { Project, ProjectSession, SessionProvider } from '../types/app';

export function useChatTabs(
  selectedSession: ProjectSession | null,
  selectedProject: Project | null,
  onNavigateToSession: (sessionId: string, provider?: SessionProvider, projectName?: string) => void,
): UseChatTabsReturn {
  const [tabs, setTabs] = useState<ChatTab[]>([]);
  const activeTabIdRef = useRef<string | null>(null);

  // Sync: when selectedSession changes externally (sidebar click),
  // either activate existing tab or create one
  // This effect keeps tabs in sync with the existing selectedSession flow
  
  const getActiveTab = useCallback(() => {
    return tabs.find(t => t.isActive) || null;
  }, [tabs]);

  const openTab = useCallback((session: ProjectSession, project: Project) => {
    setTabs(prev => {
      // If tab for this session already exists, activate it
      const existing = prev.find(t => t.sessionId === session.id);
      if (existing) {
        return prev.map(t => ({ ...t, isActive: t.id === existing.id }));
      }
      // Create new tab, deactivate others
      const newTab: ChatTab = {
        id: session.id || crypto.randomUUID(),
        sessionId: session.id,
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
  }, [selectedProject]);

  const closeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId);
      if (idx === -1) return prev;
      const closing = prev[idx];
      const next = prev.filter(t => t.id !== tabId);
      // If closing the active tab, activate neighbor
      if (closing.isActive && next.length > 0) {
        const newActiveIdx = Math.min(idx, next.length - 1);
        next[newActiveIdx].isActive = true;
        // Navigate to the newly active tab's session
        const newActive = next[newActiveIdx];
        if (newActive.sessionId) {
          onNavigateToSession(newActive.sessionId, newActive.provider || undefined, newActive.projectName || undefined);
        }
      }
      return next;
    });
  }, [onNavigateToSession]);

  const switchTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const target = prev.find(t => t.id === tabId);
      if (!target || target.isActive) return prev;
      // Navigate to this tab's session
      if (target.sessionId) {
        onNavigateToSession(target.sessionId, target.provider || undefined, target.projectName || undefined);
      }
      return prev.map(t => ({ ...t, isActive: t.id === tabId }));
    });
  }, [onNavigateToSession]);

  const updateTabTitle = useCallback((tabId: string, title: string) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, title } : t));
  }, []);

  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    setTabs(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  return {
    tabs,
    activeTab: getActiveTab(),
    openTab,
    openNewTab,
    closeTab,
    switchTab,
    updateTabTitle,
    reorderTabs,
  };
}
```

**Key behavior:** When `selectedSession` changes from sidebar click, the parent (MainContent) calls `openTab()` to sync. When user clicks a tab, `switchTab()` calls `onNavigateToSession()` which flows back through the existing navigation system — `useProjectsState.handleNavigateToSession` → `setSelectedSession` → ChatInterface re-renders with new session.

---

## Task 2: `ChatTabBar` Component

**Files:**
- Create: `src/components/chat/view/ChatTabBar.tsx`

**Props:**
```typescript
interface ChatTabBarProps {
  tabs: ChatTab[];
  processingSessions: Set<string>;  // from AppContent — sessions currently streaming
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
}
```

**Render:**
```tsx
function ChatTabBar({ tabs, processingSessions, onSwitchTab, onCloseTab, onNewTab }: ChatTabBarProps) {
  if (tabs.length <= 1) return null;  // Hide when single tab (current behavior)

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
            {/* Provider icon */}
            <span className="w-3 h-3 shrink-0">
              {isProcessing ? (
                <span className="block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              ) : (
                <ProviderIcon provider={tab.provider} size={12} />
              )}
            </span>

            {/* Title */}
            <span className="truncate">{tab.title}</span>

            {/* Close button */}
            <span
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              className="ml-1 opacity-0 group-hover:opacity-100 hover:bg-accent rounded p-0.5"
            >
              <X size={10} />
            </span>
          </button>
        );
      })}

      {/* New tab button */}
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
```

**Key behaviors:**
- **Hidden when 1 tab** — single session looks exactly like current UI (zero visual change)
- **Blue pulse dot** when background tab's session is still processing (uses `processingSessions` Set)
- **Close button** appears on hover
- **Overflow scrolls horizontally** for many tabs
- **Close active tab** activates neighbor (handled by `useChatTabs.closeTab`)

---

## Task 3: Wire Tab Bar into MainContent

**Files:**
- Modify: `src/components/main-content/view/MainContent.tsx`

**Changes to the chat section (lines 253-329):**

Before (current, simplified):
```tsx
<ChatInterface selectedSession={selectedSession} ... />
```

After:
```tsx
// In MainContent function body, add:
const chatTabs = useChatTabs(selectedSession, selectedProject, onNavigateToSession);

// Sync external session changes into tabs
useEffect(() => {
  if (selectedSession && selectedProject && activeTab === 'chat') {
    chatTabs.openTab(selectedSession, selectedProject);
  }
}, [selectedSession?.id, selectedProject?.name, activeTab]);

// In the render, above ChatInterface:
<ChatTabBar
  tabs={chatTabs.tabs}
  processingSessions={processingSessions}
  onSwitchTab={chatTabs.switchTab}
  onCloseTab={chatTabs.closeTab}
  onNewTab={chatTabs.openNewTab}
/>
<ChatInterface
  selectedSession={selectedSession}  // unchanged — driven by tab switching via navigate
  selectedProject={selectedProject}
  ... // all other props unchanged
/>
```

**Critical: ChatInterface is NOT modified.** Tab switching calls `onNavigateToSession` → `useProjectsState` → `setSelectedSession` → ChatInterface re-renders. This is the same flow as clicking a session in the sidebar.

---

## Task 4: Sidebar "Open in New Tab" Entry Point

**Files:**
- Modify: sidebar session list component (find the session right-click/context menu)

**What:** Add "Open in New Tab" to the session context menu or as a middle-click action.

**Approach A — Middle-click (Cmd+click):**
```typescript
// In session list item onClick handler:
const handleSessionClick = (e: React.MouseEvent, session: ProjectSession) => {
  if (e.metaKey || e.ctrlKey || e.button === 1) {
    // Cmd+click or middle-click: open in new tab
    chatTabs.openTab(session, selectedProject);
    // Don't navigate — keep current tab active
    return;
  }
  // Normal click: existing behavior (navigate, which syncs to active tab)
  onNavigateToSession(session.id, session.__provider, selectedProject?.name);
};
```

**Approach B — Context menu item:**
Add "Open in New Tab" to whatever right-click menu exists on session items.

**Recommendation:** Do both. Middle-click is power-user discoverable, context menu is explicit.

---

## Task 5: Background Session Lifecycle Indicators

**Files:**
- Already partially done by Task 2 (ChatTabBar shows blue pulse for processing sessions)
- Minor addition: update tab title when session completes

**What `processingSessions` already gives us:**

The `processingSessions` Set in AppContent tracks sessions currently streaming. It's updated by:
- `onSessionProcessing(sessionId)` → add to set (useChatRealtimeHandlers fires this when streaming starts)
- `onSessionNotProcessing(sessionId)` → remove from set (fires on complete/error)

`handleBackgroundLifecycle` at useChatRealtimeHandlers.ts:436-444 already calls `onSessionInactive` and `onSessionNotProcessing` for messages arriving for non-active sessions. So when a background tab's session completes, `processingSessions` removes it, and the tab bar's blue pulse stops.

**Additional enhancement — completion badge:**
```typescript
// In ChatTabBar, after the processing check:
const isRecentlyCompleted = !isProcessing && tab.sessionId && 
  recentlyCompletedSessions.has(tab.sessionId);

{isRecentlyCompleted && (
  <span className="block w-2 h-2 rounded-full bg-green-500" title="Completed" />
)}
```

This requires adding a `recentlyCompletedSessions` Set that gets populated when `onSessionNotProcessing` fires and cleared when the user switches to that tab.

---

## Task 6: Tab Persistence (Optional, defer if tight)

**Files:**
- Modify: `src/hooks/useChatTabs.ts`

**What:** Save tab state to localStorage so tabs survive page refresh.

```typescript
const TABS_STORAGE_KEY = 'dr-claw-chat-tabs';

// On init:
const [tabs, setTabs] = useState<ChatTab[]>(() => {
  const saved = localStorage.getItem(TABS_STORAGE_KEY);
  if (saved) {
    try { return JSON.parse(saved); } catch { /* ignore */ }
  }
  return [];
});

// On change:
useEffect(() => {
  localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs));
}, [tabs]);
```

**Defer this** — nice-to-have, not blocking for v1.

---

## Execution Order

```
Task 1: useChatTabs hook         ← pure logic, no UI, testable in isolation
   ↓
Task 2: ChatTabBar component     ← visual component, no wiring yet
   ↓
Task 3: Wire into MainContent    ← integration, this is where it becomes visible
   ↓
Task 4: Sidebar entry points     ← Cmd+click / context menu for "Open in New Tab"
   ↓
Task 5: Background indicators    ← polish (pulse dot, completion badge)
   ↓
Task 6: Tab persistence          ← optional, localStorage save/restore
```

**All tasks modify different files — no merge conflicts between them.**

---

## Files To Change Summary

| File | Action | Task | Lines (est.) |
|------|--------|------|-------------|
| `src/hooks/useChatTabs.ts` | **Create** | 1 | ~120 |
| `src/components/chat/view/ChatTabBar.tsx` | **Create** | 2 | ~80 |
| `src/components/main-content/view/MainContent.tsx` | Modify | 3 | +25 |
| Sidebar session list component | Modify | 4 | +15 |
| `src/hooks/useChatTabs.ts` | Modify | 5, 6 | +30 |

**Total: ~270 lines of new code. Zero changes to ChatInterface, useChatRealtimeHandlers, WebSocketContext, or any server file.**

---

## What This Does NOT Do (Explicit Scope Limits)

- **No split-panel** — single ChatInterface, full width, one at a time
- **No per-tab message caching** — switching tabs reloads from server (current behavior)
- **No URL per-tab** — URL shows active tab's session only
- **No drag-and-drop reorder** — arrow keys or later enhancement
- **No max tab limit** — let it grow (performance concern only at 50+ tabs, unlikely)
- **No cross-project tabs** — all tabs share `selectedProject` (switching projects closes tabs)

---

## Playwright E2E Test Plan

Tests to write alongside development:

```typescript
// L1: Smoke tests
test('tab bar hidden with single session', ...);
test('tab bar appears when second session opened', ...);
test('close last tab hides tab bar', ...);

// L2: Tab management
test('Cmd+click session opens new tab without switching', ...);
test('clicking tab switches active session', ...);
test('closing active tab activates neighbor', ...);
test('closing inactive tab preserves active session', ...);

// L3: Background indicators (mock WebSocket)
test('processing session shows pulse dot on background tab', ...);
test('completed session shows green dot on background tab', ...);
test('switching to completed tab clears the dot', ...);
```
