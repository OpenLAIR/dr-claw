import { useCallback, useEffect, useRef, useState } from 'react';

import { useTranslation } from 'react-i18next';

import { api } from '../../../utils/api';
import type { NewsItem } from './NewsItemCard';

export type NewsSourceKey = 'arxiv' | 'huggingface' | 'x' | 'xiaohongshu' | 'github' | 'wechat';

export type SourceInfo = {
  key: NewsSourceKey;
  label: string;
  hasResults: boolean;
  lastSearchDate: string | null;
  requiresCredentials: boolean;
  credentialType: string | null;
  credentialStatus: 'not_required' | 'configured' | 'missing';
};

export type SearchResults = {
  top_papers: NewsItem[];
  total_found: number;
  total_filtered: number;
  search_date?: string;
};

export type ResearchDomain = {
  keywords: string[];
  arxiv_categories: string[];
  priority: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SourceConfig = Record<string, any>;

const ALL_SOURCES: NewsSourceKey[] = ['arxiv', 'huggingface', 'github', 'wechat', 'x', 'xiaohongshu'];

export function useNewsDashboardData() {
  const { t } = useTranslation('news');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [configs, setConfigs] = useState<Record<NewsSourceKey, SourceConfig>>({} as Record<NewsSourceKey, SourceConfig>);
  const [results, setResults] = useState<Record<NewsSourceKey, SearchResults>>({} as Record<NewsSourceKey, SearchResults>);
  const [isSearching, setIsSearching] = useState<Record<NewsSourceKey, boolean>>({} as Record<NewsSourceKey, boolean>);
  const [errors, setErrors] = useState<Record<NewsSourceKey, string | null>>({} as Record<NewsSourceKey, string | null>);
  const [saveErrors, setSaveErrors] = useState<Partial<Record<NewsSourceKey, string | null>>>({});
  const [configDirty, setConfigDirty] = useState<Record<NewsSourceKey, boolean>>({} as Record<NewsSourceKey, boolean>);
  const [searchLogs, setSearchLogs] = useState<Record<NewsSourceKey, string[]>>({} as Record<NewsSourceKey, string[]>);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const read = async (response: Response) => {
      if (!response.ok) throw new Error(t('errors.load'));
      return response.json();
    };
    try {
      const sourcesRes = await read(await api.news.getSources());
      setSources(sourcesRes.sources || []);
      await Promise.all(ALL_SOURCES.map(async key => {
        const [configResult, result] = await Promise.allSettled([
          api.news.getConfig(key).then(read),
          api.news.getResults(key).then(read),
        ]);
        if (configResult.status === 'fulfilled') setConfigs(prev => ({ ...prev, [key]: configResult.value }));
        if (result.status === 'fulfilled') setResults(prev => ({ ...prev, [key]: result.value }));
        const failed = configResult.status === 'rejected' || result.status === 'rejected';
        setErrors(prev => ({ ...prev, [key]: failed ? t('errors.load') : null }));
        if (failed) setLoadError(t('errors.load'));
      }));
    } catch {
      setLoadError(t('errors.load'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  // Poll intermediate results while any source is searching
  const isSearchingRef = useRef(isSearching);
  isSearchingRef.current = isSearching;

  useEffect(() => {
    const searchingKeys = ALL_SOURCES.filter((k) => isSearching[k]);
    if (searchingKeys.length === 0) return;

    const interval = setInterval(async () => {
      const currentSearching = ALL_SOURCES.filter((k) => isSearchingRef.current[k]);
      if (currentSearching.length === 0) return;

      await Promise.allSettled(
        currentSearching.map(async (key) => {
          try {
            // Poll intermediate results
            const resPromise = api.news.getResults(key);
            // Poll search logs
            const logPromise = api.news.getLogs(key);

            const [resResult, logResult] = await Promise.allSettled([resPromise, logPromise]);

            if (resResult.status === 'fulfilled' && resResult.value.ok) {
              const data = await resResult.value.json();
              if (data?.top_papers?.length > 0) {
                setResults((prev) => ({ ...prev, [key]: data }));
              }
            }

            if (logResult.status === 'fulfilled' && logResult.value.ok) {
              const logData = await logResult.value.json();
              if (logData?.logs?.length > 0) {
                setSearchLogs((prev) => ({ ...prev, [key]: logData.logs }));
              }
            }
          } catch {
            // ignore polling errors
          }
        })
      );
    }, 2000);

    return () => clearInterval(interval);
  }, [isSearching]);

  const searchSource = useCallback(async (key: NewsSourceKey) => {
    setIsSearching((prev) => ({ ...prev, [key]: true }));
    setErrors((prev) => ({ ...prev, [key]: null }));
    setSearchLogs((prev) => ({ ...prev, [key]: [] }));
    try {
      // Save config if dirty
      if (configDirty[key] && configs[key]) {
        const saved = await api.news.updateConfig(key, configs[key]);
        if (!saved.ok) throw new Error(t('errors.save'));
        setConfigDirty((prev) => ({ ...prev, [key]: false }));
      }
      const res = await api.news.search(key);
      if (!res.ok) {
        const errData = await res.json();
        // Show logs from failed search if available
        if (errData.logs) {
          setSearchLogs((prev) => ({ ...prev, [key]: errData.logs }));
        }
        throw new Error(errData.error || t('errors.search'));
      }
      const data = await res.json();
      // Capture logs returned with results
      if (data.logs) {
        setSearchLogs((prev) => ({ ...prev, [key]: data.logs }));
      }
      setResults((prev) => ({ ...prev, [key]: data }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('errors.search');
      setErrors((prev) => ({ ...prev, [key]: message }));
    } finally {
      setIsSearching((prev) => ({ ...prev, [key]: false }));
    }
  }, [configs, configDirty, t]);

  const searchAll = useCallback(async (activeKeys: NewsSourceKey[]) => {
    await Promise.allSettled(activeKeys.map((key) => searchSource(key)));
  }, [searchSource]);

  const updateConfig = useCallback((key: NewsSourceKey, config: SourceConfig) => {
    setConfigs((prev) => ({ ...prev, [key]: config }));
    setConfigDirty((prev) => ({ ...prev, [key]: true }));
  }, []);

  const saveConfig = useCallback(async (key: NewsSourceKey) => {
    if (!configs[key]) return;
    setSaveErrors(prev => ({ ...prev, [key]: null }));
    try {
      const saved = await api.news.updateConfig(key, configs[key]);
        if (!saved.ok) throw new Error(t('errors.save'));
      setConfigDirty((prev) => ({ ...prev, [key]: false }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('errors.save');
      setSaveErrors((prev) => ({ ...prev, [key]: message }));
    }
  }, [configs, t]);

  const clearError = useCallback((key: NewsSourceKey) => {
    setErrors((prev) => ({ ...prev, [key]: null }));
  }, []);

  const clearResults = useCallback((key: NewsSourceKey) => {
    setResults((prev) => ({ ...prev, [key]: { top_papers: [], total_found: 0, total_filtered: 0 } }));
    setSearchLogs((prev) => ({ ...prev, [key]: [] }));
    setErrors((prev) => ({ ...prev, [key]: null }));
  }, []);

  return {
    sources,
    configs,
    results,
    isSearching,
    errors,
    configDirty,
    saveErrors,
    searchLogs,
    isLoading,
    loadError,
    reload: load,
    searchSource,
    searchAll,
    updateConfig,
    saveConfig,
    clearError,
    clearResults,
  };
}
