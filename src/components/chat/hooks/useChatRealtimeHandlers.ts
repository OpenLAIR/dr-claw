import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  buildAssistantMessages,
  decodeHtmlEntities,
  formatUsageLimitText,
  unescapeWithMathProtection,
} from '../utils/chatFormatting';
import { parseAskUserAnswers, mergeAnswersIntoToolInput } from '../utils/messageTransforms';
import {
  clearSessionTimerStart,
  moveSessionTimerStart,
  persistSessionTimerStart,
  safeLocalStorage,
} from '../utils/chatStorage';
import { invalidateSessionMessageCache } from './useChatSessionState';
import { RESUMING_STATUS_TEXT } from '../types/types';
import i18n from '../../../i18n/config';
import type { ChatMessage, PendingPermissionRequest } from '../types/types';
import type { Project, ProjectSession, SessionNavigationSource, SessionProvider } from '../../../types/app';

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

type LatestChatMessage = {
  type?: string;
  data?: any;
  sessionId?: string;
  requestId?: string;
  toolName?: string;
  input?: unknown;
  context?: unknown;
  error?: string;
  tool?: string;
  exitCode?: number;
  isProcessing?: boolean;
  actualSessionId?: string;
  [key: string]: any;
};

interface UseChatRealtimeHandlersArgs {
  latestMessage: LatestChatMessage | null;
  provider: SessionProvider;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setCurrentSessionId: (sessionId: string | null) => void;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: Dispatch<SetStateAction<{ text: string; tokens: number; can_interrupt: boolean; startTime?: number } | null>>;
  setStatusTextOverride: Dispatch<SetStateAction<string | null>>;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  setIsSystemSessionChange: (isSystemSessionChange: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  streamBufferRef: MutableRefObject<string>;
  streamTimerRef: MutableRefObject<number | null>;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  onSessionStatusResolved?: (sessionId?: string | null, isProcessing?: boolean) => void;
  onReplaceTemporarySession?: (sessionId?: string | null) => void;
  onNavigateToSession?: (
    sessionId: string,
    sessionProvider?: SessionProvider,
    targetProjectName?: string,
    options?: { source?: SessionNavigationSource },
  ) => void;
}

type FinalizeSessionLifecycleOptions = {
  projectName?: string | null;
  clearSessionTimerStart?: (sessionId: string) => void;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  onSessionStatusResolved?: (sessionId?: string | null, isProcessing?: boolean) => void;
  invalidateSessionCache?: (projectName: string, sessionId: string) => void;
};

export function finalizeSessionLifecycle(
  sessionIds: Array<string | null | undefined>,
  {
    projectName,
    clearSessionTimerStart: clearTimer = clearSessionTimerStart,
    onSessionInactive,
    onSessionNotProcessing,
    onSessionStatusResolved,
    invalidateSessionCache = invalidateSessionMessageCache,
  }: FinalizeSessionLifecycleOptions,
) {
  const normalizedSessionIds = Array.from(
    new Set(
      sessionIds.filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0),
    ),
  );

  normalizedSessionIds.forEach((sessionId) => {
    clearTimer(sessionId);
    onSessionInactive?.(sessionId);
    onSessionNotProcessing?.(sessionId);
    onSessionStatusResolved?.(sessionId, false);
    if (projectName) {
      invalidateSessionCache(projectName, sessionId);
    }
  });
}

const appendStreamingChunk = (
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  chunk: string,
  newline = false,
) => {
  if (!chunk) {
    return;
  }

  setChatMessages((previous) => {
    const updated = [...previous];
    const lastIndex = updated.length - 1;
    const last = updated[lastIndex];
    if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
      const nextContent = newline
        ? last.content
          ? `${last.content}\n${chunk}`
          : chunk
        : `${last.content || ''}${chunk}`;
      updated[lastIndex] = { ...last, content: nextContent };
    } else {
      updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
    }
    return updated;
  });
};

// NOTE: unescapeWithMathProtection, formatUsageLimitText, and splitLegacyGeminiThoughtContent
// are safe no-ops for non-Gemini text, so no provider guard is needed here.
const finalizeStreamingMessage = (setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>) => {
  setChatMessages((previous) => {
    const updated = [...previous];
    const lastIndex = updated.length - 1;
    const last = updated[lastIndex];
    if (last && last.type === 'assistant' && last.isStreaming) {
      const normalizedContent = unescapeWithMathProtection(formatUsageLimitText(String(last.content || '')));
      const messages = buildAssistantMessages(normalizedContent, last.timestamp || new Date());
      updated.splice(
        lastIndex,
        1,
        ...messages.map((msg) => ({
          ...last,
          content: msg.content,
          isStreaming: false,
          isThinking: msg.isThinking || false,
        })),
      );
    }
    return updated;
  });
};

const isLegacyTaskMasterInstallError = (value: unknown): boolean => {
  const normalized = String(value || '').toLowerCase();
  if (!normalized.includes('taskmaster')) {
    return false;
  }

  return normalized.includes('not installed') || normalized.includes('not configured');
};

export function useChatRealtimeHandlers({
  latestMessage,
  provider,
  selectedProject,
  selectedSession,
  currentSessionId,
  setCurrentSessionId,
  setChatMessages,
  setIsLoading,
  setCanAbortSession,
  setClaudeStatus,
  setStatusTextOverride,
  setTokenBudget,
  setIsSystemSessionChange,
  setPendingPermissionRequests,
  pendingViewSessionRef,
  streamBufferRef,
  streamTimerRef,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  onSessionStatusResolved,
  onReplaceTemporarySession,
  onNavigateToSession,
}: UseChatRealtimeHandlersArgs) {
  const lastProcessedMessageRef = useRef<LatestChatMessage | null>(null);

  // Helper: Handle structured assistant content
  const handleStructuredAssistantMessage = (structuredData: any, rawData: any) => {
    // New assistant message = previous tool execution done; clear override.
    // If this message contains a new Bash tool_use, it will be re-set below (React batches both updates).
    setStatusTextOverride(null);

    const parentToolUseId = rawData?.parentToolUseId;
    const newMessages: any[] = [];
    const childToolUpdates: { parentId: string; child: any }[] = [];

    structuredData.content.forEach((part: any) => {
      if (part.type === 'thinking' || part.type === 'reasoning') {
        const thinkingText = part.thinking || part.reasoning || part.text || '';
        if (thinkingText.trim()) {
          newMessages.push({
            type: 'assistant',
            content: unescapeWithMathProtection(thinkingText),
            timestamp: new Date(),
            isThinking: true,
            isStreaming: true,
          });
        }
        return;
      }

      if (part.type === 'tool_use') {
        if (['Bash', 'run_shell_command'].includes(part.name)) {
          // Set running code status when command starts
          setStatusTextOverride(i18n.t('chat:status.runningCode'));
        }
        const toolInput = part.input ? JSON.stringify(part.input, null, 2) : '';

        if (parentToolUseId) {
          childToolUpdates.push({
            parentId: parentToolUseId,
            child: {
              toolId: part.id,
              toolName: part.name,
              toolInput: part.input,
              toolResult: null,
              timestamp: new Date(),
            },
          });
          return;
        }

        const isSubagentContainer = part.name === 'Task';
        newMessages.push({
          type: 'assistant',
          content: '',
          timestamp: new Date(),
          isToolUse: true,
          toolName: part.name,
          toolInput,
          toolId: part.id,
          toolResult: null,
          isSubagentContainer,
          subagentState: isSubagentContainer
            ? { childTools: [], currentToolIndex: -1, isComplete: false }
            : undefined,
        });
        return;
      }

      if (part.type === 'text' && part.text?.trim()) {
        let content = decodeHtmlEntities(part.text);
        content = formatUsageLimitText(content);
        newMessages.push(...buildAssistantMessages(content, new Date()));
      }
    });

    if (newMessages.length > 0 || childToolUpdates.length > 0) {
      setChatMessages((previous) => {
        let updated = previous;
        if (childToolUpdates.length > 0) {
          updated = updated.map((message) => {
            if (!message.isSubagentContainer) return message;
            const updates = childToolUpdates.filter((u) => u.parentId === message.toolId);
            if (updates.length === 0) return message;
            const existingChildren = message.subagentState?.childTools || [];
            const newChildren = updates.map((u) => u.child);
            return {
              ...message,
              subagentState: {
                childTools: [...existingChildren, ...newChildren],
                currentToolIndex: existingChildren.length + newChildren.length - 1,
                isComplete: false,
              },
            };
          });
        }
        if (newMessages.length > 0) {
          updated = [...updated, ...newMessages];
        }
        return updated;
      });
    }
  };

  // Helper: Handle simple text assistant message
  const handleSimpleAssistantMessage = (structuredData: any) => {
    let content = decodeHtmlEntities(structuredData.content);
    content = formatUsageLimitText(content);

    setChatMessages((previous) => [
      ...previous,
      ...buildAssistantMessages(content, new Date()),
    ]);
  };

  // Helper: Handle user tool results
  const handleUserToolResults = (structuredData: any, rawData: any) => {
    const parentToolUseId = rawData?.parentToolUseId;
    const toolResults = structuredData.content.filter((part: any) => part.type === 'tool_result');
    const textParts = structuredData.content.filter((part: any) => part.type === 'text');

    if (textParts.length > 0) {
      const textContent = textParts.map((p: any) => p.text || '').join('\n');
      const isSkillText =
        textContent.includes('Base directory for this skill:') ||
        textContent.startsWith('<command-name>') ||
        textContent.startsWith('<command-message>') ||
        textContent.startsWith('<command-args>') ||
        textContent.startsWith('<local-command-stdout>') ||
        (toolResults.length > 0 && !textContent.startsWith('<system-reminder>'));
      if (isSkillText && textContent.trim()) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'user',
            content: textContent,
            timestamp: new Date(),
            isSkillContent: true,
          },
        ]);
      }
    }

    if (toolResults.length > 0) {
      // Reset "running code" status when tool results arrive (tool execution finished)
      setStatusTextOverride(null);

      setChatMessages((previous) =>
        previous.map((message) => {
          for (const part of toolResults) {
            if (parentToolUseId && message.toolId === parentToolUseId && message.isSubagentContainer) {
              const updatedChildren = message.subagentState!.childTools.map((child: any) => {
                if (child.toolId === part.tool_use_id) {
                  return {
                    ...child,
                    toolResult: {
                      content: part.content,
                      isError: part.is_error,
                      timestamp: new Date(),
                    },
                  };
                }
                return child;
              });
              if (updatedChildren !== message.subagentState!.childTools) {
                return {
                  ...message,
                  subagentState: {
                    ...message.subagentState!,
                    childTools: updatedChildren,
                  },
                };
              }
            }

            if (message.isToolUse && message.toolId === part.tool_use_id) {
              const result: any = {
                ...message,
                toolResult: {
                  content: part.content,
                  isError: part.is_error,
                  timestamp: new Date(),
                },
              };
              if (message.toolName === 'AskUserQuestion' && part.content) {
                const resultStr = typeof part.content === 'string' ? part.content : JSON.stringify(part.content);
                const parsedAnswers = parseAskUserAnswers(resultStr);
                if (parsedAnswers) {
                  const inputStr = typeof message.toolInput === 'string'
                    ? message.toolInput
                    : JSON.stringify(message.toolInput || {});
                  result.toolInput = mergeAnswersIntoToolInput(inputStr, parsedAnswers);
                }
              }
              if (message.isSubagentContainer && message.subagentState) {
                result.subagentState = {
                  ...message.subagentState,
                  isComplete: true,
                };
              }
              return result;
            }
          }
          return message;
        }),
      );
    }
  };

  useEffect(() => {
    if (!latestMessage) {
      return;
    }

    if (lastProcessedMessageRef.current === latestMessage) {
      return;
    }
    lastProcessedMessageRef.current = latestMessage;

    const messageData = latestMessage.data?.message || latestMessage.data;
    const structuredMessageData =
      messageData && typeof messageData === 'object' ? (messageData as Record<string, any>) : null;
    const rawStructuredData =
      latestMessage.data && typeof latestMessage.data === 'object'
        ? (latestMessage.data as Record<string, any>)
        : null;

    const globalMessageTypes = ['projects_updated', 'taskmaster-project-updated', 'session-created', 'session-aborted'];
    const isGlobalMessage = globalMessageTypes.includes(String(latestMessage.type));
    const lifecycleMessageTypes = new Set([
      'claude-complete',
      'codex-complete',
      'gemini-complete',
      'openrouter-complete',
      'localgpu-complete',
      'cursor-result',
      'session-aborted',
      'claude-error',
      'cursor-error',
      'codex-error',
      'gemini-error',
      'openrouter-error',
      'localgpu-error',
      'session-busy',
    ]);

    const isClaudeSystemInit =
      latestMessage.type === 'claude-response' &&
      structuredMessageData &&
      structuredMessageData.type === 'system' &&
      structuredMessageData.subtype === 'init';

    const isGeminiSystemInit =
      latestMessage.type === 'gemini-response' &&
      structuredMessageData &&
      structuredMessageData.type === 'system' &&
      structuredMessageData.subtype === 'init';

    const isCursorSystemInit =
      latestMessage.type === 'cursor-system' &&
      rawStructuredData &&
      rawStructuredData.type === 'system' &&
      rawStructuredData.subtype === 'init';

    const systemInitSessionId = isClaudeSystemInit || isGeminiSystemInit
      ? structuredMessageData?.session_id
      : isCursorSystemInit
      ? rawStructuredData?.session_id
      : null;

    const activeViewSessionId =
      selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || null;
    const isSystemInitForView =
      systemInitSessionId && (!activeViewSessionId || systemInitSessionId === activeViewSessionId);
    const shouldBypassSessionFilter = isGlobalMessage || Boolean(isSystemInitForView);
    const isUnscopedError =
      !latestMessage.sessionId &&
      pendingViewSessionRef.current &&
      !pendingViewSessionRef.current.sessionId &&
      (latestMessage.type === 'claude-error' ||
        latestMessage.type === 'cursor-error' ||
        latestMessage.type === 'codex-error' ||
        latestMessage.type === 'gemini-error');

    const handleBackgroundLifecycle = (sessionId?: string) => {
      finalizeSessionLifecycle([sessionId], {
        projectName: selectedProject?.name,
        onSessionInactive,
        onSessionNotProcessing,
        onSessionStatusResolved,
      });
    };

    const persistStartTime = (startTime?: number | null, ...sessionIds: Array<string | null | undefined>) => {
      if (!Number.isFinite(startTime)) {
        return;
      }

      const targetSessionId = sessionIds.find((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0);
      if (!targetSessionId) {
        return;
      }

      persistSessionTimerStart(targetSessionId, startTime);
    };

    const syncClaudeStatusStartTime = (startTime?: number | null, fallbackText = 'Processing') => {
      if (!Number.isFinite(startTime)) {
        return;
      }

      const normalizedStartTime = startTime as number;

      setClaudeStatus((prev) => ({
        text: prev?.text || fallbackText,
        tokens: prev?.tokens || 0,
        can_interrupt: prev?.can_interrupt !== undefined ? prev.can_interrupt : true,
        startTime: normalizedStartTime,
      }));
    };

    const clearLoadingIndicators = () => {
      setIsLoading(false);
      setCanAbortSession(false);
      setClaudeStatus(null);
      setStatusTextOverride(null);
    };

    const flushAndFinalizePendingStream = () => {
      if (streamTimerRef.current) {
        clearTimeout(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      const chunk = streamBufferRef.current;
      streamBufferRef.current = '';
      appendStreamingChunk(setChatMessages, chunk, false);
      finalizeStreamingMessage(setChatMessages);
    };

    const markSessionsAsCompleted = (...sessionIds: Array<string | null | undefined>) => {
      finalizeSessionLifecycle(sessionIds, {
        projectName: selectedProject?.name,
        onSessionInactive,
        onSessionNotProcessing,
        onSessionStatusResolved,
      });
    };

    if (!shouldBypassSessionFilter) {
      if (!activeViewSessionId) {
        if (latestMessage.sessionId && lifecycleMessageTypes.has(String(latestMessage.type))) {
          handleBackgroundLifecycle(latestMessage.sessionId);
        }
        if (!isUnscopedError) {
          return;
        }
      }

      if (!latestMessage.sessionId && !isUnscopedError) {
        return;
      }

      if (latestMessage.sessionId !== activeViewSessionId) {
        if (latestMessage.sessionId && lifecycleMessageTypes.has(String(latestMessage.type))) {
          handleBackgroundLifecycle(latestMessage.sessionId);
        }
        return;
      }
    }

    switch (latestMessage.type) {
      case 'session-created':
        if (latestMessage.sessionId && (!currentSessionId || currentSessionId.startsWith('new-session-'))) {
          const createdSessionProvider =
            (latestMessage.provider as SessionProvider | undefined) || provider;
          const pendingStartTime = pendingViewSessionRef.current?.startedAt;
          const temporarySessionId = currentSessionId?.startsWith('new-session-') ? currentSessionId : null;
          if (temporarySessionId) {
            moveSessionTimerStart(temporarySessionId, latestMessage.sessionId);
          }
          persistStartTime(
            typeof latestMessage.startTime === 'number' ? latestMessage.startTime : pendingStartTime,
            latestMessage.sessionId,
          );
          if (selectedProject && latestMessage.mode) {
            safeLocalStorage.setItem(`session_mode_${selectedProject.name}_${latestMessage.sessionId}`, String(latestMessage.mode));
          }
          sessionStorage.setItem('pendingSessionId', latestMessage.sessionId);
          if ((latestMessage as any).provider === 'gemini') {
            sessionStorage.setItem('geminiSessionId', latestMessage.sessionId);
          } else if (latestMessage.model) {
            sessionStorage.setItem('cursorSessionId', latestMessage.sessionId);
          }
          if (pendingViewSessionRef.current && !pendingViewSessionRef.current.sessionId) {
            pendingViewSessionRef.current.sessionId = latestMessage.sessionId;
          }
          setIsSystemSessionChange(true);
          onReplaceTemporarySession?.(latestMessage.sessionId);
          onNavigateToSession?.(latestMessage.sessionId, createdSessionProvider, selectedProject?.name, { source: 'system' });
          setPendingPermissionRequests((previous) =>
            previous.map((request) =>
              request.sessionId ? request : { ...request, sessionId: latestMessage.sessionId },
            ),
          );
        }
        break;

      case 'token-budget':
        if (latestMessage.data) {
          setTokenBudget(latestMessage.data);
        }
        break;

      case 'claude-response': {
        if (messageData && typeof messageData === 'object' && messageData.type) {
          if (Number.isFinite(messageData.startTime)) {
            persistStartTime(messageData.startTime, latestMessage.sessionId, currentSessionId, selectedSession?.id);
            syncClaudeStatusStartTime(messageData.startTime);
          }
          if (messageData.type === 'content_block_delta' && messageData.delta?.text) {
            setIsLoading(true);
            setStatusTextOverride(null);
            const decodedText = decodeHtmlEntities(messageData.delta.text);
            streamBufferRef.current += decodedText;
            if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, false);
              }, 30);
            }
            return;
          }
          if (messageData.type === 'content_block_stop') {
            if (streamTimerRef.current) {
              clearTimeout(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            const chunk = streamBufferRef.current;
            streamBufferRef.current = '';
            appendStreamingChunk(setChatMessages, chunk, false);
            finalizeStreamingMessage(setChatMessages);
            return;
          }
        }

        if (isClaudeSystemInit && structuredMessageData?.session_id && isSystemInitForView) {
          if (!currentSessionId || structuredMessageData.session_id !== currentSessionId) {
            console.log('Claude CLI session duplication or new init detected');
            setIsSystemSessionChange(true);
            onNavigateToSession?.(structuredMessageData.session_id, 'claude', selectedProject?.name, { source: 'system' });
            return;
          }
        }

        if (structuredMessageData && Array.isArray(structuredMessageData.content) && structuredMessageData.role === 'assistant') {
          handleStructuredAssistantMessage(structuredMessageData, rawStructuredData);
        } else if (structuredMessageData && structuredMessageData.role === 'assistant' && typeof structuredMessageData.content === 'string' && structuredMessageData.content.trim()) {
          handleSimpleAssistantMessage(structuredMessageData);
        }

        if (structuredMessageData?.role === 'user' && Array.isArray(structuredMessageData.content)) {
          handleUserToolResults(structuredMessageData, rawStructuredData);
        }
        break;
      }

      case 'gemini-response': {
        if (messageData && typeof messageData === 'object' && messageData.type) {
          if (Number.isFinite(messageData.startTime)) {
            persistStartTime(messageData.startTime, latestMessage.sessionId, currentSessionId, selectedSession?.id);
            syncClaudeStatusStartTime(messageData.startTime);
          }
          if (messageData.type === 'content_block_delta' && messageData.delta?.text) {
            setIsLoading(true);
            setStatusTextOverride(null);
            const decodedText = decodeHtmlEntities(messageData.delta.text);
            streamBufferRef.current += decodedText;
            if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, false);
              }, 30);
            }
            return;
          }
          if (messageData.type === 'content_block_stop') {
            if (streamTimerRef.current) {
              clearTimeout(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            const chunk = streamBufferRef.current;
            streamBufferRef.current = '';
            appendStreamingChunk(setChatMessages, chunk, false);
            finalizeStreamingMessage(setChatMessages);
            return;
          }
        }

        if (isGeminiSystemInit && structuredMessageData?.session_id && isSystemInitForView) {
          if (!currentSessionId || structuredMessageData.session_id !== currentSessionId) {
            console.log('Gemini CLI session init detected');
            setIsSystemSessionChange(true);
            onNavigateToSession?.(structuredMessageData.session_id, 'gemini', selectedProject?.name, { source: 'system' });
            return;
          }
        }

        if (structuredMessageData && Array.isArray(structuredMessageData.content) && structuredMessageData.role === 'assistant') {
          handleStructuredAssistantMessage(structuredMessageData, rawStructuredData);
        } else if (structuredMessageData && structuredMessageData.role === 'assistant' && typeof structuredMessageData.content === 'string' && structuredMessageData.content.trim()) {
          handleSimpleAssistantMessage(structuredMessageData);
        }

        if (structuredMessageData?.role === 'user' && Array.isArray(structuredMessageData.content)) {
          handleUserToolResults(structuredMessageData, rawStructuredData);
        }
        break;
      }

      case 'localgpu-response':
      case 'openrouter-response': {
        const orData = latestMessage.data;
        if (orData && typeof orData === 'object') {
          if (Number.isFinite(orData.startTime)) {
            persistStartTime(orData.startTime, latestMessage.sessionId, currentSessionId, selectedSession?.id);
            syncClaudeStatusStartTime(orData.startTime);
          }

          if (orData.type === 'assistant_message' && orData.message?.content) {
            setIsLoading(true);
            setStatusTextOverride(null);
            const text = orData.message.content;
            streamBufferRef.current += text;
            if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, false);
              }, 30);
            }
            return;
          }

          if (orData.type === 'structured_turn' && orData.message) {
            flushAndFinalizePendingStream();
            handleStructuredAssistantMessage(orData.message, orData);
            return;
          }

          if (orData.type === 'structured_result' && orData.message) {
            handleUserToolResults(orData.message, orData);
            return;
          }

          if (orData.type === 'tool_use') {
            flushAndFinalizePendingStream();
            if (['Bash', 'bash', 'run_shell_command'].includes(orData.toolName)) {
              setStatusTextOverride(i18n.t('chat:status.runningCode'));
            }
            const toolInput = orData.toolInput ? JSON.stringify(orData.toolInput, null, 2) : '';
            setChatMessages((prev) => [
              ...prev,
              {
                type: 'assistant' as const,
                content: '',
                timestamp: new Date(),
                isToolUse: true,
                toolName: orData.toolName,
                toolInput,
                toolId: orData.toolCallId,
                toolResult: null,
              },
            ]);
            return;
          }

          if (orData.type === 'tool_result') {
            setStatusTextOverride(null);
            setChatMessages((prev) => {
              const updated = [...prev];
              for (let i = updated.length - 1; i >= 0; i--) {
                if (updated[i].isToolUse && updated[i].toolId === orData.toolCallId) {
                  updated[i] = {
                    ...updated[i],
                    toolResult: {
                      content: orData.output,
                      isError: orData.isError || false,
                      timestamp: new Date(),
                    },
                  };
                  break;
                }
              }
              return updated;
            });
            return;
          }
        }
        break;
      }

      case 'claude-output': {
        const cleaned = String(latestMessage.data || '');
        if (cleaned.trim()) {
          streamBufferRef.current += streamBufferRef.current ? `\n${cleaned}` : cleaned;
          if (!streamTimerRef.current) {
            streamTimerRef.current = window.setTimeout(() => {
              const chunk = streamBufferRef.current;
              streamBufferRef.current = '';
              streamTimerRef.current = null;
              appendStreamingChunk(setChatMessages, chunk, true);
            }, 30);
          }
        }
        break;
      }

      case 'claude-complete':
      case 'gemini-complete':
      case 'openrouter-complete':
      case 'localgpu-complete': {
        const pendingSessionId = sessionStorage.getItem('pendingSessionId');
        const completedSessionId = latestMessage.sessionId || currentSessionId || pendingSessionId;
        flushAndFinalizePendingStream();
        clearLoadingIndicators();
        markSessionsAsCompleted(completedSessionId, currentSessionId, selectedSession?.id, pendingSessionId);
        if (pendingSessionId && !currentSessionId && latestMessage.exitCode === 0) {
          setCurrentSessionId(pendingSessionId);
          sessionStorage.removeItem('pendingSessionId');
        }
        if (selectedProject && latestMessage.exitCode === 0) {
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
        }
        setPendingPermissionRequests([]);
        break;
      }

      case 'claude-error':
      case 'gemini-error':
      case 'openrouter-error':
      case 'localgpu-error': {
        if (isLegacyTaskMasterInstallError(latestMessage.error)) {
          break;
        }
        const erroredSessionId =
          latestMessage.sessionId ||
          pendingViewSessionRef.current?.sessionId ||
          currentSessionId ||
          selectedSession?.id ||
          null;
        flushAndFinalizePendingStream();
        clearLoadingIndicators();
        markSessionsAsCompleted(erroredSessionId, currentSessionId, selectedSession?.id);
        // Clear pendingSessionId for the errored session (not all sessions — other tabs may be active)
        if (typeof window !== 'undefined') {
          const pendingSessionId = sessionStorage.getItem('pendingSessionId');
          if (pendingSessionId && (!erroredSessionId || pendingSessionId === erroredSessionId)) {
            sessionStorage.removeItem('pendingSessionId');
          }
        }
        setPendingPermissionRequests([]);
        const details = typeof latestMessage.details === 'string' ? latestMessage.details.trim() : '';
        const errorContent = details
          ? `Error: ${latestMessage.error}\n\n<details><summary>Technical details</summary>\n\n\`\`\`text\n${details.slice(0, 8000)}\n\`\`\`\n</details>`
          : `Error: ${latestMessage.error}`;
        setChatMessages((previous) => {
          const last = previous[previous.length - 1];
          if (last?.type === 'error' && String(last.content || '') === errorContent) {
            return previous;
          }
          return [
            ...previous,
            {
              type: 'error',
              content: errorContent,
              timestamp: new Date(),
              errorType: latestMessage.errorType,
              isRetryable: latestMessage.isRetryable === true,
            },
          ];
        });
        break;
      }

      case 'cursor-system':
        try {
          const cursorData = latestMessage.data;
          if (cursorData && cursorData.type === 'system' && cursorData.subtype === 'init' && cursorData.session_id) {
            if (!isSystemInitForView) return;
            if (!currentSessionId || cursorData.session_id !== currentSessionId) {
              setIsSystemSessionChange(true);
              onNavigateToSession?.(cursorData.session_id, 'cursor', selectedProject?.name, { source: 'system' });
            }
          }
        } catch (error) {
          console.warn('Error handling cursor-system message:', error);
        }
        break;

      case 'cursor-tool-use':
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'assistant',
            content: `Using tool: ${latestMessage.tool} ${latestMessage.input ? `with ${latestMessage.input}` : ''}`,
            timestamp: new Date(),
            isToolUse: true,
            toolName: latestMessage.tool,
            toolInput: latestMessage.input,
          },
        ]);
        break;

      case 'cursor-error':
        if (isLegacyTaskMasterInstallError(latestMessage.error)) break;
        flushAndFinalizePendingStream();
        clearLoadingIndicators();
        markSessionsAsCompleted(latestMessage.sessionId, currentSessionId, selectedSession?.id);
        setPendingPermissionRequests([]);
        setChatMessages((previous) => [
          ...previous,
          { type: 'error', content: `Cursor error: ${latestMessage.error || 'Unknown error'}`, timestamp: new Date(), errorType: latestMessage.errorType, isRetryable: latestMessage.isRetryable === true },
        ]);
        break;

      case 'cursor-result': {
        const cursorCompletedSessionId = latestMessage.sessionId || currentSessionId;
        const pendingCursorSessionId = sessionStorage.getItem('pendingSessionId');
        
        if (Number.isFinite(latestMessage.startTime)) {
          persistStartTime(latestMessage.startTime, latestMessage.sessionId, currentSessionId, selectedSession?.id);
          syncClaudeStatusStartTime(latestMessage.startTime);
        }

        clearLoadingIndicators();
        markSessionsAsCompleted(cursorCompletedSessionId, currentSessionId, selectedSession?.id, pendingCursorSessionId);
        try {
          const resultData = latestMessage.data || {};
          const textResult = typeof resultData.result === 'string' ? resultData.result : '';
          if (streamTimerRef.current) {
            clearTimeout(streamTimerRef.current);
            streamTimerRef.current = null;
          }
          const pendingChunk = streamBufferRef.current;
          streamBufferRef.current = '';
          setChatMessages((previous) => {
            const updated = [...previous];
            const lastIndex = updated.length - 1;
            const last = updated[lastIndex];
            if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
              const finalContent = textResult && textResult.trim() ? textResult : `${last.content || ''}${pendingChunk || ''}`;
              updated[lastIndex] = { ...last, content: finalContent, isStreaming: false };
            } else if (textResult && textResult.trim()) {
              updated.push({ type: resultData.is_error ? 'error' : 'assistant', content: textResult, timestamp: new Date(), isStreaming: false });
            }
            return updated;
          });
        } catch (error) {
          console.warn('Error handling cursor-result message:', error);
        }
        if (cursorCompletedSessionId && !currentSessionId && cursorCompletedSessionId === pendingCursorSessionId) {
          setCurrentSessionId(cursorCompletedSessionId);
          sessionStorage.removeItem('pendingSessionId');
          if (window.refreshProjects) setTimeout(() => window.refreshProjects?.(), 500);
        }
        break;
      }

      case 'cursor-output':
        try {
          if (Number.isFinite(latestMessage.startTime)) {
            persistStartTime(latestMessage.startTime, latestMessage.sessionId, currentSessionId, selectedSession?.id);
            syncClaudeStatusStartTime(latestMessage.startTime);
          }
          setIsLoading(true);
          const raw = String(latestMessage.data ?? '');
          const cleaned = raw
            .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
            .trim();
          if (cleaned) {
            streamBufferRef.current += streamBufferRef.current ? `\n${cleaned}` : cleaned;
            if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, true);
              }, 100);
            }
          }
        } catch (error) {
          console.warn('Error handling cursor-output message:', error);
        }
        break;

      case 'codex-response': {
        const codexData = latestMessage.data;
        if (!codexData) break;

        if (Number.isFinite(codexData.startTime)) {
          persistStartTime(codexData.startTime, latestMessage.sessionId, currentSessionId, selectedSession?.id);
          syncClaudeStatusStartTime(codexData.startTime);
        }

        setIsLoading(true);
        if (codexData.type === 'item') {
          const itemId = codexData.itemId;
          const lifecycle = codexData.lifecycle; // 'started' | 'completed' | 'other'

          switch (codexData.itemType) {
            case 'agent_message':
              if (codexData.message?.content?.trim()) {
                const content = decodeHtmlEntities(codexData.message.content);

                // Server marks system prompts; also detect on frontend as fallback
                const isSystemPrompt = codexData.isSystemPrompt ||
                  /^#\s+(AGENTS|SKILL|INSTRUCTIONS)/m.test(content) ||
                  content.includes('<INSTRUCTIONS>') ||
                  content.includes('</INSTRUCTIONS>') ||
                  /^#+\s+.*instructions\s+for\s+\//im.test(content) ||
                  (content.includes('Base directory for this skill:') && content.length > 500) ||
                  (content.length > 2000 && /^\d+\)\s/m.test(content) && /\bskill\b/i.test(content)) ||
                  ((content.match(/SKILL\.md\)/g) || []).length >= 3) ||
                  content.includes('### How to use skills') ||
                  content.includes('## How to use skills') ||
                  (content.includes('Trigger rules:') && content.includes('skill') && content.length > 500);

                if (isSystemPrompt) {
                  // Show as collapsed skill content
                  setChatMessages((previous) => [
                    ...previous,
                    {
                      type: 'user',
                      content,
                      timestamp: new Date(),
                      isSkillContent: true,
                    },
                  ]);
                } else {
                  setChatMessages((previous) => [
                    ...previous,
                    {
                      type: 'assistant',
                      content,
                      timestamp: new Date(),
                    },
                  ]);
                }
              }
              break;

            case 'reasoning':
              // Codex reasoning items are very brief status notes (e.g. "Planning API path inspection")
              // They add noise without value - skip them entirely for Codex sessions
              break;

            case 'command_execution':
              if (lifecycle !== 'completed') {
                setStatusTextOverride(i18n.t('chat:status.runningCode'));
              } else {
                setStatusTextOverride(null);
              }
              if (codexData.command) {
                const exitCode = codexData.exitCode;
                const output = codexData.output;
                // Wrap command in object format expected by Bash ToolRenderer
                const bashToolInput = { command: codexData.command };

                if (lifecycle === 'completed' && itemId) {
                  // Update existing tool message if it was added on 'started'
                  setChatMessages((previous) => {
                    const existingIdx = previous.findIndex(
                      (m) => m.codexItemId === itemId && m.isToolUse,
                    );
                    if (existingIdx >= 0) {
                      const updated = [...previous];
                      updated[existingIdx] = {
                        ...updated[existingIdx],
                        toolResult: output != null ? {
                          content: output,
                          isError: exitCode != null && exitCode !== 0,
                        } : null,
                        exitCode,
                      };
                      return updated;
                    }
                    // Not found, add new
                    return [
                      ...previous,
                      {
                        type: 'assistant',
                        content: '',
                        timestamp: new Date(),
                        isToolUse: true,
                        toolName: 'Bash',
                        toolInput: bashToolInput,
                        toolResult: output != null ? {
                          content: output,
                          isError: exitCode != null && exitCode !== 0,
                        } : null,
                        exitCode,
                        codexItemId: itemId,
                      },
                    ];
                  });
                } else {
                  // 'started' or no lifecycle - add new tool message
                  setChatMessages((previous) => [
                    ...previous,
                    {
                      type: 'assistant',
                      content: '',
                      timestamp: new Date(),
                      isToolUse: true,
                      toolName: 'Bash',
                      toolInput: bashToolInput,
                      toolResult: output != null ? {
                        content: output,
                        isError: exitCode != null && exitCode !== 0,
                        } : null,
                      exitCode,
                      codexItemId: itemId,
                    },
                  ]);
                }
              }
              break;

            case 'file_change':
              if (codexData.changes?.length > 0) {
                const changesList = codexData.changes
                  .map((change: { kind: string; path: string }) => `${change.kind}: ${change.path}`)
                  .join('\n');

                if (lifecycle === 'completed' && itemId) {
                  setChatMessages((previous) => {
                    const existingIdx = previous.findIndex(
                      (m) => m.codexItemId === itemId && m.isToolUse,
                    );
                    if (existingIdx >= 0) {
                      const updated = [...previous];
                      updated[existingIdx] = {
                        ...updated[existingIdx],
                        toolInput: changesList,
                        toolResult: {
                          content: `Status: ${codexData.status}`,
                          isError: false,
                        },
                      };
                      return updated;
                    }
                    return [
                      ...previous,
                      {
                        type: 'assistant',
                        content: '',
                        timestamp: new Date(),
                        isToolUse: true,
                        toolName: 'FileChanges',
                        toolInput: changesList,
                        toolResult: {
                          content: `Status: ${codexData.status}`,
                          isError: false,
                        },
                        codexItemId: itemId,
                      },
                    ];
                  });
                } else {
                  setChatMessages((previous) => [
                    ...previous,
                    {
                      type: 'assistant',
                      content: '',
                      timestamp: new Date(),
                      isToolUse: true,
                      toolName: 'FileChanges',
                      toolInput: changesList,
                      toolResult: codexData.status ? {
                        content: `Status: ${codexData.status}`,
                        isError: false,
                      } : null,
                      codexItemId: itemId,
                    },
                  ]);
                }
              }
              break;

            case 'mcp_tool_call': {
              const toolResult = codexData.result
                ? { content: JSON.stringify(codexData.result, null, 2), isError: false }
                : codexData.error?.message
                ? { content: codexData.error.message, isError: true }
                : null;

              if (lifecycle === 'completed' && itemId) {
                setChatMessages((previous) => {
                  const existingIdx = previous.findIndex(
                    (m) => m.codexItemId === itemId && m.isToolUse,
                  );
                  if (existingIdx >= 0) {
                    const updated = [...previous];
                    updated[existingIdx] = {
                      ...updated[existingIdx],
                      toolResult,
                    };
                    return updated;
                  }
                  return [
                    ...previous,
                    {
                      type: 'assistant',
                      content: '',
                      timestamp: new Date(),
                      isToolUse: true,
                      toolName: `${codexData.server}:${codexData.tool}`,
                      toolInput: JSON.stringify(codexData.arguments, null, 2),
                      toolResult,
                      codexItemId: itemId,
                    },
                  ];
                });
              } else {
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    isToolUse: true,
                    toolName: `${codexData.server}:${codexData.tool}`,
                    toolInput: JSON.stringify(codexData.arguments, null, 2),
                    toolResult,
                    codexItemId: itemId,
                  },
                ]);
              }
              break;
            }

            case 'web_search': {
              const query = codexData.query || 'Searching...';
              if (lifecycle === 'completed' && itemId) {
                // Update existing or add new
                setChatMessages((previous) => {
                  const existingIdx = previous.findIndex(
                    (m) => m.codexItemId === itemId && m.isToolUse,
                  );
                  if (existingIdx >= 0) {
                    // Already shown from 'started', no update needed for web_search
                    return previous;
                  }
                  return [
                    ...previous,
                    {
                      type: 'assistant',
                      content: '',
                      timestamp: new Date(),
                      isToolUse: true,
                      toolName: 'WebSearch',
                      toolInput: { command: query },
                      toolResult: null,
                      codexItemId: itemId,
                    },
                  ];
                });
              } else {
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    isToolUse: true,
                    toolName: 'WebSearch',
                    toolInput: { command: query },
                    toolResult: null,
                    codexItemId: itemId,
                  },
                ]);
              }
              break;
            }

            case 'error':
              if (codexData.message?.content) {
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'error',
                    content: codexData.message.content,
                    timestamp: new Date(),
                  },
                ]);
              }
              break;

            default:
              console.log('[Codex] Unhandled item type:', codexData.itemType, codexData);
          }
        }

        if (codexData.type === 'turn_complete' || codexData.type === 'turn_failed') {
          clearLoadingIndicators();
          markSessionsAsCompleted(latestMessage.sessionId, currentSessionId, selectedSession?.id);
          if (codexData.type === 'turn_failed') {
            setChatMessages((previous) => [...previous, { type: 'error', content: codexData.error?.message || 'Turn failed', timestamp: new Date() }]);
          }
        }
        break;
      }

      case 'codex-complete': {
        const codexPendingSessionId = sessionStorage.getItem('pendingSessionId');
        const codexActualSessionId = latestMessage.actualSessionId || codexPendingSessionId;
        const codexCompletedSessionId = latestMessage.sessionId || currentSessionId || codexPendingSessionId;
        clearLoadingIndicators();
        markSessionsAsCompleted(codexCompletedSessionId, codexActualSessionId, currentSessionId, selectedSession?.id, codexPendingSessionId);
        if (codexPendingSessionId && !currentSessionId) {
          setCurrentSessionId(codexActualSessionId);
          setIsSystemSessionChange(true);
          if (codexActualSessionId) {
            onNavigateToSession?.(codexActualSessionId, 'codex', selectedProject?.name, { source: 'system' });
          }
          sessionStorage.removeItem('pendingSessionId');
        }
        if (selectedProject) safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
        break;
      }

      case 'codex-error':
        if (isLegacyTaskMasterInstallError(latestMessage.error)) break;
        flushAndFinalizePendingStream();
        clearLoadingIndicators();
        markSessionsAsCompleted(latestMessage.sessionId, currentSessionId, selectedSession?.id);
        setPendingPermissionRequests([]);
        setChatMessages((previous) => [...previous, { type: 'error', content: latestMessage.error || 'An error occurred with Codex', timestamp: new Date(), errorType: latestMessage.errorType, isRetryable: latestMessage.isRetryable === true }]);
        break;

      case 'session-aborted': {
        const pendingSessionId = typeof window !== 'undefined' ? sessionStorage.getItem('pendingSessionId') : null;
        const abortedSessionId = latestMessage.sessionId || currentSessionId;
        if (latestMessage.success !== false) {
          clearLoadingIndicators();
          markSessionsAsCompleted(abortedSessionId, currentSessionId, selectedSession?.id, pendingSessionId);
          if (pendingSessionId && (!abortedSessionId || pendingSessionId === abortedSessionId)) sessionStorage.removeItem('pendingSessionId');
          setPendingPermissionRequests([]);
          setChatMessages((previous) => [...previous, { type: 'assistant', content: 'Session interrupted by user.', timestamp: new Date() }]);
        } else {
          clearLoadingIndicators();
          setPendingPermissionRequests([]);
          setChatMessages((previous) => [...previous, { type: 'error', content: 'Session has already finished.', timestamp: new Date() }]);
        }
        break;
      }

      case 'session-busy':
        console.warn(`[session-busy] Session ${latestMessage.sessionId} is already processing (${latestMessage.provider})`);
        setChatMessages((previous) => {
          const busyMsg = 'This session is still processing. Please wait for the current response to complete.';
          const last = previous[previous.length - 1];
          if (last?.type === 'error' && last.content === busyMsg) return previous;
          return [...previous, { type: 'error', content: busyMsg, timestamp: new Date() }];
        });
        break;

      case 'session-status': {
        const statusSessionId = latestMessage.sessionId;
        const isCurrentSession = statusSessionId === currentSessionId || (selectedSession && statusSessionId === selectedSession.id);
        if (isCurrentSession && latestMessage.isProcessing) {
          persistStartTime(latestMessage.startTime, statusSessionId, currentSessionId, selectedSession?.id);
          setIsLoading(true);
          setCanAbortSession(true);
          onSessionProcessing?.(statusSessionId);
          onSessionStatusResolved?.(statusSessionId, true);
          // If we have a startTime from the backend, sync our status
          if (Number.isFinite(latestMessage.startTime)) {
            syncClaudeStatusStartTime(latestMessage.startTime, RESUMING_STATUS_TEXT);
          }
        } else if (isCurrentSession && latestMessage.isProcessing === false) {
          clearSessionTimerStart(statusSessionId);
          clearLoadingIndicators();
          onSessionNotProcessing?.(statusSessionId);
          onSessionStatusResolved?.(statusSessionId, false);
        }
        break;
      }

      case 'claude-permission-request': {
        const { requestId, toolName, input: toolInput } = latestMessage;
        if (!requestId || !toolName) break;

        setPendingPermissionRequests((previous) => {
          if (previous.some((p) => p.requestId === requestId)) return previous;
          return [
            ...previous,
            {
              requestId,
              toolName,
              input: toolInput,
              sessionId: latestMessage.sessionId || currentSessionId,
              receivedAt: new Date(),
            },
          ];
        });
        
        // Ensure UI is in loading/waiting state
        setIsLoading(true);
        setCanAbortSession(true);
        break;
      }

      case 'claude-permission-cancelled': {
        const { requestId } = latestMessage;
        if (!requestId) break;
        setPendingPermissionRequests((previous) => previous.filter((p) => p.requestId !== requestId));
        break;
      }

      case 'claude-status':
      case 'gemini-status': {
        const statusData = latestMessage.data;
        if (!statusData) break;
        persistStartTime(statusData.startTime, latestMessage.sessionId, currentSessionId, selectedSession?.id);
        const statusInfo = { 
          text: statusData.message || statusData.status || (typeof statusData === 'string' ? statusData : 'Working...'), 
          tokens: statusData.tokens || statusData.token_count || 0, 
          can_interrupt: statusData.can_interrupt !== undefined ? statusData.can_interrupt : true,
          startTime: statusData.startTime // Use startTime from message if provided
        };
        
        // Use updater function to preserve existing startTime if not provided in message
        setClaudeStatus(prev => ({
          ...statusInfo,
          startTime: Number.isFinite(statusInfo.startTime) ? statusInfo.startTime : prev?.startTime
        }));
        
        setIsLoading(true);
        setCanAbortSession(statusInfo.can_interrupt);
        break;
      }

      default:
        break;
    }
  }, [
    latestMessage, provider, selectedProject, selectedSession, currentSessionId, setCurrentSessionId,
    setChatMessages, setIsLoading, setCanAbortSession, setClaudeStatus, setStatusTextOverride, setTokenBudget,
    setIsSystemSessionChange, setPendingPermissionRequests, onSessionInactive, onSessionProcessing,
    onSessionNotProcessing, onSessionStatusResolved, onReplaceTemporarySession, onNavigateToSession,
  ]);
}
