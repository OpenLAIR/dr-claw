import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbulb, Loader2, Sparkles, RefreshCw, AlertCircle } from 'lucide-react';

interface BriefingClusterSummary {
  label: string;
  size: number;
  topScore: number;
}

interface BriefingSummary {
  totalScanned: number;
  totalUnique: number;
  clusterCount: number;
  clusters: BriefingClusterSummary[];
  outputPath: string;
}

interface BriefingResponse {
  ok: boolean;
  summary: BriefingSummary | null;
  outputPath: string;
  generatedAt: string;
  skill: string;
  nextStep: string;
}

const BRIEFING_PROMPT = '/news-idea-briefing';

export default function IdeaBriefingCard() {
  const { t } = useTranslation('news');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BriefingResponse | null>(null);

  const runBriefing = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/news/briefings/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minScore: 3.5, topNPerCluster: 6 }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${resp.status}`);
      }
      const payload = (await resp.json()) as BriefingResponse;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const copyPromptToClipboard = useCallback(() => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(BRIEFING_PROMPT);
  }, []);

  const formattedTime = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleString()
    : '';

  return (
    <section className="rounded-lg border border-amber-200/60 bg-background p-5  dark:border-amber-900/40 dark:bg-background sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/60 bg-white/85 px-2.5 py-1 text-xs font-medium uppercase tracking-[0.22em] text-amber-700 dark:border-amber-800/60 dark:bg-slate-950/60 dark:text-amber-200">
            <Sparkles className="h-3 w-3" />
            {t('briefing.skillBadge')}
          </div>
          <h3 className="mt-3 flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            {t('briefing.title')}
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            {t('briefing.description')}
          </p>
        </div>

        <div className="flex flex-shrink-0 flex-col gap-2 sm:items-end">
          <button
            type="button"
            onClick={runBriefing}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-amber-400/60 bg-amber-500 px-4 py-2 text-sm font-medium text-white  transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('briefing.generating')}
              </>
            ) : (
              <>
                {data ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                {data ? t('briefing.regenerateButton') : t('briefing.generateButton')}
              </>
            )}
          </button>
          {data?.generatedAt && (
            <span className="text-xs text-muted-foreground/70">
              {t('briefing.lastRun', { at: formattedTime })}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200/70 bg-rose-50/70 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <div>
            <div className="font-medium">{t('briefing.errorTitle')}</div>
            <div className="mt-0.5 break-all opacity-80">{error}</div>
          </div>
        </div>
      )}

      {data?.summary && (
        <div className="mt-4 rounded-lg border border-white/70 bg-white/65 p-4  dark:border-white/10 dark:bg-slate-950/40">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {t('briefing.summaryStats', {
              clusters: data.summary.clusterCount,
              unique: data.summary.totalUnique,
              scanned: data.summary.totalScanned,
            })}
          </div>

          {data.summary.clusters.length > 0 && (
            <>
              <div className="mt-3 text-xs uppercase tracking-[0.2em] text-muted-foreground/70">
                {t('briefing.topClusters')}
              </div>
              <ul className="mt-2 space-y-1.5">
                {data.summary.clusters.slice(0, 5).map((cluster) => (
                  <li
                    key={cluster.label}
                    className="flex items-center justify-between gap-3 rounded-lg bg-amber-50/60 px-3 py-1.5 text-sm dark:bg-amber-950/20"
                  >
                    <span className="truncate text-foreground/85">{cluster.label}</span>
                    <span className="flex-shrink-0 text-xs text-muted-foreground/80">
                      {cluster.size} · {cluster.topScore.toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copyPromptToClipboard}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-white/80 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-700/50 dark:bg-slate-950/60 dark:text-amber-200 dark:hover:bg-amber-950/30"
              title={t('briefing.openInChatHint')}
            >
              <Sparkles className="h-3 w-3" />
              {t('briefing.openInChat')} · {BRIEFING_PROMPT}
            </button>
            <span className="text-xs text-muted-foreground/70">
              {t('briefing.openInChatHint')}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
