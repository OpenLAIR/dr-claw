type ShouldPreserveOptimisticMessagesArgs = {
  currentSessionId: string | null;
  nextSelectedSessionId: string | null;
  pendingViewSessionId: string | null;
  deferredLoadSessionId: string | null;
  chatMessageCount: number;
  isSystemSessionChange: boolean;
};

const isTemporarySessionId = (sessionId: string | null) =>
  typeof sessionId === 'string' && sessionId.startsWith('new-session-');

export function shouldPreserveOptimisticMessagesOnSessionSelect({
  currentSessionId,
  nextSelectedSessionId,
  pendingViewSessionId,
  deferredLoadSessionId,
  chatMessageCount,
  isSystemSessionChange,
}: ShouldPreserveOptimisticMessagesArgs): boolean {
  if (isSystemSessionChange) {
    return true;
  }

  if (!nextSelectedSessionId || chatMessageCount === 0) {
    return false;
  }

  if (deferredLoadSessionId === nextSelectedSessionId) {
    return true;
  }

  if (isTemporarySessionId(currentSessionId) && currentSessionId !== nextSelectedSessionId) {
    return true;
  }

  return pendingViewSessionId === nextSelectedSessionId;
}
