import { useCallback, useState } from 'react';
import type { SessionProvider } from '../types/app';
import {
  buildSessionScopeKey,
  isTemporarySessionId,
  parseSessionScopeKey,
  scopeKeyMatchesSessionId,
} from '../utils/sessionScope';

export function useSessionProtection() {
  const [activeSessions, setActiveSessions] = useState<Set<string>>(new Set());
  const [processingSessions, setProcessingSessions] = useState<Set<string>>(new Set());

  const resolveTrackingKey = useCallback((
    sessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
  ) => {
    if (!sessionId) {
      return '';
    }

    const scopeKey = buildSessionScopeKey(projectName, provider, sessionId);
    return scopeKey || sessionId;
  }, []);

  const markSessionAsActive = useCallback((
    sessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
  ) => {
    const trackingKey = resolveTrackingKey(sessionId, provider, projectName);
    if (!trackingKey) {
      return;
    }

    setActiveSessions((prev) => new Set([...prev, trackingKey]));
  }, [resolveTrackingKey]);

  const markSessionAsInactive = useCallback((
    sessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
  ) => {
    const trackingKey = resolveTrackingKey(sessionId, provider, projectName);
    if (!trackingKey) {
      return;
    }

    setActiveSessions((prev) => {
      const next = new Set(prev);
      next.delete(trackingKey);
      if (sessionId) {
        next.delete(sessionId);
      }
      return next;
    });
  }, [resolveTrackingKey]);

  const markSessionAsProcessing = useCallback((
    sessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
  ) => {
    const trackingKey = resolveTrackingKey(sessionId, provider, projectName);
    if (!trackingKey) {
      return;
    }

    setProcessingSessions((prev) => new Set([...prev, trackingKey]));
  }, [resolveTrackingKey]);

  const markSessionAsNotProcessing = useCallback((
    sessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
  ) => {
    const trackingKey = resolveTrackingKey(sessionId, provider, projectName);
    if (!trackingKey) {
      return;
    }

    setProcessingSessions((prev) => {
      const next = new Set(prev);
      next.delete(trackingKey);
      if (sessionId) {
        next.delete(sessionId);
      }
      return next;
    });
  }, [resolveTrackingKey]);

  const replaceTemporarySession = useCallback((
    realSessionId?: string | null,
    provider?: SessionProvider | null,
    projectName?: string | null,
    previousSessionId?: string | null,
  ) => {
    if (!realSessionId) {
      return;
    }

    const realTrackingKey = resolveTrackingKey(realSessionId, provider, projectName);
    if (!realTrackingKey) {
      return;
    }

    const shouldReplaceTemporary = (trackingKey: string) => {
      if (!trackingKey) {
        return false;
      }

      const parsed = parseSessionScopeKey(trackingKey);
      const parsedSessionId = parsed?.sessionId || trackingKey;
      if (!isTemporarySessionId(parsedSessionId)) {
        return false;
      }

      if (previousSessionId) {
        return scopeKeyMatchesSessionId(trackingKey, previousSessionId);
      }

      if (projectName && parsed?.projectName && parsed.projectName !== projectName) {
        return false;
      }

      if (provider && parsed?.provider && parsed.provider !== provider) {
        return false;
      }

      return true;
    };

    setActiveSessions((prev) => {
      const next = new Set<string>();
      for (const sessionId of prev) {
        if (!shouldReplaceTemporary(sessionId)) {
          next.add(sessionId);
        }
      }
      next.add(realTrackingKey);
      return next;
    });

    setProcessingSessions((prev) => {
      const next = new Set<string>();
      let hadTemporarySession = false;
      for (const sessionId of prev) {
        if (shouldReplaceTemporary(sessionId)) {
          hadTemporarySession = true;
          continue;
        }
        next.add(sessionId);
      }
      if (hadTemporarySession) {
        next.add(realTrackingKey);
      }
      return next;
    });
  }, [resolveTrackingKey]);

  return {
    activeSessions,
    processingSessions,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsProcessing,
    markSessionAsNotProcessing,
    replaceTemporarySession,
  };
}
