import type { ProviderSettings } from '../types/types';
import type { SessionProvider } from '../../../types/app';
import { DEFAULT_PROVIDER, normalizeProvider } from '../../../utils/providerPolicy';

export const CLAUDE_SETTINGS_KEY = 'claude-settings';
export const GEMINI_SETTINGS_KEY = 'gemini-settings';
export const CURSOR_SETTINGS_KEY = 'cursor-tools-settings';
export const CODEX_SETTINGS_KEY = 'codex-settings';
export const NANO_SETTINGS_KEY = 'nano-claude-code-settings';
const SESSION_TIMER_PREFIX = 'session_timer_start_';
const CHAT_MESSAGES_PREFIX = 'chat_messages_';
const DRAFT_INPUT_PREFIX = 'draft_input_';
const SCOPED_PENDING_SESSION_PREFIX = 'pending_session_id_';
const SCOPED_PROVIDER_SESSION_PREFIX = 'provider_session_id_';

const safeSessionStorage = {
  setItem: (key: string, value: string) => {
    try {
      sessionStorage.setItem(key, value);
    } catch (error) {
      console.error('sessionStorage setItem error:', error);
    }
  },
  getItem: (key: string): string | null => {
    try {
      return sessionStorage.getItem(key);
    } catch (error) {
      console.error('sessionStorage getItem error:', error);
      return null;
    }
  },
  removeItem: (key: string) => {
    try {
      sessionStorage.removeItem(key);
    } catch (error) {
      console.error('sessionStorage removeItem error:', error);
    }
  },
};

export function getProviderSettingsKey(provider?: string) {
  switch (provider) {
    case 'gemini': return GEMINI_SETTINGS_KEY;
    case 'cursor': return CURSOR_SETTINGS_KEY;
    case 'codex': return CODEX_SETTINGS_KEY;
    case 'nano': return NANO_SETTINGS_KEY;
    default: return CLAUDE_SETTINGS_KEY;
  }
}

function normalizeScopedStorageProvider(
  provider?: SessionProvider | string | null,
): SessionProvider {
  return normalizeProvider((provider || DEFAULT_PROVIDER) as SessionProvider);
}

export function buildChatMessagesStorageKey(
  projectName: string | null | undefined,
  sessionId: string | null | undefined,
  provider?: SessionProvider | string | null,
) {
  if (!projectName || !sessionId) {
    return '';
  }

  const normalizedProvider = normalizeScopedStorageProvider(provider);
  return `${CHAT_MESSAGES_PREFIX}${projectName}_${normalizedProvider}_${sessionId}`;
}

export function buildDraftInputStorageKey(
  projectName: string | null | undefined,
  provider?: SessionProvider | string | null,
  sessionOrBucket: string | null | undefined = 'new',
) {
  if (!projectName) {
    return '';
  }

  const normalizedProvider = normalizeScopedStorageProvider(provider);
  const normalizedBucket = sessionOrBucket || 'new';
  return `${DRAFT_INPUT_PREFIX}${projectName}_${normalizedProvider}_${normalizedBucket}`;
}

function buildScopedSessionStorageKey(
  prefix: string,
  projectName: string | null | undefined,
  provider?: SessionProvider | string | null,
) {
  if (!projectName) {
    return '';
  }

  const normalizedProvider = normalizeScopedStorageProvider(provider);
  return `${prefix}${projectName}_${normalizedProvider}`;
}

export const safeLocalStorage = {
  setItem: (key: string, value: string) => {
    try {
      if (key.startsWith(CHAT_MESSAGES_PREFIX) && typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed) && parsed.length > 50) {
            const truncated = parsed.slice(-50);
            value = JSON.stringify(truncated);
          }
        } catch (parseError) {
          console.warn('Could not parse chat messages for truncation:', parseError);
        }
      }

      localStorage.setItem(key, value);
    } catch (error: any) {
      if (error?.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded, clearing old data');

        const keys = Object.keys(localStorage);
        const chatKeys = keys.filter((k) => k.startsWith('chat_messages_')).sort();

        if (chatKeys.length > 3) {
          chatKeys.slice(0, chatKeys.length - 3).forEach((k) => {
            localStorage.removeItem(k);
          });
        }

        const draftKeys = keys.filter((k) => k.startsWith('draft_input_'));
        draftKeys.forEach((k) => {
          localStorage.removeItem(k);
        });

        try {
          localStorage.setItem(key, value);
        } catch (retryError) {
          console.error('Failed to save to localStorage even after cleanup:', retryError);
          if (key.startsWith(CHAT_MESSAGES_PREFIX) && typeof value === 'string') {
            try {
              const parsed = JSON.parse(value);
              if (Array.isArray(parsed) && parsed.length > 10) {
                const minimal = parsed.slice(-10);
                localStorage.setItem(key, JSON.stringify(minimal));
              }
            } catch (finalError) {
              console.error('Final save attempt failed:', finalError);
            }
          }
        }
      } else {
        console.error('localStorage error:', error);
      }
    }
  },
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.error('localStorage getItem error:', error);
      return null;
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error('localStorage removeItem error:', error);
    }
  },
};

export function persistSessionTimerStart(sessionId: string | null | undefined, startTime: number | null | undefined) {
  if (!sessionId || !Number.isFinite(startTime)) {
    return;
  }

  safeSessionStorage.setItem(`${SESSION_TIMER_PREFIX}${sessionId}`, String(startTime));
}

export function persistScopedPendingSessionId(
  projectName: string | null | undefined,
  provider: SessionProvider | string | null | undefined,
  sessionId: string | null | undefined,
) {
  const storageKey = buildScopedSessionStorageKey(SCOPED_PENDING_SESSION_PREFIX, projectName, provider);
  if (!storageKey || !sessionId) {
    return;
  }

  safeSessionStorage.setItem(storageKey, sessionId);
}

export function readScopedPendingSessionId(
  projectName: string | null | undefined,
  provider: SessionProvider | string | null | undefined,
): string | null {
  const storageKey = buildScopedSessionStorageKey(SCOPED_PENDING_SESSION_PREFIX, projectName, provider);
  if (!storageKey) {
    return null;
  }

  return safeSessionStorage.getItem(storageKey);
}

export function clearScopedPendingSessionId(
  projectName: string | null | undefined,
  provider: SessionProvider | string | null | undefined,
) {
  const storageKey = buildScopedSessionStorageKey(SCOPED_PENDING_SESSION_PREFIX, projectName, provider);
  if (!storageKey) {
    return;
  }

  safeSessionStorage.removeItem(storageKey);
}

export function persistScopedProviderSessionId(
  projectName: string | null | undefined,
  provider: SessionProvider | string | null | undefined,
  sessionId: string | null | undefined,
) {
  const storageKey = buildScopedSessionStorageKey(SCOPED_PROVIDER_SESSION_PREFIX, projectName, provider);
  if (!storageKey || !sessionId) {
    return;
  }

  safeSessionStorage.setItem(storageKey, sessionId);
}

export function readScopedProviderSessionId(
  projectName: string | null | undefined,
  provider: SessionProvider | string | null | undefined,
): string | null {
  const storageKey = buildScopedSessionStorageKey(SCOPED_PROVIDER_SESSION_PREFIX, projectName, provider);
  if (!storageKey) {
    return null;
  }

  return safeSessionStorage.getItem(storageKey);
}

export function clearScopedProviderSessionId(
  projectName: string | null | undefined,
  provider: SessionProvider | string | null | undefined,
) {
  const storageKey = buildScopedSessionStorageKey(SCOPED_PROVIDER_SESSION_PREFIX, projectName, provider);
  if (!storageKey) {
    return;
  }

  safeSessionStorage.removeItem(storageKey);
}

export function readSessionTimerStart(sessionId: string | null | undefined): number | null {
  if (!sessionId) {
    return null;
  }

  const raw = safeSessionStorage.getItem(`${SESSION_TIMER_PREFIX}${sessionId}`);
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function clearSessionTimerStart(sessionId: string | null | undefined) {
  if (!sessionId) {
    return;
  }

  safeSessionStorage.removeItem(`${SESSION_TIMER_PREFIX}${sessionId}`);
}

export function moveSessionTimerStart(fromSessionId: string | null | undefined, toSessionId: string | null | undefined) {
  if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) {
    return;
  }

  const startTime = readSessionTimerStart(fromSessionId);
  if (!Number.isFinite(startTime)) {
    return;
  }

  persistSessionTimerStart(toSessionId, startTime);
  clearSessionTimerStart(fromSessionId);
}

export function getProviderSettings(provider?: string): ProviderSettings {
  const key = getProviderSettingsKey(provider);
  let raw = safeLocalStorage.getItem(key);
  if (!raw) {
    return {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      projectSortOrder: 'date',
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      allowedTools: Array.isArray(parsed.allowedTools) ? parsed.allowedTools : [],
      disallowedTools: Array.isArray(parsed.disallowedTools) ? parsed.disallowedTools : [],
      skipPermissions: Boolean(parsed.skipPermissions),
      projectSortOrder: parsed.projectSortOrder || 'date',
    };
  } catch {
    return {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      projectSortOrder: 'date',
    };
  }
}
