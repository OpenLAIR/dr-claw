import type { SessionProvider } from "../../../types/app";

const SESSION_FILTER_DEBUG_LOCAL_STORAGE_KEY = "session_filter_debug";
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export interface SessionFilterDebugPayload {
  reason: string;
  messageType?: string | null;
  routedSessionId?: string | null;
  actualSessionId?: string | null;
  sessionProvider?: SessionProvider | string | null;
  messageProjectName?: string | null;
  activeViewSessionId?: string | null;
  activeViewProvider?: SessionProvider | string | null;
  activeViewProjectName?: string | null;
  isGlobalMessage?: boolean;
  isPendingViewSession?: boolean;
  shouldRebindTemporarySession?: boolean;
  canUseActiveTemporarySessionForCodex?: boolean;
  isUnscopedError?: boolean;
  shouldBypassSessionFilter?: boolean;
  extra?: Record<string, unknown>;
}

type SendMessageFn = ((message: Record<string, unknown>) => void) | undefined;

export function isSessionFilterDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const rawValue = window.localStorage
    .getItem(SESSION_FILTER_DEBUG_LOCAL_STORAGE_KEY)
    ?.trim()
    .toLowerCase();
  if (!rawValue) {
    return false;
  }
  return TRUE_VALUES.has(rawValue);
}

export function syncSessionFilterDebugSetting(sendMessage?: SendMessageFn): void {
  if (!sendMessage) {
    return;
  }

  const enabled = isSessionFilterDebugEnabled();
  if (!enabled) {
    return;
  }

  sendMessage({
    type: "session-filter-debug-settings",
    enabled,
    source: "frontend",
  });
}

export function emitSessionFilterDebugLog(
  payload: SessionFilterDebugPayload,
  sendMessage?: SendMessageFn,
): void {
  if (!isSessionFilterDebugEnabled()) {
    return;
  }

  const normalizedPayload = {
    ...payload,
    loggedAt: Date.now(),
  };

  if (typeof window !== "undefined") {
    console.debug("[session-filter-debug]", normalizedPayload);
  }

  if (!sendMessage) {
    return;
  }

  sendMessage({
    type: "session-filter-debug",
    source: "frontend",
    reason: payload.reason,
    payload: normalizedPayload,
  });
}
