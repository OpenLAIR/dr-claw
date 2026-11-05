import {
  Info,
  Loader2,
  RefreshCw,
  Settings2,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import NewsItemCard from './NewsItemCard';
import SourceIcon from './SourceIcon';
import type { NewsSourceKey, SearchResults } from './useNewsDashboardData';

const SOURCE_LABEL_KEYS: Record<NewsSourceKey, string> = {
  arxiv: 'sources.arxiv',
  huggingface: 'sources.huggingfaceFeed',
  github: 'sources.githubFeed',
  wechat: 'sources.wechatFeed',
  x: 'sources.x',
  xiaohongshu: 'sources.xiaohongshu',
};

const SOURCE_BORDER_COLORS: Record<NewsSourceKey, string> = {
  arxiv: 'border-border',
  huggingface: 'border-border',
  github: 'border-border',
  wechat: 'border-border',
  x: 'border-border',
  xiaohongshu: 'border-border',
};

const SOURCE_HEADER_COLORS: Record<NewsSourceKey, string> = {
  arxiv: 'text-foreground',
  huggingface: 'text-foreground',
  github: 'text-foreground',
  wechat: 'text-foreground',
  x: 'text-foreground',
  xiaohongshu: 'text-foreground',
};

const SOURCE_BADGE_COLORS: Record<NewsSourceKey, string> = {
  arxiv: 'text-muted-foreground',
  huggingface: 'text-muted-foreground',
  github: 'text-muted-foreground',
  wechat: 'text-muted-foreground',
  x: 'text-muted-foreground',
  xiaohongshu: 'text-muted-foreground',
};

function SetupGuide({ sourceKey, onOpenSettings }: { sourceKey: NewsSourceKey; onOpenSettings: (key: NewsSourceKey) => void }) {
  const { t } = useTranslation('news');
  const steps = t(`setup.${sourceKey}.steps`, { returnObjects: true }) as string[];
  const note = t(`setup.${sourceKey}.note`, { defaultValue: '' });

  return (
    <div className="rounded-lg border border-sky-200/60 bg-sky-50/50 p-4 dark:border-sky-800/30 dark:bg-sky-950/20">
      <div className="flex items-start gap-2.5">
        <Info className="h-4 w-4 flex-shrink-0 mt-0.5 text-sky-500" />
        <div className="space-y-2.5 min-w-0">
          <p className="text-xs font-semibold text-sky-800 dark:text-sky-200">{t('setup.title')}</p>
          <ol className="list-decimal list-inside space-y-1.5">
            {Array.isArray(steps) && steps.map((step, i) => (
              <li key={i} className="text-xs text-sky-700/80 dark:text-sky-300/80">{step}</li>
            ))}
          </ol>
          {note && (
            <p className="text-xs text-sky-600/60 dark:text-sky-400/50 border-t border-sky-200/40 dark:border-sky-800/20 pt-2 font-mono">
              {note}
            </p>
          )}
          <button
            onClick={() => onOpenSettings(sourceKey)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-100 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-200/80 transition-colors dark:bg-sky-900/40 dark:text-sky-300 dark:hover:bg-sky-900/60"
          >
            <Settings2 className="h-3.5 w-3.5" /> {t('actions.openSettings')}
          </button>
        </div>
      </div>
    </div>
  );
}

function LogPanel({ logs }: { logs: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  if (logs.length === 0) return null;

  return (
    <div className="mx-5 mb-3">
      <div
        ref={scrollRef}
        className="max-h-32 overflow-y-auto rounded-lg border border-border/40 bg-slate-950/90 p-3 font-mono text-xs leading-5 text-emerald-400 dark:border-border/30"
      >
        {logs.map((line, i) => (
          <div key={i} className="flex gap-2">
            <Terminal className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-600" />
            <span>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function UnifiedFeed({
  activeSource,
  results,
  errors,
  isSearching,
  searchLogs,
  onSearchSource,
  onOpenSettings,
  onClearSource,
}: {
  activeSource: NewsSourceKey;
  results: Record<NewsSourceKey, SearchResults>;
  errors: Record<NewsSourceKey, string | null>;
  isSearching: Record<NewsSourceKey, boolean>;
  searchLogs: Record<NewsSourceKey, string[]>;
  onSearchSource: (key: NewsSourceKey) => void;
  onOpenSettings: (key: NewsSourceKey) => void;
  onClearSource: (key: NewsSourceKey) => void;
}) {
  const { t } = useTranslation('news');

  const key = activeSource;
  const label = t(SOURCE_LABEL_KEYS[key]);
  const papers = (results[key]?.top_papers ?? []).filter(
    (p) => p.title && p.title !== '(Untitled)'
  );
  const error = errors[key];
  const searching = isSearching[key];
  const totalFound = results[key]?.total_found ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <section
        className={`border-t ${SOURCE_BORDER_COLORS[key]} overflow-hidden`}
      >
        {/* Source header */}
        <div className="flex w-full items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${SOURCE_BADGE_COLORS[key]}`}>
              <SourceIcon sourceKey={key} className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className={`text-sm font-semibold ${SOURCE_HEADER_COLORS[key]}`}>{label}</h3>
              <p className="text-xs text-muted-foreground">
                {papers.length > 0
                  ? (totalFound > 0
                      ? t('status.resultsWithTotal', { count: papers.length, total: totalFound })
                      : t('status.resultsCount', { count: papers.length }))
                  : t('status.noResults')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {searching && (
              <div className="flex items-center gap-1.5 rounded-lg bg-primary/5 px-2.5 py-1 text-xs text-primary dark:bg-primary/10">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('actions.searching')}
              </div>
            )}
            <button
              onClick={() => onOpenSettings(key)}
              aria-label={t('actions.settings')}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('actions.settings')}</span>
            </button>
            <button
              onClick={() => onSearchSource(key)}
              aria-label={t('actions.refresh')}
              disabled={searching}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('actions.refresh')}</span>
            </button>
            {papers.length > 0 && (
              <button
                onClick={() => onClearSource(key)}
                aria-label={t('actions.clear')}
                disabled={searching}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('actions.clear')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Search progress logs */}
        {(searching || (searchLogs[key]?.length > 0)) && <LogPanel logs={searchLogs[key] || []} />}

        {/* Error */}
        {error && (
          <div role="alert" className="mx-5 mb-4 flex items-center gap-3 rounded-lg border border-red-200/80 bg-red-50/80 p-3 text-xs text-red-700 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300">
            <span>{error}</span>
          </div>
        )}

        {/* Results grid */}
        {papers.length > 0 ? (
          <div className="max-h-[1200px] overflow-y-auto grid gap-4 p-5 pt-0 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {papers.map((item, index) => (
              <NewsItemCard
                key={`${key}-${item.id ?? item.link ?? index}`}
                item={item}
                index={index}
                sourceKey={key}
              />
            ))}
          </div>
        ) : !searching && !error ? (
          <div className="flex flex-col gap-4 px-5 pb-5">
            <SetupGuide sourceKey={key} onOpenSettings={onOpenSettings} />
            <div className="flex flex-col items-center justify-center gap-3 py-4 text-center">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t('status.noResults')}</p>
                <p className="mt-1 text-xs text-muted-foreground/60">{t('status.noResultsHint')}</p>
              </div>
              <button
                onClick={() => onSearchSource(key)}
              aria-label={t('actions.refresh')}
                className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/80 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/40 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" /> {t('actions.startSearch')}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
