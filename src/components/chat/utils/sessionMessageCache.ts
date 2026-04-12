import type { Provider } from '../types/types';
import { buildChatMessagesStorageKey } from './chatStorage';
import { DEFAULT_PROVIDER, normalizeProvider } from '../../../utils/providerPolicy';

const LEGACY_CHAT_MESSAGES_PREFIX = 'chat_messages_';

export function buildSessionMessageCacheCandidateKeys(
  projectName: string | null | undefined,
  sessionId: string | null | undefined,
  provider: Provider | string | null | undefined,
): string[] {
  if (!projectName || !sessionId) {
    return [];
  }

  const normalizedProvider = normalizeProvider((provider || DEFAULT_PROVIDER) as Provider);
  return Array.from(
    new Set([
      buildChatMessagesStorageKey(projectName, sessionId, normalizedProvider),
      buildChatMessagesStorageKey(projectName, sessionId, DEFAULT_PROVIDER),
      `${LEGACY_CHAT_MESSAGES_PREFIX}${projectName}_${sessionId}`,
    ].filter(Boolean)),
  );
}
