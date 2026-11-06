import { isTemporarySessionId } from '../../../constants/session';

type ShouldPreserveOptimisticMessagesArgs = {
  currentSessionId: string | null;
  nextSelectedSessionId: string | null;
  pendingViewSessionId: string | null;
  deferredLoadSessionId: string | null;
  chatMessageCount: number;
  isSystemSessionChange: boolean;
};

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

export type DisplayedSession = {
  sessionId: string;
  ws: unknown;
};

/**
 * What the session-load effect should do for the selected session:
 * - 'adopt': the session was just created by our own send (session-created).
 *   The messages on screen already belong to it; fetching now would replace
 *   them with a transcript the CLI may not have written yet.
 * - 'keep': the view already shows this session over the same socket. The
 *   effect re-ran only because a dependency changed identity (a projects
 *   refresh, the system-change flag resetting), so a reload would only risk
 *   overwriting newer streamed messages.
 * - 'load': a different session, or a new socket that may have missed events.
 */
export function decideSessionMessageLoad({
  selectedSessionId,
  isSystemSessionChange,
  displayed,
  ws,
}: {
  selectedSessionId: string;
  isSystemSessionChange: boolean;
  displayed: DisplayedSession | null;
  ws: unknown;
}): 'adopt' | 'keep' | 'load' {
  if (isSystemSessionChange) {
    return 'adopt';
  }
  if (displayed && displayed.sessionId === selectedSessionId && displayed.ws === ws) {
    return 'keep';
  }
  return 'load';
}

/** True when the external-update counter moved since it was last handled. */
export function isNewExternalMessageUpdate(update: number | undefined, lastHandled: number): boolean {
  return Boolean(update) && update !== lastHandled;
}
