import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import { api, authenticatedFetch } from '../../../utils/api';
import { isTemporarySessionId } from '../../../constants/session';
import { RESUMING_STATUS_TEXT } from '../types/types';
import type { ChatMessage, Provider, TokenBudget } from '../types/types';
import type { Project, ProjectSession } from '../../../types/app';
import { clearSessionTimerStart, readSessionTimerStart, safeLocalStorage } from '../utils/chatStorage';
import { hydrateStoredChatMessages } from '../utils/chatMessages';
import {
  convertCursorSessionMessages,
  convertSessionMessages,
  createCachedDiffCalculator,
  type DiffCalculator,
} from '../utils/messageTransforms';
import { useSessionTabsStore } from '../../../stores/useSessionTabsStore';

const MESSAGES_PER_PAGE = 20;
const INITIAL_VISIBLE_MESSAGES = 100;

// LRU message cache for instant tab switching. Max 10 sessions cached.
const SESSION_MESSAGE_CACHE_MAX = 10;
type CachedSessionData = { messages: ChatMessage[]; tokenUsage?: TokenBudget | null; total: number; hasMore: boolean };
const sessionMessageCache = new Map<string, CachedSessionData>();
function cacheSessionMessages(key: string, data: CachedSessionData) {
  if (sessionMessageCache.size >= SESSION_MESSAGE_CACHE_MAX) {
    const oldest = sessionMessageCache.keys().next().value;
    if (oldest) sessionMessageCache.delete(oldest);
  }
  sessionMessageCache.set(key, data);
}
function getCachedSessionMessages(key: string) {
  const data = sessionMessageCache.get(key);
  if (!data) return null;
  sessionMessageCache.delete(key);
  sessionMessageCache.set(key, data);
  return data;
}
export function invalidateSessionMessageCache(projectName: string, sessionId: string) {
  sessionMessageCache.delete(`${projectName}:${sessionId}`);
}

/** Grace period for WebSocket status-check response before clearing stale resume state */
const STATUS_VALIDATION_TIMEOUT_MS = 5000;

/**
 * Prefer session.__provider; else infer from project session lists.
 * Never fall back to chat composer `selected-provider` — if that is "nano", every unmatched session
 * would request provider=nano and load empty history.
 */
function resolveSessionProviderForLoad(session: ProjectSession | null, project: Project | null): Provider | string {
  if (session?.__provider) {
    return session.__provider;
  }
  if (!session?.id || !project) {
    return 'claude';
  }
  const { id } = session;
  if (project.nanoSessions?.some((s) => s.id === id)) return 'nano';
  if (project.localSessions?.some((s) => s.id === id)) return 'local';
  if (project.openrouterSessions?.some((s) => s.id === id)) return 'openrouter';
  if (project.geminiSessions?.some((s) => s.id === id)) return 'gemini';
  if (project.codexSessions?.some((s) => s.id === id)) return 'codex';
  if (project.cursorSessions?.some((s) => s.id === id)) return 'cursor';
  if (project.sessions?.some((s) => s.id === id)) return 'claude';
  return 'claude';
}

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

interface UseChatSessionStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  autoScrollToBottom?: boolean;
  externalMessageUpdate?: number;
  processingSessions?: Set<string>;
  resetStreamingState: () => void;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
}

interface ScrollRestoreState {
  height: number;
  top: number;
}

export function useChatSessionState({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  autoScrollToBottom,
  externalMessageUpdate,
  processingSessions,
  resetStreamingState,
  pendingViewSessionRef,
}: UseChatSessionStateArgs) {
  const persistedInitialStartTime = selectedSession?.id ? readSessionTimerStart(selectedSession.id) : null;

  const [chatMessages, _setChatMessages] = useState<ChatMessage[]>(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      // Prefer session-scoped key to avoid collisions when multiple sessions
      // from the same project are open simultaneously (split pane / multi-tab).
      const sessionScopedKey =
        selectedSession?.id && !selectedSession.id.startsWith('new-session-')
          ? `chat_messages_${selectedProject.name}_${selectedSession.id}`
          : null;
      const saved =
        (sessionScopedKey ? safeLocalStorage.getItem(sessionScopedKey) : null) ??
        safeLocalStorage.getItem(`chat_messages_${selectedProject.name}`);
      if (saved) {
        try {
          return hydrateStoredChatMessages(JSON.parse(saved) as ChatMessage[]);
        } catch {
          console.error('Failed to parse saved chat messages, resetting');
          if (sessionScopedKey) safeLocalStorage.removeItem(sessionScopedKey);
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
          return [];
        }
      }
      return [];
    }
    return [];
  });

  const setChatMessages = useCallback((updater: React.SetStateAction<ChatMessage[]>) => {
    _setChatMessages((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return hydrateStoredChatMessages(next);
    });
  }, []);

  const [isLoading, setIsLoading] = useState(() => {
    if (selectedSession?.id && processingSessions?.has(selectedSession.id)) {
      return true;
    }
    if (persistedInitialStartTime) {
      return true;
    }
    return false;
  });
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(selectedSession?.id || null);
  const [sessionMessages, setSessionMessages] = useState<ChatMessage[]>([]);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [isSystemSessionChange, setIsSystemSessionChange] = useState(false);
  const [canAbortSession, setCanAbortSession] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [tokenBudget, setTokenBudget] = useState<TokenBudget | null>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [claudeStatus, setClaudeStatus] = useState<{ text: string; tokens: number; can_interrupt: boolean; startTime?: number } | null>(() => {
    if (!persistedInitialStartTime) {
      return null;
    }

    return {
      text: RESUMING_STATUS_TEXT,
      tokens: 0,
      can_interrupt: true,
      startTime: persistedInitialStartTime,
    };
  });
  const [statusTextOverride, setStatusTextOverride] = useState<string | null>(null);
  const [allMessagesLoaded, setAllMessagesLoaded] = useState(false);
  const [isLoadingAllMessages, setIsLoadingAllMessages] = useState(false);
  const [loadAllJustFinished, setLoadAllJustFinished] = useState(false);
  const [showLoadAllOverlay, setShowLoadAllOverlay] = useState(false);
  const [pendingStatusValidationSessionId, setPendingStatusValidationSessionId] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isLoadingSessionRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const allMessagesLoadedRef = useRef(false);
  const topLoadLockRef = useRef(false);
  const pendingScrollRestoreRef = useRef<ScrollRestoreState | null>(null);
  const pendingInitialScrollRef = useRef(true);
  const messagesOffsetRef = useRef(0);
  const scrollPositionRef = useRef({ height: 0, top: 0 });
  const loadAllFinishedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadAllOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const createDiff = useMemo<DiffCalculator>(() => createCachedDiffCalculator(), []);

  const pendingStatusValidationSessionIdRef = useRef(pendingStatusValidationSessionId);
  useEffect(() => {
    pendingStatusValidationSessionIdRef.current = pendingStatusValidationSessionId;
  }, [pendingStatusValidationSessionId]);

  const markSessionStatusCheckPending = useCallback((sessionId?: string | null) => {
    if (!sessionId) {
      return;
    }

    setPendingStatusValidationSessionId(sessionId);
  }, []);

  const resolveSessionStatusCheck = useCallback((sessionId?: string | null) => {
    if (!sessionId) {
      return;
    }

    setPendingStatusValidationSessionId((previous) => (previous === sessionId ? null : previous));
  }, []);

  const loadSessionMessages = useCallback(
    async (projectName: string, sessionId: string, loadMore = false, provider: Provider | string = 'claude') => {
      if (!projectName || !sessionId) {
        return [] as ChatMessage[];
      }

      const isInitialLoad = !loadMore;
      const cacheKey = `${projectName}:${sessionId}`;
      if (isInitialLoad) {
        const cached = getCachedSessionMessages(cacheKey);
        if (cached) {
          if (cached.tokenUsage) setTokenBudget(cached.tokenUsage);
          setHasMoreMessages(cached.hasMore);
          setTotalMessages(cached.total);
          messagesOffsetRef.current = cached.messages.length;
          setIsLoadingSessionMessages(false);
          return cached.messages;
        }
        setIsLoadingSessionMessages(true);
      } else {
        setIsLoadingMoreMessages(true);
      }

      try {
        const currentOffset = loadMore ? messagesOffsetRef.current : 0;
        const response = await (api.sessionMessages as any)(
          projectName,
          sessionId,
          MESSAGES_PER_PAGE,
          currentOffset,
          provider,
        );
        if (!response.ok) {
          throw new Error('Failed to load session messages');
        }

        const data = await response.json();
        if (isInitialLoad && data.tokenUsage) {
          setTokenBudget(data.tokenUsage);
        }

        if (data.hasMore !== undefined) {
          const loadedCount = data.messages?.length || 0;
          setHasMoreMessages(Boolean(data.hasMore));
          setTotalMessages(Number(data.total || 0));
          messagesOffsetRef.current = currentOffset + loadedCount;
          if (isInitialLoad) {
            cacheSessionMessages(cacheKey, { messages: data.messages || [], tokenUsage: data.tokenUsage, total: Number(data.total || 0), hasMore: Boolean(data.hasMore) });
          }
          return data.messages || [];
        }

        const messages = data.messages || [];
        setHasMoreMessages(false);
        setTotalMessages(messages.length);
        messagesOffsetRef.current = messages.length;
        if (isInitialLoad) {
          cacheSessionMessages(cacheKey, { messages, tokenUsage: data.tokenUsage, total: messages.length, hasMore: false });
        }
        return messages;
      } catch (error) {
        console.error('Error loading session messages:', error);
        return [];
      } finally {
        if (isInitialLoad) {
          setIsLoadingSessionMessages(false);
        } else {
          setIsLoadingMoreMessages(false);
        }
      }
    },
    [],
  );

  const loadCursorSessionMessages = useCallback(async (projectPath: string, sessionId: string) => {
    if (!projectPath || !sessionId) {
      return [] as ChatMessage[];
    }

    setIsLoadingSessionMessages(true);
    try {
      const url = `/api/cursor/sessions/${encodeURIComponent(sessionId)}?projectPath=${encodeURIComponent(projectPath)}`;
      const response = await authenticatedFetch(url);
      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      const blobs = (data?.session?.messages || []) as any[];
      return convertCursorSessionMessages(blobs, projectPath);
    } catch (error) {
      console.error('Error loading Cursor session messages:', error);
      return [];
    } finally {
      setIsLoadingSessionMessages(false);
    }
  }, []);

  const convertedMessages = useMemo(() => {
    return convertSessionMessages(sessionMessages);
  }, [sessionMessages]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, []);

  const scrollToBottomAndReset = useCallback(() => {
    scrollToBottom();
    if (allMessagesLoaded) {
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
      setAllMessagesLoaded(false);
      allMessagesLoadedRef.current = false;
    }
  }, [allMessagesLoaded, scrollToBottom]);

  const isNearBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return false;
    }
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  const loadOlderMessages = useCallback(
    async (container: HTMLDivElement) => {
      if (!container || isLoadingMoreRef.current || isLoadingMoreMessages) {
        return false;
      }
      if (allMessagesLoadedRef.current) return false;
      if (!hasMoreMessages || !selectedSession || !selectedProject) {
        return false;
      }

      const sessionProvider = resolveSessionProviderForLoad(selectedSession, selectedProject) as Provider | string;
      if (sessionProvider === 'cursor') {
        return false;
      }

      isLoadingMoreRef.current = true;
      const previousScrollHeight = container.scrollHeight;
      const previousScrollTop = container.scrollTop;

      try {
        const moreMessages = await loadSessionMessages(
          selectedProject.name,
          selectedSession.id,
          true,
          sessionProvider,
        );

        if (moreMessages.length === 0) {
          return false;
        }

        pendingScrollRestoreRef.current = {
          height: previousScrollHeight,
          top: previousScrollTop,
        };
        setSessionMessages((previous) => [...moreMessages, ...previous]);
        // Keep the rendered window in sync with top-pagination so newly loaded history becomes visible.
        setVisibleMessageCount((previousCount) => previousCount + moreMessages.length);
        return true;
      } finally {
        isLoadingMoreRef.current = false;
      }
    },
    [hasMoreMessages, isLoadingMoreMessages, loadSessionMessages, selectedProject, selectedSession],
  );

  const handleScroll = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const nearBottom = isNearBottom();
    setIsUserScrolledUp(!nearBottom);

    if (!allMessagesLoadedRef.current) {
      const scrolledNearTop = container.scrollTop < 100;
      if (!scrolledNearTop) {
        topLoadLockRef.current = false;
        return;
      }

      if (topLoadLockRef.current) {
        if (container.scrollTop > 20) {
          topLoadLockRef.current = false;
        }
        return;
      }

      const didLoad = await loadOlderMessages(container);
      if (didLoad) {
        topLoadLockRef.current = true;
      }
    }
  }, [isNearBottom, loadOlderMessages]);

  useLayoutEffect(() => {
    if (!pendingScrollRestoreRef.current || !scrollContainerRef.current) {
      return;
    }

    const { height, top } = pendingScrollRestoreRef.current;
    const container = scrollContainerRef.current;
    const newScrollHeight = container.scrollHeight;
    const scrollDiff = newScrollHeight - height;
    container.scrollTop = top + Math.max(scrollDiff, 0);
    pendingScrollRestoreRef.current = null;
  }, [chatMessages.length]);

  useEffect(() => {
    pendingInitialScrollRef.current = true;
    topLoadLockRef.current = false;
    pendingScrollRestoreRef.current = null;
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setIsUserScrolledUp(false);
  }, [selectedProject?.name, selectedSession?.id]);

  useEffect(() => {
    if (!pendingInitialScrollRef.current || !scrollContainerRef.current || isLoadingSessionMessages) {
      return;
    }

    if (chatMessages.length === 0) {
      pendingInitialScrollRef.current = false;
      return;
    }

    pendingInitialScrollRef.current = false;
    setTimeout(() => {
      scrollToBottom();
    }, 200);
  }, [chatMessages.length, isLoadingSessionMessages, scrollToBottom]);

  // Keep refs to latest values so snapshot save never captures stale closures
  const chatMessagesRef = useRef(chatMessages);
  chatMessagesRef.current = chatMessages;
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;
  const claudeStatusRef = useRef(claudeStatus);
  claudeStatusRef.current = claudeStatus;
  const tokenBudgetRef = useRef(tokenBudget);
  tokenBudgetRef.current = tokenBudget;
  const canAbortSessionRef = useRef(canAbortSession);
  canAbortSessionRef.current = canAbortSession;

  const prevSessionIdRef = useRef<string | null>(selectedSession?.id || null);

  // Save snapshot of outgoing session when selectedSession changes
  useEffect(() => {
    const outgoingId = prevSessionIdRef.current;
    const incomingId = selectedSession?.id || null;

    if (outgoingId && outgoingId !== incomingId && chatMessagesRef.current.length > 0) {
      const container = scrollContainerRef.current;
      useSessionTabsStore.getState().saveSnapshot(outgoingId, {
        messages: chatMessagesRef.current,
        isLoading: isLoadingRef.current,
        statusText: claudeStatusRef.current?.text ?? null,
        tokenCount: claudeStatusRef.current?.tokens ?? 0,
        tokenBudget: tokenBudgetRef.current,
        scrollTop: container?.scrollTop ?? 0,
        canAbort: canAbortSessionRef.current,
      });
    }

    prevSessionIdRef.current = incomingId;
  }, [selectedSession?.id]);

  useEffect(() => {
    const loadMessages = async () => {
      if (selectedSession && selectedProject) {
        const currentProvider = resolveSessionProviderForLoad(selectedSession, selectedProject) as Provider | string;
        isLoadingSessionRef.current = true;

        const sessionChanged = currentSessionId !== null && currentSessionId !== selectedSession.id;

        // Try restoring from snapshot cache for instant tab switching
        if (sessionChanged && !isSystemSessionChange) {
          const snapshot = useSessionTabsStore.getState().getSnapshot(selectedSession.id);
          if (snapshot && snapshot.messages.length > 0) {
            useSessionTabsStore.getState().clearSnapshot(selectedSession.id);
            resetStreamingState();
            pendingViewSessionRef.current = null;
            setChatMessages(snapshot.messages);
            setSessionMessages([]);
            setIsLoading(snapshot.isLoading);
            setCanAbortSession(snapshot.canAbort);
            setTokenBudget(snapshot.tokenBudget);
            setStatusTextOverride(null);
            setCurrentSessionId(selectedSession.id);
            messagesOffsetRef.current = 0;
            setHasMoreMessages(false);
            setTotalMessages(snapshot.messages.length);
            setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
            setAllMessagesLoaded(false);
            allMessagesLoadedRef.current = false;

            if (snapshot.isLoading && snapshot.statusText) {
              setClaudeStatus({ text: snapshot.statusText, tokens: snapshot.tokenCount, can_interrupt: true });
            } else {
              setClaudeStatus(null);
              // Clear persisted timer so the "Resuming..." effect doesn't kick in
              clearSessionTimerStart(selectedSession.id);
            }

            // Clear any pending status validation to prevent spurious "Resuming..."
            setPendingStatusValidationSessionId(null);

            // Only check session status if the snapshot indicated the session was active
            if (snapshot.isLoading && ws && selectedSession?.id) {
              markSessionStatusCheckPending(selectedSession.id);
              sendMessage({
                type: 'check-session-status',
                sessionId: selectedSession.id,
                provider: currentProvider,
              });
            }

            // Restore scroll position after next paint
            const savedScrollTop = snapshot.scrollTop;
            requestAnimationFrame(() => {
              if (scrollContainerRef.current && savedScrollTop > 0) {
                scrollContainerRef.current.scrollTop = savedScrollTop;
              }
            });

            isLoadingSessionRef.current = false;
            return;
          }
        }

        if (sessionChanged) {
          if (!isSystemSessionChange) {
            resetStreamingState();
            pendingViewSessionRef.current = null;
            setChatMessages([]);
            setSessionMessages([]);
            setClaudeStatus(null);
            setCanAbortSession(false);
          }

          messagesOffsetRef.current = 0;
          setHasMoreMessages(false);
          setTotalMessages(0);
          setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
          setAllMessagesLoaded(false);
          allMessagesLoadedRef.current = false;
          setIsLoadingAllMessages(false);
          setLoadAllJustFinished(false);
          setShowLoadAllOverlay(false);
          if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
          if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
          setTokenBudget(null);
          
          const isProcessing =
            processingSessions?.has(selectedSession.id) ||
            pendingStatusValidationSessionIdRef.current === selectedSession.id;
          if (!isProcessing) {
            setIsLoading(false);
          }
        }

        if (ws && selectedSession?.id) {
          markSessionStatusCheckPending(selectedSession.id);
          sendMessage({
            type: 'check-session-status',
            sessionId: selectedSession.id,
            provider: currentProvider,
          });
        }

        if (currentProvider === 'cursor') {
          setCurrentSessionId(selectedSession.id);
          sessionStorage.setItem('cursorSessionId', selectedSession.id);

          if (!isSystemSessionChange) {
            const projectPath = selectedProject.fullPath || selectedProject.path || '';
            const converted = await loadCursorSessionMessages(projectPath, selectedSession.id);
            setSessionMessages([]);
            setChatMessages(converted);
          } else {
            setIsSystemSessionChange(false);
          }
        } else {
          setCurrentSessionId(selectedSession.id);

          if (!isSystemSessionChange) {
            const messages = await loadSessionMessages(
              selectedProject.name,
              selectedSession.id,
              false,
              currentProvider,
            );
            setSessionMessages(messages);
          } else {
            setIsSystemSessionChange(false);
          }
        }
      } else {
        if (!isSystemSessionChange) {
          resetStreamingState();
          pendingViewSessionRef.current = null;
          setChatMessages([]);
          setSessionMessages([]);
          setClaudeStatus(null);
          setCanAbortSession(false);
          setIsLoading(false);
        }

        setCurrentSessionId(null);
        sessionStorage.removeItem('cursorSessionId');
        messagesOffsetRef.current = 0;
        setHasMoreMessages(false);
        setTotalMessages(0);
        setTokenBudget(null);
      }

      setTimeout(() => {
        isLoadingSessionRef.current = false;
      }, 250);
    };

    loadMessages();
  }, [
    // Intentionally exclude currentSessionId: this effect sets it and should not retrigger another full load.
    isSystemSessionChange,
    loadCursorSessionMessages,
    loadSessionMessages,
    pendingViewSessionRef,
    resetStreamingState,
    markSessionStatusCheckPending,
    selectedProject,
    selectedSession,
    sendMessage,
    ws,
  ]);

  useEffect(() => {
    if (!externalMessageUpdate || !selectedSession || !selectedProject) {
      return;
    }

    const reloadExternalMessages = async () => {
      try {
        const provider = resolveSessionProviderForLoad(selectedSession, selectedProject) as Provider;

        if (provider === 'cursor') {
          const projectPath = selectedProject.fullPath || selectedProject.path || '';
          const converted = await loadCursorSessionMessages(projectPath, selectedSession.id);
          setSessionMessages([]);
          setChatMessages(converted);
          return;
        }

        const messages = await loadSessionMessages(
          selectedProject.name,
          selectedSession.id,
          false,
          provider,
        );
        setSessionMessages(messages);

        const shouldAutoScroll = Boolean(autoScrollToBottom) && isNearBottom();
        if (shouldAutoScroll) {
          setTimeout(() => scrollToBottom(), 200);
        }
      } catch (error) {
        console.error('Error reloading messages from external update:', error);
      }
    };

    reloadExternalMessages();
  }, [
    autoScrollToBottom,
    externalMessageUpdate,
    isNearBottom,
    loadCursorSessionMessages,
    loadSessionMessages,
    scrollToBottom,
    selectedProject,
    selectedSession,
  ]);

  useEffect(() => {
    if (selectedSession?.id) {
      pendingViewSessionRef.current = null;
    }
  }, [pendingViewSessionRef, selectedSession?.id]);

  useEffect(() => {
    // Sync converted messages to chat state.
    // We update even for empty arrays to clear old state when switching to an empty session.
    setChatMessages(convertedMessages);
  }, [convertedMessages, setChatMessages]);

  useEffect(() => {
    if (!selectedProject || chatMessages.length === 0) return;
    // Use session-scoped key when possible to avoid cross-session collisions.
    const key =
      selectedSession?.id && !selectedSession.id.startsWith('new-session-')
        ? `chat_messages_${selectedProject.name}_${selectedSession.id}`
        : `chat_messages_${selectedProject.name}`;
    safeLocalStorage.setItem(key, JSON.stringify(chatMessages));
  }, [chatMessages, selectedProject, selectedSession?.id]);

  useEffect(() => {
    if (!selectedProject || !selectedSession?.id || isTemporarySessionId(selectedSession.id)) {
      setTokenBudget(null);
      return;
    }

    const sessionProvider = resolveSessionProviderForLoad(selectedSession, selectedProject) as Provider | string;
    if (sessionProvider === 'cursor') {
      setTokenBudget(null);
      return;
    }

    const fetchInitialTokenUsage = async () => {
      try {
        const url = `/api/projects/${selectedProject.name}/sessions/${selectedSession.id}/token-usage?provider=${encodeURIComponent(sessionProvider)}`;
        const response = await authenticatedFetch(url);
        if (response.ok) {
          const data = await response.json();
          setTokenBudget(data as TokenBudget);
        } else {
          setTokenBudget(null);
        }
      } catch (error) {
        console.error('Failed to fetch initial token usage:', error);
      }
    };

    fetchInitialTokenUsage();
  }, [selectedProject, selectedSession]);

  const visibleMessages = useMemo(() => {
    if (chatMessages.length <= visibleMessageCount) {
      return chatMessages;
    }
    return chatMessages.slice(-visibleMessageCount);
  }, [chatMessages, visibleMessageCount]);

  useEffect(() => {
    if (!autoScrollToBottom && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      scrollPositionRef.current = {
        height: container.scrollHeight,
        top: container.scrollTop,
      };
    }
  });

  useEffect(() => {
    if (!scrollContainerRef.current || chatMessages.length === 0) {
      return;
    }

    if (isLoadingMoreRef.current || isLoadingMoreMessages || pendingScrollRestoreRef.current) {
      return;
    }

    if (autoScrollToBottom) {
      if (!isUserScrolledUp) {
        setTimeout(() => scrollToBottom(), 50);
      }
      return;
    }

    const container = scrollContainerRef.current;
    const prevHeight = scrollPositionRef.current.height;
    const prevTop = scrollPositionRef.current.top;
    const newHeight = container.scrollHeight;
    const heightDiff = newHeight - prevHeight;

    if (heightDiff > 0 && prevTop > 0) {
      container.scrollTop = prevTop + heightDiff;
    }
  }, [autoScrollToBottom, chatMessages.length, isLoadingMoreMessages, isUserScrolledUp, scrollToBottom]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    const activeViewSessionId = selectedSession?.id || currentSessionId;
    if (!activeViewSessionId) {
      return;
    }

    const persistedStartTime = readSessionTimerStart(activeViewSessionId);
    if (persistedStartTime) {
      setClaudeStatus((previous) => {
        if (previous?.startTime === persistedStartTime) {
          return previous;
        }

        return {
          text: previous?.text || RESUMING_STATUS_TEXT,
          tokens: previous?.tokens || 0,
          can_interrupt: previous?.can_interrupt !== false,
          startTime: persistedStartTime,
        };
      });
    }

    const isTrackedProcessing = Boolean(processingSessions?.has(activeViewSessionId));
    const isAwaitingStatusValidation =
      pendingStatusValidationSessionId === activeViewSessionId && Boolean(persistedStartTime);
    const shouldBeProcessing = isTrackedProcessing || isAwaitingStatusValidation;

    if (shouldBeProcessing && !isLoading) {
      setIsLoading(true);
      setCanAbortSession(true);
    }
  }, [currentSessionId, isLoading, pendingStatusValidationSessionId, processingSessions, selectedSession?.id]);

  useEffect(() => {
    const activeViewSessionId = selectedSession?.id || currentSessionId;
    if (!activeViewSessionId || pendingStatusValidationSessionId !== activeViewSessionId) {
      return;
    }

    const persistedStartTime = readSessionTimerStart(activeViewSessionId);
    if (!persistedStartTime || processingSessions?.has(activeViewSessionId)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (processingSessions?.has(activeViewSessionId)) {
        return;
      }

      const latestPersistedStartTime = readSessionTimerStart(activeViewSessionId);
      if (latestPersistedStartTime !== persistedStartTime) {
        return;
      }

      clearSessionTimerStart(activeViewSessionId);
      setPendingStatusValidationSessionId((previous) => (previous === activeViewSessionId ? null : previous));
      setClaudeStatus((previous) => (previous?.text === RESUMING_STATUS_TEXT ? null : previous));
      setIsLoading(false);
      setCanAbortSession(false);
    }, STATUS_VALIDATION_TIMEOUT_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [currentSessionId, pendingStatusValidationSessionId, processingSessions, selectedSession?.id]);

  // Show "Load all" overlay after a batch finishes loading, persist for 2s then hide
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isLoadingMoreMessages;

    if (wasLoading && !isLoadingMoreMessages && hasMoreMessages) {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
      setShowLoadAllOverlay(true);
      loadAllOverlayTimerRef.current = setTimeout(() => {
        setShowLoadAllOverlay(false);
      }, 2000);
    }
    if (!hasMoreMessages && !isLoadingMoreMessages) {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
      setShowLoadAllOverlay(false);
    }
    return () => {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
    };
  }, [isLoadingMoreMessages, hasMoreMessages]);

  const loadAllMessages = useCallback(async () => {
    if (!selectedSession || !selectedProject) return;
    if (isLoadingAllMessages) return;
    const sessionProvider = resolveSessionProviderForLoad(selectedSession, selectedProject) as Provider | string;
    if (sessionProvider === 'cursor') {
      setVisibleMessageCount(Infinity);
      setAllMessagesLoaded(true);
      allMessagesLoadedRef.current = true;
      setLoadAllJustFinished(true);
      if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
      loadAllFinishedTimerRef.current = setTimeout(() => {
        setLoadAllJustFinished(false);
        setShowLoadAllOverlay(false);
      }, 1000);
      return;
    }

    const requestSessionId = selectedSession.id;

    allMessagesLoadedRef.current = true;
    isLoadingMoreRef.current = true;
    setIsLoadingAllMessages(true);
    setShowLoadAllOverlay(true);

    const container = scrollContainerRef.current;
    const previousScrollHeight = container ? container.scrollHeight : 0;
    const previousScrollTop = container ? container.scrollTop : 0;

    try {
      const response = await (api.sessionMessages as any)(
        selectedProject.name,
        requestSessionId,
        null,
        0,
        sessionProvider,
      );

      if (currentSessionId !== requestSessionId) return;

      if (response.ok) {
        const data = await response.json();
        const allMessages = data.messages || data;

        if (container) {
          pendingScrollRestoreRef.current = {
            height: previousScrollHeight,
            top: previousScrollTop,
          };
        }

        setSessionMessages(Array.isArray(allMessages) ? allMessages : []);
        setHasMoreMessages(false);
        setTotalMessages(Array.isArray(allMessages) ? allMessages.length : 0);
        messagesOffsetRef.current = Array.isArray(allMessages) ? allMessages.length : 0;

        setVisibleMessageCount(Infinity);
        setAllMessagesLoaded(true);

        setLoadAllJustFinished(true);
        if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
        loadAllFinishedTimerRef.current = setTimeout(() => {
          setLoadAllJustFinished(false);
          setShowLoadAllOverlay(false);
        }, 1000);
      } else {
        allMessagesLoadedRef.current = false;
        setShowLoadAllOverlay(false);
      }
    } catch (error) {
      console.error('Error loading all messages:', error);
      allMessagesLoadedRef.current = false;
      setShowLoadAllOverlay(false);
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingAllMessages(false);
    }
  }, [selectedSession, selectedProject, isLoadingAllMessages, currentSessionId]);

  const loadEarlierMessages = useCallback(() => {
    setVisibleMessageCount((previousCount) => previousCount + 100);
  }, []);

  return {
    chatMessages,
    setChatMessages,
    isLoading,
    setIsLoading,
    currentSessionId,
    setCurrentSessionId,
    sessionMessages,
    setSessionMessages,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    isSystemSessionChange,
    setIsSystemSessionChange,
    canAbortSession,
    setCanAbortSession,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    claudeStatus,
    setClaudeStatus,
    statusTextOverride,
    setStatusTextOverride,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    isNearBottom,
    handleScroll,
    loadSessionMessages,
    loadCursorSessionMessages,
    resolveSessionStatusCheck,
  };
}
