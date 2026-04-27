import { Loader2, Sparkles } from 'lucide-react';
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

const SOURCE_STAT_ACCENTS: Record<NewsSourceKey, string> = {
  arxiv: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
  huggingface: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-300',
  github: 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300',
  wechat: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  x: 'bg-gray-200 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300',
  xiaohongshu: 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-300',
};

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/75 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-950/45">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">{label}</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</div>
        </div>
        {accent && (
          <div className={`flex h-10 w-10 items-center justify-center rounded-2xl text-xs font-bold ${accent}`}>
            {value}
          </div>
        )}
      </div>
    </div>
  );
}

export default function NewsDashboard() {
  const { t } = useTranslation('news');
  const {
    sources,
    configs,
    results,
    isSearching,
    errors,
    configDirty,
    searchLogs,
    isLoading,
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
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 sm:p-6">
        {/* Hero Section */}
        <section className="relative overflow-hidden rounded-[32px] border border-border/60 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.14),transparent_34%),linear-gradient(135deg,rgba(252,250,246,0.97),rgba(255,251,247,0.94))] p-6 shadow-sm dark:bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_34%),linear-gradient(135deg,rgba(27,21,16,0.96),rgba(29,21,24,0.92))] sm:p-7">
          <div className="pointer-events-none absolute -right-12 -top-10 h-36 w-36 rounded-full bg-amber-100/45 blur-3xl dark:bg-amber-500/12" />
          <div className="pointer-events-none absolute bottom-0 right-20 h-24 w-24 rounded-full bg-rose-100/35 blur-2xl dark:bg-rose-500/8" />

          <div className="relative grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.85fr)]">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/70 bg-white/80 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-amber-700 shadow-sm dark:border-amber-800/60 dark:bg-slate-950/60 dark:text-amber-200">
                <Sparkles className="h-3.5 w-3.5" />
                {t('hero.badge')}
              </div>

              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                {t('hero.title')}
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                {t('hero.description')}
              </p>

              <div className="mt-5">
                <SourceFilterBar
                  activeSource={activeSource}
                  onSelectSource={setActiveSource}
                  sources={sources}
                  isSearching={isSearching}
                  onSearch={handleSearch}
                  isSearchingActive={isSearchingActive}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
              {ALL_SOURCES.map((key) => (
                <StatCard
                  key={key}
                  label={t(SOURCE_LABEL_KEYS[key])}
                  value={results[key]?.top_papers?.length ?? 0}
                  accent={SOURCE_STAT_ACCENTS[key]}
                />
              ))}
            </div>
          </div>
        </section>

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
        <footer className="flex items-center justify-center gap-2 pb-6 pt-2 text-[11px] text-muted-foreground/60">
          <span className="inline-flex items-center gap-1.5">
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
        />
      )}
    </div>
  );
}
