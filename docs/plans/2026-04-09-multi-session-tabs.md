# Multi-Session Tab Management — Architecture Note

**Goal:** Add browser-style tab management to the chat area so users can open multiple sessions simultaneously. Background tabs track session lifecycle (loading/complete indicators) so users know when a background agent finishes.

**Tech Stack:** React, TypeScript, Tailwind CSS. No new dependencies. No server changes required.

## Architecture Overview

Tab state lives in a `useChatTabs` hook. A `ChatTabBar` component renders above `ChatInterface`. When switching tabs, the hook swaps `selectedSession` via the existing navigation system (`useProjectsState.handleNavigateToSession` -> `setSelectedSession` -> ChatInterface re-renders). ChatInterface itself is unmodified.

Background session lifecycle is tracked by the existing `processingSessions` Set in AppContent and `handleBackgroundLifecycle` in `useChatRealtimeHandlers.ts`.

### Component Structure

| File | Role |
|------|------|
| `src/hooks/useChatTabs.ts` | Tab state management (open, close, switch, reorder) |
| `src/components/chat/view/ChatTabBar.tsx` | Tab bar UI with processing indicators |
| `src/components/main-content/view/MainContent.tsx` | Wiring — syncs tab state with `selectedSession` |
| `src/components/main-content/view/chatTabSync.ts` | Pure function resolving sync action on session change |

## Key Design Decisions

1. **Tab switches = change `selectedSession` prop** — ChatInterface is NOT modified internally. It already handles selectedSession changes gracefully (loads messages, resets state).

2. **Background tabs don't receive streaming content** — only lifecycle events (complete/error). When user switches back, messages load from server/localStorage.

3. **`processingSessions` Set already exists** — AppContent tracks which sessions are actively processing. The tab bar uses this to show loading indicators on background tabs.

4. **No URL route changes for v1** — URL shows `/session/:activeTabSessionId`. Tab state is in-memory only.

## Scope Limits

- No split-panel view — single ChatInterface, full width, one at a time
- No per-tab message caching at the tab layer (session-level LRU cache exists separately)
- No drag-and-drop reorder
- No cross-project tabs — all tabs share `selectedProject`
