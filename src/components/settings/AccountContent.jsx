import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import SessionProviderLogo from '../SessionProviderLogo';
import LocalAccountSettings from './LocalAccountSettings';
import SettingsFeedback from './SettingsFeedback';
import { useSettingsDraft } from './SettingsDraftGuard';
import { settingsRequest, useSettingsRequest } from './useSettingsRequest';

const providers = {
  claude: { name: 'Claude', command: 'claude', endpoint: 'verify-custom-api' },
  cursor: { name: 'Cursor', command: 'agent' },
  codex: { name: 'Codex', command: 'codex', keyProvider: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', endpoint: 'verify-api-key' },
  gemini: { name: 'Gemini', command: 'gemini', keyProvider: 'Google', keyUrl: 'https://aistudio.google.com/apikey', endpoint: 'verify-api-key' },
  openrouter: { name: 'OpenRouter', keyProvider: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', endpoint: 'verify-api-key' },
  local: { name: 'Local GPU' },
};

function ApiCredentialForm({ agent, provider, authStatus, onRefreshStatus }) {
  const { t } = useTranslation('settings');
  const id = useId();
  const { states, run, clear } = useSettingsRequest();
  const [secret, setSecret] = useState('');
  const [url, setUrl] = useState('');
  const [savedUrl, setSavedUrl] = useState('');
  const feedbackRef = useRef(null);
  useEffect(() => {
    if (states.save?.error) feedbackRef.current?.scrollIntoView({ block: 'nearest' });
  }, [states.save?.error]);
  const custom = agent === 'claude', busy = Boolean(states.save?.pending);
  useSettingsDraft(Boolean(secret || url !== savedUrl), { busy });
  const submit = async event => {
    event.preventDefault();
    if (!secret.trim()) return;
    const address = url;
    await run('save', () => settingsRequest(`/api/cli/${agent}/${provider.endpoint}`, { method: 'POST', body: JSON.stringify(custom ? { baseUrl: url.trim() || undefined, token: secret.trim() } : { apiKey: secret.trim() }) }), () => {
      setSecret(''); setSavedUrl(address); onRefreshStatus?.();
    });
  };
  return <form data-provider-api={agent} onSubmit={submit} className="space-y-4 border-t border-border pt-4">
    <h4 className="font-medium">{custom ? t('providerAccount.customApi') : t('providerAccount.keyTitle', { provider: provider.keyProvider })}</h4>
    <p className="text-sm text-muted-foreground">{t(custom ? 'providerAccount.customDescription' : (agent === 'gemini' ? authStatus?.hasApiKey : authStatus?.authenticated) ? 'providerAccount.replaceKey' : 'providerAccount.enterKey')}</p>
    {custom && <div className="space-y-2"><label htmlFor={`${id}-url`} className="block text-sm font-medium">{t('providerAccount.baseUrl')}</label><Input id={`${id}-url`} type="url" value={url} disabled={busy} onChange={event => { setUrl(event.target.value); clear('save'); }} placeholder="https://api.anthropic.com" className="min-h-11" /><p className="text-sm text-muted-foreground">{t('providerAccount.defaultUrl')}</p></div>}
    <div className="space-y-2"><label htmlFor={`${id}-key`} className="block text-sm font-medium">{t(custom ? 'providerAccount.token' : 'providerAccount.apiKey')}</label><Input id={`${id}-key`} type="password" autoComplete="off" spellCheck={false} required value={secret} disabled={busy} onChange={event => { setSecret(event.target.value); clear('save'); }} className="min-h-11" /></div>
    <Button type="submit" disabled={busy || !secret.trim()} className="min-h-11">{t(busy ? 'providerAccount.verifying' : 'providerAccount.verifySave')}</Button>
    <div ref={feedbackRef}><SettingsFeedback state={states.save} /></div>
    {provider.keyUrl && <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="block w-fit py-2 text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('providerAccount.getKey', { provider: provider.keyProvider })}</a>}
  </form>;
}

export default function AccountContent({ agent, authStatus, onLogin, onRefreshStatus }) {
  const { t } = useTranslation('settings');
  const provider = providers[agent];
  const { states, run } = useSettingsRequest();
  if (!provider) return null;
  const missing = authStatus?.cliAvailable === false;
  const loading = Boolean(authStatus?.loading || states.status?.pending);
  const status = loading ? 'checkingAuth' : missing ? 'cliMissing' : authStatus?.error ? 'unknown' : authStatus?.authenticated ? 'loggedInAs' : 'notConnected';
  return <section data-provider-account={agent} className="min-w-0 space-y-5">
    <div className="flex items-start gap-3"><SessionProviderLogo provider={agent} className="h-6 w-6 shrink-0" /><div className="min-w-0 space-y-1"><h3 className="text-lg font-semibold">{provider.name}</h3><p className="text-sm text-muted-foreground">{t(`agents.account.${agent}.description`)}</p></div></div>
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0 flex-1 basis-48 space-y-1"><h4 className="font-medium">{t('agents.connectionStatus')}</h4><p role="status" className="break-words text-sm text-muted-foreground">{status === 'unknown' ? t('providerAccount.statusUnknown') : t(`agents.authStatus.${status}`, { command: authStatus?.cliCommand || provider.command, email: authStatus?.email || t('agents.authStatus.authenticatedUser') })}</p></div><Button variant="outline" className="min-h-11" disabled={loading} onClick={() => run('status', () => onRefreshStatus?.())}>{t('providerAccount.refresh')}</Button></div>
      {authStatus?.error && !missing && <SettingsFeedback state={{ error: authStatus.error }} saved={false} failureMessage={t('providerAccount.statusFailed')} />}
      {provider.command && <div className="space-y-3 border-t border-border pt-4"><div className="space-y-1"><h4 className="font-medium">{t(authStatus?.authenticated ? 'agents.login.reAuthenticate' : 'agents.login.title')}</h4><p className="text-sm text-muted-foreground">{t(missing ? 'agents.login.installDescription' : authStatus?.authenticated ? 'agents.login.reAuthDescription' : 'agents.login.description', { agent: provider.name })}</p></div><Button variant="outline" className="min-h-11" onClick={onLogin} disabled={loading || missing}>{t(authStatus?.authenticated ? 'agents.login.reLoginButton' : 'agents.login.button')}</Button></div>}
      {missing && authStatus.installHint && <div className="space-y-2 border-t border-border pt-4 text-sm"><h4 className="font-medium">{t('agents.install.title')}</h4><p className="break-words text-muted-foreground">{authStatus.installHint}</p><code className="break-all">{authStatus.cliCommand || provider.command}</code></div>}
      {agent === 'gemini' && authStatus?.authenticated && <p className="text-sm text-muted-foreground">{t(authStatus?.hasOAuth && authStatus?.hasApiKey ? 'providerAccount.geminiBoth' : authStatus?.method === 'oauth' ? 'providerAccount.geminiOAuth' : 'providerAccount.geminiApi')}</p>}
      {provider.endpoint && <ApiCredentialForm agent={agent} provider={provider} authStatus={authStatus} onRefreshStatus={onRefreshStatus} />}
      {agent === 'local' && <LocalAccountSettings onRefreshStatus={onRefreshStatus || onLogin} />}
    </div>
  </section>;
}
