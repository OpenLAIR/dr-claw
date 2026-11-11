import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../utils/api';
import { Button } from '../../ui/button';

type UsageWindow = {
  id: string;
  label: string;
  usedPercent: number | null;
  remainingPercent: number | null;
  resetsAt: string | null;
  resetSinceObserved: boolean;
};

type ProviderUsage = {
  provider: 'claude' | 'codex' | 'gemini';
  account: string | null;
  plan: string | null;
  status: 'ok' | 'unavailable' | 'error';
  reasonCode: string | null;
  source: 'live' | 'session-log' | null;
  observedAt: string | null;
  windows: UsageWindow[];
};

const PROVIDER_NAMES: Record<ProviderUsage['provider'], string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
};

const OPEN_STATE_KEY = 'dr-claw:dashboard:subscription-usage-open';

function readOpenState() {
  // Open by default; only a viewer who collapsed it keeps it collapsed.
  try { return localStorage.getItem(OPEN_STATE_KEY) !== '0'; } catch { return true; }
}

function writeOpenState(open: boolean) {
  try { localStorage.setItem(OPEN_STATE_KEY, open ? '1' : '0'); } catch { /* storage unavailable */ }
}

function formatRelative(iso: string, locale: string) {
  const diffMs = new Date(iso).getTime() - Date.now();
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(diffMs);
  if (abs >= 86_400_000) return formatter.format(Math.round(diffMs / 86_400_000), 'day');
  if (abs >= 3_600_000) return formatter.format(Math.round(diffMs / 3_600_000), 'hour');
  return formatter.format(Math.round(diffMs / 60_000), 'minute');
}

function barColor(remaining: number) {
  if (remaining <= 10) return 'bg-red-600 dark:bg-red-400';
  if (remaining <= 30) return 'bg-amber-500 dark:bg-amber-400';
  return 'bg-blue-600 dark:bg-blue-400';
}

export default function SubscriptionUsage() {
  const { t, i18n } = useTranslation('common');
  const [open, setOpen] = useState(readOpenState);
  const [providers, setProviders] = useState<ProviderUsage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setFailed(false);
    try {
      const response = await api.subscriptionUsage(refresh);
      if (!response.ok) throw new Error('subscription-usage');
      const data = await response.json();
      setProviders(Array.isArray(data.providers) ? data.providers : []);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && providers === null && !loading) void load();
  }, [open, providers, loading, load]);

  const locale = i18n.resolvedLanguage || i18n.language || 'en';

  return (
    <details
      className="mt-4 text-xs text-muted-foreground"
      open={open}
      onToggle={e => { const next = e.currentTarget.open; setOpen(next); writeOpenState(next); }}
    >
      <summary className="w-fit cursor-pointer rounded py-2 focus-visible:outline focus-visible:outline-2">{t('projectDashboard.subscriptionUsage.title')}</summary>
      <div className="mt-2 max-w-3xl">
        <div className="mb-2 flex items-center gap-2">
          <span>{t('projectDashboard.subscriptionUsage.description')}</span>
          <Button variant="ghost" size="sm" className="h-6 px-2" disabled={loading} onClick={() => load(true)} aria-label={t('buttons.refresh', 'Refresh')}>
            <RefreshCw className={loading ? 'animate-spin' : undefined} />
          </Button>
        </div>
        {failed && <div role="alert">{t('projectDashboard.subscriptionUsage.loadError')}</div>}
        {!providers && loading && <div>{t('projectDashboard.subscriptionUsage.loading')}</div>}
        {providers && (
          <ul className="divide-y divide-border border-y border-border">
            {providers.map(entry => (
              <li key={entry.provider} className="grid gap-x-6 gap-y-2 py-3 sm:grid-cols-[minmax(160px,1fr)_minmax(0,2fr)]">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {PROVIDER_NAMES[entry.provider]}
                    {entry.plan && <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[11px] font-normal uppercase text-muted-foreground">{entry.plan}</span>}
                  </div>
                  {entry.account && <div className="mt-0.5 truncate" title={entry.account}>{entry.account}</div>}
                </div>
                <div className="min-w-0">
                  {entry.status === 'ok' ? (
                    <>
                      <div className="space-y-1.5">
                        {entry.windows.map(window => (
                          <div key={window.id} className="grid grid-cols-[72px_minmax(60px,160px)_auto] items-center gap-3 tabular-nums">
                            <span className="truncate" title={window.label}>{window.label}</span>
                            {window.remainingPercent !== null ? (
                              <div className="h-1 rounded-full bg-muted" role="progressbar" aria-label={`${PROVIDER_NAMES[entry.provider]} ${window.label}`} aria-valuenow={window.remainingPercent} aria-valuemin={0} aria-valuemax={100}>
                                <div className={`h-full rounded-full ${barColor(window.remainingPercent)}`} style={{ width: `${window.remainingPercent}%` }} />
                              </div>
                            ) : <span />}
                            <span>
                              {window.resetSinceObserved
                                ? t('projectDashboard.subscriptionUsage.resetSinceObserved')
                                : t('projectDashboard.subscriptionUsage.remaining', { percent: window.remainingPercent })}
                              {window.resetsAt && !window.resetSinceObserved && (
                                <> · {t('projectDashboard.subscriptionUsage.resets', { when: formatRelative(window.resetsAt, locale) })}</>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                      {entry.source === 'session-log' && entry.observedAt && (
                        <div className="mt-1.5">{t('projectDashboard.subscriptionUsage.fromSessionLog', { when: formatRelative(entry.observedAt, locale) })}</div>
                      )}
                    </>
                  ) : (
                    <div>
                      <span className="font-medium">{t('projectDashboard.subscriptionUsage.notAvailable')}</span>
                      {' — '}
                      {t(`projectDashboard.subscriptionUsage.reasons.${entry.reasonCode || 'probe_failed'}`)}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
