import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import { api, authenticatedFetch } from '../../../utils/api';
import { RESUMING_STATUS_TEXT } from '../types/types';
import type { ChatMessage, Provider, TokenBudget } from '../types/types';
import type { Project, ProjectSession } from '../../../types/app';
import {
  buildChatMessagesStorageKey,
  clearScopedProviderSessionId,
  persistScopedProviderSessionId,
  clearSessionTimerStart,
  readSessionTimerStart,
  safeLocalStorage,
} from '../utils/chatStorage';
import { DEFAULT_PROVIDER, normalizeProvider } from '../../../utils/providerPolicy';
import {
  convertCursorSessionMessages,
  convertSessionMessages,
  createCachedDiffCalculator,
  type DiffCalculator,
} from '../utils/messageTransforms';
import {
  resolveSessionLoadProvider,
  shouldSkipSessionMessageLoad,
} from '../utils/sessionLoadGuards';
import { buildSessionMessageCacheCandidateKeys } from '../utils/sessionMessageCache';
import {
  buildSessionSnapshotKey,
  cloneSessionSnapshot,
  createSessionSnapshot,
  type SessionSnapshot,
} from '../utils/sessionSnapshotCache';
import {
  buildSessionScopeKey,
  parseSessionScopeKey,
  scopeKeyMatchesSessionId,
} from '../../../utils/sessionScope';

const MESSAGES_PER_PAGE = 20;
const INITIAL_VISIBLE_MESSAGES = 100;
/** Grace period for WebSocket status-check response before clearing stale resume state */
const STATUS_VALIDATION_TIMEOUT_MS = 5000;
const MAX_SESSION_SNAPSHOT_CACHE_ENTRIES = 40;
/**
 * Infer provider from project session lists when session metadata is incomplete.
 * This is a final fallback only after session-bound and UI provider hints are considered.
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

function readStoredChatMessages(
  projectName: string,
  sessionId: string,
  provider: Provider | string | null | undefined,
  options: {
    allowLegacyFallback?: boolean;
  } = {},
): ChatMessage[] {
  const candidateKeys = buildSessionMessageCacheCandidateKeys(
    projectName,
    sessionId,
    provider,
    options,
  );

  for (const key of candidateKeys) {
    const raw = safeLocalStorage.getItem(key);
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as ChatMessage[];
      }
    } catch {
      console.error(`Failed to parse saved chat messages for key: ${key}`);
      safeLocalStorage.removeItem(key);
    }
  }

  return [];
}

function hasSessionHistoryHint(session: ProjectSession | null | undefined): boolean {
  if (!session) {
    return false;
  }

  const rawMessageCount = session.messageCount;
  if (typeof rawMessageCount === 'number') {
    return rawMessageCount > 0;
  }

  const parsedMessageCount = Number(rawMessageCount);
  return Number.isFinite(parsedMessageCount) && parsedMessageCount > 0;
}

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

interface UseChatSessionStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  activeProvider?: Provider | null;
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

const MESSAGE_ID_PREVIEW_LIMIT = 120;

function toStablePreview(value: unknown, maxLength = MESSAGE_ID_PREVIEW_LIMIT): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.slice(0, maxLength);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}

function buildFallbackMessageFingerprint(message: ChatMessage): string {
  const timestampValue = new Date(message.timestamp).getTime();
  const normalizedTimestamp = Number.isFinite(timestampValue)
    ? String(timestampValue)
    : toStablePreview(message.timestamp, 40);

  return [
    message.type || '',
    normalizedTimestamp,
    toStablePreview(message.content),
    toStablePreview(message.reasoning),
    toStablePreview(message.toolName, 80),
    toStablePreview(message.toolInput),
    message.isToolUse ? 'tool' : 'plain',
  ].join('|');
}

export function useChatSessionState({
  selectedProject,
  selectedSession,
  activeProvider,
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
    if (typeof window !== 'undefined' && selectedProject && selectedSession?.id) {
      const providerHint = selectedSession.__provider
        || (activeProvider as Provider | undefined)
        || (window.localStorage.getItem('selected-provider') as Provider | null);
      const inferredProvider = providerHint
        || resolveSessionProviderForLoad(selectedSession, selectedProject);
      const allowLegacyFallback = !providerHint;
      return readStoredChatMessages(
        selectedProject.name,
        selectedSession.id,
        normalizeProvider(inferredProvider || DEFAULT_PROVIDER),
        { allowLegacyFallback },
      );
    }
    return [];
  });

  const generatedMessageIdMapRef = useRef<Map<string, string>>(new Map());

  const setChatMessages = useCallback((updater: React.SetStateAction<ChatMessage[]>) => {
    _setChatMessages((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      let hasChanges = false;
      const occurrenceByFingerprint = new Map<string, number>();
      const final = next.map((msg) => {
        if (!msg.id && !msg.messageId && !msg.toolId && !msg.toolCallId && !msg.blobId && !msg.rowid && !msg.sequence) {
          const fingerprint = buildFallbackMessageFingerprint(msg);
          const occurrence = (occurrenceByFingerprint.get(fingerprint) || 0) + 1;
          occurrenceByFingerprint.set(fingerprint, occurrence);
          const cacheKey = `${fingerprint}#${occurrence}`;
          const existingId = generatedMessageIdMapRef.current.get(cacheKey);
          const nextId = existingId || ((typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : Math.random().toString(36).substring(2, 15));
          if (!existingId) {
            generatedMessageIdMapRef.current.set(cacheKey, nextId);
          }
          hasChanges = true;
          return { ...msg, messageId: nextId };
        }
        return msg;
      });
      return hasChanges ? final : next;
    });
  }, []);

  const hasProcessingSession = useCallback(
    (
      sessionId: string | null | undefined,
      provider: Provider | string | null | undefined,
      projectName: string | null | undefined = selectedProject?.name || null,
    ) => {
      if (!processingSessions || !sessionId || !projectName) {
        return false;
      }

      const scopeKey = buildSessionScopeKey(projectName, provider || DEFAULT_PROVIDER, sessionId);
      if (scopeKey && processingSessions.has(scopeKey)) {
        return true;
      }

      if (processingSessions.has(sessionId)) {
        return true;
      }

      for (const trackingKey of processingSessions) {
        if (scopeKeyMatchesSessionId(trackingKey, sessionId)) {
          const parsed = parseSessionScopeKey(trackingKey);
          if (!parsed) {
            continue;
          }
          if (parsed.projectName === projectName) {
            const normalizedProvider = normalizeProvider(provider || DEFAULT_PROVIDER);
            if (parsed.provider === normalizedProvider) {
              return true;
            }
          }
        }
      }

      return false;
    },
    [processingSessions, selectedProject?.name],
  );

  const resolvePreferredLoadProvider = useCallback(
    (
      session: ProjectSession | null,
      project: Project | null,
    ): Provider => {
      if (session?.__provider) {
        return resolveSessionLoadProvider(session.__provider);
      }

      if (activeProvider) {
        return resolveSessionLoadProvider(activeProvider);
      }

      if (typeof window !== 'undefined') {
        const persistedProvider = window.localStorage.getItem('selected-provider');
        if (persistedProvider) {
          return resolveSessionLoadProvider(persistedProvider as Provider);
        }
      }

      const inferredProvider = resolveSessionProviderForLoad(session, project);
      if (inferredProvider) {
        return resolveSessionLoadProvider(inferredProvider);
      }

      return resolveSessionLoadProvider(DEFAULT_PROVIDER);
    },
    [activeProvider],
  );

  const [isLoading, setIsLoading] = useState(() => {
    if (selectedSession?.id && selectedProject?.name) {
      const initialProvider = resolvePreferredLoadProvider(selectedSession, selectedProject);
      const scopeKey = buildSessionScopeKey(
        selectedProject.name,
        initialProvider,
        selectedSession.id,
      );
      if (scopeKey && processingSessions?.has(scopeKey)) {
        return true;
      }
    }
    if (persistedInitialStartTime) {
      return true;
    }
    return false;
  });
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(selectedSession?.id || null);
  const [sessionMessages, setSessionMessages] = useState<any[]>([]);
  const [isSessionMessagesAuthoritative, setIsSessionMessagesAuthoritative] = useState(false);
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
  const initialLoadCountRef = useRef(0);
  const moreLoadCountRef = useRef(0);
  const latestSelectionRef = useRef<{ projectName: string | null; sessionId: string | null }>({
    projectName: selectedProject?.name || null,
    sessionId: selectedSession?.id || null,
  });
  const sessionLoadGenerationRef = useRef(0);
  const externalReloadGenerationRef = useRef(0);
  const allMessagesLoadedRef = useRef(false);
  const topLoadLockRef = useRef(false);
  const pendingScrollRestoreRef = useRef<ScrollRestoreState | null>(null);
  const pendingInitialScrollRef = useRef(true);
  const messagesOffsetRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const scrollPositionRef = useRef({ height: 0, top: 0 });
  const loadAllFinishedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadAllOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionSnapshotCacheRef = useRef<Map<string, SessionSnapshot>>(new Map());

  const createDiff = useMemo<DiffCalculator>(() => createCachedDiffCalculator(), []);

  const rememberSessionSnapshot = useCallback(
    (
      projectName: string | null | undefined,
      sessionId: string | null | undefined,
      provider: Provider | string | null | undefined,
      nextSessionMessages: unknown[] | null | undefined,
      nextChatMessages: ChatMessage[] | null | undefined,
    ) => {
      const cacheKey = buildSessionSnapshotKey(projectName, sessionId, provider);
      if (!cacheKey) {
        return;
      }

      const cache = sessionSnapshotCacheRef.current;
      if (cache.has(cacheKey)) {
        cache.delete(cacheKey);
      }

      cache.set(cacheKey, createSessionSnapshot(provider, nextSessionMessages, nextChatMessages));

      if (cache.size > MAX_SESSION_SNAPSHOT_CACHE_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey) {
          cache.delete(oldestKey);
        }
      }
    },
    [],
  );

  const readSessionSnapshot = useCallback(
    (
      projectName: string | null | undefined,
      sessionId: string | null | undefined,
      provider: Provider | string | null | undefined,
    ): SessionSnapshot | null => {
      const cacheKey = buildSessionSnapshotKey(projectName, sessionId, provider);
      if (!cacheKey) {
        return null;
      }

      const snapshot = sessionSnapshotCacheRef.current.get(cacheKey);
      return snapshot ? cloneSessionSnapshot(snapshot) : null;
    },
    [],
  );

  const pendingStatusValidationSessionIdRef = useRef(pendingStatusValidationSessionId);
  useEffect(() => {
    pendingStatusValidationSessionIdRef.current = pendingStatusValidationSessionId;
  }, [pendingStatusValidationSessionId]);

  useEffect(() => {
    latestSelectionRef.current = {
      projectName: selectedProject?.name || null,
      sessionId: selectedSession?.id || null,
    };
  }, [selectedProject?.name, selectedSession?.id]);

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
    async (projectName: string, sessionId: string, loadMore = false, provider: Provider | string = DEFAULT_PROVIDER) => {
      if (!projectName || !sessionId) {
        return [] as any[];
      }

      if (shouldSkipSessionMessageLoad(sessionId)) {
        if (!loadMore) {
          messagesOffsetRef.current = 0;
          setHasMoreMessages(false);
          setTotalMessages(0);
        }
        return [] as any[];
      }

      const isInitialLoad = !loadMore;
      if (isInitialLoad) {
        initialLoadCountRef.current += 1;
        setIsLoadingSessionMessages(true);
      } else {
        moreLoadCountRef.current += 1;
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
          return data.messages || [];
        }

        const messages = data.messages || [];
        setHasMoreMessages(false);
        setTotalMessages(messages.length);
        messagesOffsetRef.current = messages.length;
        return messages;
      } catch (error) {
        console.error('Error loading session messages:', error);
        return [];
      } finally {
        if (isInitialLoad) {
          initialLoadCountRef.current = Math.max(0, initialLoadCountRef.current - 1);
          setIsLoadingSessionMessages(initialLoadCountRef.current > 0);
        } else {
          moreLoadCountRef.current = Math.max(0, moreLoadCountRef.current - 1);
          setIsLoadingMoreMessages(moreLoadCountRef.current > 0);
        }
      }
    },
    [],
  );

  const loadCursorSessionMessages = useCallback(async (projectPath: string, sessionId: string) => {
    if (!projectPath || !sessionId) {
      return [] as ChatMessage[];
    }

    initialLoadCountRef.current += 1;
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
      initialLoadCountRef.current = Math.max(0, initialLoadCountRef.current - 1);
      setIsLoadingSessionMessages(initialLoadCountRef.current > 0);
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

      const sessionProvider = normalizeProvider(selectedSession.__provider || DEFAULT_PROVIDER);
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
        setSessionMessages((previous) => {
          const nextMessages = [...moreMessages, ...previous];
          rememberSessionSnapshot(
            selectedProject.name,
            selectedSession.id,
            sessionProvider,
            nextMessages,
            [],
          );
          return nextMessages;
        });
        // Keep the rendered window in sync with top-pagination so newly loaded history becomes visible.
        setVisibleMessageCount((previousCount) => previousCount + moreMessages.length);
        return true;
      } finally {
        isLoadingMoreRef.current = false;
      }
    },
    [hasMoreMessages, isLoadingMoreMessages, loadSessionMessages, rememberSessionSnapshot, selectedProject, selectedSession],
  );

  const handleScroll = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const currentScrollTop = container.scrollTop;
    const wasScrollingUp = currentScrollTop <= lastScrollTopRef.current;
    lastScrollTopRef.current = currentScrollTop;

    const nearBottom = isNearBottom();
    setIsUserScrolledUp(!nearBottom);

    if (!allMessagesLoadedRef.current) {
      if (!wasScrollingUp) {
        topLoadLockRef.current = false;
        return;
      }

      const scrolledNearTop = currentScrollTop < 100;
      if (!scrolledNearTop) {
        topLoadLockRef.current = false;
        return;
      }

      if (topLoadLockRef.current) {
        if (currentScrollTop > 20) {
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
  }, [chatMessages.length, sessionMessages.length]);

  useEffect(() => {
    pendingInitialScrollRef.current = true;
    topLoadLockRef.current = false;
    pendingScrollRestoreRef.current = null;
    lastScrollTopRef.current = 0;
    initialLoadCountRef.current = 0;
    moreLoadCountRef.current = 0;
    generatedMessageIdMapRef.current.clear();
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setIsUserScrolledUp(false);
    setIsSessionMessagesAuthoritative(false);
    setIsLoadingSessionMessages(false);
    setIsLoadingMoreMessages(false);
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

  useEffect(() => {
    let cancelled = false;
    const requestGeneration = sessionLoadGenerationRef.current + 1;
    sessionLoadGenerationRef.current = requestGeneration;
    const requestSelection = {
      projectName: selectedProject?.name || null,
      sessionId: selectedSession?.id || null,
    };
    const isStaleRequest = () =>
      cancelled
      || sessionLoadGenerationRef.current !== requestGeneration
      || latestSelectionRef.current.projectName !== requestSelection.projectName
      || latestSelectionRef.current.sessionId !== requestSelection.sessionId;

    const loadMessages = async () => {
      if (selectedSession && selectedProject) {
        const currentProvider = resolvePreferredLoadProvider(selectedSession, selectedProject);
        isLoadingSessionRef.current = true;
        const cachedSnapshot =
          !isSystemSessionChange
            ? readSessionSnapshot(selectedProject.name, selectedSession.id, currentProvider)
            : null;
        const cachedStoredMessages =
          !isSystemSessionChange
            ? readStoredChatMessages(selectedProject.name, selectedSession.id, currentProvider)
            : [];

        const sessionChanged = currentSessionId !== null && currentSessionId !== selectedSession.id;
        if (sessionChanged) {
          if (!isSystemSessionChange) {
            resetStreamingState();
            pendingViewSessionRef.current = null;
            if (cachedSnapshot) {
              if (currentProvider === 'cursor') {
                setSessionMessages([]);
                setIsSessionMessagesAuthoritative(false);
                setChatMessages(cachedSnapshot.chatMessages);
              } else {
                setSessionMessages(cachedSnapshot.sessionMessages);
                setIsSessionMessagesAuthoritative(true);
              }
            } else if (cachedStoredMessages.length > 0) {
              setSessionMessages([]);
              setIsSessionMessagesAuthoritative(false);
              setChatMessages(cachedStoredMessages);
            } else {
              setSessionMessages([]);
              setIsSessionMessagesAuthoritative(false);
              setChatMessages([]);
            }
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
          
          // Only set isLoading to false if it's NOT in the processingSessions set
          const isProcessing =
            hasProcessingSession(selectedSession.id, currentProvider, selectedProject.name) ||
            pendingStatusValidationSessionIdRef.current === selectedSession.id;
          if (!isProcessing) {
            setIsLoading(false);
          }
        }

        if (isStaleRequest()) {
          return;
        }

        // Always check status if we have a websocket and a session, 
        // especially on initial load or reconnect.
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
          persistScopedProviderSessionId(selectedProject.name, 'cursor', selectedSession.id);

          if (!isSystemSessionChange) {
            const projectPath = selectedProject.fullPath || selectedProject.path || '';
            const converted = await loadCursorSessionMessages(projectPath, selectedSession.id);
            if (isStaleRequest()) {
              return;
            }
            const shouldKeepCachedCursorMessages =
              converted.length === 0
              && cachedStoredMessages.length > 0
              && hasSessionHistoryHint(selectedSession);
            const nextCursorMessages = shouldKeepCachedCursorMessages
              ? cachedStoredMessages
              : converted;
            setSessionMessages([]);
            setIsSessionMessagesAuthoritative(false);
            setChatMessages(nextCursorMessages);
            rememberSessionSnapshot(
              selectedProject.name,
              selectedSession.id,
              currentProvider,
              [],
              nextCursorMessages,
            );
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
            if (isStaleRequest()) {
              return;
            }
            const shouldKeepCachedHistory =
              messages.length === 0
              && cachedStoredMessages.length > 0
              && hasSessionHistoryHint(selectedSession);

            if (shouldKeepCachedHistory) {
              setSessionMessages([]);
              setIsSessionMessagesAuthoritative(false);
              setChatMessages(cachedStoredMessages);
              rememberSessionSnapshot(
                selectedProject.name,
                selectedSession.id,
                currentProvider,
                [],
                cachedStoredMessages,
              );
            } else {
              setSessionMessages(messages);
              setIsSessionMessagesAuthoritative(true);
              rememberSessionSnapshot(
                selectedProject.name,
                selectedSession.id,
                currentProvider,
                messages,
                [],
              );
            }
          } else {
            setIsSystemSessionChange(false);
          }
        }
      } else {
        const pendingViewSessionId =
          pendingViewSessionRef.current?.sessionId || null;
        const hasPendingOptimisticSession =
          Boolean(pendingViewSessionRef.current) ||
          Boolean(currentSessionId && currentSessionId.startsWith("new-session-"));
        const pendingOptimisticSessionId =
          pendingViewSessionId || currentSessionId || null;
          const hasPendingProcessing =
          pendingOptimisticSessionId
            ? hasProcessingSession(
                pendingOptimisticSessionId,
                selectedSession?.__provider || DEFAULT_PROVIDER,
                selectedProject?.name || null,
              )
            : Boolean(
                processingSessions &&
                  Array.from(processingSessions).some((sessionKey) =>
                    sessionKey.startsWith('new-session-') || sessionKey.includes('::new-session-'),
                  ),
              );
        const hasPendingStartTime = Boolean(
          pendingOptimisticSessionId &&
            readSessionTimerStart(pendingOptimisticSessionId),
        );
        const shouldKeepPendingLoading =
          hasPendingOptimisticSession &&
          (hasPendingProcessing || hasPendingStartTime);

        if (!isSystemSessionChange) {
          if (hasPendingOptimisticSession) {
            setCanAbortSession(shouldKeepPendingLoading);
            if (shouldKeepPendingLoading) {
              setIsLoading(true);
            }
          } else {
            resetStreamingState();
            pendingViewSessionRef.current = null;
            setChatMessages([]);
            setSessionMessages([]);
            setIsSessionMessagesAuthoritative(false);
            setClaudeStatus(null);
            setCanAbortSession(false);
            setIsLoading(false);
          }
        }

        if (hasPendingOptimisticSession) {
          if (!currentSessionId && pendingViewSessionId) {
            setCurrentSessionId(pendingViewSessionId);
          }
        } else {
          setCurrentSessionId(null);
          clearScopedProviderSessionId(selectedProject?.name || null, 'cursor');
          messagesOffsetRef.current = 0;
          setHasMoreMessages(false);
          setTotalMessages(0);
          setTokenBudget(null);
        }
      }

      setTimeout(() => {
        if (isStaleRequest()) {
          return;
        }
        isLoadingSessionRef.current = false;
      }, 250);
    };

    loadMessages();
    return () => {
      cancelled = true;
    };
  }, [
    // Intentionally exclude currentSessionId: this effect sets it and should not retrigger another full load.
    isSystemSessionChange,
    loadCursorSessionMessages,
    loadSessionMessages,
    readSessionSnapshot,
    pendingViewSessionRef,
    rememberSessionSnapshot,
    resetStreamingState,
    resolvePreferredLoadProvider,
    markSessionStatusCheckPending,
    hasProcessingSession,
    processingSessions,
    selectedProject,
    selectedSession,
    sendMessage,
    ws,
  ]);

  useEffect(() => {
    if (!externalMessageUpdate || !selectedSession || !selectedProject) {
      return;
    }

    let cancelled = false;
    const requestGeneration = externalReloadGenerationRef.current + 1;
    externalReloadGenerationRef.current = requestGeneration;
    const reloadSelection = {
      projectName: selectedProject.name,
      sessionId: selectedSession.id,
    };
    const isStaleReload = () =>
      cancelled
      || externalReloadGenerationRef.current !== requestGeneration
      || latestSelectionRef.current.projectName !== reloadSelection.projectName
      || latestSelectionRef.current.sessionId !== reloadSelection.sessionId;

    const reloadExternalMessages = async () => {
      try {
        const provider = resolvePreferredLoadProvider(selectedSession, selectedProject);
        const cachedStoredMessages = readStoredChatMessages(
          selectedProject.name,
          selectedSession.id,
          provider,
        );

        if (provider === 'cursor') {
          const projectPath = selectedProject.fullPath || selectedProject.path || '';
          const converted = await loadCursorSessionMessages(projectPath, selectedSession.id);
          if (isStaleReload()) {
            return;
          }
          const shouldKeepCachedCursorMessages =
            converted.length === 0
            && cachedStoredMessages.length > 0
            && hasSessionHistoryHint(selectedSession);
          const nextCursorMessages = shouldKeepCachedCursorMessages
            ? cachedStoredMessages
            : converted;
          setSessionMessages([]);
          setIsSessionMessagesAuthoritative(false);
          setChatMessages(nextCursorMessages);
          rememberSessionSnapshot(
            selectedProject.name,
            selectedSession.id,
            provider,
            [],
            nextCursorMessages,
          );
          return;
        }

        const messages = await loadSessionMessages(
          selectedProject.name,
          selectedSession.id,
          false,
          provider,
        );
        if (isStaleReload()) {
          return;
        }
        const shouldKeepCachedHistory =
          messages.length === 0
          && cachedStoredMessages.length > 0
          && hasSessionHistoryHint(selectedSession);

        if (shouldKeepCachedHistory) {
          setSessionMessages([]);
          setIsSessionMessagesAuthoritative(false);
          setChatMessages(cachedStoredMessages);
          rememberSessionSnapshot(
            selectedProject.name,
            selectedSession.id,
            provider,
            [],
            cachedStoredMessages,
          );
        } else {
          setSessionMessages(messages);
          setIsSessionMessagesAuthoritative(true);
          rememberSessionSnapshot(
            selectedProject.name,
            selectedSession.id,
            provider,
            messages,
            [],
          );
        }

        const shouldAutoScroll = Boolean(autoScrollToBottom) && isNearBottom();
        if (shouldAutoScroll) {
          setTimeout(() => scrollToBottom(), 200);
        }
      } catch (error) {
        console.error('Error reloading messages from external update:', error);
      }
    };

    reloadExternalMessages();
    return () => {
      cancelled = true;
    };
  }, [
    autoScrollToBottom,
    externalMessageUpdate,
    isNearBottom,
    loadCursorSessionMessages,
    loadSessionMessages,
    rememberSessionSnapshot,
    resolvePreferredLoadProvider,
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
    // Only sync converted session payloads when sessionMessages are the authoritative source.
    // Cursor and compatibility fallbacks write directly to chatMessages.
    if (!isSessionMessagesAuthoritative) {
      return;
    }
    setChatMessages(convertedMessages);
  }, [convertedMessages, isSessionMessagesAuthoritative, setChatMessages]);

  useEffect(() => {
    const activeSessionId = selectedSession?.id || currentSessionId;
    const resolvedActiveProvider = resolvePreferredLoadProvider(selectedSession, selectedProject);
    const storageKey = buildChatMessagesStorageKey(
      selectedProject?.name || null,
      activeSessionId,
      resolvedActiveProvider,
    );

    if (!storageKey) {
      return;
    }

    if (chatMessages.length > 0) {
      safeLocalStorage.setItem(storageKey, JSON.stringify(chatMessages));
      return;
    }

    if (isLoadingSessionMessages || isLoading || !isSessionMessagesAuthoritative) {
      return;
    }

    safeLocalStorage.removeItem(storageKey);
  }, [
    chatMessages,
    currentSessionId,
    isLoading,
    isLoadingSessionMessages,
    isSessionMessagesAuthoritative,
    resolvePreferredLoadProvider,
    selectedProject,
    selectedSession,
    selectedProject?.name,
    selectedSession?.id,
    selectedSession?.__provider,
  ]);

  useEffect(() => {
    if (!selectedProject || !selectedSession?.id || selectedSession.id.startsWith('new-session-')) {
      setTokenBudget(null);
      return;
    }

    const sessionProvider = resolvePreferredLoadProvider(selectedSession, selectedProject);
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
  }, [resolvePreferredLoadProvider, selectedProject, selectedSession]);

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

    const activeProvider = resolvePreferredLoadProvider(selectedSession, selectedProject);
    const isTrackedProcessing = hasProcessingSession(
      activeViewSessionId,
      activeProvider,
      selectedProject?.name || null,
    );
    const isAwaitingStatusValidation =
      pendingStatusValidationSessionId === activeViewSessionId && Boolean(persistedStartTime);
    const shouldBeProcessing = isTrackedProcessing || isAwaitingStatusValidation;

    if (shouldBeProcessing && !isLoading) {
      setIsLoading(true);
      setCanAbortSession(true);
    }
  }, [
    currentSessionId,
    hasProcessingSession,
    isLoading,
    pendingStatusValidationSessionId,
    resolvePreferredLoadProvider,
    selectedProject,
    selectedProject?.name,
    selectedSession?.id,
    selectedSession?.__provider,
  ]);

  useEffect(() => {
    const activeViewSessionId = selectedSession?.id || currentSessionId;
    if (!activeViewSessionId || pendingStatusValidationSessionId !== activeViewSessionId) {
      return;
    }

    const persistedStartTime = readSessionTimerStart(activeViewSessionId);
    if (
      !persistedStartTime ||
      hasProcessingSession(
        activeViewSessionId,
        resolvePreferredLoadProvider(selectedSession, selectedProject),
        selectedProject?.name || null,
      )
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (
        hasProcessingSession(
          activeViewSessionId,
          resolvePreferredLoadProvider(selectedSession, selectedProject),
          selectedProject?.name || null,
        )
      ) {
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
  }, [
    currentSessionId,
    hasProcessingSession,
    pendingStatusValidationSessionId,
    resolvePreferredLoadProvider,
    selectedProject,
    selectedProject?.name,
    selectedSession?.id,
    selectedSession?.__provider,
  ]);

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
    const sessionProvider = normalizeProvider(selectedSession.__provider || DEFAULT_PROVIDER);
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
        rememberSessionSnapshot(
          selectedProject.name,
          requestSessionId,
          sessionProvider,
          Array.isArray(allMessages) ? allMessages : [],
          [],
        );

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
  }, [currentSessionId, isLoadingAllMessages, rememberSessionSnapshot, selectedProject, selectedSession]);

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

