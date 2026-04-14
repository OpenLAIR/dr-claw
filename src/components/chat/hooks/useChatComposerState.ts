import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  SetStateAction,
  TouchEvent,
} from "react";
import { useDropzone } from "react-dropzone";
import type { FileRejection } from "react-dropzone";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authenticatedFetch } from "../../../utils/api";
import { isTelemetryEnabled } from "../../../utils/telemetry";

import { thinkingModes } from "../constants/thinkingModes";
import type { CodexReasoningEffortId } from "../constants/codexReasoningEfforts";
import { getSupportedCodexReasoningEfforts } from "../constants/codexReasoningSupport";
import type { GeminiThinkingModeId } from "../../../../shared/geminiThinkingSupport";
import { getSupportedGeminiThinkingModes } from "../../../../shared/geminiThinkingSupport";

import { grantToolPermission } from "../utils/chatPermissions";
import {
  buildDraftInputStorageKey,
  clearScopedPendingSessionId,
  clearScopedProviderSessionId,
  clearSessionTimerStart,
  getProviderSettingsKey,
  persistScopedPendingSessionId,
  persistScopedProviderSessionId,
  persistSessionTimerStart,
  readScopedPendingSessionId,
  readScopedProviderSessionId,
  safeLocalStorage,
} from "../utils/chatStorage";
import {
  consumeWorkspaceQaDraft,
  WORKSPACE_QA_DRAFT_EVENT,
} from "../../../utils/workspaceQa";
import {
  consumeReferenceChatDraft,
  REFERENCE_CHAT_DRAFT_EVENT,
} from "../../../utils/referenceChatDraft";
import type {
  AttachedPrompt,
  ChatAttachment,
  ChatImage,
  ChatMessage,
  PendingPermissionRequest,
  PermissionMode,
  QueuedTurn,
  QueuedTurnKind,
  QueuedTurnStatus,
  TokenBudget,
} from "../types/types";
import { useFileMentions } from "./useFileMentions";
import { type SlashCommand, useSlashCommands } from "./useSlashCommands";
import type {
  Project,
  ProjectSession,
  SessionProvider,
} from "../../../types/app";
import { escapeRegExp } from "../utils/chatFormatting";
import type { SessionMode } from "../../../types/app";
import { normalizeProvider } from "../../../utils/providerPolicy";
import {
  buildSessionScopeKey,
  parseSessionScopeKey,
  scopeKeyMatchesSessionId,
} from "../../../utils/sessionScope";
import {
  buildQueuedTurn,
  enqueueSessionTurn,
  getNextDispatchableTurn,
  getSessionQueue,
  promoteQueuedTurnToSteer,
  reconcileSessionQueueId,
  reconcileSettledSessionQueue,
  removeQueuedTurn,
  setSessionQueueStatus,
  type SessionQueueMap,
} from "../utils/codexQueue";
import {
  OPTIMISTIC_SESSION_CREATED_EVENT,
  type OptimisticSessionCreatedDetail,
} from "../../../constants/sessionEvents";
import type { BtwOverlayState } from "../view/subcomponents/BtwOverlay";

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

type PendingCodexQueueDispatch = {
  turn: QueuedTurn;
  shouldUpdateForegroundState: boolean;
};

interface UseChatComposerStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: SessionProvider;
  permissionMode: PermissionMode | string;
  cyclePermissionMode: () => void;
  cursorModel: string;
  claudeModel: string;
  codexModel: string;
  geminiModel: string;
  openrouterModel: string;
  localModel: string;
  nanoModel: string;
  isLoading: boolean;
  canAbortSession: boolean;
  tokenBudget: TokenBudget | null;
  sendMessage: (message: unknown) => void;
  sendByCtrlEnter?: boolean;
  onSessionActive?: (
    sessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
  ) => void;
  onSessionProcessing?: (
    sessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
  ) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  processingSessions?: Set<string>;
  pendingViewSessionRef: { current: PendingViewSession | null };
  scrollToBottom: () => void;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSessionMessages?: Dispatch<SetStateAction<any[]>>;
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
  setIsUserScrolledUp: (isScrolledUp: boolean) => void;
  setPendingPermissionRequests: Dispatch<
    SetStateAction<PendingPermissionRequest[]>
  >;
  newSessionMode?: SessionMode;
  /** Current chat messages for /btw context. */
  getChatMessagesForBtw?: () => ChatMessage[];
}

interface MentionableFile {
  name: string;
  path: string;
}

interface CommandExecutionResult {
  type: "builtin" | "custom";
  action?: string;
  data?: any;
  content?: string;
  hasBashCommands?: boolean;
  hasFileIncludes?: boolean;
}

interface UploadedProjectFile {
  name?: string;
  path?: string;
  size?: number;
}

const createFakeSubmitEvent = () => {
  return {
    preventDefault: () => undefined,
  } as unknown as FormEvent<HTMLFormElement>;
};

const PROGRAMMATIC_SUBMIT_MAX_RETRIES = 12;
const PROGRAMMATIC_SUBMIT_RETRY_DELAY_MS = 50;
const CODEX_QUEUE_DISPATCH_AFTER_SETTLE_MS = 800;
const CODEX_QUEUE_DISPATCH_ACK_TIMEOUT_MS = 6000;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;
const CODEX_ATTACHMENT_DIR = ".dr-claw/chat-attachments";
const CLOSED_BTW_OVERLAY: BtwOverlayState = {
  open: false,
  question: "",
  answer: "",
  loading: false,
  error: null,
};

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".heic",
  ".heif",
]);

const PDF_EXTENSION = ".pdf";

function getAttachmentKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function getFileExtension(file: File) {
  const lowerName = file.name.toLowerCase();
  const lastDot = lowerName.lastIndexOf(".");
  return lastDot >= 0 ? lowerName.slice(lastDot) : "";
}

function isImageAttachment(file: File) {
  return (
    file.type.startsWith("image/") ||
    IMAGE_EXTENSIONS.has(getFileExtension(file))
  );
}

function isPdfAttachment(file: File) {
  return (
    file.type === "application/pdf" || getFileExtension(file) === PDF_EXTENSION
  );
}

function getAttachmentKind(file: File) {
  if (isImageAttachment(file)) {
    return "image";
  }
  if (isPdfAttachment(file)) {
    return "pdf";
  }
  return "file";
}

function formatRejectedFileMessage(rejection: FileRejection) {
  const attachmentKey = getAttachmentKey(rejection.file);
  const name = rejection.file?.name || "Unknown file";
  const messages = rejection.errors.map((error) => {
    if (error.code === "file-too-large") {
      return "File too large (max 50MB)";
    }
    if (error.code === "too-many-files") {
      return "Too many files (max 5)";
    }
    return error.message;
  });

  return {
    attachmentKey,
    message: `${name}: ${messages.join(", ") || "File rejected"}`,
  };
}

const isTemporarySessionId = (sessionId: string | null | undefined) =>
  Boolean(
    sessionId
    && (
      sessionId.startsWith("new-session-")
      || sessionId.startsWith("temp-")
    ),
  );

const BTW_TRANSCRIPT_MAX_CHARS = 120_000;

function buildBtwTranscript(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.type !== 'user' && m.type !== 'assistant') {
      continue;
    }
    const raw = typeof m.content === 'string' ? m.content : '';
    const text = raw.trim();
    if (!text) {
      continue;
    }
    const label = m.type === 'user' ? 'User' : 'Assistant';
    lines.push(`${label}: ${text}`);
  }
  let out = lines.join('\n\n');
  if (out.length > BTW_TRANSCRIPT_MAX_CHARS) {
    let cutPos = out.length - BTW_TRANSCRIPT_MAX_CHARS;
    const nextBoundary = out.indexOf('\n\n', cutPos);
    if (nextBoundary !== -1 && nextBoundary < cutPos + 2000) {
      cutPos = nextBoundary + 2;
    }
    out = '…(earlier messages omitted)\n\n' + out.slice(cutPos);
  }
  return out;
}

const getRouteSessionId = () => {
  if (typeof window === "undefined") {
    return null;
  }

  const match = window.location.pathname.match(/^\/session\/([^/]+)$/);
  if (!match?.[1]) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

const getOptimisticSessionDisplayName = (input: string) => {
  const firstLine = input
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return "New Session";
  }

  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine;
};

const getCodexQueueStorageKey = (projectName: string) =>
  `codex_queue_${projectName}`;

const readPersistedCodexQueue = (
  projectName?: string | null,
): SessionQueueMap => {
  if (!projectName) {
    return {};
  }

  try {
    const raw = safeLocalStorage.getItem(getCodexQueueStorageKey(projectName));
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const normalized: SessionQueueMap = {};
    for (const [sessionId, queue] of Object.entries(parsed)) {
      if (!Array.isArray(queue)) {
        continue;
      }

      const turns: QueuedTurn[] = [];
      for (const candidate of queue) {
        if (!candidate || typeof candidate !== "object") {
          continue;
        }

        const turn = {
          id:
            typeof (candidate as any).id === "string"
              ? (candidate as any).id
              : `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sessionId,
          text:
            typeof (candidate as any).text === "string"
              ? (candidate as any).text
              : "",
          kind: (candidate as any).kind === "steer" ? "steer" : "normal",
          status: (candidate as any).status === "paused" ? "paused" : "queued",
          createdAt:
            typeof (candidate as any).createdAt === "number"
              ? (candidate as any).createdAt
              : Date.now(),
          projectName:
            typeof (candidate as any).projectName === "string"
              ? (candidate as any).projectName
              : undefined,
          projectPath:
            typeof (candidate as any).projectPath === "string"
              ? (candidate as any).projectPath
              : undefined,
          sessionMode:
            (candidate as any).sessionMode === "workspace_qa"
              ? "workspace_qa"
              : "research",
        } satisfies QueuedTurn;

        if (!turn.text.trim()) {
          continue;
        }

        turns.push(turn);
      }

      if (turns.length > 0) {
        normalized[sessionId] = turns;
      }
    }

    return normalized;
  } catch {
    return {};
  }
};

export function useChatComposerState({
  selectedProject,
  selectedSession,
  currentSessionId,
  provider,
  permissionMode,
  cyclePermissionMode,
  cursorModel,
  claudeModel,
  codexModel,
  geminiModel,
  openrouterModel,
  localModel,
  nanoModel,
  isLoading,
  canAbortSession,
  tokenBudget,
  sendMessage,
  sendByCtrlEnter,
  onSessionActive,
  onSessionProcessing,
  onInputFocusChange,
  onFileOpen,
  onShowSettings,
  processingSessions,
  pendingViewSessionRef,
  scrollToBottom,
  setChatMessages,
  setSessionMessages,
  setIsLoading,
  setCanAbortSession,
  setClaudeStatus,
  setIsUserScrolledUp,
  setPendingPermissionRequests,
  newSessionMode = "research",
  getChatMessagesForBtw,
}: UseChatComposerStateArgs) {
  const { t } = useTranslation("chat");
  const { pathname } = useLocation();
  const initialDraftBucket =
    selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || "new";
  const initialDraftStorageKey = buildDraftInputStorageKey(
    selectedProject?.name || null,
    normalizeProvider(provider),
    initialDraftBucket,
  );
  const [input, setInput] = useState(() => {
    if (typeof window !== "undefined" && initialDraftStorageKey) {
      return safeLocalStorage.getItem(initialDraftStorageKey) || "";
    }
    return "";
  });
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, number>>(
    new Map(),
  );
  const [fileErrors, setFileErrors] = useState<Map<string, string>>(new Map());
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [thinkingMode, setThinkingMode] = useState("none");
  const [codexReasoningEffort, setCodexReasoningEffort] =
    useState<CodexReasoningEffortId>(() => {
      const savedValue = safeLocalStorage.getItem("codex-reasoning-effort");
      switch (savedValue) {
        case "minimal":
        case "low":
        case "medium":
        case "high":
        case "xhigh":
        case "default":
          return savedValue;
        default:
          return "default";
      }
    });
  const [geminiThinkingMode, setGeminiThinkingMode] =
    useState<GeminiThinkingModeId>(() => {
      const savedValue = safeLocalStorage.getItem("gemini-thinking-mode");
      switch (savedValue) {
        case "default":
        case "minimal":
        case "low":
        case "medium":
        case "high":
        case "dynamic":
        case "off":
        case "light":
        case "balanced":
        case "deep":
        case "max":
          return savedValue;
        default:
          return "default";
      }
    });
  const [intakeGreeting, setIntakeGreeting] = useState<string | null>(null);
  const [btwOverlay, setBtwOverlay] = useState<BtwOverlayState>(CLOSED_BTW_OVERLAY);
  const btwAbortRef = useRef<AbortController | null>(null);
  const closeBtwOverlay = useCallback(() => {
    btwAbortRef.current?.abort();
    btwAbortRef.current = null;
    setBtwOverlay(CLOSED_BTW_OVERLAY);
  }, []);
  const [pendingStageTagKeys, setPendingStageTagKeys] = useState<string[]>([]);
  const [attachedPrompt, setAttachedPrompt] = useState<AttachedPrompt | null>(
    null,
  );
  const [steerMode, setSteerMode] = useState(false);
  const [isQueueBootstrapReady, setIsQueueBootstrapReady] = useState(false);
  const [queuedTurnsBySession, setQueuedTurnsBySession] =
    useState<SessionQueueMap>(() =>
      readPersistedCodexQueue(selectedProject?.name),
    );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputHighlightRef = useRef<HTMLDivElement>(null);
  const handleSubmitRef = useRef<
    | ((
        event:
          | FormEvent<HTMLFormElement>
          | MouseEvent
          | TouchEvent
          | KeyboardEvent<HTMLTextAreaElement>,
      ) => Promise<void>)
    | null
  >(null);
  const inputValueRef = useRef(input);
  const abortTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuedTurnsBySessionRef = useRef<SessionQueueMap>(queuedTurnsBySession);
  const queueDispatchLocksRef = useRef<Set<string>>(new Set());
  const pendingQueueDispatchesRef = useRef<
    Map<string, PendingCodexQueueDispatch>
  >(new Map());
  const queueDispatchAckTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const codexBusyRejectedDispatchesRef = useRef<Set<string>>(new Set());
  const queueBootstrapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastSubmittedCodexSessionRef = useRef<string | null>(null);
  const forceSteerForSubmitRef = useRef(false);
  const normalizedProvider = normalizeProvider(provider);
  const currentProjectName = selectedProject?.name || null;
  const activeDraftBucket =
    selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || "new";
  const draftStorageKey = useMemo(
    () =>
      buildDraftInputStorageKey(
        currentProjectName,
        normalizedProvider,
        activeDraftBucket,
      ),
    [activeDraftBucket, currentProjectName, normalizedProvider],
  );

  const hasProcessingSession = useCallback(
    (
      sessionId: string | null | undefined,
      providerOverride: SessionProvider | string | null | undefined = normalizedProvider,
      projectNameOverride: string | null | undefined = currentProjectName,
    ) => {
      if (!sessionId || !processingSessions || !projectNameOverride) {
        return false;
      }

      const scopeKey = buildSessionScopeKey(
        projectNameOverride,
        providerOverride || normalizedProvider,
        sessionId,
      );

      if (scopeKey && processingSessions.has(scopeKey)) {
        return true;
      }

      if (processingSessions.has(sessionId)) {
        return true;
      }

      const normalizedProviderOverride = normalizeProvider(
        (providerOverride || normalizedProvider) as SessionProvider,
      );

      return Array.from(processingSessions).some((trackingKey) => {
        if (!scopeKeyMatchesSessionId(trackingKey, sessionId)) {
          return false;
        }

        const parsedScope = parseSessionScopeKey(trackingKey);
        if (!parsedScope) {
          return trackingKey === sessionId;
        }

        return (
          parsedScope.projectName === projectNameOverride &&
          parsedScope.provider === normalizedProviderOverride
        );
      });
    },
    [currentProjectName, normalizedProvider, processingSessions],
  );

  useEffect(() => {
    queuedTurnsBySessionRef.current = queuedTurnsBySession;
  }, [queuedTurnsBySession]);

  useEffect(() => {
    setQueuedTurnsBySession(readPersistedCodexQueue(selectedProject?.name));
  }, [selectedProject?.name]);

  useEffect(() => {
    return () => {
      if (abortTimeoutRef.current) {
        clearTimeout(abortTimeoutRef.current);
        abortTimeoutRef.current = null;
      }

      if (queueBootstrapTimerRef.current) {
        clearTimeout(queueBootstrapTimerRef.current);
        queueBootstrapTimerRef.current = null;
      }

      for (const timerId of queueDispatchAckTimersRef.current.values()) {
        clearTimeout(timerId);
      }
      queueDispatchAckTimersRef.current.clear();
      queueDispatchLocksRef.current.clear();
      pendingQueueDispatchesRef.current.clear();
      codexBusyRejectedDispatchesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    setIsQueueBootstrapReady(false);
    if (queueBootstrapTimerRef.current) {
      clearTimeout(queueBootstrapTimerRef.current);
      queueBootstrapTimerRef.current = null;
    }
  }, [selectedProject?.name]);

  useEffect(() => {
    if (!selectedProject?.name) {
      return;
    }

    safeLocalStorage.setItem(
      getCodexQueueStorageKey(selectedProject.name),
      JSON.stringify(queuedTurnsBySession),
    );
  }, [queuedTurnsBySession, selectedProject?.name]);

  useEffect(() => {
    if (isQueueBootstrapReady || queueBootstrapTimerRef.current) {
      return;
    }

    const queuedSessionIds = Object.entries(queuedTurnsBySession)
      .filter(([, queue]) => queue.some((turn) => turn.status === "queued"))
      .map(([sessionId]) => sessionId);

    if (queuedSessionIds.length === 0) {
      setIsQueueBootstrapReady(true);
      return;
    }

    queuedSessionIds.forEach((sessionId) => {
      sendMessage({
        type: "check-session-status",
        sessionId,
        provider: "codex",
      });
    });

    queueBootstrapTimerRef.current = setTimeout(() => {
      setIsQueueBootstrapReady(true);
      queueBootstrapTimerRef.current = null;
    }, 1200);
  }, [isQueueBootstrapReady, queuedTurnsBySession, sendMessage]);

  useEffect(() => {
    setPendingStageTagKeys([]);
  }, [selectedProject?.name, selectedSession?.id]);

  useEffect(() => {
    safeLocalStorage.setItem("codex-reasoning-effort", codexReasoningEffort);
  }, [codexReasoningEffort]);

  useEffect(() => {
    safeLocalStorage.setItem("gemini-thinking-mode", geminiThinkingMode);
  }, [geminiThinkingMode]);

  useEffect(() => {
    const supportedEfforts = getSupportedCodexReasoningEfforts(codexModel);
    if (!supportedEfforts.includes(codexReasoningEffort)) {
      setCodexReasoningEffort("default");
    }
  }, [codexModel, codexReasoningEffort]);

  useEffect(() => {
    const supportedModes = getSupportedGeminiThinkingModes(geminiModel);
    if (!supportedModes.includes(geminiThinkingMode)) {
      setGeminiThinkingMode("default");
    }
  }, [geminiModel, geminiThinkingMode]);

  const handleBuiltInCommand = useCallback(
    (result: CommandExecutionResult) => {
      const { action, data } = result;
      switch (action) {
        case "clear":
          setChatMessages([]);
          setSessionMessages?.([]);
          break;

        case "help":
          setChatMessages((previous) => [
            ...previous,
            {
              type: "assistant",
              content: data.content,
              timestamp: Date.now(),
            },
          ]);
          break;

        case "model":
          setChatMessages((previous) => [
            ...previous,
            {
              type: "assistant",
              content: `**Current Model**: ${data.current.model}\n\n**Available Models**:\n\nClaude: ${data.available.claude.join(", ")}\n\nCursor: ${data.available.cursor.join(", ")}`,
              timestamp: Date.now(),
            },
          ]);
          break;

        case "cost": {
          const costMessage = `**Token Usage**: ${data.tokenUsage.used.toLocaleString()} / ${data.tokenUsage.total.toLocaleString()} (${data.tokenUsage.percentage}%)\n\n**Estimated Cost**:\n- Input: $${data.cost.input}\n- Output: $${data.cost.output}\n- **Total**: $${data.cost.total}\n\n**Model**: ${data.model}`;
          setChatMessages((previous) => [
            ...previous,
            { type: "assistant", content: costMessage, timestamp: Date.now() },
          ]);
          break;
        }

        case "status": {
          const statusMessage = `**System Status**\n\n- Version: ${data.version}\n- Uptime: ${data.uptime}\n- Model: ${data.model}\n- Provider: ${data.provider}\n- Node.js: ${data.nodeVersion}\n- Platform: ${data.platform}`;
          setChatMessages((previous) => [
            ...previous,
            {
              type: "assistant",
              content: statusMessage,
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        case "memory":
          if (data.error) {
            setChatMessages((previous) => [
              ...previous,
              {
                type: "assistant",
                content: `閳跨媴绗?${data.message}`,
                timestamp: Date.now(),
              },
            ]);
          } else {
            setChatMessages((previous) => [
              ...previous,
              {
                type: "assistant",
                content: `棣冩憫 ${data.message}\n\nPath: \`${data.path}\``,
                timestamp: Date.now(),
              },
            ]);
            if (data.exists && onFileOpen) {
              onFileOpen(data.path);
            }
          }
          break;

        case "config":
          onShowSettings?.();
          break;

        case "rewind":
          if (data.error) {
            setChatMessages((previous) => [
              ...previous,
              {
                type: "assistant",
                content: `閳跨媴绗?${data.message}`,
                timestamp: Date.now(),
              },
            ]);
          } else {
            setChatMessages((previous) => previous.slice(0, -data.steps * 2));
            setChatMessages((previous) => [
              ...previous,
              {
                type: "assistant",
                content: `閳?${data.message}`,
                timestamp: Date.now(),
              },
            ]);
          }
          break;

        default:
          console.warn("Unknown built-in command action:", action);
      }
    },
    [onFileOpen, onShowSettings, setChatMessages, setSessionMessages],
  );

  const handleCustomCommand = useCallback(
    async (result: CommandExecutionResult) => {
      const { content, hasBashCommands } = result;

      if (hasBashCommands) {
        const confirmed = window.confirm(
          "This command contains bash commands that will be executed. Do you want to proceed?",
        );
        if (!confirmed) {
          setChatMessages((previous) => [
            ...previous,
            {
              type: "assistant",
              content: "閴?Command execution cancelled",
              timestamp: Date.now(),
            },
          ]);
          return;
        }
      }

      const commandContent = content || "";
      setInput(commandContent);
      inputValueRef.current = commandContent;

      // Defer submit to next tick so the command text is reflected in UI before dispatching.
      setTimeout(() => {
        if (handleSubmitRef.current) {
          handleSubmitRef.current(createFakeSubmitEvent());
        }
      }, 0);
    },
    [setChatMessages],
  );

  const submitProgrammaticInput = useCallback((content: string) => {
    const nextContent = content || "";
    setInput(nextContent);
    inputValueRef.current = nextContent;

    const attemptSubmit = (attempt = 0) => {
      if (handleSubmitRef.current) {
        handleSubmitRef.current(createFakeSubmitEvent());
        return;
      }

      if (attempt >= PROGRAMMATIC_SUBMIT_MAX_RETRIES) {
        console.warn(
          "[Chat] Programmatic submit skipped because handleSubmit was not ready",
        );
        return;
      }

      setTimeout(() => {
        attemptSubmit(attempt + 1);
      }, PROGRAMMATIC_SUBMIT_RETRY_DELAY_MS);
    };

    setTimeout(() => {
      attemptSubmit();
    }, 0);
  }, []);

  const executeCommand = useCallback(
    async (command: SlashCommand, rawInput?: string) => {
      if (!command || !selectedProject) {
        return;
      }

      try {
        const effectiveInput = rawInput ?? input;
        const commandMatch = effectiveInput.match(
          new RegExp(`${escapeRegExp(command.name)}\\s*(.*)`),
        );
        const args =
          commandMatch && commandMatch[1]
            ? commandMatch[1].trim().split(/\s+/)
            : [];

        const context = {
          projectPath: selectedProject.fullPath || selectedProject.path,
          projectName: selectedProject.name,
          sessionId: currentSessionId,
          provider,
          model:
            provider === "cursor"
              ? cursorModel
              : provider === "codex"
                ? codexModel
                : claudeModel,
          tokenUsage: tokenBudget,
        };

        const response = await authenticatedFetch("/api/commands/execute", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            commandName: command.name,
            commandPath: command.path,
            args,
            context,
          }),
        });

        if (!response.ok) {
          let errorMessage = `Failed to execute command (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage =
              errorData?.message || errorData?.error || errorMessage;
          } catch {
            // Ignore JSON parse failures and use fallback message.
          }
          throw new Error(errorMessage);
        }

        const result = (await response.json()) as CommandExecutionResult;
        if (result.type === 'builtin' && result.action === 'btw') {
          const { data } = result;
          setInput('');
          inputValueRef.current = '';
          if (data?.error) {
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content: `⚠️ ${data.error}`,
                timestamp: Date.now(),
              },
            ]);
            return;
          }
          const btwSupportedProviders = new Set(['claude', 'gemini', 'codex']);
          if (!btwSupportedProviders.has(provider)) {
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content:
                  '`/btw` is available with Claude, Gemini, and Codex providers. Switch to one of them in the chat controls, then try again.',
                timestamp: Date.now(),
              },
            ]);
            return;
          }
          const question = typeof data?.question === 'string' ? data.question.trim() : '';
          if (!question) {
            return;
          }
          btwAbortRef.current?.abort();
          const abortController = new AbortController();
          btwAbortRef.current = abortController;
          setBtwOverlay({
            open: true,
            question,
            answer: '',
            loading: true,
            error: null,
          });
          try {
            const transcript = buildBtwTranscript(getChatMessagesForBtw?.() ?? []);
            const btwModel =
              provider === 'gemini'
                ? geminiModel
                : provider === 'codex'
                  ? codexModel
                  : claudeModel;
            const btwResponse = await authenticatedFetch('/api/btw', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                question,
                transcript,
                projectPath: selectedProject.fullPath || selectedProject.path,
                model: btwModel,
                provider,
              }),
              signal: abortController.signal,
            });
            const payload = (await btwResponse.json().catch(() => ({}))) as {
              answer?: string;
              error?: string;
              message?: string;
            };
            if (!btwResponse.ok) {
              throw new Error(payload?.error || payload?.message || `Request failed (${btwResponse.status})`);
            }
            setBtwOverlay((previous) => ({
              ...previous,
              loading: false,
              answer: typeof payload.answer === 'string' ? payload.answer : '',
              error: null,
            }));
          } catch (btwErr) {
            if (abortController.signal.aborted) {
              return;
            }
            const msg = btwErr instanceof Error ? btwErr.message : 'Unknown error';
            setBtwOverlay((previous) => ({
              ...previous,
              loading: false,
              error: msg,
              answer: '',
            }));
          }
          return;
        }
        if (result.type === "builtin") {
          handleBuiltInCommand(result);
          setInput("");
          inputValueRef.current = "";
        } else if (result.type === "custom") {
          await handleCustomCommand(result);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.error("Error executing command:", error);
        setChatMessages((previous) => [
          ...previous,
          {
            type: "assistant",
            content: `Error executing command: ${message}`,
            timestamp: Date.now(),
          },
        ]);
      }
    },
    [
      claudeModel,
      codexModel,
      currentSessionId,
      cursorModel,
      getChatMessagesForBtw,
      geminiModel,
      openrouterModel,
      localModel,
      nanoModel,
      handleBuiltInCommand,
      handleCustomCommand,
      input,
      provider,
      selectedProject,
      setChatMessages,
      tokenBudget,
    ],
  );

  const {
    slashCommands,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
  } = useSlashCommands({
    selectedProject,
    input,
    setInput,
    textareaRef,
    onExecuteCommand: executeCommand,
  });

  const {
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    setCursorPosition,
    handleFileMentionsKeyDown,
  } = useFileMentions({
    selectedProject,
    input,
    setInput,
    textareaRef,
  });

  const syncInputOverlayScroll = useCallback((target: HTMLTextAreaElement) => {
    if (!inputHighlightRef.current || !target) {
      return;
    }
    inputHighlightRef.current.scrollTop = target.scrollTop;
    inputHighlightRef.current.scrollLeft = target.scrollLeft;
  }, []);

  const handleAttachmentFiles = useCallback((files: File[]) => {
    const validFiles: File[] = [];

    files.forEach((file) => {
      try {
        if (!file || typeof file !== "object") {
          console.warn("Invalid file object:", file);
          return;
        }

        const attachmentKey = getAttachmentKey(file);

        if (!file.size) {
          setFileErrors((previous) => {
            const next = new Map(previous);
            next.set(
              attachmentKey,
              `${file.name || "Unknown file"}: Empty files are not supported`,
            );
            return next;
          });
          return;
        }

        if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
          setFileErrors((previous) => {
            const next = new Map(previous);
            next.set(
              attachmentKey,
              `${file.name || "Unknown file"}: File too large (max 50MB)`,
            );
            return next;
          });
          return;
        }

        validFiles.push(file);
      } catch (error) {
        console.error("Error validating file:", error, file);
      }
    });

    if (validFiles.length > 0) {
      setFileErrors((previous) => {
        const next = new Map(previous);
        validFiles.forEach((file) => {
          next.delete(getAttachmentKey(file));
        });
        return next;
      });

      setAttachedFiles((previous) => {
        const deduped = [...previous];
        validFiles.forEach((file) => {
          const nextKey = getAttachmentKey(file);
          if (
            !deduped.some((existing) => getAttachmentKey(existing) === nextKey)
          ) {
            deduped.push(file);
          }
        });
        return deduped.slice(0, MAX_ATTACHMENTS);
      });
    }
  }, []);

  const handleRejectedFiles = useCallback((rejections: FileRejection[]) => {
    if (!Array.isArray(rejections) || rejections.length === 0) {
      return;
    }

    setFileErrors((previous) => {
      const next = new Map(previous);
      rejections.forEach((rejection) => {
        const { attachmentKey, message } = formatRejectedFileMessage(rejection);
        next.set(attachmentKey, message);
      });
      return next;
    });
  }, []);

  const removeAttachedFile = useCallback((index: number) => {
    setAttachedFiles((previous) => {
      const next = [...previous];
      const [removedFile] = next.splice(index, 1);

      if (removedFile) {
        const attachmentKey = getAttachmentKey(removedFile);
        setFileErrors((previousErrors) => {
          const nextErrors = new Map(previousErrors);
          nextErrors.delete(attachmentKey);
          return nextErrors;
        });
        setUploadingFiles((previousUploads) => {
          const nextUploads = new Map(previousUploads);
          nextUploads.delete(attachmentKey);
          return nextUploads;
        });
      }

      return next;
    });
  }, []);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData.items);

      items.forEach((item) => {
        if (item.kind !== "file") {
          return;
        }
        const file = item.getAsFile();
        if (file) {
          handleAttachmentFiles([file]);
        }
      });

      if (items.length === 0 && event.clipboardData.files.length > 0) {
        const files = Array.from(event.clipboardData.files);
        if (files.length > 0) {
          handleAttachmentFiles(files);
        }
      }
    },
    [handleAttachmentFiles],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    maxSize: MAX_ATTACHMENT_SIZE_BYTES,
    maxFiles: MAX_ATTACHMENTS,
    onDrop: handleAttachmentFiles,
    onDropRejected: handleRejectedFiles,
    noClick: true,
    noKeyboard: true,
  });

  const uploadPreviewImages = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return [];
      }

      const formData = new FormData();
      files.forEach((file) => {
        formData.append("images", file);
      });

      const response = await authenticatedFetch(
        `/api/projects/${encodeURIComponent(selectedProject?.name || "")}/upload-images`,
        {
          method: "POST",
          headers: {},
          body: formData,
        },
      );

      if (!response.ok) {
        throw new Error("Failed to upload images");
      }

      const result = await response.json();
      return Array.isArray(result.images) ? (result.images as ChatImage[]) : [];
    },
    [selectedProject?.name],
  );

  const uploadFilesToProject = useCallback(
    async (files: File[]) => {
      if (!selectedProject || files.length === 0) {
        return [];
      }

      const formData = new FormData();
      const targetDir = `${CODEX_ATTACHMENT_DIR}/${Date.now()}`;
      formData.append("targetDir", targetDir);
      files.forEach((file) => {
        formData.append("files", file);
      });

      const response = await authenticatedFetch(
        `/api/projects/${encodeURIComponent(selectedProject.name)}/upload-files`,
        {
          method: "POST",
          headers: {},
          body: formData,
        },
      );

      if (!response.ok) {
        throw new Error("Failed to upload files");
      }

      const result = await response.json();
      return Array.isArray(result.files)
        ? (result.files as UploadedProjectFile[])
        : [];
    },
    [selectedProject],
  );

  const resolveSessionContext = useCallback(() => {
    const routedSessionId = getRouteSessionId();
    const projectName = selectedProject?.name || null;
    const resolvedProvider = normalizeProvider(provider);

    // If we're on the root path with no routed session and no selected session,
    // treat this as an explicit new-session start and clear stale IDs.
    const isExplicitNewSessionStart =
      pathname === "/" &&
      !routedSessionId &&
      !selectedSession?.id;
    if (isExplicitNewSessionStart) {
      clearScopedProviderSessionId(projectName, "gemini");
      clearScopedProviderSessionId(projectName, "cursor");
      clearScopedPendingSessionId(projectName, "claude");
      clearScopedPendingSessionId(projectName, "cursor");
      clearScopedPendingSessionId(projectName, "codex");
      clearScopedPendingSessionId(projectName, "gemini");
      clearScopedPendingSessionId(projectName, "openrouter");
      clearScopedPendingSessionId(projectName, "local");
      lastSubmittedCodexSessionRef.current = null;
    }

    const providerSessionId =
      resolvedProvider === "gemini" || resolvedProvider === "cursor"
        ? readScopedProviderSessionId(projectName, resolvedProvider)
        : null;
    const pendingSessionId = readScopedPendingSessionId(projectName, resolvedProvider);
    const pendingViewSessionId =
      pendingViewSessionRef.current?.sessionId || null;
    const lastSubmittedSessionId =
      provider === "codex" ? lastSubmittedCodexSessionRef.current : null;
    const effectiveSessionId =
      currentSessionId ||
        selectedSession?.id ||
        routedSessionId ||
        pendingViewSessionId ||
        pendingSessionId ||
        providerSessionId ||
        lastSubmittedSessionId;
    const isNewSession = !effectiveSessionId;
    const sessionToActivate = effectiveSessionId || `new-session-${Date.now()}`;
    const resolvedProjectPath =
      selectedProject?.fullPath || selectedProject?.path || "";

    return {
      routedSessionId,
      effectiveSessionId,
      isNewSession,
      sessionToActivate,
      resolvedProvider,
      resolvedProjectPath,
    };
  }, [
    currentSessionId,
    pathname,
    pendingViewSessionRef,
    provider,
    selectedProject?.fullPath,
    selectedProject?.path,
    selectedSession?.id,
  ]);

  const getToolsSettings = useCallback((resolvedProvider: SessionProvider) => {
    try {
      const settingsKey = getProviderSettingsKey(resolvedProvider);
      const savedSettings = safeLocalStorage.getItem(settingsKey);
      if (savedSettings) {
        return JSON.parse(savedSettings);
      }
    } catch (error) {
      console.error("Error loading tools settings:", error);
    }

    return {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
    };
  }, []);

  const sendCodexTurn = useCallback(
    ({
      text,
      sessionId,
      projectName,
      projectPath,
      sessionMode,
      updateForegroundState = true,
      appendLocalUserMessage = true,
    }: {
      text: string;
      sessionId: string;
      projectName?: string | null;
      projectPath: string;
      sessionMode: SessionMode;
      updateForegroundState?: boolean;
      appendLocalUserMessage?: boolean;
    }) => {
      if (!text.trim() || !sessionId || !projectPath) {
        return;
      }

      const turnStartTime = Date.now();

      if (appendLocalUserMessage) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: "user",
            content: text,
            timestamp: new Date(),
          },
        ]);
      }

      if (updateForegroundState) {
        setIsLoading(true);
        setCanAbortSession(true);
        setClaudeStatus({
          text: "Processing",
          tokens: 0,
          can_interrupt: true,
          startTime: turnStartTime,
        });
        setIsUserScrolledUp(false);
        setTimeout(() => scrollToBottom(), 100);
      }

      persistSessionTimerStart(sessionId, turnStartTime);
      onSessionActive?.(sessionId, "codex", projectName || selectedProject?.name || null);
      onSessionProcessing?.(
        sessionId,
        "codex",
        projectName || selectedProject?.name || null,
      );
      lastSubmittedCodexSessionRef.current = sessionId;

      sendMessage({
        type: "codex-command",
        command: text,
        sessionId,
        options: {
          cwd: projectPath,
          projectPath,
          sessionId,
          resume: true,
          model: codexModel,
          permissionMode:
            permissionMode === "plan" ? "default" : permissionMode,
          modelReasoningEffort:
            codexReasoningEffort === "default"
              ? undefined
              : codexReasoningEffort,
          telemetryEnabled: isTelemetryEnabled(),
          sessionMode,
        },
      });
    },
    [
      codexModel,
      codexReasoningEffort,
      onSessionActive,
      onSessionProcessing,
      permissionMode,
      scrollToBottom,
      sendMessage,
      setCanAbortSession,
      setChatMessages,
      setClaudeStatus,
      setIsLoading,
      setIsUserScrolledUp,
      selectedProject?.name,
    ],
  );

  const clearQueueDispatchAckTimer = useCallback((sessionId: string) => {
    const timerId = queueDispatchAckTimersRef.current.get(sessionId);
    if (timerId) {
      clearTimeout(timerId);
      queueDispatchAckTimersRef.current.delete(sessionId);
    }
  }, []);

  const releasePendingQueueDispatch = useCallback(
    (sessionId: string) => {
      clearQueueDispatchAckTimer(sessionId);
      queueDispatchLocksRef.current.delete(sessionId);
      pendingQueueDispatchesRef.current.delete(sessionId);
      codexBusyRejectedDispatchesRef.current.delete(sessionId);
    },
    [clearQueueDispatchAckTimer],
  );

  const dispatchNextQueuedCodexTurn = useCallback(
    (sessionId: string, options?: { ignoreProcessingCheck?: boolean }) => {
      if (!sessionId) {
        return;
      }

      if (
        queueDispatchLocksRef.current.has(sessionId) ||
        pendingQueueDispatchesRef.current.has(sessionId)
      ) {
        return;
      }

      const queue = getSessionQueue(queuedTurnsBySessionRef.current, sessionId);
      const nextTurn = getNextDispatchableTurn(queue);
      if (!nextTurn) {
        return;
      }

      if (
        !options?.ignoreProcessingCheck &&
        hasProcessingSession(
          sessionId,
          "codex",
          nextTurn.projectName || selectedProject?.name || currentProjectName,
        )
      ) {
        return;
      }

      const queuedProjectPath =
        nextTurn.projectPath ||
        selectedProject?.fullPath ||
        selectedProject?.path ||
        "";
      if (!queuedProjectPath) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: "error",
            content:
              "Unable to execute queued message: project path is unavailable.",
            timestamp: new Date(),
          },
        ]);
        return;
      }

      const routedSessionId = getRouteSessionId();
      const currentViewSessionId =
        selectedSession?.id ||
        routedSessionId ||
        currentSessionId ||
        pendingViewSessionRef.current?.sessionId ||
        null;
      const shouldUpdateForegroundState =
        currentViewSessionId === sessionId ||
        (!currentViewSessionId &&
          lastSubmittedCodexSessionRef.current === sessionId);

      queueDispatchLocksRef.current.add(sessionId);
      pendingQueueDispatchesRef.current.set(sessionId, {
        turn: nextTurn,
        shouldUpdateForegroundState,
      });

      clearQueueDispatchAckTimer(sessionId);
      const ackTimer = setTimeout(() => {
        const pendingDispatch =
          pendingQueueDispatchesRef.current.get(sessionId);
        if (!pendingDispatch || pendingDispatch.turn.id !== nextTurn.id) {
          return;
        }

        queueDispatchAckTimersRef.current.delete(sessionId);
        queueDispatchLocksRef.current.delete(sessionId);
        pendingQueueDispatchesRef.current.delete(sessionId);
        sendMessage({
          type: "check-session-status",
          sessionId,
          provider: "codex",
        });
      }, CODEX_QUEUE_DISPATCH_ACK_TIMEOUT_MS);
      queueDispatchAckTimersRef.current.set(sessionId, ackTimer);

      sendCodexTurn({
        text: nextTurn.text,
        sessionId,
        projectName: nextTurn.projectName || selectedProject?.name || currentProjectName,
        projectPath: queuedProjectPath,
        sessionMode:
          nextTurn.sessionMode || selectedSession?.mode || newSessionMode,
        updateForegroundState: shouldUpdateForegroundState,
        appendLocalUserMessage: false,
      });
    },
    [
      clearQueueDispatchAckTimer,
      currentSessionId,
      newSessionMode,
      pendingViewSessionRef,
      hasProcessingSession,
      selectedProject?.fullPath,
      selectedProject?.name,
      selectedProject?.path,
      selectedSession?.id,
      selectedSession?.mode,
      currentProjectName,
      sendCodexTurn,
      sendMessage,
      setChatMessages,
    ],
  );

  const handleCodexTurnStarted = useCallback(
    (sessionId?: string | null) => {
      if (!sessionId) {
        return;
      }

      codexBusyRejectedDispatchesRef.current.delete(sessionId);
      const pendingDispatch = pendingQueueDispatchesRef.current.get(sessionId);
      if (!pendingDispatch) {
        return;
      }

      releasePendingQueueDispatch(sessionId);
      setQueuedTurnsBySession((previous) =>
        removeQueuedTurn(previous, sessionId, pendingDispatch.turn.id),
      );

      if (pendingDispatch.shouldUpdateForegroundState) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: "user",
            content: pendingDispatch.turn.text,
            timestamp: new Date(),
          },
        ]);
      }
    },
    [releasePendingQueueDispatch, setChatMessages],
  );

  const handleCodexTurnSettled = useCallback(
    (
      sessionId?: string | null,
      outcome: "complete" | "error" | "aborted" = "complete",
    ) => {
      if (!sessionId) {
        return;
      }

      codexBusyRejectedDispatchesRef.current.delete(sessionId);
      releasePendingQueueDispatch(sessionId);

      if (outcome === "aborted") {
        setQueuedTurnsBySession((previous) =>
          setSessionQueueStatus(previous, sessionId, "paused"),
        );
        return;
      }

      const fallbackTemporarySessionId = lastSubmittedCodexSessionRef.current;
      if (fallbackTemporarySessionId) {
        const reconciled = reconcileSettledSessionQueue(
          queuedTurnsBySessionRef.current,
          sessionId,
          fallbackTemporarySessionId,
        );
        if (reconciled !== queuedTurnsBySessionRef.current) {
          queuedTurnsBySessionRef.current = reconciled;
          setQueuedTurnsBySession(reconciled);
        }
      }

      queueDispatchLocksRef.current.add(sessionId);
      setTimeout(() => {
        queueDispatchLocksRef.current.delete(sessionId);
        sendMessage({
          type: "check-session-status",
          sessionId,
          provider: "codex",
        });
        dispatchNextQueuedCodexTurn(sessionId);
      }, CODEX_QUEUE_DISPATCH_AFTER_SETTLE_MS);
    },
    [dispatchNextQueuedCodexTurn, releasePendingQueueDispatch, sendMessage],
  );

  const handleCodexSessionIdResolved = useCallback(
    (previousSessionId?: string | null, actualSessionId?: string | null) => {
      if (
        !previousSessionId ||
        !actualSessionId ||
        previousSessionId === actualSessionId
      ) {
        return;
      }

      if (lastSubmittedCodexSessionRef.current === previousSessionId) {
        lastSubmittedCodexSessionRef.current = actualSessionId;
      }

      if (codexBusyRejectedDispatchesRef.current.has(previousSessionId)) {
        codexBusyRejectedDispatchesRef.current.delete(previousSessionId);
        codexBusyRejectedDispatchesRef.current.add(actualSessionId);
      }

      if (queueDispatchLocksRef.current.has(previousSessionId)) {
        queueDispatchLocksRef.current.delete(previousSessionId);
        queueDispatchLocksRef.current.add(actualSessionId);
      }

      const pendingDispatch =
        pendingQueueDispatchesRef.current.get(previousSessionId);
      if (
        pendingDispatch &&
        !pendingQueueDispatchesRef.current.has(actualSessionId)
      ) {
        pendingQueueDispatchesRef.current.set(actualSessionId, {
          ...pendingDispatch,
          turn: {
            ...pendingDispatch.turn,
            sessionId: actualSessionId,
          },
        });
      }
      pendingQueueDispatchesRef.current.delete(previousSessionId);

      clearQueueDispatchAckTimer(previousSessionId);
      if (pendingDispatch) {
        const ackTimer = setTimeout(() => {
          const currentPending =
            pendingQueueDispatchesRef.current.get(actualSessionId);
          if (
            !currentPending ||
            currentPending.turn.id !== pendingDispatch.turn.id
          ) {
            return;
          }

          queueDispatchAckTimersRef.current.delete(actualSessionId);
          queueDispatchLocksRef.current.delete(actualSessionId);
          pendingQueueDispatchesRef.current.delete(actualSessionId);
          sendMessage({
            type: "check-session-status",
            sessionId: actualSessionId,
            provider: "codex",
          });
        }, CODEX_QUEUE_DISPATCH_ACK_TIMEOUT_MS);
        queueDispatchAckTimersRef.current.set(actualSessionId, ackTimer);
      }

      const reconciled = reconcileSessionQueueId(
        queuedTurnsBySessionRef.current,
        previousSessionId,
        actualSessionId,
      );
      if (reconciled === queuedTurnsBySessionRef.current) {
        return;
      }

      queuedTurnsBySessionRef.current = reconciled;
      setQueuedTurnsBySession(reconciled);
    },
    [clearQueueDispatchAckTimer, sendMessage],
  );

  const handleCodexSessionBusy = useCallback(
    (sessionId?: string | null) => {
      if (!sessionId) {
        return;
      }

      codexBusyRejectedDispatchesRef.current.add(sessionId);
      releasePendingQueueDispatch(sessionId);
      queueDispatchLocksRef.current.delete(sessionId);

      setTimeout(() => {
        sendMessage({
          type: "check-session-status",
          sessionId,
          provider: "codex",
        });
        dispatchNextQueuedCodexTurn(sessionId);
      }, CODEX_QUEUE_DISPATCH_AFTER_SETTLE_MS);
    },
    [dispatchNextQueuedCodexTurn, releasePendingQueueDispatch, sendMessage],
  );

  const handleCodexSessionStatusUpdate = useCallback(
    (sessionId?: string | null, isProcessing?: boolean) => {
      if (!sessionId) {
        return;
      }

      if (isProcessing) {
        if (codexBusyRejectedDispatchesRef.current.has(sessionId)) {
          codexBusyRejectedDispatchesRef.current.delete(sessionId);
          return;
        }
        if (pendingQueueDispatchesRef.current.has(sessionId)) {
          handleCodexTurnStarted(sessionId);
        }
        return;
      }

      releasePendingQueueDispatch(sessionId);
      queueDispatchLocksRef.current.delete(sessionId);
      dispatchNextQueuedCodexTurn(sessionId);
    },
    [
      dispatchNextQueuedCodexTurn,
      handleCodexTurnStarted,
      releasePendingQueueDispatch,
    ],
  );

  const removeQueuedCodexTurn = useCallback(
    (sessionId: string, turnId: string) => {
      if (!sessionId || !turnId) {
        return;
      }

      const pendingDispatch = pendingQueueDispatchesRef.current.get(sessionId);
      if (pendingDispatch?.turn.id === turnId) {
        releasePendingQueueDispatch(sessionId);
      }

      setQueuedTurnsBySession((previous) =>
        removeQueuedTurn(previous, sessionId, turnId),
      );
    },
    [releasePendingQueueDispatch],
  );

  const promoteQueuedCodexTurnToSteer = useCallback(
    (sessionId: string, turnId: string) => {
      if (!sessionId || !turnId) {
        return;
      }

      setQueuedTurnsBySession((previous) =>
        promoteQueuedTurnToSteer(previous, sessionId, turnId),
      );
      sendMessage({
        type: "check-session-status",
        sessionId,
        provider: "codex",
      });
      dispatchNextQueuedCodexTurn(sessionId);
    },
    [dispatchNextQueuedCodexTurn, sendMessage],
  );

  const resumeQueuedCodexTurns = useCallback(
    (sessionId: string) => {
      if (!sessionId) {
        return;
      }

      setQueuedTurnsBySession((previous) =>
        setSessionQueueStatus(previous, sessionId, "queued"),
      );
      sendMessage({
        type: "check-session-status",
        sessionId,
        provider: "codex",
      });
      dispatchNextQueuedCodexTurn(sessionId);
    },
    [dispatchNextQueuedCodexTurn, sendMessage],
  );

  useEffect(() => {
    if (!isQueueBootstrapReady) {
      return;
    }

    for (const [sessionId, queue] of Object.entries(queuedTurnsBySession)) {
      if (!queue.some((turn) => turn.status === "queued")) {
        continue;
      }

      if (
        queueDispatchLocksRef.current.has(sessionId) ||
        pendingQueueDispatchesRef.current.has(sessionId)
      ) {
        continue;
      }

      if (hasProcessingSession(sessionId, "codex", selectedProject?.name || currentProjectName)) {
        continue;
      }

      dispatchNextQueuedCodexTurn(sessionId);
    }
  }, [
    dispatchNextQueuedCodexTurn,
    hasProcessingSession,
    currentProjectName,
    isQueueBootstrapReady,
    queuedTurnsBySession,
    selectedProject?.name,
  ]);

  const activeQueueSessionId =
    selectedSession?.id ||
    getRouteSessionId() ||
    currentSessionId ||
    pendingViewSessionRef.current?.sessionId ||
    lastSubmittedCodexSessionRef.current ||
    null;
  const activeQueuedTurns = activeQueueSessionId
    ? getSessionQueue(queuedTurnsBySession, activeQueueSessionId)
    : [];
  const isActiveQueuePaused = activeQueuedTurns.some(
    (turn) => turn.status === "paused",
  );

  const handleSubmit = useCallback(
    async (
      event:
        | FormEvent<HTMLFormElement>
        | MouseEvent
        | TouchEvent
        | KeyboardEvent<HTMLTextAreaElement>,
    ) => {
      event.preventDefault();
      const forceSteerForSubmit = forceSteerForSubmitRef.current;
      forceSteerForSubmitRef.current = false;
      const currentInput = inputValueRef.current;
      if (
        (!currentInput.trim() &&
          attachedFiles.length === 0 &&
          !attachedPrompt) ||
        !selectedProject
      ) {
        return;
      }

      if (isLoading && provider !== "codex") {
        return;
      }

      const trimmedInput = currentInput.trim();
      if (trimmedInput.startsWith("/")) {
        const firstSpace = trimmedInput.indexOf(" ");
        const commandName =
          firstSpace > 0 ? trimmedInput.slice(0, firstSpace) : trimmedInput;
        const matchedCommand = slashCommands.find(
          (command: SlashCommand) => command.name === commandName,
        );

        if (matchedCommand) {
          if (isLoading && commandName !== '/btw') {
            return;
          }
          await executeCommand(matchedCommand, trimmedInput);
          setInput("");
          inputValueRef.current = "";
          setAttachedPrompt(null);
          setAttachedFiles([]);
          setUploadingFiles(new Map());
          setFileErrors(new Map());
          resetCommandMenuState();
          setIsTextareaExpanded(false);
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
          }
          return;
        }
      }

      if (isLoading) {
        return;
      }

      const normalizedInput =
        currentInput.trim() ||
        t("input.attachmentOnlyFallback", {
          defaultValue:
            "Please inspect the attached files and help me with them.",
        });
      let messageContent = normalizedInput;

      if (attachedPrompt) {
        if (currentInput.trim()) {
          messageContent = `${attachedPrompt.promptText}\n\n${normalizedInput}`;
        } else {
          messageContent = attachedPrompt.promptText;
        }
      }

      const selectedThinkingMode = thinkingModes.find(
        (mode: { id: string; prefix?: string }) => mode.id === thinkingMode,
      );
      if (selectedThinkingMode && selectedThinkingMode.prefix) {
        messageContent = `${selectedThinkingMode.prefix}: ${messageContent}`;
      }

      if (intakeGreeting) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: "assistant",
            content: intakeGreeting,
            timestamp: new Date(),
          },
        ]);
        messageContent = `[Context: You have already greeted me as Dr. Claw's research assistant and asked about my research project. Continue the intake conversation without re-greeting.]\n\n${messageContent}`;
        setIntakeGreeting(null);
      }

      const {
        effectiveSessionId,
        isNewSession,
        sessionToActivate,
        resolvedProvider,
        resolvedProjectPath,
      } = resolveSessionContext();
      const isCurrentViewSession =
        !selectedSession?.id ||
        selectedSession?.id === sessionToActivate ||
        currentSessionId === sessionToActivate;
      const isCodexSessionBusy =
        resolvedProvider === "codex" &&
        hasProcessingSession(
          sessionToActivate,
          resolvedProvider,
          selectedProject?.name || currentProjectName,
        );
      const useSteerForThisSubmit =
        resolvedProvider === "codex" && (steerMode || forceSteerForSubmit);

      if (isCodexSessionBusy) {
        if (attachedFiles.length > 0) {
          setChatMessages((previous) => [
            ...previous,
            {
              type: "error",
              content:
                "Queued Codex turns currently support text-only input. Remove attachments and resend.",
              timestamp: new Date(),
            },
          ]);
          return;
        }

        const existingQueue = getSessionQueue(
          queuedTurnsBySessionRef.current,
          sessionToActivate,
        );
        const queueStatus: QueuedTurnStatus = existingQueue.some(
          (turn) => turn.status === "paused",
        )
          ? "paused"
          : "queued";
        const queuedTurn = buildQueuedTurn({
          id:
            typeof crypto !== "undefined" &&
            typeof crypto.randomUUID === "function"
              ? crypto.randomUUID()
              : `queued-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          sessionId: sessionToActivate,
          text: messageContent,
          kind: (useSteerForThisSubmit ? "steer" : "normal") as QueuedTurnKind,
          status: queueStatus,
          createdAt: Date.now(),
          projectName: selectedProject.name,
          projectPath: resolvedProjectPath,
          sessionMode: selectedSession?.mode || newSessionMode,
        });

        setQueuedTurnsBySession((previous) =>
          enqueueSessionTurn(previous, queuedTurn),
        );
        setInput("");
        inputValueRef.current = "";
        setPendingStageTagKeys([]);
        resetCommandMenuState();
        setAttachedPrompt(null);
        setAttachedFiles([]);
        setUploadingFiles(new Map());
        setFileErrors(new Map());
        setIsTextareaExpanded(false);
        setThinkingMode("none");
        setSteerMode(false);
        if (draftStorageKey) {
          safeLocalStorage.removeItem(draftStorageKey);
        }
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
        }
        return;
      }

      let uploadedImages: ChatImage[] = [];
      let codexAttachmentPayload:
        | {
            imagePaths: string[];
            documentPaths: string[];
          }
        | undefined;
      let messageAttachments: ChatAttachment[] = [];

      if (attachedFiles.length > 0) {
        let uploadedFiles: UploadedProjectFile[] = [];

        try {
          uploadedFiles = await uploadFilesToProject(attachedFiles);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          console.error("File upload failed:", error);
          setChatMessages((previous) => [
            ...previous,
            {
              type: "error",
              content: `Failed to upload files: ${message}`,
              timestamp: new Date(),
            },
          ]);
          return;
        }

        messageAttachments = attachedFiles.map((file, index) => {
          const uploadedFile = uploadedFiles[index];
          const uploadedPath =
            uploadedFile?.path && typeof uploadedFile.path === "string"
              ? uploadedFile.path
              : undefined;

          return {
            name: file.name,
            kind: getAttachmentKind(file),
            mimeType: file.type || undefined,
            path: uploadedPath,
          };
        });

        if (uploadedFiles.length > 0) {
          const fileNote = `\n\n[Files available at the following paths]\n${uploadedFiles
            .map((file, index) => `${index + 1}. ${file.path}`)
            .join("\n")}`;
          messageContent = `${messageContent}${fileNote}`;
        }

        if (resolvedProvider === "codex") {
          codexAttachmentPayload = uploadedFiles.reduce(
            (
              accumulator: {
                imagePaths: string[];
                documentPaths: string[];
              },
              uploadedFile: UploadedProjectFile,
              index: number,
            ) => {
              const sourceFile = attachedFiles[index];
              const uploadedPath =
                uploadedFile?.path && typeof uploadedFile.path === "string"
                  ? uploadedFile.path
                  : null;

              if (!sourceFile || !uploadedPath) {
                return accumulator;
              }

              if (isImageAttachment(sourceFile)) {
                accumulator.imagePaths.push(uploadedPath);
              } else if (isPdfAttachment(sourceFile)) {
                accumulator.documentPaths.push(uploadedPath);
              }

              return accumulator;
            },
            {
              imagePaths: [] as string[],
              documentPaths: [] as string[],
            },
          );
        }

        const imageFiles = attachedFiles.filter((file) =>
          isImageAttachment(file),
        );
        if (imageFiles.length > 0) {
          try {
            uploadedImages = await uploadPreviewImages(imageFiles);
          } catch (error) {
            console.error("Image preview upload failed:", error);
          }
        }
      }

      const userMessage: ChatMessage = {
        type: "user",
        content: normalizedInput,
        images: uploadedImages.length > 0 ? uploadedImages : undefined,
        attachments:
          messageAttachments.length > 0 ? messageAttachments : undefined,
        timestamp: new Date(),
        ...(attachedPrompt ? { attachedPrompt } : {}),
      };

      setChatMessages((previous) => [...previous, userMessage]);
      if (abortTimeoutRef.current) {
        clearTimeout(abortTimeoutRef.current);
        abortTimeoutRef.current = null;
      }
      const turnStartTime = Date.now();
      setIsLoading(true);
      setCanAbortSession(true);
      setClaudeStatus({
        text: "Processing",
        tokens: 0,
        can_interrupt: true,
        startTime: turnStartTime,
      });

      setIsUserScrolledUp(false);
      setTimeout(() => scrollToBottom(), 100);

      if (
        typeof window !== "undefined" &&
        isNewSession &&
        selectedProject.name
      ) {
        const optimisticSessionCreatedDetail: OptimisticSessionCreatedDetail = {
          sessionId: sessionToActivate,
          projectName: selectedProject.name,
          provider: resolvedProvider,
          mode: newSessionMode,
          displayName: getOptimisticSessionDisplayName(normalizedInput),
          summary: getOptimisticSessionDisplayName(normalizedInput),
          createdAt: new Date().toISOString(),
        };
        window.dispatchEvent(
          new CustomEvent<OptimisticSessionCreatedDetail>(
            OPTIMISTIC_SESSION_CREATED_EVENT,
            {
              detail: optimisticSessionCreatedDetail,
            },
          ),
        );
      }

      if (!effectiveSessionId && !selectedSession?.id) {
        clearScopedPendingSessionId(selectedProject.name, resolvedProvider);
        if (resolvedProvider === "cursor" || resolvedProvider === "gemini") {
          clearScopedProviderSessionId(selectedProject.name, resolvedProvider);
        }
        pendingViewSessionRef.current = {
          sessionId: sessionToActivate,
          startedAt: Date.now(),
        };
      }
      persistScopedPendingSessionId(
        selectedProject.name,
        resolvedProvider,
        sessionToActivate,
      );
      if (resolvedProvider === "cursor" || resolvedProvider === "gemini") {
        persistScopedProviderSessionId(
          selectedProject.name,
          resolvedProvider,
          sessionToActivate,
        );
      }
      persistSessionTimerStart(sessionToActivate, turnStartTime);
      onSessionActive?.(sessionToActivate, resolvedProvider, selectedProject.name);
      onSessionProcessing?.(
        sessionToActivate,
        resolvedProvider,
        selectedProject.name,
      );
      if (resolvedProvider === "codex") {
        lastSubmittedCodexSessionRef.current = sessionToActivate;
      }

      const toolsSettings = getToolsSettings(resolvedProvider);
      const telemetryEnabled = isTelemetryEnabled();

      if (isNewSession) {
        const sessionModeContext =
          newSessionMode === "workspace_qa"
            ? "[Context: session-mode=workspace_qa]\n[Context: Treat this as a lightweight workspace Q&A session. Focus on answering questions about files, code, and project structure. Do not start the research intake or pipeline workflow unless the user explicitly asks for it.]\n\n"
            : "[Context: session-mode=research]\n[Context: This is a research workflow session. Follow the normal project research instructions and pipeline behavior.]\n\n";
        messageContent = `${sessionModeContext}${messageContent}`;
      }

      if (resolvedProvider === "cursor") {
        sendMessage({
          type: "cursor-command",
          command: messageContent,
          sessionId: effectiveSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            model: cursorModel,
            skipPermissions: toolsSettings?.skipPermissions || false,
            toolsSettings,
            telemetryEnabled,
            sessionMode: isNewSession ? newSessionMode : selectedSession?.mode,
            stageTagKeys: pendingStageTagKeys,
            stageTagSource: "task_context",
          },
        });
      } else if (resolvedProvider === "gemini") {
        sendMessage({
          type: "gemini-command",
          command: messageContent,
          sessionId: effectiveSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            model: geminiModel,
            permissionMode,
            thinkingMode: geminiThinkingMode,
            images: uploadedImages.length > 0 ? uploadedImages : undefined,
            toolsSettings,
            telemetryEnabled,
            sessionMode: isNewSession ? newSessionMode : selectedSession?.mode,
            stageTagKeys: pendingStageTagKeys,
            stageTagSource: "task_context",
          },
        });
      } else if (resolvedProvider === "codex") {
        sendMessage({
          type: "codex-command",
          command: messageContent,
          sessionId: effectiveSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            model: codexModel,
            permissionMode:
              permissionMode === "plan" ? "default" : permissionMode,
            modelReasoningEffort:
              codexReasoningEffort === "default"
                ? undefined
                : codexReasoningEffort,
            attachments: codexAttachmentPayload,
            images: uploadedImages,
            telemetryEnabled,
            sessionMode: isNewSession ? newSessionMode : selectedSession?.mode,
            stageTagKeys: pendingStageTagKeys,
            stageTagSource: "task_context",
          },
        });
      } else if (resolvedProvider === "openrouter") {
        sendMessage({
          type: "openrouter-command",
          command: messageContent,
          sessionId: effectiveSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            model: openrouterModel,
            permissionMode,
            toolsSettings,
            telemetryEnabled,
            sessionMode: isNewSession ? newSessionMode : selectedSession?.mode,
            stageTagKeys: pendingStageTagKeys,
            stageTagSource: "task_context",
          },
        });
      } else if (resolvedProvider === "local") {
        sendMessage({
          type: "local-command",
          command: messageContent,
          sessionId: effectiveSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            model: localModel,
            serverUrl:
              localStorage.getItem("local-gpu-server-url") ||
              "http://localhost:11434",
            gpuId: localStorage.getItem("local-gpu-selected") || undefined,
            permissionMode,
            toolsSettings,
            telemetryEnabled,
            sessionMode: isNewSession ? newSessionMode : selectedSession?.mode,
            stageTagKeys: pendingStageTagKeys,
            stageTagSource: "task_context",
          },
        });
      } else if (resolvedProvider === "nano") {
        sendMessage({
          type: "nano-command",
          command: messageContent,
          sessionId: effectiveSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            model: nanoModel,
            toolsSettings,
            telemetryEnabled,
            sessionMode: isNewSession ? newSessionMode : selectedSession?.mode,
            stageTagKeys: pendingStageTagKeys,
            stageTagSource: "task_context",
          },
        });
      } else {
        sendMessage({
          type: "claude-command",
          command: messageContent,
          options: {
            projectPath: resolvedProjectPath,
            cwd: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            toolsSettings,
            permissionMode,
            model: claudeModel,
            images: uploadedImages.length > 0 ? uploadedImages : undefined,
            telemetryEnabled,
            sessionMode: isNewSession ? newSessionMode : selectedSession?.mode,
            stageTagKeys: pendingStageTagKeys,
            stageTagSource: "task_context",
          },
        });
      }

      setInput("");
      inputValueRef.current = "";
      setPendingStageTagKeys([]);
      resetCommandMenuState();
      setAttachedFiles([]);
      setUploadingFiles(new Map());
      setFileErrors(new Map());
      setIsTextareaExpanded(false);
      setThinkingMode("none");
      setAttachedPrompt(null);
      setSteerMode(false);

      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      if (draftStorageKey) {
        safeLocalStorage.removeItem(draftStorageKey);
      }
    },
    [
      attachedFiles,
      attachedPrompt,
      claudeModel,
      codexModel,
      codexReasoningEffort,
      currentSessionId,
      cursorModel,
      executeCommand,
      geminiThinkingMode,
      geminiModel,
      getToolsSettings,
      intakeGreeting,
      isLoading,
      localModel,
      newSessionMode,
      onSessionActive,
      onSessionProcessing,
      openrouterModel,
      pendingStageTagKeys,
      pendingViewSessionRef,
      permissionMode,
      processingSessions,
      provider,
      resetCommandMenuState,
      resolveSessionContext,
      scrollToBottom,
      selectedProject,
      selectedSession?.id,
      selectedSession?.mode,
      sendMessage,
      setCanAbortSession,
      setChatMessages,
      setClaudeStatus,
      setIsLoading,
      setIsUserScrolledUp,
      slashCommands,
      steerMode,
      t,
      thinkingMode,
      uploadFilesToProject,
      uploadPreviewImages,
    ],
  );
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  useEffect(() => {
    if (!selectedProject || !draftStorageKey) {
      return;
    }
    const savedInput = safeLocalStorage.getItem(draftStorageKey) || "";
    setInput((previous) => {
      const next = previous === savedInput ? previous : savedInput;
      inputValueRef.current = next;
      return next;
    });
  }, [draftStorageKey, selectedProject]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    const applyDraft = (draft: string) => {
      setInput(draft);
      inputValueRef.current = draft;

      setTimeout(() => {
        if (!textareaRef.current) {
          return;
        }

        textareaRef.current.focus();
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        const cursor = draft.length;
        textareaRef.current.setSelectionRange(cursor, cursor);
        const lineHeight = parseInt(
          window.getComputedStyle(textareaRef.current).lineHeight,
        );
        setIsTextareaExpanded(
          textareaRef.current.scrollHeight > lineHeight * 2,
        );
      }, 0);
    };

    const applyQueuedDraft = () => {
      const wqDraft = consumeWorkspaceQaDraft(selectedProject.name);
      if (wqDraft) {
        applyDraft(wqDraft);
        return;
      }
      const refDraft = consumeReferenceChatDraft(selectedProject.name);
      if (refDraft) {
        applyDraft(refDraft.text);

        if (refDraft.pdfCached && refDraft.referenceId) {
          (async () => {
            try {
              const res = await authenticatedFetch(
                `/api/references/${refDraft.referenceId}/pdf`,
              );
              if (res.ok) {
                const blob = await res.blob();
                const file = new File([blob], `${refDraft.referenceId}.pdf`, {
                  type: "application/pdf",
                });
                setAttachedFiles((prev: File[]) => [...prev, file].slice(0, 5));
              }
            } catch {
              // PDF fetch failed 閳?user still has text context
            }
          })();
        }
      }
    };

    applyQueuedDraft();

    const handleQueuedDraft = (event: Event) => {
      const customEvent = event as CustomEvent<{ projectName?: string }>;
      if (customEvent.detail?.projectName !== selectedProject.name) {
        return;
      }
      applyQueuedDraft();
    };

    window.addEventListener(WORKSPACE_QA_DRAFT_EVENT, handleQueuedDraft);
    window.addEventListener(REFERENCE_CHAT_DRAFT_EVENT, handleQueuedDraft);
    return () => {
      window.removeEventListener(WORKSPACE_QA_DRAFT_EVENT, handleQueuedDraft);
      window.removeEventListener(REFERENCE_CHAT_DRAFT_EVENT, handleQueuedDraft);
    };
  }, [selectedProject?.name, setInput]);

  useEffect(() => {
    if (!selectedProject || !draftStorageKey) {
      return;
    }
    if (input !== "") {
      safeLocalStorage.setItem(draftStorageKey, input);
    } else {
      safeLocalStorage.removeItem(draftStorageKey);
    }
  }, [draftStorageKey, input, selectedProject]);

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    // Re-run when input changes so restored drafts get the same autosize behavior as typed text.
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    const lineHeight = parseInt(
      window.getComputedStyle(textareaRef.current).lineHeight,
    );
    const expanded = textareaRef.current.scrollHeight > lineHeight * 2;
    setIsTextareaExpanded(expanded);
  }, [input]);

  useEffect(() => {
    if (!textareaRef.current || input.trim()) {
      return;
    }
    textareaRef.current.style.height = "auto";
    setIsTextareaExpanded(false);
  }, [input]);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value;
      const cursorPos = event.target.selectionStart;

      setInput(newValue);
      inputValueRef.current = newValue;
      setCursorPosition(cursorPos);

      if (!newValue.trim()) {
        setPendingStageTagKeys([]);
        event.target.style.height = "auto";
        setIsTextareaExpanded(false);
        resetCommandMenuState();
        return;
      }

      handleCommandInputChange(newValue, cursorPos);
    },
    [handleCommandInputChange, resetCommandMenuState, setCursorPosition],
  );

  const isCodexQueueShortcutActive = useCallback(() => {
    if (provider !== "codex") {
      return false;
    }

    const { sessionToActivate } = resolveSessionContext();
    const isCurrentViewSession =
      !selectedSession?.id ||
      selectedSession.id === sessionToActivate ||
      currentSessionId === sessionToActivate;

    return hasProcessingSession(
      sessionToActivate,
      "codex",
      selectedProject?.name || currentProjectName,
    ) ||
      (isLoading && isCurrentViewSession);
  }, [
    currentSessionId,
    currentProjectName,
    hasProcessingSession,
    isLoading,
    provider,
    resolveSessionContext,
    selectedProject?.name,
    selectedSession?.id,
  ]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleCommandMenuKeyDown(event)) {
        return;
      }

      if (handleFileMentionsKeyDown(event)) {
        return;
      }

      if (event.key === "Tab" && !showFileDropdown && !showCommandMenu) {
        event.preventDefault();
        cyclePermissionMode();
        return;
      }

      if (event.key === "Enter") {
        if (event.nativeEvent.isComposing) {
          return;
        }

        if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
          event.preventDefault();
          if (provider === "codex") {
            forceSteerForSubmitRef.current = true;
          }
          handleSubmit(event);
        } else if (
          !event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          (!sendByCtrlEnter || isCodexQueueShortcutActive())
        ) {
          event.preventDefault();
          handleSubmit(event);
        }
      }
    },
    [
      cyclePermissionMode,
      handleCommandMenuKeyDown,
      handleFileMentionsKeyDown,
      handleSubmit,
      isCodexQueueShortcutActive,
      provider,
      sendByCtrlEnter,
      showCommandMenu,
      showFileDropdown,
    ],
  );

  const handleTextareaClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      setCursorPosition(event.currentTarget.selectionStart);
    },
    [setCursorPosition],
  );

  const handleTextareaInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      target.style.height = "auto";
      target.style.height = `${target.scrollHeight}px`;
      setCursorPosition(target.selectionStart);
      syncInputOverlayScroll(target);

      const lineHeight = parseInt(window.getComputedStyle(target).lineHeight);
      setIsTextareaExpanded(target.scrollHeight > lineHeight * 2);
    },
    [setCursorPosition, syncInputOverlayScroll],
  );

  const handleClearInput = useCallback(() => {
    setInput("");
    inputValueRef.current = "";
    setPendingStageTagKeys([]);
    setAttachedFiles([]);
    setUploadingFiles(new Map());
    setFileErrors(new Map());
    resetCommandMenuState();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
    }
    setIsTextareaExpanded(false);
  }, [resetCommandMenuState]);

  const handleAbortSession = useCallback(() => {
    if (!canAbortSession) {
      // Force-reset the UI when Stop is clicked but no active abort is possible.
      // This handles stale state after server restarts or lost WebSocket connections.
      if (isLoading) {
        setIsLoading(false);
        setCanAbortSession(false);
        setClaudeStatus(null);
        setPendingPermissionRequests([]);
        const sessionId = currentSessionId || selectedSession?.id;
        if (sessionId) clearSessionTimerStart(sessionId);
      }
      return;
    }

    setCanAbortSession(false);

    const selectedSessionProvider = normalizeProvider(
      selectedSession?.__provider || provider,
    );
    const pendingSessionId = readScopedPendingSessionId(
      currentProjectName,
      selectedSessionProvider,
    );
    const providerSessionId =
      selectedSessionProvider === "cursor" ||
      selectedSessionProvider === "gemini"
        ? readScopedProviderSessionId(currentProjectName, selectedSessionProvider)
        : null;

    const candidateSessionIds = [
      currentSessionId,
      pendingViewSessionRef.current?.sessionId || null,
      pendingSessionId,
      providerSessionId,
      selectedSession?.id || null,
    ];

    const targetSessionId =
      candidateSessionIds.find(
        (sessionId) => Boolean(sessionId) && !isTemporarySessionId(sessionId),
      ) || null;

    if (!targetSessionId) {
      const recoverySessionIds = Array.from(
        new Set(
          candidateSessionIds.filter(
            (sessionId): sessionId is string => Boolean(sessionId),
          ),
        ),
      );

      for (const sessionId of recoverySessionIds) {
        clearSessionTimerStart(sessionId);
        if (provider === "codex") {
          releasePendingQueueDispatch(sessionId);
        }
        sendMessage({
          type: "check-session-status",
          sessionId,
          provider,
        });
      }

      setIsLoading(false);
      setCanAbortSession(false);
      setClaudeStatus(null);
      setPendingPermissionRequests([]);
      return;
    }

    sendMessage({
      type: "abort-session",
      sessionId: targetSessionId,
      provider,
    });

    if (abortTimeoutRef.current) {
      clearTimeout(abortTimeoutRef.current);
    }
    abortTimeoutRef.current = setTimeout(() => {
      abortTimeoutRef.current = null;
      setIsLoading(false);
      setCanAbortSession(false);
      setClaudeStatus(null);
      if (targetSessionId) clearSessionTimerStart(targetSessionId);
    }, 5000);
  }, [
    canAbortSession,
    currentProjectName,
    currentSessionId,
    isLoading,
    pendingViewSessionRef,
    provider,
    selectedSession?.id,
    selectedSession?.__provider,
    sendMessage,
    releasePendingQueueDispatch,
    setCanAbortSession,
    setClaudeStatus,
    setIsLoading,
    setPendingPermissionRequests,
  ]);

  const handleTranscript = useCallback((text: string) => {
    if (!text.trim()) {
      return;
    }

    setInput((previousInput) => {
      const newInput = previousInput.trim() ? `${previousInput} ${text}` : text;
      inputValueRef.current = newInput;

      setTimeout(() => {
        if (!textareaRef.current) {
          return;
        }

        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        const lineHeight = parseInt(
          window.getComputedStyle(textareaRef.current).lineHeight,
        );
        setIsTextareaExpanded(
          textareaRef.current.scrollHeight > lineHeight * 2,
        );
      }, 0);

      return newInput;
    });
  }, []);

  const handleGrantToolPermission = useCallback(
    (suggestion: { entry: string; toolName: string }) => {
      if (!suggestion || (provider !== "claude" && provider !== "gemini")) {
        return { success: false };
      }
      return grantToolPermission(suggestion.entry, provider);
    },
    [provider],
  );

  const handlePermissionDecision = useCallback(
    (
      requestIds: string | string[],
      decision: {
        allow?: boolean;
        message?: string;
        rememberEntry?: string | null;
        updatedInput?: unknown;
      },
    ) => {
      const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
      const validIds = ids.filter(Boolean);
      if (validIds.length === 0) {
        return;
      }

      validIds.forEach((requestId) => {
        sendMessage({
          type: "claude-permission-response",
          requestId,
          allow: Boolean(decision?.allow),
          updatedInput: decision?.updatedInput,
          message: decision?.message,
          rememberEntry: decision?.rememberEntry,
        });
      });

      // Update the local chatMessage toolInput so answered questions render with selections
      if (
        decision?.updatedInput &&
        typeof decision.updatedInput === "object" &&
        "answers" in (decision.updatedInput as Record<string, unknown>)
      ) {
        const updated = decision.updatedInput as Record<string, unknown>;
        setChatMessages((previous) => {
          const msgs = [...previous];
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].toolName === "AskUserQuestion" && msgs[i].isToolUse) {
              msgs[i] = { ...msgs[i], toolInput: updated };
              break;
            }
          }
          return msgs;
        });
      }

      setPendingPermissionRequests((previous) => {
        const next = previous.filter(
          (request) => !validIds.includes(request.requestId),
        );
        if (next.length === 0) {
          setClaudeStatus(null);
        }
        return next;
      });
    },
    [
      sendMessage,
      setChatMessages,
      setClaudeStatus,
      setPendingPermissionRequests,
    ],
  );

  const [isInputFocused, setIsInputFocused] = useState(false);

  const handleInputFocusChange = useCallback(
    (focused: boolean) => {
      setIsInputFocused(focused);
      onInputFocusChange?.(focused);
    },
    [onInputFocusChange],
  );

  return {
    input,
    setInput,
    attachedPrompt,
    setAttachedPrompt,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    steerMode,
    setSteerMode,
    thinkingMode,
    setThinkingMode,
    codexReasoningEffort,
    setCodexReasoningEffort,
    geminiThinkingMode,
    setGeminiThinkingMode,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles: filteredFiles as MentionableFile[],
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedFiles,
    removeAttachedFile,
    uploadingFiles,
    fileErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openFilePicker: open,
    handleSubmit,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handleTranscript,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
    intakeGreeting,
    setIntakeGreeting,
    btwOverlay,
    closeBtwOverlay,
    setPendingStageTagKeys,
    submitProgrammaticInput,
    activeQueueSessionId,
    activeQueuedTurns,
    isActiveQueuePaused,
    removeQueuedCodexTurn,
    promoteQueuedCodexTurnToSteer,
    resumeQueuedCodexTurns,
    handleCodexTurnStarted,
    handleCodexTurnSettled,
    handleCodexSessionIdResolved,
    handleCodexSessionBusy,
    handleCodexSessionStatusUpdate,
  };
}
