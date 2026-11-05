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
    <div className="flex flex-wrap items-center gap-2 border-y border-border py-3">
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
            aria-label={label}
            aria-pressed={isActive}
            className={`relative flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SourceIcon sourceKey={key} className="h-4 w-4" inverted={false} />
            )}
            <span >{label}</span>
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
          className="h-8 gap-1.5 rounded-md text-xs"
          size="sm"
        >
          {isSearchingActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          {t('actions.searchAll')}
        </Button>
      </div>
    </div>
  );
}
