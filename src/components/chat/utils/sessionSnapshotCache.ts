import type { ChatMessage, Provider } from '../types/types';
import { DEFAULT_PROVIDER, normalizeProvider } from '../../../utils/providerPolicy';

export type SessionSnapshot = {
  provider: Provider;
  sessionMessages: unknown[];
  chatMessages: ChatMessage[];
  updatedAt: number;
};

function cloneArrayShallow<T>(items: T[] | null | undefined): T[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return { ...(item as Record<string, unknown>) } as T;
    }
    return item;
  });
}

export function normalizeSessionSnapshotProvider(provider: Provider | string | null | undefined): Provider {
  return normalizeProvider((provider || DEFAULT_PROVIDER) as Provider);
}

export function buildSessionSnapshotKey(
  projectName: string | null | undefined,
  sessionId: string | null | undefined,
  provider: Provider | string | null | undefined,
): string {
  if (!projectName || !sessionId) {
    return '';
  }

  const normalizedProvider = normalizeSessionSnapshotProvider(provider);
  return `${projectName}::${sessionId}::${normalizedProvider}`;
}

export function createSessionSnapshot(
  provider: Provider | string | null | undefined,
  sessionMessages: unknown[] | null | undefined,
  chatMessages: ChatMessage[] | null | undefined,
): SessionSnapshot {
  return {
    provider: normalizeSessionSnapshotProvider(provider),
    sessionMessages: cloneArrayShallow(sessionMessages),
    chatMessages: cloneArrayShallow(chatMessages),
    updatedAt: Date.now(),
  };
}

export function cloneSessionSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  return {
    ...snapshot,
    sessionMessages: cloneArrayShallow(snapshot.sessionMessages),
    chatMessages: cloneArrayShallow(snapshot.chatMessages),
  };
}
