import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Cpu, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LocaleKey, PackDef } from '../../constants/autoResearchPacks';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

export type ConfigurationResult = {
  success: boolean;
  steps?: Array<{ step: string; status: string; message?: string }>;
  errors?: Array<{ step?: string; error: string }>;
};

type Props = {
  pack: PackDef;
  locale: LocaleKey;
  pendingPack: string | null;
  configure: (pack: string, backend: string, values: Record<string, string>) => Promise<ConfigurationResult | null>;
};

function Command({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation('common');
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const active = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; clearTimeout(timer.current); }; }, []);
  return <div className="space-y-1">
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm font-medium">{label}</p>
      <Button type="button" variant="ghost" className="h-11 w-11 shrink-0 p-0" aria-label={t('autoResearchHub.copyCommand', { label })} onClick={async () => {
        clearTimeout(timer.current);
        try {
          await navigator.clipboard.writeText(value);
          if (!active.current) return;
          setStatus('copied'); timer.current = setTimeout(() => setStatus('idle'), 2000);
        } catch { if (active.current) setStatus('failed'); }
      }}>{status === 'copied' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button>
    </div>
    <code className="block whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs leading-5">{value}</code>
    {status !== 'idle' && <p role={status === 'failed' ? 'alert' : 'status'} className="text-sm text-muted-foreground">{t(status === 'failed' ? 'autoResearchHub.copyFailed' : 'autoResearchHub.copied')}</p>}
  </div>;
}

export default function PackConfiguration({ pack, locale, pendingPack, configure }: Props) {
  const { t } = useTranslation('common');
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [backend, setBackend] = useState(pack.mcp[0]?.key || '');
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, ConfigurationResult | undefined>>({});
  const mounted = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const option = pack.mcp.find(item => item.key === backend)!;
  const values = drafts[backend] || {};
  const result = results[backend];
  const pending = pendingPack === pack.name;
  useEffect(() => { if (result && !result.success) feedback.current?.scrollIntoView({ block: 'nearest' }); }, [result]);
  const update = (key: string, value: string) => {
    setDrafts(previous => ({ ...previous, [backend]: { ...previous[backend], [key]: value } }));
    setResults(previous => ({ ...previous, [backend]: undefined }));
  };
  return <div className="min-w-0 border-t border-border">
    <button type="button" aria-expanded={expanded} aria-controls={`${id}-panel`} onClick={() => setExpanded(value => !value)} className="flex min-h-11 w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      {t('autoResearchHub.config')}{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
    </button>
    <form id={`${id}-panel`} hidden={!expanded} className="space-y-4 px-5 pb-5" onSubmit={async event => {
      event.preventDefault();
      if (pendingPack) return;
      const submitted = { ...values };
      try {
        const response = await configure(pack.name, backend, submitted);
        if (!mounted.current || !response) return;
        setResults(previous => ({ ...previous, [backend]: response }));
        if (response.success) {
          setDrafts(previous => {
            const next = { ...previous[backend] };
            for (const [key, value] of Object.entries(submitted)) if (/KEY|TOKEN|SECRET|PASSWORD/.test(key) && next[key] === value) delete next[key];
            return { ...previous, [backend]: next };
          });
          setVisible({});
        }
      } catch (error) {
        if (mounted.current) setResults(previous => ({ ...previous, [backend]: { success: false, errors: [{ error: error instanceof Error ? error.message : String(error) }] } }));
      }
    }}>
      <div className="space-y-1"><h3 className="text-sm font-medium">{pack.configLabel?.[locale]?.title ?? t('autoResearchHub.configMcp')}</h3><p className="text-sm text-muted-foreground">{pack.configLabel?.[locale]?.desc ?? t('autoResearchHub.configMcpDesc')}</p></div>
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        {pack.mcp.length > 1 && <div className="flex flex-wrap gap-2" role="group" aria-label={t('autoResearchHub.configMcp')}>
          {pack.mcp.map(item => <Button key={item.key} type="button" variant={backend === item.key ? 'default' : 'outline'} aria-pressed={backend === item.key} className="min-h-11 h-auto whitespace-normal" onClick={() => setBackend(item.key)}>{item.label}</Button>)}
        </div>}
        {option.install && <Command key={`${backend}-install`} value={option.install} label={t('autoResearchHub.install')} />}
        {option.register && <Command key={`${backend}-register`} value={option.register} label={t('autoResearchHub.register')} />}
        {option.envVars.map(variable => {
          const field = `${id}-${backend}-${variable.name}`;
          const secret = /KEY|TOKEN|SECRET|PASSWORD/.test(variable.name);
          const shown = visible[field];
          return <div key={field} className="space-y-2">
            <label htmlFor={field} className="block break-all text-sm font-medium">{variable.name}</label>
            <div className="flex min-w-0 gap-2">
              <Input id={field} type={secret && !shown ? 'password' : 'text'} autoComplete="off" spellCheck={false} placeholder={variable.example} value={values[variable.name] || ''} onChange={event => update(variable.name, event.target.value)} className="min-h-11 min-w-0 flex-1" />
              {secret && <Button type="button" variant="outline" aria-label={t(shown ? 'autoResearchHub.hideKey' : 'autoResearchHub.showKey', { name: variable.name })} aria-pressed={Boolean(shown)} className="h-11 w-11 shrink-0 p-0" onClick={() => setVisible(previous => ({ ...previous, [field]: !shown }))}>{shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>}
            </div>
          </div>;
        })}
      </fieldset>
      {pack.gpu.length > 0 && <p className="text-sm text-muted-foreground"><Cpu className="mr-1 inline h-4 w-4" />{t('autoResearchHub.gpuNote')}</p>}
      <Button type="submit" disabled={Boolean(pendingPack)} className="min-h-11 h-auto w-full whitespace-normal">{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t(pending ? 'autoResearchHub.configApplying' : 'autoResearchHub.configApply')}</Button>
      {pendingPack && !pending && <p role="status" className="text-sm text-muted-foreground">{t('autoResearchHub.otherPending', { name: pendingPack })}</p>}
      <div ref={feedback}>
        {result && <div role={result.success ? 'status' : 'alert'} className={`space-y-2 rounded-md border p-3 text-sm ${result.success ? 'border-border text-muted-foreground' : 'border-destructive/30'}`}>
          <p>{t(result.success ? 'autoResearchHub.configSuccess' : 'autoResearchHub.configFailed')}</p>
          {!result.success && <details><summary className="cursor-pointer">{t('autoResearchHub.resultDetails')}</summary><ul className="mt-2 space-y-1 break-words">
            {result.steps?.map((step, index) => <li key={`step-${index}`}>{step.message || step.step}</li>)}
            {result.errors?.map((error, index) => <li key={`error-${index}`}>{error.error}</li>)}
          </ul></details>}
        </div>}
      </div>
    </form>
  </div>;
}
