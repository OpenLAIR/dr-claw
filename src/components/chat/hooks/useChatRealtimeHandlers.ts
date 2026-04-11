import { useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  buildAssistantMessages,
  decodeHtmlEntities,
  formatUsageLimitText,
  unescapeWithMathProtection,
} from "../utils/chatFormatting";
import {
  parseAskUserAnswers,
  mergeAnswersIntoToolInput,
} from "../utils/messageTransforms";
import {
  buildChatMessagesStorageKey,
  clearScopedPendingSessionId,
  clearSessionTimerStart,
  moveSessionTimerStart,
  persistSessionTimerStart,
  persistScopedPendingSessionId,
  persistScopedProviderSessionId,
  readScopedPendingSessionId,
  safeLocalStorage,
} from "../utils/chatStorage";
import { RESUMING_STATUS_TEXT } from "../types/types";
import i18n from "../../../i18n/config";
import type { ChatMessage, PendingPermissionRequest } from "../types/types";
import type {
  Project,
  ProjectSession,
  SessionProvider,
} from "../../../types/app";
import { normalizeProvider } from "../../../utils/providerPolicy";

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
  setClaudeStatus: Dispatch<
    SetStateAction<{
      text: string;
      tokens: number;
      can_interrupt: boolean;
      startTime?: number;
    } | null>
  >;
  setStatusTextOverride: Dispatch<SetStateAction<string | null>>;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  setIsSystemSessionChange: (isSystemSessionChange: boolean) => void;
  setPendingPermissionRequests: Dispatch<
    SetStateAction<PendingPermissionRequest[]>
  >;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  streamBufferRef: MutableRefObject<string>;
  streamTimerRef: MutableRefObject<number | null>;
  onSessionInactive?: (
    sessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
  ) => void;
  onSessionProcessing?: (
    sessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
  ) => void;
  onSessionNotProcessing?: (
    sessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
  ) => void;
  onSessionStatusResolved?: (
    sessionId?: string | null,
    isProcessing?: boolean,
  ) => void;
  onCodexTurnStarted?: (sessionId?: string | null) => void;
  onCodexTurnSettled?: (
    sessionId?: string | null,
    outcome?: "complete" | "error" | "aborted",
  ) => void;
  onCodexSessionBusy?: (sessionId?: string | null) => void;
  onCodexSessionIdResolved?: (
    previousSessionId?: string | null,
    actualSessionId?: string | null,
  ) => void;
  onReplaceTemporarySession?: (
    sessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
    previousSessionId?: string | null,
  ) => void;
  onNavigateToSession?: (
    sessionId: string,
    sessionProvider?: SessionProvider,
    targetProjectName?: string,
  ) => void;
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
    if (
      last &&
      last.type === "assistant" &&
      !last.isToolUse &&
      last.isStreaming
    ) {
      const nextContent = newline
        ? last.content
          ? `${last.content}\n${chunk}`
          : chunk
        : `${last.content || ""}${chunk}`;
      updated[lastIndex] = { ...last, content: nextContent };
    } else {
      updated.push({
        type: "assistant",
        content: chunk,
        timestamp: new Date(),
        isStreaming: true,
      });
    }
    return updated;
  });
};

// NOTE: unescapeWithMathProtection, formatUsageLimitText, and splitLegacyGeminiThoughtContent
// are safe no-ops for non-Gemini text, so no provider guard is needed here.
const finalizeStreamingMessage = (
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
) => {
  setChatMessages((previous) => {
    const updated = [...previous];
    const lastIndex = updated.length - 1;
    const last = updated[lastIndex];
    if (last && last.type === "assistant" && last.isStreaming) {
      const normalizedContent = unescapeWithMathProtection(
        formatUsageLimitText(String(last.content || "")),
      );
      const messages = buildAssistantMessages(
        normalizedContent,
        last.timestamp || new Date(),
      );
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
  const normalized = String(value || "").toLowerCase();
  if (!normalized.includes("taskmaster")) {
    return false;
  }

  return (
    normalized.includes("not installed") ||
    normalized.includes("not configured")
  );
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
  onCodexTurnStarted,
  onCodexTurnSettled,
  onCodexSessionBusy,
  onCodexSessionIdResolved,
  onReplaceTemporarySession,
  onNavigateToSession,
}: UseChatRealtimeHandlersArgs) {
  const lastProcessedMessageRef = useRef<LatestChatMessage | null>(null);

  // Helper: Handle structured assistant content
  const handleStructuredAssistantMessage = (
    structuredData: any,
    rawData: any,
  ) => {
    // New assistant message = previous tool execution done; clear override.
    // If this message contains a new Bash tool_use, it will be re-set below (React batches both updates).
    setStatusTextOverride(null);

    const parentToolUseId = rawData?.parentToolUseId;
    const newMessages: any[] = [];
    const childToolUpdates: { parentId: string; child: any }[] = [];

    structuredData.content.forEach((part: any) => {
      if (part.type === "thinking" || part.type === "reasoning") {
        const thinkingText = part.thinking || part.reasoning || part.text || "";
        if (thinkingText.trim()) {
          newMessages.push({
            type: "assistant",
            content: unescapeWithMathProtection(thinkingText),
            timestamp: new Date(),
            isThinking: true,
            isStreaming: true,
          });
        }
        return;
      }

      if (part.type === "tool_use") {
        if (["Bash", "run_shell_command"].includes(part.name)) {
          // Set running code status when command starts
          setStatusTextOverride(i18n.t("chat:status.runningCode"));
        }
        const toolInput = part.input ? JSON.stringify(part.input, null, 2) : "";

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

        const isSubagentContainer = part.name === "Task";
        newMessages.push({
          type: "assistant",
          content: "",
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

      if (part.type === "text" && part.text?.trim()) {
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
            const updates = childToolUpdates.filter(
              (u) => u.parentId === message.toolId,
            );
            if (updates.length === 0) return message;
            const existingChildren = message.subagentState?.childTools || [];
            const newChildren = updates.map((u) => u.child);
            return {
              ...message,
              subagentState: {
                childTools: [...existingChildren, ...newChildren],
                currentToolIndex:
                  existingChildren.length + newChildren.length - 1,
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
    const toolResults = structuredData.content.filter(
      (part: any) => part.type === "tool_result",
    );
    const textParts = structuredData.content.filter(
      (part: any) => part.type === "text",
    );

    if (textParts.length > 0) {
      const textContent = textParts.map((p: any) => p.text || "").join("\n");
      const isSkillText =
        textContent.includes("Base directory for this skill:") ||
        textContent.startsWith("<command-name>") ||
        textContent.startsWith("<command-message>") ||
        textContent.startsWith("<command-args>") ||
        textContent.startsWith("<local-command-stdout>") ||
        (toolResults.length > 0 &&
          !textContent.startsWith("<system-reminder>"));
      if (isSkillText && textContent.trim()) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: "user",
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
            if (
              parentToolUseId &&
              message.toolId === parentToolUseId &&
              message.isSubagentContainer
            ) {
              const updatedChildren = message.subagentState!.childTools.map(
                (child: any) => {
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
                },
              );
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
              if (message.toolName === "AskUserQuestion" && part.content) {
                const resultStr =
                  typeof part.content === "string"
                    ? part.content
                    : JSON.stringify(part.content);
                const parsedAnswers = parseAskUserAnswers(resultStr);
                if (parsedAnswers) {
                  result.toolInput = mergeAnswersIntoToolInput(
                    String(message.toolInput || "{}"),
                    parsedAnswers,
                  );
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
      messageData && typeof messageData === "object"
        ? (messageData as Record<string, any>)
        : null;
    const rawStructuredData =
      latestMessage.data && typeof latestMessage.data === "object"
        ? (latestMessage.data as Record<string, any>)
        : null;

    const globalMessageTypes = [
      "projects_updated",
      "taskmaster-project-updated",
      "session-created",
      "session-aborted",
      "session-status",
      "session-accepted",
      "session-busy",
      "session-state-changed",
    ];
    const isGlobalMessage = globalMessageTypes.includes(
      String(latestMessage.type),
    );
    const lifecycleMessageTypes = new Set([
      "claude-complete",
      "codex-complete",
      "gemini-complete",
      "openrouter-complete",
      "localgpu-complete",
      "cursor-result",
      "session-aborted",
      "claude-error",
      "cursor-error",
      "codex-error",
      "gemini-error",
      "openrouter-error",
      "localgpu-error",
    ]);

    const isClaudeSystemInit =
      latestMessage.type === "claude-response" &&
      structuredMessageData &&
      structuredMessageData.type === "system" &&
      structuredMessageData.subtype === "init";

    const isGeminiSystemInit =
      latestMessage.type === "gemini-response" &&
      structuredMessageData &&
      structuredMessageData.type === "system" &&
      structuredMessageData.subtype === "init";

    const isCursorSystemInit =
      latestMessage.type === "cursor-system" &&
      rawStructuredData &&
      rawStructuredData.type === "system" &&
      rawStructuredData.subtype === "init";

    const systemInitSessionId =
      isClaudeSystemInit || isGeminiSystemInit
        ? structuredMessageData?.session_id
        : isCursorSystemInit
          ? rawStructuredData?.session_id
          : null;

    const activeViewSessionId =
      selectedSession?.id ||
      currentSessionId ||
      pendingViewSessionRef.current?.sessionId ||
      null;
    const pendingViewSessionId = pendingViewSessionRef.current?.sessionId || null;
    const isPendingViewSession =
      Boolean(pendingViewSessionRef.current?.startedAt) &&
      !selectedSession?.id &&
      !currentSessionId;
    const inferredMessageProvider = (() => {
      const messageType = String(latestMessage.type || "");
      if (messageType.startsWith("claude-")) return "claude";
      if (messageType.startsWith("cursor-")) return "cursor";
      if (messageType.startsWith("codex-")) return "codex";
      if (messageType.startsWith("gemini-")) return "gemini";
      if (messageType.startsWith("openrouter-")) return "openrouter";
      if (messageType.startsWith("localgpu-")) return "local";
      if (
        messageType === "session-created" ||
        messageType === "session-status" ||
        messageType === "session-aborted" ||
        messageType === "session-accepted" ||
        messageType === "session-busy" ||
        messageType === "session-state-changed"
      ) {
        return typeof latestMessage.provider === "string"
          ? (latestMessage.provider as SessionProvider)
          : null;
      }
      return null;
    })();
    const resolveProvider = (
      providerValue?: string | null,
      fallback?: SessionProvider | null,
    ): SessionProvider => {
      const candidate =
        typeof providerValue === "string" && providerValue.length > 0
          ? providerValue
          : fallback || inferredMessageProvider || provider;
      return normalizeProvider(candidate as SessionProvider);
    };
    const resolveProjectName = (
      projectNameValue?: string | null,
    ): string | null => {
      if (typeof projectNameValue === "string" && projectNameValue.length > 0) {
        return projectNameValue;
      }
      return selectedProject?.name || selectedSession?.__projectName || null;
    };
    const latestMessageProvider = resolveProvider(
      typeof latestMessage.provider === "string" ? latestMessage.provider : null,
    );
    const latestMessageProjectName = resolveProjectName(
      typeof latestMessage.projectName === "string"
        ? latestMessage.projectName
        : null,
    );
    const activeViewProvider = resolveProvider(
      selectedSession?.__provider || provider,
      provider,
    );
    const activeViewProjectName =
      selectedSession?.__projectName || selectedProject?.name || null;
    const routedMessageSessionId =
      latestMessage.type === "codex-complete"
        ? latestMessage.actualSessionId || latestMessage.sessionId || null
        : latestMessage.sessionId || null;
    const temporaryActiveSessionId =
      activeViewSessionId?.startsWith("new-session-")
        ? activeViewSessionId
        : null;
    const shouldRebindCodexTemporarySession =
      Boolean(
        temporaryActiveSessionId &&
          inferredMessageProvider === "codex" &&
          routedMessageSessionId &&
          routedMessageSessionId !== temporaryActiveSessionId,
      ) && !selectedSession?.id;

    if (
      shouldRebindCodexTemporarySession &&
      temporaryActiveSessionId &&
      routedMessageSessionId
    ) {
      onCodexSessionIdResolved?.(
        temporaryActiveSessionId,
        routedMessageSessionId,
      );
      onReplaceTemporarySession?.(
        routedMessageSessionId,
        "codex",
        latestMessageProjectName,
        temporaryActiveSessionId,
      );

      if (pendingViewSessionRef.current?.sessionId === temporaryActiveSessionId) {
        pendingViewSessionRef.current = {
          ...pendingViewSessionRef.current,
          sessionId: routedMessageSessionId,
        };
      }

      if (currentSessionId === temporaryActiveSessionId) {
        setCurrentSessionId(routedMessageSessionId);
      }
    }

    const isSystemInitForView =
      systemInitSessionId &&
      (!activeViewSessionId || systemInitSessionId === activeViewSessionId);
    const isMessageInActiveScope = (
      sessionId?: string | null,
      sessionProvider: SessionProvider = latestMessageProvider,
      projectName: string | null = latestMessageProjectName,
    ): boolean => {
      if (!sessionId || !activeViewSessionId) {
        return false;
      }

      if (sessionId !== activeViewSessionId) {
        return false;
      }

      if (sessionProvider !== activeViewProvider) {
        return false;
      }

      if (
        activeViewProjectName &&
        projectName &&
        activeViewProjectName !== projectName
      ) {
        return false;
      }

      return true;
    };
    const shouldBypassSessionFilter =
      isGlobalMessage ||
      Boolean(isSystemInitForView) ||
      Boolean(isPendingViewSession && inferredMessageProvider === provider) ||
      shouldRebindCodexTemporarySession;
    const isUnscopedError =
      !latestMessage.sessionId &&
      pendingViewSessionRef.current &&
      (!pendingViewSessionId ||
        pendingViewSessionId.startsWith("new-session-")) &&
      (latestMessage.type === "claude-error" ||
        latestMessage.type === "cursor-error" ||
        latestMessage.type === "codex-error" ||
        latestMessage.type === "gemini-error" ||
        latestMessage.type === "openrouter-error" ||
        latestMessage.type === "localgpu-error");

    if (latestMessage.type === "codex-complete") {
      const completedSessionId =
        latestMessage.sessionId || currentSessionId || null;
      const actualSessionId =
        latestMessage.actualSessionId || completedSessionId;
      if (
        currentSessionId &&
        currentSessionId.startsWith("new-session-") &&
        actualSessionId &&
        currentSessionId !== actualSessionId
      ) {
        onCodexSessionIdResolved?.(currentSessionId, actualSessionId);
      }
      if (
        completedSessionId &&
        actualSessionId &&
        completedSessionId !== actualSessionId
      ) {
        onCodexSessionIdResolved?.(completedSessionId, actualSessionId);
      }
      onCodexTurnSettled?.(actualSessionId || completedSessionId, "complete");
    } else if (latestMessage.type === "codex-error") {
      onCodexTurnSettled?.(
        latestMessage.sessionId || currentSessionId || null,
        "error",
      );
    } else if (
      latestMessage.type === "session-aborted" &&
      latestMessage.provider === "codex"
    ) {
      onCodexTurnSettled?.(
        latestMessage.sessionId || currentSessionId || null,
        "aborted",
      );
    }

    if (latestMessage.type === "codex-response" && latestMessage.sessionId) {
      const codexData = latestMessage.data;
      if (
        codexData &&
        (codexData.type === "turn_started" ||
          (codexData.type === "item" && codexData.lifecycle === "started"))
      ) {
        onCodexTurnStarted?.(latestMessage.sessionId);
      }
    }

    const notifySessionProcessing = (
      sessionId?: string | null,
      sessionProvider: SessionProvider = latestMessageProvider,
      projectName: string | null = latestMessageProjectName,
    ) => {
      onSessionProcessing?.(sessionId, sessionProvider, projectName);
      onSessionStatusResolved?.(sessionId, true);
    };

    const notifySessionCompleted = (
      sessionId?: string | null,
      sessionProvider: SessionProvider = latestMessageProvider,
      projectName: string | null = latestMessageProjectName,
    ) => {
      onSessionInactive?.(sessionId, sessionProvider, projectName);
      onSessionNotProcessing?.(sessionId, sessionProvider, projectName);
      onSessionStatusResolved?.(sessionId, false);
    };

    const clearScopedMessageCache = (
      sessionId?: string | null,
      sessionProvider: SessionProvider = latestMessageProvider,
      projectName: string | null = latestMessageProjectName,
    ) => {
      const storageKey = buildChatMessagesStorageKey(
        projectName,
        sessionId,
        sessionProvider,
      );
      if (storageKey) {
        safeLocalStorage.removeItem(storageKey);
      }
    };

    const handleBackgroundLifecycle = (sessionId?: string) => {
      if (!sessionId) {
        return;
      }
      clearSessionTimerStart(sessionId);
      notifySessionCompleted(sessionId, latestMessageProvider, latestMessageProjectName);
    };

    const getLifecycleSessionIds = () => {
      const ids: string[] = [];
      if (latestMessage.sessionId) {
        ids.push(latestMessage.sessionId);
      }

      if (
        latestMessage.type === "codex-complete" &&
        latestMessage.actualSessionId &&
        latestMessage.actualSessionId !== latestMessage.sessionId
      ) {
        ids.push(latestMessage.actualSessionId);
      }

      return [...new Set(ids)];
    };

    const persistStartTime = (
      startTime?: number | null,
      ...sessionIds: Array<string | null | undefined>
    ) => {
      if (!Number.isFinite(startTime)) {
        return;
      }

      const targetSessionId = sessionIds.find(
        (sessionId): sessionId is string =>
          typeof sessionId === "string" && sessionId.length > 0,
      );
      if (!targetSessionId) {
        return;
      }

      persistSessionTimerStart(targetSessionId, startTime);
    };

    const syncClaudeStatusStartTime = (
      startTime?: number | null,
      fallbackText = "Processing",
    ) => {
      if (!Number.isFinite(startTime)) {
        return;
      }

      const normalizedStartTime = startTime as number;

      setClaudeStatus((prev) => ({
        text: prev?.text || fallbackText,
        tokens: prev?.tokens || 0,
        can_interrupt:
          prev?.can_interrupt !== undefined ? prev.can_interrupt : true,
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
      streamBufferRef.current = "";
      appendStreamingChunk(setChatMessages, chunk, false);
      finalizeStreamingMessage(setChatMessages);
    };

    const markSessionsAsCompleted = (
      ...sessionIds: Array<string | null | undefined>
    ) => {
      const normalizedSessionIds = sessionIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );
      normalizedSessionIds.forEach((sessionId) => {
        clearSessionTimerStart(sessionId);
        notifySessionCompleted(
          sessionId,
          latestMessageProvider,
          latestMessageProjectName,
        );
      });
    };

    if (!shouldBypassSessionFilter) {
      if (!activeViewSessionId) {
        if (lifecycleMessageTypes.has(String(latestMessage.type))) {
          getLifecycleSessionIds().forEach((sessionId) => {
            handleBackgroundLifecycle(sessionId);
          });
        }
        if (!isUnscopedError) {
          return;
        }
      }

      if (!routedMessageSessionId && !isUnscopedError) {
        return;
      }

      if (
        !isMessageInActiveScope(
          routedMessageSessionId,
          latestMessageProvider,
          latestMessageProjectName,
        )
      ) {
        if (lifecycleMessageTypes.has(String(latestMessage.type))) {
          getLifecycleSessionIds().forEach((sessionId) => {
            handleBackgroundLifecycle(sessionId);
          });
        }
        return;
      }
    }

    switch (latestMessage.type) {
      case "session-accepted": {
        const acceptedSessionId =
          latestMessage.sessionId ||
          pendingViewSessionRef.current?.sessionId ||
          currentSessionId ||
          selectedSession?.id ||
          null;
        const acceptedAt = Number.isFinite(latestMessage.acceptedAt)
          ? (latestMessage.acceptedAt as number)
          : Date.now();
        const acceptedProvider = resolveProvider(
          typeof latestMessage.provider === "string"
            ? latestMessage.provider
            : provider,
        );
        const acceptedProjectName = resolveProjectName(
          typeof latestMessage.projectName === "string"
            ? latestMessage.projectName
            : selectedProject?.name || null,
        );
        const isCurrentSession =
          !acceptedSessionId ||
          isMessageInActiveScope(
            acceptedSessionId,
            acceptedProvider,
            acceptedProjectName,
          );

        if (acceptedSessionId) {
          persistStartTime(
            acceptedAt,
            acceptedSessionId,
            currentSessionId,
            selectedSession?.id,
          );
          notifySessionProcessing(
            acceptedSessionId,
            acceptedProvider,
            acceptedProjectName,
          );
        }

        if (isCurrentSession) {
          setIsLoading(true);
          setCanAbortSession(true);
          syncClaudeStatusStartTime(acceptedAt, "Processing");
        }
        break;
      }

      case "session-busy": {
        const busySessionId =
          latestMessage.sessionId ||
          pendingViewSessionRef.current?.sessionId ||
          currentSessionId ||
          selectedSession?.id ||
          null;
        const busyAt = Number.isFinite(latestMessage.reportedAt)
          ? (latestMessage.reportedAt as number)
          : Date.now();
        const busyProvider = resolveProvider(
          typeof latestMessage.provider === "string"
            ? latestMessage.provider
            : provider,
        );
        const busyProjectName = resolveProjectName(
          typeof latestMessage.projectName === "string"
            ? latestMessage.projectName
            : selectedProject?.name || null,
        );
        const isCurrentSession =
          !busySessionId ||
          isMessageInActiveScope(busySessionId, busyProvider, busyProjectName);

        if (busySessionId) {
          persistStartTime(
            busyAt,
            busySessionId,
            currentSessionId,
            selectedSession?.id,
          );
          notifySessionProcessing(busySessionId, busyProvider, busyProjectName);
        }

        if (latestMessage.provider === "codex") {
          onCodexSessionBusy?.(busySessionId);
        }

        if (isCurrentSession) {
          const busyMessage = String(
            latestMessage.message ||
              "Session is busy. Waiting for the current turn to finish.",
          );
          setIsLoading(true);
          setCanAbortSession(true);
          setStatusTextOverride(busyMessage);
          setChatMessages((previous) => {
            const lastMessage = previous[previous.length - 1];
            if (
              lastMessage &&
              lastMessage.type === "assistant" &&
              String(lastMessage.content || "") === busyMessage
            ) {
              return previous;
            }
            return [
              ...previous,
              {
                type: "assistant",
                content: busyMessage,
                timestamp: new Date(),
              },
            ];
          });
        }
        break;
      }

      case "session-state-changed": {
        const stateSessionId =
          typeof latestMessage.sessionId === "string"
            ? latestMessage.sessionId
            : null;
        if (!stateSessionId) {
          break;
        }

        const state = String(latestMessage.state || "").toLowerCase();
        const stateProvider = resolveProvider(
          typeof latestMessage.provider === "string"
            ? latestMessage.provider
            : provider,
        );
        const stateProjectName = resolveProjectName(
          typeof latestMessage.projectName === "string"
            ? latestMessage.projectName
            : selectedProject?.name || null,
        );
        const isCurrentSession =
          isMessageInActiveScope(
            stateSessionId,
            stateProvider,
            stateProjectName,
          );
        const isProcessingState =
          state === "running" ||
          state === "queued" ||
          state === "in_progress" ||
          state === "waiting_user";
        const isTerminalState =
          state === "completed" ||
          state === "failed" ||
          state === "aborted" ||
          state === "error" ||
          state === "idle";

        if (isProcessingState) {
          notifySessionProcessing(stateSessionId, stateProvider, stateProjectName);
          if (isCurrentSession) {
            setIsLoading(true);
            setCanAbortSession(true);
          }
          break;
        }

        if (isTerminalState) {
          clearSessionTimerStart(stateSessionId);
          notifySessionCompleted(stateSessionId, stateProvider, stateProjectName);
          if (isCurrentSession) {
            clearLoadingIndicators();
          }
        }
        break;
      }

      case "session-created":
        if (
          latestMessage.sessionId &&
          (!currentSessionId || currentSessionId.startsWith("new-session-"))
        ) {
          const createdSessionProvider =
            resolveProvider(
              typeof latestMessage.provider === "string"
                ? latestMessage.provider
                : provider,
            );
          const explicitProjectName = resolveProjectName(
            typeof latestMessage.projectName === "string"
              ? latestMessage.projectName
              : null,
          );
          const createdProjectName =
            explicitProjectName
            || (pendingViewSessionRef.current ? selectedProject?.name || null : null);
          const pendingStartTime = pendingViewSessionRef.current?.startedAt;
          const pendingTemporarySessionId = pendingViewSessionRef.current
            ?.sessionId?.startsWith("new-session-")
            ? pendingViewSessionRef.current.sessionId
            : null;
          const temporarySessionId = currentSessionId?.startsWith(
            "new-session-",
          )
            ? currentSessionId
            : pendingTemporarySessionId;
          if (temporarySessionId) {
            moveSessionTimerStart(temporarySessionId, latestMessage.sessionId);
            if (createdSessionProvider === "codex") {
              onCodexSessionIdResolved?.(
                temporarySessionId,
                latestMessage.sessionId,
              );
            }
          }
          persistStartTime(
            typeof latestMessage.startTime === "number"
              ? latestMessage.startTime
              : pendingStartTime,
            latestMessage.sessionId,
          );
          if (createdProjectName && latestMessage.mode) {
            safeLocalStorage.setItem(
              `session_mode_${createdProjectName}_${latestMessage.sessionId}`,
              String(latestMessage.mode),
            );
          }
          persistScopedPendingSessionId(
            createdProjectName,
            createdSessionProvider,
            latestMessage.sessionId,
          );
          if (
            createdSessionProvider === "gemini" ||
            createdSessionProvider === "cursor"
          ) {
            persistScopedProviderSessionId(
              createdProjectName,
              createdSessionProvider,
              latestMessage.sessionId,
            );
          }
          if (
            pendingViewSessionRef.current &&
            (!pendingViewSessionRef.current.sessionId ||
              pendingViewSessionRef.current.sessionId.startsWith(
                "new-session-",
              ))
          ) {
            pendingViewSessionRef.current.sessionId = latestMessage.sessionId;
          }
          setIsSystemSessionChange(true);
          onReplaceTemporarySession?.(
            latestMessage.sessionId,
            createdSessionProvider,
            createdProjectName,
            temporarySessionId,
          );
          if (createdProjectName || pendingViewSessionRef.current) {
            onNavigateToSession?.(
              latestMessage.sessionId,
              createdSessionProvider,
              createdProjectName || undefined,
            );
          }
          setPendingPermissionRequests((previous) =>
            previous.map((request) =>
              request.sessionId
                ? request
                : { ...request, sessionId: latestMessage.sessionId },
            ),
          );
        }
        break;

      case "token-budget":
        if (latestMessage.data) {
          setTokenBudget(latestMessage.data);
        }
        break;

      case "claude-response": {
        if (
          messageData &&
          typeof messageData === "object" &&
          messageData.type
        ) {
          if (Number.isFinite(messageData.startTime)) {
            persistStartTime(
              messageData.startTime,
              latestMessage.sessionId,
              currentSessionId,
              selectedSession?.id,
            );
            syncClaudeStatusStartTime(messageData.startTime);
          }
          if (
            messageData.type === "content_block_delta" &&
            messageData.delta?.text
          ) {
            setIsLoading(true);
            setStatusTextOverride(null);
            const decodedText = decodeHtmlEntities(messageData.delta.text);
            streamBufferRef.current += decodedText;
            if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = "";
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, false);
              }, 30);
            }
            return;
          }
          if (messageData.type === "content_block_stop") {
            if (streamTimerRef.current) {
              clearTimeout(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            const chunk = streamBufferRef.current;
            streamBufferRef.current = "";
            appendStreamingChunk(setChatMessages, chunk, false);
            finalizeStreamingMessage(setChatMessages);
            return;
          }
        }

        if (
          isClaudeSystemInit &&
          structuredMessageData?.session_id &&
          isSystemInitForView
        ) {
          if (
            !currentSessionId ||
            structuredMessageData.session_id !== currentSessionId
          ) {
            console.log("Claude CLI session duplication or new init detected");
            setIsSystemSessionChange(true);
            onNavigateToSession?.(
              structuredMessageData.session_id,
              "claude",
              latestMessageProjectName || undefined,
            );
            return;
          }
        }

        if (
          structuredMessageData &&
          Array.isArray(structuredMessageData.content) &&
          structuredMessageData.role === "assistant"
        ) {
          handleStructuredAssistantMessage(
            structuredMessageData,
            rawStructuredData,
          );
        } else if (
          structuredMessageData &&
          structuredMessageData.role === "assistant" &&
          typeof structuredMessageData.content === "string" &&
          structuredMessageData.content.trim()
        ) {
          handleSimpleAssistantMessage(structuredMessageData);
        }

        if (
          structuredMessageData?.role === "user" &&
          Array.isArray(structuredMessageData.content)
        ) {
          handleUserToolResults(structuredMessageData, rawStructuredData);
        }
        break;
      }

      case "gemini-response": {
        if (
          messageData &&
          typeof messageData === "object" &&
          messageData.type
        ) {
          if (Number.isFinite(messageData.startTime)) {
            persistStartTime(
              messageData.startTime,
              latestMessage.sessionId,
              currentSessionId,
              selectedSession?.id,
            );
            syncClaudeStatusStartTime(messageData.startTime);
          }
          if (
            messageData.type === "content_block_delta" &&
            messageData.delta?.text
          ) {
            setIsLoading(true);
            setStatusTextOverride(null);
            const decodedText = decodeHtmlEntities(messageData.delta.text);
            streamBufferRef.current += decodedText;
            if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = "";
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, false);
              }, 30);
            }
            return;
          }
          if (messageData.type === "content_block_stop") {
            if (streamTimerRef.current) {
              clearTimeout(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            const chunk = streamBufferRef.current;
            streamBufferRef.current = "";
            appendStreamingChunk(setChatMessages, chunk, false);
            finalizeStreamingMessage(setChatMessages);
            return;
          }
        }

        if (
          isGeminiSystemInit &&
          structuredMessageData?.session_id &&
          isSystemInitForView
        ) {
          if (
            !currentSessionId ||
            structuredMessageData.session_id !== currentSessionId
          ) {
            console.log("Gemini CLI session init detected");
            setIsSystemSessionChange(true);
            onNavigateToSession?.(
              structuredMessageData.session_id,
              "gemini",
              latestMessageProjectName || undefined,
            );
            return;
          }
        }

        if (
          structuredMessageData &&
          Array.isArray(structuredMessageData.content) &&
          structuredMessageData.role === "assistant"
        ) {
          handleStructuredAssistantMessage(
            structuredMessageData,
            rawStructuredData,
          );
        } else if (
          structuredMessageData &&
          structuredMessageData.role === "assistant" &&
          typeof structuredMessageData.content === "string" &&
          structuredMessageData.content.trim()
        ) {
          handleSimpleAssistantMessage(structuredMessageData);
        }

        if (
          structuredMessageData?.role === "user" &&
          Array.isArray(structuredMessageData.content)
        ) {
          handleUserToolResults(structuredMessageData, rawStructuredData);
        }
        break;
      }

      case "localgpu-response":
      case "openrouter-response": {
        const orData = latestMessage.data;
        if (orData && typeof orData === "object") {
          if (Number.isFinite(orData.startTime)) {
            persistStartTime(
              orData.startTime,
              latestMessage.sessionId,
              currentSessionId,
              selectedSession?.id,
            );
            syncClaudeStatusStartTime(orData.startTime);
          }

          if (orData.type === "assistant_message" && orData.message?.content) {
            setIsLoading(true);
            setStatusTextOverride(null);
            const text = orData.message.content;
            streamBufferRef.current += text;
            if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = "";
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, false);
              }, 30);
            }
            return;
          }

          if (orData.type === "structured_turn" && orData.message) {
            flushAndFinalizePendingStream();
            handleStructuredAssistantMessage(orData.message, orData);
            return;
          }

          if (orData.type === "structured_result" && orData.message) {
            handleUserToolResults(orData.message, orData);
            return;
          }

          if (orData.type === "tool_use") {
            flushAndFinalizePendingStream();
            if (
              ["Bash", "bash", "run_shell_command"].includes(orData.toolName)
            ) {
              setStatusTextOverride(i18n.t("chat:status.runningCode"));
            }
            const toolInput = orData.toolInput
              ? JSON.stringify(orData.toolInput, null, 2)
              : "";
            setChatMessages((prev) => [
              ...prev,
              {
                type: "assistant" as const,
                content: "",
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

          if (orData.type === "tool_result") {
            setStatusTextOverride(null);
            setChatMessages((prev) => {
              const updated = [...prev];
              for (let i = updated.length - 1; i >= 0; i--) {
                if (
                  updated[i].isToolUse &&
                  updated[i].toolId === orData.toolCallId
                ) {
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

      case "claude-output": {
        const cleaned = String(latestMessage.data || "");
        if (cleaned.trim()) {
          streamBufferRef.current += streamBufferRef.current
            ? `\n${cleaned}`
            : cleaned;
          if (!streamTimerRef.current) {
            streamTimerRef.current = window.setTimeout(() => {
              const chunk = streamBufferRef.current;
              streamBufferRef.current = "";
              streamTimerRef.current = null;
              appendStreamingChunk(setChatMessages, chunk, true);
            }, 30);
          }
        }
        break;
      }

      case "claude-complete":
      case "gemini-complete":
      case "openrouter-complete":
      case "localgpu-complete": {
        const pendingSessionId = readScopedPendingSessionId(
          latestMessageProjectName,
          latestMessageProvider,
        );
        const completedSessionId =
          latestMessage.sessionId || currentSessionId || pendingSessionId;
        flushAndFinalizePendingStream();
        clearLoadingIndicators();
        markSessionsAsCompleted(
          completedSessionId,
          currentSessionId,
          selectedSession?.id,
          pendingSessionId,
        );
        if (
          pendingSessionId &&
          !currentSessionId &&
          latestMessage.exitCode === 0
        ) {
          setCurrentSessionId(pendingSessionId);
          clearScopedPendingSessionId(
            latestMessageProjectName,
            latestMessageProvider,
          );
        }
        if (latestMessage.exitCode === 0) {
          clearScopedMessageCache(
            completedSessionId || pendingSessionId,
            latestMessageProvider,
            latestMessageProjectName,
          );
        }
        setPendingPermissionRequests([]);
        break;
      }

      case "claude-error":
      case "gemini-error":
      case "openrouter-error":
      case "localgpu-error": {
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
        markSessionsAsCompleted(
          erroredSessionId,
          currentSessionId,
          selectedSession?.id,
        );
        // Clear pendingSessionId for the errored session (not all sessions 鈥?other tabs may be active)
        const pendingSessionId = readScopedPendingSessionId(
          latestMessageProjectName,
          latestMessageProvider,
        );
        if (
          pendingSessionId &&
          (!erroredSessionId || pendingSessionId === erroredSessionId)
        ) {
          clearScopedPendingSessionId(
            latestMessageProjectName,
            latestMessageProvider,
          );
        }
        setPendingPermissionRequests([]);
        const details =
          typeof latestMessage.details === "string"
            ? latestMessage.details.trim()
            : "";
        const errorContent = details
          ? `Error: ${latestMessage.error}\n\n<details><summary>Technical details</summary>\n\n\`\`\`text\n${details.slice(0, 8000)}\n\`\`\`\n</details>`
          : `Error: ${latestMessage.error}`;
        setChatMessages((previous) => {
          const last = previous[previous.length - 1];
          if (
            last?.type === "error" &&
            String(last.content || "") === errorContent
          ) {
            return previous;
          }
          return [
            ...previous,
            {
              type: "error",
              content: errorContent,
              timestamp: new Date(),
              errorType: latestMessage.errorType,
              isRetryable: latestMessage.isRetryable === true,
            },
          ];
        });
        break;
      }

      case "cursor-system":
        try {
          const cursorData = latestMessage.data;
          if (
            cursorData &&
            cursorData.type === "system" &&
            cursorData.subtype === "init" &&
            cursorData.session_id
          ) {
            if (!isSystemInitForView) return;
            if (
              !currentSessionId ||
              cursorData.session_id !== currentSessionId
            ) {
              setIsSystemSessionChange(true);
              onNavigateToSession?.(
                cursorData.session_id,
                "cursor",
                latestMessageProjectName || undefined,
              );
            }
          }
        } catch (error) {
          console.warn("Error handling cursor-system message:", error);
        }
        break;

      case "cursor-tool-use":
        setChatMessages((previous) => [
          ...previous,
          {
            type: "assistant",
            content: `Using tool: ${latestMessage.tool} ${latestMessage.input ? `with ${latestMessage.input}` : ""}`,
            timestamp: new Date(),
            isToolUse: true,
            toolName: latestMessage.tool,
            toolInput: latestMessage.input,
          },
        ]);
        break;

      case "cursor-error":
        if (isLegacyTaskMasterInstallError(latestMessage.error)) break;
        flushAndFinalizePendingStream();
        clearLoadingIndicators();
        markSessionsAsCompleted(
          latestMessage.sessionId,
          currentSessionId,
          selectedSession?.id,
        );
        setPendingPermissionRequests([]);
        setChatMessages((previous) => [
          ...previous,
          {
            type: "error",
            content: `Cursor error: ${latestMessage.error || "Unknown error"}`,
            timestamp: new Date(),
            errorType: latestMessage.errorType,
            isRetryable: latestMessage.isRetryable === true,
          },
        ]);
        break;

      case "cursor-result": {
        const cursorCompletedSessionId =
          latestMessage.sessionId || currentSessionId;
        const pendingCursorSessionId =
          readScopedPendingSessionId(latestMessageProjectName, "cursor");

        if (Number.isFinite(latestMessage.startTime)) {
          persistStartTime(
            latestMessage.startTime,
            latestMessage.sessionId,
            currentSessionId,
            selectedSession?.id,
          );
          syncClaudeStatusStartTime(latestMessage.startTime);
        }

        clearLoadingIndicators();
        markSessionsAsCompleted(
          cursorCompletedSessionId,
          currentSessionId,
          selectedSession?.id,
          pendingCursorSessionId,
        );
        try {
          const resultData = latestMessage.data || {};
          const textResult =
            typeof resultData.result === "string" ? resultData.result : "";
          if (streamTimerRef.current) {
            clearTimeout(streamTimerRef.current);
            streamTimerRef.current = null;
          }
          const pendingChunk = streamBufferRef.current;
          streamBufferRef.current = "";
          setChatMessages((previous) => {
            const updated = [...previous];
            const lastIndex = updated.length - 1;
            const last = updated[lastIndex];
            if (
              last &&
              last.type === "assistant" &&
              !last.isToolUse &&
              last.isStreaming
            ) {
              const finalContent =
                textResult && textResult.trim()
                  ? textResult
                  : `${last.content || ""}${pendingChunk || ""}`;
              updated[lastIndex] = {
                ...last,
                content: finalContent,
                isStreaming: false,
              };
            } else if (textResult && textResult.trim()) {
              updated.push({
                type: resultData.is_error ? "error" : "assistant",
                content: textResult,
                timestamp: new Date(),
                isStreaming: false,
              });
            }
            return updated;
          });
        } catch (error) {
          console.warn("Error handling cursor-result message:", error);
        }
        if (
          cursorCompletedSessionId &&
          !currentSessionId &&
          cursorCompletedSessionId === pendingCursorSessionId
        ) {
          setCurrentSessionId(cursorCompletedSessionId);
          clearScopedPendingSessionId(latestMessageProjectName, "cursor");
          if (window.refreshProjects)
            setTimeout(() => window.refreshProjects?.(), 500);
        }
        break;
      }

      case "cursor-output":
        try {
          if (Number.isFinite(latestMessage.startTime)) {
            persistStartTime(
              latestMessage.startTime,
              latestMessage.sessionId,
              currentSessionId,
              selectedSession?.id,
            );
            syncClaudeStatusStartTime(latestMessage.startTime);
          }
          setIsLoading(true);
          const raw = String(latestMessage.data ?? "");
          const cleaned = raw
            .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
            .trim();
          if (cleaned) {
            streamBufferRef.current += streamBufferRef.current
              ? `\n${cleaned}`
              : cleaned;
            if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = "";
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, true);
              }, 100);
            }
          }
        } catch (error) {
          console.warn("Error handling cursor-output message:", error);
        }
        break;

      case "codex-response": {
        const codexData = latestMessage.data;
        if (!codexData) break;

        if (Number.isFinite(codexData.startTime)) {
          persistStartTime(
            codexData.startTime,
            latestMessage.sessionId,
            currentSessionId,
            selectedSession?.id,
          );
          syncClaudeStatusStartTime(codexData.startTime);
        }

        setIsLoading(true);
        if (codexData.type === "item") {
          const itemId = codexData.itemId;
          const lifecycle = codexData.lifecycle; // 'started' | 'completed' | 'other'

          switch (codexData.itemType) {
            case "agent_message":
              if (codexData.message?.content?.trim()) {
                const content = decodeHtmlEntities(codexData.message.content);

                // Server marks system prompts; also detect on frontend as fallback
                const isSystemPrompt =
                  codexData.isSystemPrompt ||
                  /^#\s+(AGENTS|SKILL|INSTRUCTIONS)/m.test(content) ||
                  content.includes("<INSTRUCTIONS>") ||
                  content.includes("</INSTRUCTIONS>") ||
                  /^#+\s+.*instructions\s+for\s+\//im.test(content) ||
                  (content.includes("Base directory for this skill:") &&
                    content.length > 500) ||
                  (content.length > 2000 &&
                    /^\d+\)\s/m.test(content) &&
                    /\bskill\b/i.test(content)) ||
                  (content.match(/SKILL\.md\)/g) || []).length >= 3 ||
                  content.includes("### How to use skills") ||
                  content.includes("## How to use skills") ||
                  (content.includes("Trigger rules:") &&
                    content.includes("skill") &&
                    content.length > 500);

                if (isSystemPrompt) {
                  // Show as collapsed skill content
                  setChatMessages((previous) => [
                    ...previous,
                    {
                      type: "user",
                      content,
                      timestamp: new Date(),
                      isSkillContent: true,
                    },
                  ]);
                } else {
                  setChatMessages((previous) => [
                    ...previous,
                    {
                      type: "assistant",
                      content,
                      timestamp: new Date(),
                    },
                  ]);
                }
              }
              break;

            case "reasoning":
              // Codex reasoning items are very brief status notes (e.g. "Planning API path inspection")
              // They add noise without value - skip them entirely for Codex sessions
              break;

            case "command_execution":
              if (lifecycle !== "completed") {
                setStatusTextOverride(i18n.t("chat:status.runningCode"));
              } else {
                setStatusTextOverride(null);
              }
              if (codexData.command) {
                const exitCode = codexData.exitCode;
                const output = codexData.output;
                // Wrap command in object format expected by Bash ToolRenderer
                const bashToolInput = { command: codexData.command };

                if (lifecycle === "completed" && itemId) {
                  // Update existing tool message if it was added on 'started'
                  setChatMessages((previous) => {
                    const existingIdx = previous.findIndex(
                      (m) => m.codexItemId === itemId && m.isToolUse,
                    );
                    if (existingIdx >= 0) {
                      const updated = [...previous];
                      updated[existingIdx] = {
                        ...updated[existingIdx],
                        toolResult:
                          output != null
                            ? {
                                content: output,
                                isError: exitCode != null && exitCode !== 0,
                              }
                            : null,
                        exitCode,
                      };
                      return updated;
                    }
                    // Not found, add new
                    return [
                      ...previous,
                      {
                        type: "assistant",
                        content: "",
                        timestamp: new Date(),
                        isToolUse: true,
                        toolName: "Bash",
                        toolInput: bashToolInput,
                        toolResult:
                          output != null
                            ? {
                                content: output,
                                isError: exitCode != null && exitCode !== 0,
                              }
                            : null,
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
                      type: "assistant",
                      content: "",
                      timestamp: new Date(),
                      isToolUse: true,
                      toolName: "Bash",
                      toolInput: bashToolInput,
                      toolResult:
                        output != null
                          ? {
                              content: output,
                              isError: exitCode != null && exitCode !== 0,
                            }
                          : null,
                      exitCode,
                      codexItemId: itemId,
                    },
                  ]);
                }
              }
              break;

            case "file_change":
              if (codexData.changes?.length > 0) {
                const changesList = codexData.changes
                  .map(
                    (change: { kind: string; path: string }) =>
                      `${change.kind}: ${change.path}`,
                  )
                  .join("\n");

                if (lifecycle === "completed" && itemId) {
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
                        type: "assistant",
                        content: "",
                        timestamp: new Date(),
                        isToolUse: true,
                        toolName: "FileChanges",
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
                      type: "assistant",
                      content: "",
                      timestamp: new Date(),
                      isToolUse: true,
                      toolName: "FileChanges",
                      toolInput: changesList,
                      toolResult: codexData.status
                        ? {
                            content: `Status: ${codexData.status}`,
                            isError: false,
                          }
                        : null,
                      codexItemId: itemId,
                    },
                  ]);
                }
              }
              break;

            case "mcp_tool_call": {
              const toolResult = codexData.result
                ? {
                    content: JSON.stringify(codexData.result, null, 2),
                    isError: false,
                  }
                : codexData.error?.message
                  ? { content: codexData.error.message, isError: true }
                  : null;

              if (lifecycle === "completed" && itemId) {
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
                      type: "assistant",
                      content: "",
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
                    type: "assistant",
                    content: "",
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

            case "web_search": {
              const query = codexData.query || "Searching...";
              if (lifecycle === "completed" && itemId) {
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
                      type: "assistant",
                      content: "",
                      timestamp: new Date(),
                      isToolUse: true,
                      toolName: "WebSearch",
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
                    type: "assistant",
                    content: "",
                    timestamp: new Date(),
                    isToolUse: true,
                    toolName: "WebSearch",
                    toolInput: { command: query },
                    toolResult: null,
                    codexItemId: itemId,
                  },
                ]);
              }
              break;
            }

            case "error":
              if (codexData.message?.content) {
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: "error",
                    content: codexData.message.content,
                    timestamp: new Date(),
                  },
                ]);
              }
              break;

            default:
              console.log(
                "[Codex] Unhandled item type:",
                codexData.itemType,
                codexData,
              );
          }
        }

        if (
          codexData.type === "turn_complete" ||
          codexData.type === "turn_failed"
        ) {
          clearLoadingIndicators();
          markSessionsAsCompleted(
            latestMessage.sessionId,
            currentSessionId,
            selectedSession?.id,
          );
          if (codexData.type === "turn_failed") {
            setChatMessages((previous) => [
              ...previous,
              {
                type: "error",
                content: codexData.error?.message || "Turn failed",
                timestamp: new Date(),
              },
            ]);
          }
        }
        break;
      }

      case "codex-complete": {
        const codexPendingSessionId =
          readScopedPendingSessionId(latestMessageProjectName, "codex");
        const codexActualSessionId =
          latestMessage.actualSessionId ||
          codexPendingSessionId ||
          latestMessage.sessionId;
        const codexCompletedSessionId =
          latestMessage.sessionId || currentSessionId || codexPendingSessionId;
        clearLoadingIndicators();
        markSessionsAsCompleted(
          codexCompletedSessionId,
          codexActualSessionId,
          currentSessionId,
          selectedSession?.id,
          codexPendingSessionId,
        );

        const shouldSyncToActualSessionId =
          Boolean(codexActualSessionId) &&
          codexActualSessionId !== currentSessionId &&
          ((currentSessionId && currentSessionId.startsWith("new-session-")) ||
            Boolean(codexPendingSessionId));

        if (shouldSyncToActualSessionId) {
          setCurrentSessionId(codexActualSessionId || null);
          setIsSystemSessionChange(true);
          if (codexActualSessionId) {
            onNavigateToSession?.(
              codexActualSessionId,
              "codex",
              latestMessageProjectName || undefined,
            );
          }
        }

        if (codexPendingSessionId) {
          clearScopedPendingSessionId(latestMessageProjectName, "codex");
        }

        clearScopedMessageCache(
          codexCompletedSessionId || codexActualSessionId,
          "codex",
          latestMessageProjectName,
        );
        break;
      }

      case "codex-error":
        if (isLegacyTaskMasterInstallError(latestMessage.error)) break;
        flushAndFinalizePendingStream();
        clearLoadingIndicators();
        markSessionsAsCompleted(
          latestMessage.sessionId,
          currentSessionId,
          selectedSession?.id,
        );
        setPendingPermissionRequests([]);
        setChatMessages((previous) => [
          ...previous,
          {
            type: "error",
            content: latestMessage.error || "An error occurred with Codex",
            timestamp: new Date(),
            errorType: latestMessage.errorType,
            isRetryable: latestMessage.isRetryable === true,
          },
        ]);
        break;

      case "session-aborted": {
        const abortedProvider = resolveProvider(
          typeof latestMessage.provider === "string"
            ? latestMessage.provider
            : provider,
        );
        const abortedProjectName = resolveProjectName(
          typeof latestMessage.projectName === "string"
            ? latestMessage.projectName
            : selectedProject?.name || null,
        );
        const pendingSessionId = readScopedPendingSessionId(
          abortedProjectName,
          abortedProvider,
        );
        const abortedSessionId = latestMessage.sessionId || currentSessionId;
        if (latestMessage.success !== false) {
          clearLoadingIndicators();
          markSessionsAsCompleted(
            abortedSessionId,
            currentSessionId,
            selectedSession?.id,
            pendingSessionId,
          );
          if (
            pendingSessionId &&
            (!abortedSessionId || pendingSessionId === abortedSessionId)
          )
            clearScopedPendingSessionId(abortedProjectName, abortedProvider);
          setPendingPermissionRequests([]);
          setChatMessages((previous) => [
            ...previous,
            {
              type: "assistant",
              content: "Session interrupted by user.",
              timestamp: new Date(),
            },
          ]);
        } else {
          clearLoadingIndicators();
          setPendingPermissionRequests([]);
          setChatMessages((previous) => [
            ...previous,
            {
              type: "error",
              content: "Session has already finished.",
              timestamp: new Date(),
            },
          ]);
        }
        break;
      }

      case "session-status": {
        const statusSessionId = latestMessage.sessionId;
        if (!statusSessionId) {
          break;
        }

        const statusProvider = resolveProvider(
          typeof latestMessage.provider === "string"
            ? latestMessage.provider
            : provider,
        );
        const statusProjectName = resolveProjectName(
          typeof latestMessage.projectName === "string"
            ? latestMessage.projectName
            : selectedProject?.name || null,
        );
        const isCurrentSession = isMessageInActiveScope(
          statusSessionId,
          statusProvider,
          statusProjectName,
        );
        if (latestMessage.isProcessing) {
          persistStartTime(
            latestMessage.startTime,
            statusSessionId,
            currentSessionId,
            selectedSession?.id,
          );
          notifySessionProcessing(
            statusSessionId,
            statusProvider,
            statusProjectName,
          );

          if (!isCurrentSession) {
            break;
          }

          setIsLoading(true);
          setCanAbortSession(true);
          // If we have a startTime from the backend, sync our status
          if (Number.isFinite(latestMessage.startTime)) {
            syncClaudeStatusStartTime(
              latestMessage.startTime,
              RESUMING_STATUS_TEXT,
            );
          }
        } else if (latestMessage.isProcessing === false) {
          clearSessionTimerStart(statusSessionId);
          notifySessionCompleted(
            statusSessionId,
            statusProvider,
            statusProjectName,
          );

          if (!isCurrentSession) {
            break;
          }

          clearLoadingIndicators();
        }
        break;
      }

      case "claude-permission-request": {
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

      case "claude-permission-cancelled": {
        const { requestId } = latestMessage;
        if (!requestId) break;
        setPendingPermissionRequests((previous) =>
          previous.filter((p) => p.requestId !== requestId),
        );
        break;
      }

      case "claude-status":
      case "gemini-status": {
        const statusData = latestMessage.data;
        if (!statusData) break;
        persistStartTime(
          statusData.startTime,
          latestMessage.sessionId,
          currentSessionId,
          selectedSession?.id,
        );
        const statusInfo = {
          text:
            statusData.message ||
            statusData.status ||
            (typeof statusData === "string" ? statusData : "Working..."),
          tokens: statusData.tokens || statusData.token_count || 0,
          can_interrupt:
            statusData.can_interrupt !== undefined
              ? statusData.can_interrupt
              : true,
          startTime: statusData.startTime, // Use startTime from message if provided
        };

        // Use updater function to preserve existing startTime if not provided in message
        setClaudeStatus((prev) => ({
          ...statusInfo,
          startTime: Number.isFinite(statusInfo.startTime)
            ? statusInfo.startTime
            : prev?.startTime,
        }));

        setIsLoading(true);
        setCanAbortSession(statusInfo.can_interrupt);
        break;
      }

      default:
        break;
    }
  }, [
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
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onSessionStatusResolved,
    onCodexTurnStarted,
    onCodexTurnSettled,
    onCodexSessionBusy,
    onCodexSessionIdResolved,
    onReplaceTemporarySession,
    onNavigateToSession,
  ]);
}
