import {
  Loader2,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../ui/button';
import SourceIcon from './SourceIcon';
import type { NewsSourceKey, SourceInfo } from './useNewsDashboardData';

const SOURCE_LABEL_KEYS: Record<NewsSourceKey, string> = {
  arxiv: 'sources.arxiv',
  huggingface: 'sources.huggingface',
  github: 'sources.github',
  wechat: 'sources.wechat',
  x: 'sources.x',
  xiaohongshu: 'sources.xiaohongshu',
};

const SOURCE_INACTIVE_COLORS: Record<NewsSourceKey, string> = {
  arxiv: 'bg-transparent text-rose-800/60 hover:bg-rose-100/50 dark:text-rose-400/60 dark:hover:bg-rose-950/30',
  huggingface: 'bg-transparent text-yellow-800/60 hover:bg-yellow-100/50 dark:text-yellow-400/60 dark:hover:bg-yellow-950/30',
  github: 'bg-transparent text-violet-800/60 hover:bg-violet-100/50 dark:text-violet-300/60 dark:hover:bg-violet-950/30',
  wechat: 'bg-transparent text-emerald-800/60 hover:bg-emerald-100/50 dark:text-emerald-300/60 dark:hover:bg-emerald-950/30',
  x: 'bg-transparent text-gray-600/60 hover:bg-gray-200/50 dark:text-gray-400/60 dark:hover:bg-gray-800/30',
  xiaohongshu: 'bg-transparent text-red-600/60 hover:bg-red-100/50 dark:text-red-400/60 dark:hover:bg-red-950/30',
};

const SOURCE_ACTIVE_COLORS: Record<NewsSourceKey, string> = {
  arxiv: 'bg-rose-600 text-white shadow-md ring-2 ring-rose-600/30 hover:bg-rose-700 dark:bg-rose-700 dark:ring-rose-500/30 dark:hover:bg-rose-600',
  huggingface: 'bg-yellow-500 text-white shadow-md ring-2 ring-yellow-500/30 hover:bg-yellow-600 dark:bg-yellow-600 dark:ring-yellow-400/30 dark:hover:bg-yellow-500',
  github: 'bg-violet-600 text-white shadow-md ring-2 ring-violet-600/30 hover:bg-violet-700 dark:bg-violet-700 dark:ring-violet-500/30 dark:hover:bg-violet-600',
  wechat: 'bg-emerald-600 text-white shadow-md ring-2 ring-emerald-600/30 hover:bg-emerald-700 dark:bg-emerald-700 dark:ring-emerald-500/30 dark:hover:bg-emerald-600',
  x: 'bg-gray-800 text-white shadow-md ring-2 ring-gray-800/30 hover:bg-gray-900 dark:bg-gray-600 dark:ring-gray-500/30 dark:hover:bg-gray-500',
  xiaohongshu: 'bg-red-500 text-white shadow-md ring-2 ring-red-500/30 hover:bg-red-600 dark:bg-red-600 dark:ring-red-400/30 dark:hover:bg-red-500',
};

const ALL_SOURCES: NewsSourceKey[] = ['arxiv', 'huggingface', 'github', 'wechat', 'x', 'xiaohongshu'];

export default function SourceFilterBar({
  activeSource,
  onSelectSource,
  sources,
  isSearching,
  onSearch,
  isSearchingActive,
}: {
  activeSource: NewsSourceKey;
  onSelectSource: (key: NewsSourceKey) => void;
  sources: SourceInfo[];
  isSearching: Record<NewsSourceKey, boolean>;
  onSearch: () => void;
  isSearchingActive: boolean;
}) {
  const { t } = useTranslation('news');

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-card/80 p-2 shadow-sm backdrop-blur">
      {ALL_SOURCES.map((key) => {
        const label = t(SOURCE_LABEL_KEYS[key]);
        const isActive = activeSource === key;
        const info = sources.find((s) => s.key === key);
        const needsCred = info?.requiresCredentials && info.credentialStatus === 'missing';
        const searching = isSearching[key];

        return (
          <button
            key={key}
            onClick={() => onSelectSource(key)}
            className={`relative flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
              isActive
                ? `${SOURCE_ACTIVE_COLORS[key]} scale-105`
                : SOURCE_INACTIVE_COLORS[key]
            }`}
          >
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SourceIcon sourceKey={key} className="h-4 w-4" inverted={isActive} />
            )}
            <span className="hidden sm:inline">{label}</span>
            {needsCred && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500" title={t('settings.credentialRequired')} />
            )}
          </button>
        );
      })}

      <div className="ml-auto">
        <Button
          onClick={onSearch}
          disabled={isSearchingActive}
          className="h-8 gap-1.5 rounded-xl text-xs"
          size="sm"
        >
          {isSearchingActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          {t('actions.searchAll')}
        </Button>
      </div>
    </div>
  );
}
