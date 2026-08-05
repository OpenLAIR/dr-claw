import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import type { SessionProvider } from '../../../types/app';

export interface HarnessModelOption {
  value: string;
  label: string;
  description?: string;
  /** Present in the built-in list but not reported by the harness itself. */
  deprecated?: boolean;
}

export interface HarnessModels {
  options: HarnessModelOption[] | null;
  /** 'discovered' when the harness answered; 'static' when we fell back. */
  source: 'discovered' | 'static' | null;
  defaultModel: string | null;
  isLoading: boolean;
  refresh: () => void;
}

/**
 * Ask the server for the model list the selected harness actually supports.
 *
 * Returns `options: null` until (and unless) discovery produces something, so
 * callers keep rendering their built-in list rather than flashing an empty
 * picker. The server never fails this call — it falls back to the built-in list
 * — so the only states here are "not answered yet" and "answered".
 */
export function useHarnessModels(provider: SessionProvider | string | null | undefined): HarnessModels {
  const [options, setOptions] = useState<HarnessModelOption[] | null>(null);
  const [source, setSource] = useState<'discovered' | 'static' | null>(null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  // Guards against a slow response for a provider the user has already switched
  // away from overwriting the current one.
  const requestedProviderRef = useRef<string | null>(null);

  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  useEffect(() => {
    if (!provider) {
      setOptions(null);
      setSource(null);
      setDefaultModel(null);
      return;
    }

    let cancelled = false;
    requestedProviderRef.current = provider;
    setIsLoading(true);
    // Clear immediately rather than on response: otherwise the picker keeps
    // rendering the previous provider's models for the duration of the request.
    setOptions(null);
    setSource(null);
    setDefaultModel(null);

    const query = refreshToken > 0 ? '?refresh=1' : '';
    authenticatedFetch(`/api/models/${encodeURIComponent(provider)}${query}`)
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || requestedProviderRef.current !== provider) return;
        if (!data || !Array.isArray(data.options)) {
          setOptions(null);
          setSource(null);
          return;
        }
        // A static answer carries no information the caller does not already
        // have compiled in, so leave it on its own list.
        setSource(data.source ?? null);
        setOptions(data.source === 'discovered' ? data.options : null);
        setDefaultModel(typeof data.default === 'string' ? data.default : null);
      })
      .catch(() => {
        if (cancelled) return;
        setOptions(null);
        setSource(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [provider, refreshToken]);

  return { options, source, defaultModel, isLoading, refresh };
}

export default useHarnessModels;
