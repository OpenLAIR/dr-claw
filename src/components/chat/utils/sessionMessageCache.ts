import type { Provider } from '../types/types';
import { DEFAULT_PROVIDER, normalizeProvider } from '../../../utils/providerPolicy';

const CHAT_MESSAGES_PREFIX = 'chat_messages_';

function buildChatMessagesStorageKey(
  projectName: string,
  sessionId: string,
  provider: string,
): string {
  return `${CHAT_MESSAGES_PREFIX}${projectName}_${provider}_${sessionId}`;
}

type SessionMessageCacheLookupOptions = {
  allowLegacyFallback?: boolean;
};

export function buildSessionMessageCacheCandidateKeys(
  projectName: string | null | undefined,
  sessionId: string | null | undefined,
  provider: Provider | string | null | undefined,
  options: SessionMessageCacheLookupOptions = {},
): string[] {
  if (!projectName || !sessionId) {
    return [];
  }

  const normalizedProvider = normalizeProvider((provider || DEFAULT_PROVIDER) as Provider);
  const providerScopedKey = buildChatMessagesStorageKey(projectName, sessionId, normalizedProvider);
  if (!options.allowLegacyFallback) {
    return providerScopedKey ? [providerScopedKey] : [];
  }

  return Array.from(
    new Set([
      providerScopedKey,
      buildChatMessagesStorageKey(projectName, sessionId, DEFAULT_PROVIDER),
      `${CHAT_MESSAGES_PREFIX}${projectName}_${sessionId}`,
    ].filter(Boolean)),
  );
}
