import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SourceFilterBar from './SourceFilterBar';
import SourceSettingsDialog from './SourceSettingsDialog';
import UnifiedFeed from './UnifiedFeed';
import { useNewsDashboardData } from './useNewsDashboardData';
import type { NewsSourceKey } from './useNewsDashboardData';

const ALL_SOURCES: NewsSourceKey[] = ['arxiv', 'huggingface', 'github', 'wechat', 'x', 'xiaohongshu'];

const SOURCE_LABEL_KEYS: Record<NewsSourceKey, string> = {
  arxiv: 'sources.arxiv',
  huggingface: 'sources.huggingface',
  github: 'sources.github',
  wechat: 'sources.wechatShort',
  x: 'sources.x',
  xiaohongshu: 'sources.xiaohongshuShort',
};

export default function NewsDashboard() {
  const { t } = useTranslation('news');
  const {
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
    reload,
    searchSource,
    updateConfig,
    saveConfig,
    clearResults,
  } = useNewsDashboardData();

  const [activeSource, setActiveSource] = useState<NewsSourceKey>('arxiv');
  const [settingsSource, setSettingsSource] = useState<NewsSourceKey | null>(null);

  const handleSearch = useCallback(() => {
    searchSource(activeSource);
  }, [searchSource, activeSource]);

  const isSearchingActive = isSearching[activeSource];

  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-primary/60" />
        <span className="text-sm text-muted-foreground">{t('status.loading')}</span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="workbench-page flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{t('hero.title')}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{t('hero.description')}</p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {ALL_SOURCES.map(key => <span key={key}>{t(SOURCE_LABEL_KEYS[key])} <span className="tabular-nums text-foreground">{results[key]?.top_papers?.length ?? '—'}</span></span>)}
          </div>
        </header>
        {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 p-3 text-sm"><span>{loadError}</span><button className="rounded-md border border-border px-3 py-1.5" onClick={() => void reload()}>{t('actions.retry')}</button></div>}
        <SourceFilterBar activeSource={activeSource} onSelectSource={setActiveSource} sources={sources} isSearching={isSearching} onSearch={handleSearch} isSearchingActive={isSearchingActive} />

        <UnifiedFeed
          activeSource={activeSource}
          results={results}
          errors={errors}
          isSearching={isSearching}
          searchLogs={searchLogs}
          onSearchSource={searchSource}
          onOpenSettings={setSettingsSource}
          onClearSource={clearResults}
        />

        {/* Footer */}
        <footer className="flex items-center justify-center gap-2 pb-6 pt-2 text-xs text-muted-foreground">
          <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
            {t('footer.poweredBy')}
            <a href="https://arxiv.org" target="_blank" rel="noopener noreferrer" className="font-medium text-muted-foreground/80 hover:text-foreground transition-colors">arXiv</a>
            <span>&middot;</span>
            <a href="https://huggingface.co" target="_blank" rel="noopener noreferrer" className="font-medium text-muted-foreground/80 hover:text-foreground transition-colors">HuggingFace</a>
            <span>&middot;</span>
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="font-medium text-muted-foreground/80 hover:text-foreground transition-colors">GitHub</a>
            <span>&middot;</span>
            <a href="https://docs.rsshub.app/" target="_blank" rel="noopener noreferrer" className="font-medium text-muted-foreground/80 hover:text-foreground transition-colors">{t('sources.wechat')}</a>
            <span>&middot;</span>
            <a href="https://x.com" target="_blank" rel="noopener noreferrer" className="font-medium text-muted-foreground/80 hover:text-foreground transition-colors">X</a>
            <span>&middot;</span>
            <a href="https://www.xiaohongshu.com" target="_blank" rel="noopener noreferrer" className="font-medium text-muted-foreground/80 hover:text-foreground transition-colors">{t('sources.xiaohongshu')}</a>
          </span>
        </footer>
      </div>

      {/* Settings dialog */}
      {settingsSource && configs[settingsSource] && (
        <SourceSettingsDialog
          sourceKey={settingsSource}
          config={configs[settingsSource]}
          onConfigChange={(cfg) => updateConfig(settingsSource, cfg)}
          onSave={() => saveConfig(settingsSource)}
          onClose={() => setSettingsSource(null)}
          sourceInfo={sources.find((s) => s.key === settingsSource)}
          configDirty={configDirty[settingsSource] ?? false}
          error={saveErrors[settingsSource]}
        />
      )}
    </div>
  );
}
