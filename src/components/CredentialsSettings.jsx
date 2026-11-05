import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Key, Plus, Trash2, Eye, EyeOff, Copy, Check, Github, ExternalLink, Sparkles } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import WorkbenchDialog from './ui/WorkbenchDialog';
import { useSettingsDraft } from './settings/SettingsDraftGuard';
import SettingsFeedback from './settings/SettingsFeedback';
import { settingsRequest, useSettingsRequest } from './settings/useSettingsRequest';
import { useVersionCheck } from '../hooks/useVersionCheck';
import { version } from '../../package.json';

const groups = {
  api: { prefix: 'apiKeys', path: '/api/settings/api-keys', list: 'apiKeys', icon: Key, add: 'newButton', description: 'description' },
  github: { prefix: 'apiKeys.github', path: '/api/settings/credentials', type: 'github_token', list: 'credentials', icon: Github, add: 'addButton', description: 'descriptionAlt' },
  gemini: { prefix: 'apiKeys.gemini', path: '/api/settings/credentials', type: 'gemini_api_key', list: 'credentials', icon: Sparkles, add: 'addButton', description: 'description' },
};
const actionClass = 'min-h-11 md:min-h-8 max-w-full whitespace-normal';

function CredentialGroup({ kind, onCreatedKey, hasUnsavedKey }) {
  const { t, i18n } = useTranslation('settings');
  const config = groups[kind];
  const Icon = config.icon;
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [description, setDescription] = useState('');
  const [visible, setVisible] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const trigger = useRef(null);
  const nameInput = useRef(null);
  const { states, run, clear } = useSettingsRequest();
  const load = useCallback(() => run('load', () => settingsRequest(config.path + (config.type ? `?type=${config.type}` : '')), data => {
    setItems(data[config.list] || []); setLoaded(true);
  }), [run, config]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (open) nameInput.current?.focus(); }, [open]);
  const busy = states.mutate?.pending || states.remove?.pending || states.load?.pending;
  useSettingsDraft(open && Boolean(name || secret || description), { busy: states.mutate?.pending || states.remove?.pending });
  const resetForm = () => { setName(''); setSecret(''); setDescription(''); setVisible(false); setOpen(false); };
  const returnFocus = () => requestAnimationFrame(() => trigger.current?.focus());
  const create = async event => {
    event.preventDefault();
    if ((kind !== 'gemini' && !name.trim()) || (kind !== 'api' && !secret.trim())) return;
    const success = await run('mutate', () => settingsRequest(config.path, {
      method: 'POST', body: JSON.stringify(kind === 'api' ? { keyName: name.trim() } : {
        credentialName: name.trim() || 'Gemini API Key', credentialType: config.type, credentialValue: secret.trim(), description: description.trim(),
      }),
    }), data => { resetForm(); if (kind === 'api') onCreatedKey(data.apiKey); });
    if (success) { await load(); if (kind !== 'api') returnFocus(); }
  };
  const toggle = item => run('mutate', () => settingsRequest(`${config.path}/${item.id}/toggle`, {
    method: 'PATCH', body: JSON.stringify({ isActive: !item.is_active }),
  }), () => setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, is_active: !item.is_active } : entry)));
  const remove = async () => {
    const success = await run('remove', () => settingsRequest(`${config.path}/${deleting.id}`, { method: 'DELETE' }), () => {
      setItems(previous => previous.filter(item => item.id !== deleting.id)); setDeleting(null);
    });
    if (success) returnFocus();
  };
  return <section className="space-y-4" data-credential-group={kind}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-lg font-medium"><Icon className="h-5 w-5 shrink-0" />{t(`${config.prefix}.title`)}</h3>
      <Button ref={trigger} type="button" size="sm" className={actionClass} disabled={!loaded || busy || open || (kind === 'api' && hasUnsavedKey)} onClick={() => { clear('mutate'); setOpen(true); }}><Plus className="mr-1 h-4 w-4" />{t(`${config.prefix}.${config.add}`)}</Button>
    </div>
    <p className="text-sm text-muted-foreground">{t(`${config.prefix}.${config.description}`)}</p>
    {kind === 'api' && <a href="/api-docs.html" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 text-sm underline underline-offset-4">{t('apiKeys.apiDocsLink')}<ExternalLink className="h-3 w-3" /></a>}
    <SettingsFeedback state={states.load} onRetry={load} saved={false} />
    {open && <form onSubmit={create} className="rounded-lg border border-border p-4">
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        <div><label htmlFor={`${kind}-credential-name`} className="mb-1 block text-sm">{t(`credentialLabels.${kind === 'gemini' ? 'optionalName' : 'name'}`)}</label><Input ref={nameInput} id={`${kind}-credential-name`} required={kind !== 'gemini'} value={name} onChange={event => { setName(event.target.value); clear('mutate'); }} className="min-h-11 text-base md:text-sm" /></div>
        {kind !== 'api' && <div><label htmlFor={`${kind}-credential-secret`} className="mb-1 block text-sm">{t(`credentialLabels.${kind === 'github' ? 'token' : 'key'}`)}</label>
          <div className="relative"><Input id={`${kind}-credential-secret`} required type={visible ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} value={secret} onChange={event => { setSecret(event.target.value); clear('mutate'); }} className="min-h-11 pr-12 text-base md:text-sm" /><button type="button" aria-label={t(visible ? 'feedback.hideSecret' : 'feedback.showSecret')} aria-pressed={visible} onClick={() => setVisible(value => !value)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
        </div>}
        {kind === 'github' && <div><label htmlFor="github-credential-description" className="mb-1 block text-sm">{t('credentialLabels.description')}</label><Input id="github-credential-description" value={description} onChange={event => { setDescription(event.target.value); clear('mutate'); }} className="min-h-11 text-base md:text-sm" /></div>}
        <div className="flex flex-wrap gap-2"><Button type="submit" className={actionClass} disabled={(kind !== 'gemini' && !name.trim()) || (kind !== 'api' && !secret.trim())}>{t(`${config.prefix}.form.${kind === 'api' ? 'createButton' : 'addButton'}`)}</Button><Button type="button" variant="outline" className={actionClass} onClick={() => { resetForm(); clear('mutate'); returnFocus(); }}>{t('feedback.cancel')}</Button></div>
        {kind === 'github' && <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center text-sm underline underline-offset-4">{t('apiKeys.github.form.howToCreate')}</a>}
      </fieldset>
    </form>}
    <SettingsFeedback state={states.mutate} />
    {loaded && <div className="space-y-2">{items.length === 0 ? <p className="text-sm text-muted-foreground">{t(`${config.prefix}.empty`)}</p> : items.map(item => {
      const itemName = item.key_name || item.credential_name;
      return <div key={item.id} className="space-y-3 rounded-lg border border-border p-3" data-credential-row>
        <div className="min-w-0 space-y-1"><p className="break-words font-medium [overflow-wrap:anywhere]">{itemName}</p>{kind === 'api' && <code className="block break-all text-xs text-muted-foreground">{item.api_key}</code>}{item.description && <p className="break-words text-sm text-muted-foreground">{item.description}</p>}<p className="text-xs text-muted-foreground">{t(kind === 'api' ? 'apiKeys.list.created' : `${config.prefix}.added`)} {new Date(item.created_at).toLocaleDateString(i18n.language)}{item.last_used && ` · ${t('apiKeys.list.lastUsed')} ${new Date(item.last_used).toLocaleDateString(i18n.language)}`}</p></div>
        <div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" variant="outline" role="switch" aria-checked={Boolean(item.is_active)} aria-label={t('credentialLabels.enable', { name: itemName })} disabled={busy} className={actionClass} onClick={() => toggle(item)}>{t(item.is_active ? 'apiKeys.status.active' : 'apiKeys.status.inactive')}</Button><Button type="button" size="sm" variant="ghost" disabled={busy} className={actionClass} aria-label={t('credentialLabels.delete', { name: itemName })} onClick={() => { clear('remove'); setDeleting(item); }}><Trash2 className="mr-1 h-4 w-4" />{t('feedback.delete')}</Button></div>
      </div>;
    })}</div>}
    {deleting && <WorkbenchDialog title={t('credentialLabels.deleteTitle')} onClose={() => setDeleting(null)} busy={Boolean(states.remove?.pending)}>
      <div className="space-y-4"><p className="break-words font-medium">{deleting.key_name || deleting.credential_name}</p><p className="text-sm text-muted-foreground">{t(`${config.prefix}.confirmDelete`)}</p><SettingsFeedback state={states.remove} saved={false} /><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={states.remove?.pending} onClick={() => setDeleting(null)}>{t('feedback.cancel')}</Button><Button variant="destructive" disabled={states.remove?.pending} onClick={remove}>{t('feedback.delete')}</Button></div></div>
    </WorkbenchDialog>}
  </section>;
}

export default function CredentialsSettings() {
  const { t } = useTranslation('settings');
  const [newKey, setNewKey] = useState(null);
  const keyNotice = useRef(null);
  const { states, run, clear } = useSettingsRequest();
  const { updateAvailable, latestVersion, releaseInfo } = useVersionCheck('OpenLAIR', 'dr-claw');
  useSettingsDraft(Boolean(newKey), { warning: 'key', busy: states.copy?.pending });
  useEffect(() => { if (newKey) keyNotice.current?.focus(); }, [newKey]);
  return <div className="space-y-8" data-credentials-settings>
    {newKey && <section ref={keyNotice} tabIndex={-1} aria-label={t('apiKeys.newKey.alertTitle')} className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
      <h4 className="font-medium">{t('apiKeys.newKey.alertTitle')}</h4><p className="text-sm text-muted-foreground">{t('apiKeys.newKey.alertMessage')}</p><code className="block break-all rounded border border-border bg-background p-3 text-sm">{newKey.apiKey}</code>
      <div className="flex flex-wrap gap-2"><Button variant="outline" className={actionClass} disabled={states.copy?.pending} onClick={() => run('copy', () => navigator.clipboard.writeText(newKey.apiKey))}>{states.copy?.success ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}{t(states.copy?.success ? 'feedback.copied' : 'feedback.copy')}</Button><Button variant="ghost" className={actionClass} onClick={() => { setNewKey(null); clear('copy'); requestAnimationFrame(() => document.querySelector('[data-credential-group="api"] button')?.focus()); }}>{t('apiKeys.newKey.iveSavedIt')}</Button></div>
      <SettingsFeedback state={states.copy} saved={false} />{states.copy?.success && <p role="status" className="sr-only">{t('feedback.copied')}</p>}
    </section>}
    {Object.keys(groups).map(kind => <CredentialGroup key={kind} kind={kind} onCreatedKey={setNewKey} hasUnsavedKey={Boolean(newKey)} />)}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-xs text-muted-foreground"><a href={releaseInfo?.htmlUrl || 'https://github.com/OpenLAIR/dr-claw/releases'} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center hover:underline">v{version}</a>{updateAvailable && latestVersion && <a href={releaseInfo?.htmlUrl || 'https://github.com/OpenLAIR/dr-claw/releases'} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 hover:underline">{t('apiKeys.version.updateAvailable', { version: latestVersion })}<ExternalLink className="h-3 w-3" /></a>}</div>
  </div>;
}
