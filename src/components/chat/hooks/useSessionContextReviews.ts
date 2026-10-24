import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../utils/api';
import type { SessionContextOutputItem, SessionReviewState } from '../utils/sessionContextSummary';

/** Serialize acknowledgements so opening two outputs cannot overwrite the first review. */
export function useSessionContextReviews(projectName: string, sessionId: string | null) {
  const [reviews, setReviews] = useState<SessionReviewState>({});
  const [error, setError] = useState<'load' | 'save' | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const state = useRef({ generation: 0, loaded: false, reviews: {} as SessionReviewState, queue: Promise.resolve(), failedFile: null as SessionContextOutputItem | null });

  useEffect(() => {
    const generation = ++state.current.generation;
    state.current.loaded = false;
    state.current.reviews = {};
    state.current.failedFile = null;
    setReviews({});
    setError(null);
    setBusy(Boolean(projectName && sessionId));
    state.current.queue = (async () => {
      if (!projectName || !sessionId) return;
      try {
        const response = await api.sessionContextReview(projectName, sessionId);
        if (!response.ok) throw new Error('Review load failed');
        const data = await response.json();
        if (state.current.generation !== generation) return;
        state.current.reviews = data?.reviews && typeof data.reviews === 'object' ? data.reviews : {};
        state.current.loaded = true;
        setReviews(state.current.reviews);
      } catch {
        if (state.current.generation === generation) setError('load');
      } finally {
        if (state.current.generation === generation) setBusy(false);
      }
    })();
    return () => { state.current.generation++; };
  }, [projectName, sessionId, revision]);

  const markReviewed = useCallback((file: SessionContextOutputItem) => {
    const generation = state.current.generation;
    const operation = state.current.queue.then(async () => {
      if (generation !== state.current.generation || !projectName || !sessionId) return;
      if (!state.current.loaded) {
        setError('load');
        return;
      }
      const nextReviews = {
        ...state.current.reviews,
        [file.relativePath]: {
          reviewedAt: new Date().toISOString(),
          lastSeenAt: file.lastSeenAt,
          lastReviewedSeenAt: file.lastSeenAt,
        },
      };
      setBusy(true);
      try {
        const response = await api.updateSessionContextReview(projectName, sessionId, nextReviews);
        if (!response.ok) throw new Error('Review save failed');
        if (generation !== state.current.generation) return;
        state.current.reviews = nextReviews;
        setReviews(nextReviews);
        // A different file's success must not hide an outstanding failed save.
        if (!state.current.failedFile || state.current.failedFile.key === file.key) {
          state.current.failedFile = null;
          setError(null);
        }
      } catch {
        if (generation === state.current.generation) {
          state.current.failedFile = file;
          setError('save');
        }
      } finally {
        if (generation === state.current.generation) setBusy(false);
      }
    });
    state.current.queue = operation;
    return operation;
  }, [projectName, sessionId]);

  const retry = useCallback(() => {
    if (state.current.failedFile) void markReviewed(state.current.failedFile);
    else setRevision(value => value + 1);
  }, [markReviewed]);

  return { reviews, error, busy, retry, markReviewed };
}
