import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useSettingsDraft } from './SettingsDraftGuard';
import SettingsFeedback from './SettingsFeedback';
import { settingsRequest, useSettingsRequest } from './useSettingsRequest';

const DEFAULT_URL = 'http://localhost:11434';
const examples = ['qwen3:8b', 'llama3.2:latest', 'deepseek-r1:7b', 'gemma3:12b', 'phi4:latest', 'codestral:latest'];
// Ollama is the default, but vLLM and SGLang commonly listen on :8000, so a
// saved address is kept as entered.
const savedUrl = () => localStorage.getItem('local-gpu-server-url') || DEFAULT_URL;
const announceConfigChange = () => window.dispatchEvent(new Event('local-model-config-changed'));

export default function LocalAccountSettings({ onRefreshStatus }) {
  const { t } = useTranslation('settings');
  const label = (key, values) => t(`localSettings.${key}`, values);
  const { states, run, clear } = useSettingsRequest();
  const [gpuInfo, setGpuInfo] = useState(null);
  const [gpu, setGpu] = useState(() => localStorage.getItem('local-gpu-selected') || '');
  const [savedAddress, setSavedAddress] = useState(savedUrl);
  const [url, setUrl] = useState(savedUrl);
  const urlRef = useRef(url);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('local-model') || '');
  const [modelName, setModelName] = useState('');
  const [writeKind, setWriteKind] = useState('save');
  const [models, setModels] = useState({ pending: false, items: null, source: '', provider: null, error: null, tested: false });
  // Without a saved address the server's configured URL (LOCAL_GPU_SERVER_URL)
  // is the effective one, so wait for it before the first model read.
  const [configReady, setConfigReady] = useState(() => Boolean(localStorage.getItem('local-gpu-server-url')));
  const modelRequest = useRef({ id: 0, controller: null });
  const busy = !!states.write?.pending;
  useSettingsDraft(url !== savedAddress || Boolean(modelName), { busy });

  const detect = useCallback(() => run('gpu', async () => {
    const data = await settingsRequest('/api/cli/local/gpu-info');
    if (!Array.isArray(data.gpus)) throw new Error('Invalid GPU response');
    return data;
  }, data => {
    setGpuInfo(data);
    if (data.gpus.length && !localStorage.getItem('local-gpu-selected')) {
      const id = String(data.gpus[0].id ?? 0);
      localStorage.setItem('local-gpu-selected', id);
      setGpu(id);
    }
  }), [run]);

  // A read belongs to the address that started it. Editing the address or
  // leaving this panel invalidates the request before it can update the UI.
  const loadModels = useCallback(async (address = urlRef.current.trim(), tested = false) => {
    if (!address) return;
    modelRequest.current.controller?.abort();
    const controller = new AbortController();
    const id = ++modelRequest.current.id;
    modelRequest.current.controller = controller;
    setModels(previous => ({ ...previous, pending: true, error: null, tested: false }));
    try {
      const data = await settingsRequest(`/api/cli/local/models?serverUrl=${encodeURIComponent(address)}`, { signal: controller.signal });
      if (!Array.isArray(data.models)) throw new Error('Invalid model response');
      if (id !== modelRequest.current.id) return;
      setModels({ pending: false, items: data.models, source: address, provider: data.provider || null, error: null, tested });
      if (data.hasGpu && address === savedUrl() && !localStorage.getItem('local-model')) {
        const small = data.models.find(item => item.sizeB && item.sizeB <= 14);
        if (small) { localStorage.setItem('local-model', small.name); setSelectedModel(small.name); }
      }
    } catch (error) {
      if (id === modelRequest.current.id) setModels(previous => ({ ...previous, pending: false, error: error.message || String(error), tested: false }));
    }
  }, []);

  useEffect(() => { void detect(); }, [detect]);

  useEffect(() => {
    if (configReady) return undefined;
    let cancelled = false;
    settingsRequest('/api/cli/local/config')
      .then(data => {
        if (cancelled || !data?.serverUrl || urlRef.current !== DEFAULT_URL) return;
        urlRef.current = data.serverUrl;
        setUrl(data.serverUrl);
        setSavedAddress(data.serverUrl);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setConfigReady(true); });
    return () => { cancelled = true; };
  }, [configReady]);

  useEffect(() => {
    if (!configReady) return undefined;
    void loadModels();
    return () => { modelRequest.current.id++; modelRequest.current.controller?.abort(); };
  }, [configReady, loadModels]);

  const changeUrl = value => {
    modelRequest.current.id++;
    modelRequest.current.controller?.abort();
    urlRef.current = value;
    setUrl(value);
    setModels(previous => ({ ...previous, pending: false, error: null, tested: false }));
    clear('write');
  };
  const save = event => {
    event.preventDefault();
    if (busy || !url.trim()) return;
    const address = url.trim();
    setWriteKind('save');
    void run('write', () => settingsRequest('/api/cli/local/save-config', { method: 'POST', body: JSON.stringify({ serverUrl: address }) }), data => {
      // The server normalizes the address (e.g. strips a trailing /v1); keep its form.
      const stored = data?.serverUrl || address;
      localStorage.setItem('local-gpu-server-url', stored);
      announceConfigChange();
      setSavedAddress(stored);
      if (urlRef.current.trim() === address) {
        urlRef.current = stored;
        setUrl(stored);
        void loadModels(stored);
      }
      onRefreshStatus?.();
    });
  };
  const pull = event => {
    event.preventDefault();
    if (busy || !modelName.trim() || !url.trim()) return;
    const address = url.trim();
    const name = modelName.trim();
    setWriteKind('pull');
    void run('write', () => settingsRequest('/api/cli/local/pull-model', { method: 'POST', body: JSON.stringify({ modelName: name, serverUrl: address }) }), () => {
      setModelName('');
      if (urlRef.current.trim() === address) void loadModels(address);
      onRefreshStatus?.();
    });
  };
  const currentResults = models.source === url.trim();
  const control = 'min-h-11 text-base md:text-sm';

  return <div className="space-y-6 border-t border-border pt-4" data-local-settings>
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{label('gpuTitle')}</h4>
        <Button type="button" variant="outline" className="min-h-11" disabled={states.gpu?.pending} onClick={detect}>{label('detect')}</Button>
      </div>
      <SettingsFeedback state={states.gpu} saved={false} onRetry={detect} />
      {gpuInfo?.gpus.length === 0 && <p className="text-sm text-muted-foreground">{label('noGpu')}</p>}
      {gpuInfo?.gpus.length > 0 && <fieldset className="space-y-2">
        <legend className="sr-only">{label('gpuTitle')}</legend>
        {gpuInfo.gpus.map((item, index) => {
          const id = String(item.id ?? index);
          return <label key={id} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 focus-within:ring-2 focus-within:ring-ring ${gpu === id ? 'border-foreground/40 bg-muted' : 'border-border'}`}>
            <input type="radio" name="local-gpu" value={id} checked={gpu === id} onChange={() => { localStorage.setItem('local-gpu-selected', id); setGpu(id); }} className="mt-1 accent-foreground" />
            <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{item.name}</span>
              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {item.memory && <span>{item.memory}</span>}{item.utilization !== undefined && <span>{label('utilization', { value: item.utilization })}</span>}{item.temperature !== undefined && <span>{item.temperature}°C</span>}
              </span>
            </span>
          </label>;
        })}
        {gpuInfo.system && <p className="break-words text-xs text-muted-foreground">{gpuInfo.system.driver && label('driver', { value: gpuInfo.system.driver })}{gpuInfo.system.cuda && ` · CUDA ${gpuInfo.system.cuda}`}</p>}
      </fieldset>}
    </section>
    <section className="space-y-3">
      <h4 className="text-sm font-medium">{label('serverTitle')}</h4>
      <p className="text-sm text-muted-foreground">{label('serverDescription')}</p>
      <form onSubmit={save} className="space-y-3">
        <label htmlFor="local-server-url" className="block text-sm">{label('serverUrl')}</label>
        <Input id="local-server-url" type="url" required value={url} disabled={busy} onChange={event => changeUrl(event.target.value)} placeholder={DEFAULT_URL} className={control} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="min-h-11 flex-1 whitespace-normal" onClick={() => void loadModels(url.trim(), true)} disabled={!configReady || busy || models.pending || !url.trim()}>{label('test')}</Button>
          <Button type="submit" className="min-h-11 flex-1 whitespace-normal" disabled={!configReady || busy || !url.trim()}>{label('save')}</Button>
        </div>
        {models.tested && currentResults && <p role="status" className="text-sm text-muted-foreground">{label('connected', { count: models.items.length })}</p>}
        {writeKind === 'save' && <SettingsFeedback state={states.write} />}
      </form>
    </section>
    <section className="space-y-3" data-local-models>
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-medium">{label('modelsTitle')}</h4>
        <Button type="button" variant="outline" className="min-h-11" disabled={!configReady || busy || models.pending || !url.trim()} onClick={() => void loadModels()}>{label('refresh')}</Button>
      </div>
      <SettingsFeedback state={models} saved={false} onRetry={() => void loadModels()} />
      {models.source && <p className="break-all text-xs text-muted-foreground">{label('source', { url: models.source })}</p>}
      {models.items && !currentResults && <p className="text-sm text-muted-foreground">{label('differentServer')}</p>}
      {models.items?.length === 0 && !models.pending && !models.error && currentResults && <p className="text-sm text-muted-foreground">{label('empty')}</p>}
      {models.items?.length > 0 && <fieldset className="space-y-2" disabled={!currentResults || models.pending || busy}>
        <legend className="sr-only">{label('modelsTitle')}</legend>
        {models.items.map(item => <label key={item.name} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 focus-within:ring-2 focus-within:ring-ring ${selectedModel === item.name ? 'border-foreground/40 bg-muted' : 'border-border'} ${!currentResults ? 'opacity-60' : ''}`}>
          <input type="radio" name="local-model" value={item.name} checked={selectedModel === item.name} onChange={() => { localStorage.setItem('local-model', item.name); setSelectedModel(item.name); announceConfigChange(); }} className="mt-1 accent-foreground" />
          <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{item.displayName || item.name}</span><span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{[item.size, item.quantization, item.family, item.sizeB && `${item.sizeB}B`].filter(Boolean).map((value, index) => <span key={index}>{value}</span>)}</span></span>
        </label>)}
      </fieldset>}
    </section>
    {/* Downloading models is Ollama-specific; vLLM and SGLang load models at launch. */}
    {models.provider === 'ollama' && <section className="space-y-3">
      <h4 className="text-sm font-medium">{label('pullTitle')}</h4>
      <form onSubmit={pull} className="space-y-3">
        <label htmlFor="local-model-name" className="block text-sm">{label('modelName')}</label>
        <div className="flex flex-wrap gap-2"><Input id="local-model-name" value={modelName} disabled={busy} required onChange={event => { setModelName(event.target.value); clear('write'); }} placeholder="qwen3:8b" className={`${control} min-w-0 flex-1 basis-40`} /><Button type="submit" className="min-h-11" disabled={busy || !modelName.trim() || !url.trim()}>{label('pull')}</Button></div>
        {writeKind === 'pull' && <SettingsFeedback state={states.write} saved={false} />}
        {writeKind === 'pull' && states.write?.success && <p role="status" className="text-sm text-muted-foreground">{label('pulled')}</p>}
      </form>
      <p className="text-xs text-muted-foreground">{label('examples')}</p>
      <div className="flex flex-wrap gap-2">{examples.map(name => <Button type="button" key={name} variant="outline" className="min-h-11 text-xs" disabled={busy} onClick={() => { setModelName(name); clear('write'); document.getElementById('local-model-name')?.focus(); }}>{name}</Button>)}</div>
      <a href="https://ollama.com/library" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{label('library')}</a>
    </section>}
  </div>;
}
