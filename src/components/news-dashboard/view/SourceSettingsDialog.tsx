import {
  Cookie,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  QrCode,
  Settings2,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { IS_PLATFORM } from '../../../constants/config';
import { api } from '../../../utils/api';
import { Button } from '../../ui/button';
import type { NewsSourceKey, ResearchDomain, SourceInfo } from './useNewsDashboardData';

const ARXIV_CATEGORIES = [
  'cs.AI', 'cs.LG', 'cs.CL', 'cs.CV', 'cs.MM', 'cs.MA', 'cs.RO',
  'cs.IR', 'cs.NE', 'cs.SE', 'stat.ML', 'eess.AS', 'eess.IV',
];

const SOURCE_TITLE_KEYS: Record<NewsSourceKey, string> = {
  arxiv: 'settings.arxivTitle',
  huggingface: 'settings.huggingfaceTitle',
  github: 'settings.githubTitle',
  wechat: 'settings.wechatTitle',
  x: 'settings.xTitle',
  xiaohongshu: 'settings.xiaohongshuTitle',
};

const HF_MODE_OPTIONS: Array<{ value: 'papers' | 'models' | 'datasets' | 'spaces'; labelKey: string }> = [
  { value: 'papers', labelKey: 'settings.hfModePapers' },
  { value: 'models', labelKey: 'settings.hfModeModels' },
  { value: 'datasets', labelKey: 'settings.hfModeDatasets' },
  { value: 'spaces', labelKey: 'settings.hfModeSpaces' },
];

const GITHUB_LANGUAGES = [
  { value: '', label: 'Any' },
  { value: 'python', label: 'Python' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'rust', label: 'Rust' },
  { value: 'go', label: 'Go' },
  { value: 'cuda', label: 'CUDA' },
  { value: 'c++', label: 'C++' },
  { value: 'java', label: 'Java' },
];

const GITHUB_TIME_WINDOWS: Array<{ value: 'daily' | 'weekly' | 'monthly'; labelKey: string }> = [
  { value: 'daily', labelKey: 'settings.githubWindowDaily' },
  { value: 'weekly', labelKey: 'settings.githubWindowWeekly' },
  { value: 'monthly', labelKey: 'settings.githubWindowMonthly' },
];

function parseModes(value: unknown): Array<'papers' | 'models' | 'datasets' | 'spaces'> {
  if (typeof value !== 'string') return ['papers'];
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is 'papers' | 'models' | 'datasets' | 'spaces' =>
      s === 'papers' || s === 'models' || s === 'datasets' || s === 'spaces'
    );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = Record<string, any>;
type XhsLoginMethod = 'browser' | 'qrcode';
const XHS_COOKIE_SOURCES = [
  { value: 'auto', label: 'Auto' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'chromium', label: 'Chromium' },
  { value: 'edge', label: 'Edge' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'arc', label: 'Arc' },
  { value: 'brave', label: 'Brave' },
  { value: 'vivaldi', label: 'Vivaldi' },
  { value: 'opera', label: 'Opera' },
  { value: 'opera_gx', label: 'Opera GX' },
  { value: 'librewolf', label: 'LibreWolf' },
  { value: 'safari', label: 'Safari' },
];

function clampInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseIntegerDraft(draft: string, fallback: number, min: number, max: number) {
  const trimmed = draft.trim();
  if (!trimmed) return fallback;

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return fallback;

  return clampInteger(parsed, min, max);
}

function EditableNumberInput({
  value,
  min,
  max,
  step,
  fallback,
  onCommit,
  className,
}: {
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  fallback: number;
  onCommit: (value: number) => void;
  className: string;
}) {
  const [draft, setDraft] = useState(String(value ?? fallback));

  useEffect(() => {
    setDraft(String(value ?? fallback));
  }, [fallback, value]);

  const commitDraft = useCallback(() => {
    const nextValue = parseIntegerDraft(draft, fallback, min, max);
    setDraft(String(nextValue));
    if (nextValue !== value) {
      onCommit(nextValue);
    }
  }, [draft, fallback, max, min, onCommit, value]);

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitDraft}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commitDraft();
          e.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
}

function TokenInput({
  value,
  onChange,
  placeholder,
  envVarLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  envVarLabel: string;
}) {
  const { t } = useTranslation('news');
  const [reveal, setReveal] = useState(false);
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
        <KeyRound className="h-3 w-3" />
        {t('settings.apiToken')}
        <span className="ml-1 rounded bg-muted/60 px-1 py-px font-mono text-[9px] tracking-normal text-muted-foreground">
          {envVarLabel}
        </span>
      </label>
      <div className="relative">
        <input
          type={reveal ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 pr-10 text-sm font-mono focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
        <button
          type="button"
          onClick={() => setReveal((r) => !r)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
          aria-label={reveal ? t('settings.hideToken') : t('settings.revealToken')}
        >
          {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground/70">{t('settings.tokenHelp')}</p>
    </div>
  );
}

function shouldPreferXhsQrLogin() {
  if (IS_PLATFORM) return true;
  if (typeof window === 'undefined') return false;

  const hostname = window.location.hostname.toLowerCase();
  const localHostnames = new Set(['localhost', '127.0.0.1', '::1']);
  return !localHostnames.has(hostname);
}

function DomainEditor({
  name,
  domain,
  onUpdate,
  onRemove,
  showCategories,
}: {
  name: string;
  domain: ResearchDomain;
  onUpdate: (name: string, domain: ResearchDomain) => void;
  onRemove: (name: string) => void;
  showCategories?: boolean;
}) {
  const { t } = useTranslation('news');
  const [keywordInput, setKeywordInput] = useState('');
  const [catInput, setCatInput] = useState('');

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (kw && !domain.keywords.includes(kw)) {
      onUpdate(name, { ...domain, keywords: [...domain.keywords, kw] });
      setKeywordInput('');
    }
  };

  const removeKeyword = (kw: string) => {
    onUpdate(name, { ...domain, keywords: domain.keywords.filter((k) => k !== kw) });
  };

  return (
    <div className="rounded-2xl border border-border/50 bg-background/60 p-4 space-y-3 transition-colors hover:border-border/80">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">{name}</h4>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] font-medium text-muted-foreground">{t('settings.priority')}</label>
            <EditableNumberInput
              min={1}
              max={10}
              fallback={5}
              value={domain.priority}
              onCommit={(value) => onUpdate(name, { ...domain, priority: value })}
              className="w-12 rounded-lg border border-border/60 bg-background px-2 py-1 text-xs text-center font-medium tabular-nums"
            />
          </div>
          <button onClick={() => onRemove(name)} className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.keywords')}</label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {domain.keywords.map((kw) => (
            <span key={kw} className="inline-flex items-center gap-1 rounded-lg border border-sky-200/60 bg-sky-50/80 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:border-sky-800/40 dark:bg-sky-950/30 dark:text-sky-300">
              {kw}
              <button onClick={() => removeKeyword(kw)} className="text-sky-400 hover:text-destructive transition-colors">&times;</button>
            </span>
          ))}
          <div className="inline-flex items-center gap-1">
            <input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
              placeholder={t('settings.addPlaceholder')}
              className="w-20 rounded-lg border border-dashed border-border/60 bg-transparent px-2 py-0.5 text-[10px] placeholder:text-muted-foreground/40 focus:border-primary/40 focus:outline-none"
            />
            <button onClick={addKeyword} className="rounded p-0.5 text-primary/60 hover:text-primary transition-colors"><Plus className="h-3 w-3" /></button>
          </div>
        </div>
      </div>

      {showCategories && (
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.arxivCategories')}</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {domain.arxiv_categories.map((cat) => (
              <span key={cat} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200/60 bg-emerald-50/80 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                {cat}
                <button onClick={() => onUpdate(name, { ...domain, arxiv_categories: domain.arxiv_categories.filter((c) => c !== cat) })} className="text-emerald-400 hover:text-destructive transition-colors">&times;</button>
              </span>
            ))}
            <select
              value={catInput}
              onChange={(e) => {
                const cat = e.target.value;
                if (cat && !domain.arxiv_categories.includes(cat)) {
                  onUpdate(name, { ...domain, arxiv_categories: [...domain.arxiv_categories, cat] });
                }
                setCatInput('');
              }}
              className="rounded-lg border border-dashed border-border/60 bg-transparent px-2 py-0.5 text-[10px] text-muted-foreground/70 focus:border-primary/40 focus:outline-none"
            >
              <option value="">{t('settings.addPlaceholder')}</option>
              {ARXIV_CATEGORIES.filter((c) => !domain.arxiv_categories.includes(c)).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function XhsLoginSection() {
  const { t } = useTranslation('news');
  const preferQrLogin = shouldPreferXhsQrLogin();
  const [isLogging, setIsLogging] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [cookieSource, setCookieSource] = useState('auto');
  const [activeMethod, setActiveMethod] = useState<XhsLoginMethod>(preferQrLogin ? 'qrcode' : 'browser');
  const [result, setResult] = useState<{ success: boolean; message?: string; hint?: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleLogin = async (method: XhsLoginMethod) => {
    setIsLogging(true);
    setLogs([]);
    setResult(null);
    setActiveMethod(method);

    try {
      const requestBody = method === 'browser'
        ? { method, cookieSource }
        : { method };

      const res = await api.news.xhsLogin(requestBody);
      const data = await res.json();

      if (data.logs?.length) setLogs(data.logs);

      if (data.success) {
        setResult({
          success: true,
          message: method === 'qrcode'
            ? (data.nickname ? t('settings.cookieSuccessWithName', { nickname: data.nickname }) : t('settings.qrSuccess'))
            : (data.nickname ? t('settings.cookieSuccessWithName', { nickname: data.nickname }) : t('settings.cookieSuccess')),
        });
      } else {
        setResult({
          success: false,
          message: data.error || (method === 'qrcode' ? t('settings.qrFailure') : t('settings.cookieFailure')),
          hint: data.contextHint,
        });
      }
    } catch (err: unknown) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : (method === 'qrcode' ? t('settings.qrFailure') : t('settings.loginFailed')),
      });
    } finally {
      setIsLogging(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border/50 bg-background/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Cookie className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold text-foreground">{t('settings.browserCookieAuth')}</h4>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t('settings.browserCookieDescription')}
      </p>
      <div className="rounded-xl border border-amber-200/70 bg-amber-50/80 p-3 text-[11px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
        {t('settings.serviceMachineHint')}
      </div>
      {preferQrLogin && (
        <div className="rounded-xl border border-sky-200/70 bg-sky-50/80 p-3 text-[11px] text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100">
          {t('settings.qrRecommendedHint')}
        </div>
      )}

      <div className={`rounded-xl border p-3.5 space-y-2.5 ${preferQrLogin ? 'border-primary/40 bg-primary/5' : 'border-border/40 bg-background/50'}`}>
        <div className="flex items-center gap-2">
          <QrCode className="h-4 w-4 text-muted-foreground" />
          <h5 className="text-xs font-semibold text-foreground">{t('settings.qrLoginTitle')}</h5>
          {preferQrLogin && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-primary">
              {t('settings.recommendedTag')}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{t('settings.qrLoginDescription')}</p>
        <Button
          size="sm"
          variant={preferQrLogin ? 'default' : 'outline'}
          onClick={() => handleLogin('qrcode')}
          disabled={isLogging}
          className="rounded-lg text-xs gap-1.5"
        >
          {isLogging && activeMethod === 'qrcode' ? <Loader2 className="h-3 w-3 animate-spin" /> : <QrCode className="h-3 w-3" />}
          {isLogging && activeMethod === 'qrcode' ? t('settings.qrLoggingIn') : t('settings.loginViaQr')}
        </Button>
      </div>

      <div className={`rounded-xl border p-3.5 space-y-2.5 ${preferQrLogin ? 'border-border/40 bg-background/50' : 'border-primary/40 bg-primary/5'}`}>
        <div className="flex items-center gap-2">
          <Cookie className="h-4 w-4 text-muted-foreground" />
          <h5 className="text-xs font-semibold text-foreground">{t('settings.browserCookieAuth')}</h5>
        </div>
        <p className="text-[11px] text-muted-foreground">{t('settings.cookieSourceDescription')}</p>
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
            {t('settings.cookieSource')}
          </label>
          <select
            value={cookieSource}
            onChange={(e) => setCookieSource(e.target.value)}
            className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
          >
            {XHS_COOKIE_SOURCES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          variant={preferQrLogin ? 'outline' : 'default'}
          onClick={() => handleLogin('browser')}
          disabled={isLogging}
          className="rounded-lg text-xs gap-1.5"
        >
          {isLogging && activeMethod === 'browser' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Cookie className="h-3 w-3" />}
          {isLogging && activeMethod === 'browser' ? t('settings.extracting') : t('settings.extractBrowserCookie')}
        </Button>
      </div>

      {logs.length > 0 && (
        <div
          ref={scrollRef}
          className="max-h-28 overflow-y-auto rounded-xl border border-border/40 bg-slate-950/90 p-2.5 font-mono text-[10px] leading-4 text-emerald-400 dark:border-border/30"
        >
          {logs.map((line, i) => (
            <div key={i} className="flex gap-1.5">
              <Terminal className="mt-0.5 h-2.5 w-2.5 flex-shrink-0 text-emerald-600" />
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}

      {result && (
        <div className="space-y-1">
          <p className={`text-[11px] font-medium ${result.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
            {result.message}
          </p>
          {result.hint && (
            <p className="text-[11px] text-muted-foreground">
              {result.hint}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function SourceSettingsDialog({
  sourceKey,
  config,
  onConfigChange,
  onSave,
  onClose,
  sourceInfo,
  configDirty,
}: {
  sourceKey: NewsSourceKey;
  config: AnyConfig;
  onConfigChange: (config: AnyConfig) => void;
  onSave: () => void;
  onClose: () => void;
  sourceInfo?: SourceInfo;
  configDirty: boolean;
}) {
  const { t } = useTranslation('news');
  const [newDomainName, setNewDomainName] = useState('');

  const updateField = useCallback((field: string, value: unknown) => {
    onConfigChange({ ...config, [field]: value });
  }, [config, onConfigChange]);

  const updateDomain = useCallback((name: string, domain: ResearchDomain) => {
    onConfigChange({ ...config, research_domains: { ...config.research_domains, [name]: domain } });
  }, [config, onConfigChange]);

  const removeDomain = useCallback((name: string) => {
    const { [name]: _, ...rest } = config.research_domains;
    onConfigChange({ ...config, research_domains: rest });
  }, [config, onConfigChange]);

  const addDomain = useCallback(() => {
    if (!newDomainName.trim()) return;
    onConfigChange({
      ...config,
      research_domains: {
        ...config.research_domains,
        [newDomainName.trim()]: { keywords: [], arxiv_categories: sourceKey === 'arxiv' ? ['cs.AI'] : [], priority: 5 },
      },
    });
    setNewDomainName('');
  }, [config, newDomainName, onConfigChange, sourceKey]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-[28px] border border-border/60 bg-card p-6 shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10">
              <Settings2 className="h-4 w-4 text-primary" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">{t(SOURCE_TITLE_KEYS[sourceKey])}</h3>
          </div>
          <div className="flex items-center gap-2">
            {configDirty && (
              <Button size="sm" className="rounded-full text-xs gap-1.5 shadow-sm" onClick={onSave}>
                {t('actions.save')}
              </Button>
            )}
            <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Authentication — CLI-based, auto-extracts browser cookies */}
        {sourceKey === 'x' && (
          <div className="rounded-2xl border border-border/50 bg-background/60 p-4 space-y-2">
            <h4 className="text-sm font-semibold text-foreground">{t('settings.authentication')}</h4>
            <p className="text-[11px] text-muted-foreground">
              {t('settings.xAuthDescription')}
            </p>
          </div>
        )}
        {sourceKey === 'xiaohongshu' && <XhsLoginSection />}
        {sourceKey === 'github' && (
          <div className="rounded-2xl border border-border/50 bg-background/60 p-4 space-y-3">
            <h4 className="text-sm font-semibold text-foreground">{t('settings.authentication')}</h4>
            <p className="text-[11px] text-muted-foreground">{t('settings.githubAuthDescription')}</p>
            <TokenInput
              value={typeof config.api_token === 'string' ? config.api_token : ''}
              onChange={(next) => updateField('api_token', next)}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              envVarLabel="GITHUB_TOKEN"
            />
          </div>
        )}
        {sourceKey === 'huggingface' && (
          <div className="rounded-2xl border border-border/50 bg-background/60 p-4 space-y-3">
            <h4 className="text-sm font-semibold text-foreground">{t('settings.authentication')}</h4>
            <p className="text-[11px] text-muted-foreground">{t('settings.hfAuthDescription')}</p>
            <TokenInput
              value={typeof config.api_token === 'string' ? config.api_token : ''}
              onChange={(next) => updateField('api_token', next)}
              placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              envVarLabel="HF_TOKEN"
            />
          </div>
        )}

        {/* HuggingFace: mode toggles */}
        {sourceKey === 'huggingface' && (
          <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.hfModes')}</label>
            <p className="mt-1 text-[11px] text-muted-foreground/80">{t('settings.hfModesHelp')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {HF_MODE_OPTIONS.map((opt) => {
                const active = parseModes(config.modes).includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      const current = new Set(parseModes(config.modes));
                      if (active) {
                        current.delete(opt.value);
                      } else {
                        current.add(opt.value);
                      }
                      // Always keep at least one mode active.
                      if (current.size === 0) current.add('papers');
                      const orderedModes = HF_MODE_OPTIONS
                        .map((o) => o.value)
                        .filter((v) => current.has(v));
                      updateField('modes', orderedModes.join(','));
                    }}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-yellow-500 text-white shadow-sm'
                        : 'bg-muted/40 text-muted-foreground hover:bg-muted/60'
                    }`}
                  >
                    {t(opt.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* GitHub: language + time window + trending toggle */}
        {sourceKey === 'github' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
              <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.githubLanguage')}</label>
              <select
                value={config.language || ''}
                onChange={(e) => updateField('language', e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
              >
                {GITHUB_LANGUAGES.map((lang) => (
                  <option key={lang.value} value={lang.value}>{lang.label}</option>
                ))}
              </select>
            </div>
            <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
              <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.githubTimeWindow')}</label>
              <select
                value={config.time_window || 'weekly'}
                onChange={(e) => updateField('time_window', e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
              >
                {GITHUB_TIME_WINDOWS.map((tw) => (
                  <option key={tw.value} value={tw.value}>{t(tw.labelKey)}</option>
                ))}
              </select>
            </div>
            <div className="rounded-xl border border-border/40 bg-background/50 p-3.5 sm:col-span-2 flex items-center justify-between">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.githubIncludeTrending')}</label>
                <p className="mt-1 text-[11px] text-muted-foreground/80">{t('settings.githubIncludeTrendingHelp')}</p>
              </div>
              <button
                type="button"
                onClick={() => updateField('include_trending', !(config.include_trending ?? true))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  config.include_trending !== false ? 'bg-violet-500' : 'bg-muted'
                }`}
                aria-pressed={config.include_trending !== false}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    config.include_trending !== false ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        {/* WeChat 公众号: RSSHub instance + accounts list + access key */}
        {sourceKey === 'wechat' && (
          <>
            <div className="rounded-2xl border border-border/50 bg-background/60 p-4 space-y-3">
              <h4 className="text-sm font-semibold text-foreground">{t('settings.wechatRsshubTitle')}</h4>
              <p className="text-[11px] text-muted-foreground">{t('settings.wechatRsshubDescription')}</p>
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                  {t('settings.wechatInstanceUrl')}
                </label>
                <input
                  type="url"
                  value={typeof config.instance_url === 'string' ? config.instance_url : ''}
                  onChange={(e) => updateField('instance_url', e.target.value)}
                  placeholder="https://rsshub.app"
                  spellCheck={false}
                  className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-mono focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
                />
                <p className="text-[10px] text-muted-foreground/70">{t('settings.wechatInstanceHelp')}</p>
              </div>
              <TokenInput
                value={typeof config.access_key === 'string' ? config.access_key : ''}
                onChange={(next) => updateField('access_key', next)}
                placeholder={t('settings.wechatAccessKeyPlaceholder')}
                envVarLabel="?key=…"
              />
            </div>
            <div className="rounded-xl border border-border/40 bg-background/50 p-3.5 space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                {t('settings.wechatAccounts')}
              </label>
              <p className="text-[11px] text-muted-foreground/80">{t('settings.wechatAccountsHelp')}</p>
              <textarea
                value={
                  Array.isArray(config.accounts)
                    ? config.accounts.join('\n')
                    : (typeof config.accounts === 'string' ? config.accounts.replace(/,\s*/g, '\n') : '')
                }
                onChange={(e) => {
                  const lines = e.target.value
                    .split(/\n/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                  updateField('accounts', lines.join(','));
                }}
                placeholder={'wechat/ce/huxiu_com\nwechat/ce/ifanr\nhttps://rsshub.app/wechat/ce/PingWest'}
                rows={5}
                spellCheck={false}
                className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-xs font-mono focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
              <p className="text-[10px] text-muted-foreground/70">
                {t('settings.wechatAccountsFormat')}
              </p>
            </div>
          </>
        )}

        {/* Source-specific fields */}
        {sourceKey === 'x' && (
          <>
            <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
              <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.searchQueries')}</label>
              <input
                value={config.queries || ''}
                onChange={(e) => updateField('queries', e.target.value)}
                placeholder={t('settings.searchQueriesPlaceholder')}
                className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
              <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.trackedAccounts')}</label>
              <input
                value={config.accounts || ''}
                onChange={(e) => updateField('accounts', e.target.value)}
                placeholder={t('settings.trackedAccountsPlaceholder')}
                className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
          </>
        )}

        {sourceKey === 'xiaohongshu' && (
          <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.searchKeywords')}</label>
            <input
              value={config.keywords || ''}
              onChange={(e) => updateField('keywords', e.target.value)}
              placeholder={t('settings.searchKeywordsPlaceholder')}
              className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
          </div>
        )}

        {/* Common fields */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.resultsToShow')}</label>
            <EditableNumberInput
              min={1}
              max={50}
              fallback={10}
              value={config.top_n}
              onCommit={(value) => updateField('top_n', value)}
              className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-medium tabular-nums focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
          </div>
          {sourceKey === 'arxiv' && (
            <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
              <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.maxArxivResults')}</label>
              <EditableNumberInput
                min={50}
                max={1000}
                step={50}
                fallback={200}
                value={config.max_results}
                onCommit={(value) => updateField('max_results', value)}
                className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-medium tabular-nums focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
          )}
        </div>

        {/* Research Domains */}
        <div className="space-y-3">
          <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.researchDomains')}</label>
          {Object.entries(config.research_domains || {}).map(([name, domain]) => (
            <DomainEditor
              key={name}
              name={name}
              domain={domain as ResearchDomain}
              onUpdate={updateDomain}
              onRemove={removeDomain}
              showCategories={sourceKey === 'arxiv'}
            />
          ))}
          <div className="flex items-center gap-2">
            <input
              value={newDomainName}
              onChange={(e) => setNewDomainName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addDomain()}
              placeholder={t('settings.newDomainPlaceholder')}
              className="flex-1 rounded-xl border border-dashed border-border/60 bg-transparent px-3.5 py-2 text-sm placeholder:text-muted-foreground/40 focus:border-primary/40 focus:outline-none"
            />
            <Button size="sm" variant="outline" className="rounded-full gap-1.5" onClick={addDomain} disabled={!newDomainName.trim()}>
              <Plus className="h-3.5 w-3.5" /> {t('settings.addDomain')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
