import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import type { SessionProvider } from '../../../types/app';

export interface HarnessModelOption {
  value: string;
  label: string;
  description?: string;
  /** Present in the built-in list but not reported by the harness itself. */
  deprecated?: boolean;
  isDefault?: boolean;
  /** Reasoning efforts the harness says this model accepts (Codex). */
  reasoningEfforts?: string[];
  defaultReasoningEffort?: string;
}

export interface HarnessModels {
  options: HarnessModelOption[] | null;
  /** 'discovered' when the harness answered; 'static' when we fell back. */
  source: 'discovered' | 'static' | null;
  defaultModel: string | null;
  isLoading: boolean;
  refresh: () => void;
}

interface LoadedModels {
  /** The provider this answer was fetched for. */
  provider: string;
  options: HarnessModelOption[] | null;
  source: 'discovered' | 'static' | null;
  defaultModel: string | null;
}

const EMPTY: HarnessModels = {
  options: null,
  source: null,
  defaultModel: null,
  isLoading: false,
  refresh: () => {},
};

/**
 * Ask the server for the model list the selected harness actually supports.
 *
 * Returns `options: null` until (and unless) discovery produces something, so
 * callers keep rendering their built-in list rather than flashing an empty
 * picker. The server never fails this call — it falls back to the built-in list
 * — so the only states here are "not answered yet" and "answered".
 *
 * Every answer is tagged with the provider it was fetched for, and only an
 * answer for the *current* provider is ever exposed. State updates are
 * asynchronous, so for at least one render after a provider switch the stored
 * answer still describes the previous provider; handing that out would let a
 * consumer act on Codex's list while `provider` already says Claude (which is
 * exactly how a Codex model once ended up saved as the Claude model).
 */
export function useHarnessModels(provider: SessionProvider | string | null | undefined): HarnessModels {
  const [loaded, setLoaded] = useState<LoadedModels | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  // One-shot: only the request triggered by refresh() bypasses the server
  // cache. Deriving it from `refreshToken > 0` would make every later provider
  // switch bypass the cache too, for the life of the mount.
  const forceNextRef = useRef(false);
  const refresh = useCallback(() => {
    forceNextRef.current = true;
    setRefreshToken((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!provider) {
      setLoaded(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const force = forceNextRef.current;
    forceNextRef.current = false;
    const query = force ? '?refresh=1' : '';
    authenticatedFetch(`/api/models/${encodeURIComponent(provider)}${query}`)
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (!data || !Array.isArray(data.options)) {
          setLoaded({ provider, options: null, source: null, defaultModel: null });
          return;
        }
        setLoaded({
          provider,
          source: data.source ?? null,
          // A static answer carries no information the caller does not already
          // have compiled in, so leave it on its own list.
          options: data.source === 'discovered' ? data.options : null,
          defaultModel: typeof data.default === 'string' ? data.default : null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded({ provider, options: null, source: null, defaultModel: null });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [provider, refreshToken]);

  if (!provider) return EMPTY;

  const current = loaded && loaded.provider === provider ? loaded : null;
  return {
    options: current?.options ?? null,
    source: current?.source ?? null,
    defaultModel: current?.defaultModel ?? null,
    isLoading,
    refresh,
  };
}

export default useHarnessModels;
