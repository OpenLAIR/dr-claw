import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useSettingsDraft } from './settings/SettingsDraftGuard';
import SettingsFeedback from './settings/SettingsFeedback';
import { settingsRequest, useSettingsRequest } from './settings/useSettingsRequest';

export default function GitSettings() {
  const { t } = useTranslation('settings');
  const [gitName, setGitName] = useState('');
  const [gitEmail, setGitEmail] = useState('');
  const [saved, setSaved] = useState({ name: '', email: '' });
  const [loaded, setLoaded] = useState(false);
  const { states, run, clear } = useSettingsRequest();
  const load = useCallback(() => run('load', () => settingsRequest('/api/user/git-config'), data => {
    setSaved({ name: data.gitName || '', email: data.gitEmail || '' });
    setGitName(data.gitName || ''); setGitEmail(data.gitEmail || ''); setLoaded(true);
  }), [run]);
  useEffect(() => { void load(); }, [load]);
  useSettingsDraft(loaded && (gitName !== saved.name || gitEmail !== saved.email), { busy: states.save?.pending });
  const save = event => {
    event.preventDefault();
    if (!gitName.trim() || !gitEmail.trim()) return;
    void run('save', () => settingsRequest('/api/user/git-config', {
      method: 'POST', body: JSON.stringify({ gitName: gitName.trim(), gitEmail: gitEmail.trim() }),
    }), () => setSaved({ name: gitName, email: gitEmail }));
  };
  return <section className="space-y-4" data-git-settings>
    <div><h3 className="text-lg font-medium">{t('git.title')}</h3><p className="mt-1 text-sm text-muted-foreground">{t('git.description')}</p></div>
    <SettingsFeedback state={states.load} onRetry={load} saved={false} />
    <form onSubmit={save}>
      <fieldset disabled={!loaded || states.load?.pending || states.save?.pending} className="min-w-0 space-y-4 rounded-lg border border-border p-4">
        <div><label htmlFor="settings-git-name" className="mb-2 block text-sm font-medium">{t('git.name.label')}</label><Input id="settings-git-name" required value={gitName} onChange={event => { setGitName(event.target.value); clear('save'); }} autoComplete="name" className="min-h-11 text-base md:text-sm" /><p className="mt-1 text-xs text-muted-foreground">{t('git.name.help')}</p></div>
        <div><label htmlFor="settings-git-email" className="mb-2 block text-sm font-medium">{t('git.email.label')}</label><Input id="settings-git-email" type="email" required value={gitEmail} onChange={event => { setGitEmail(event.target.value); clear('save'); }} autoComplete="email" className="min-h-11 text-base md:text-sm" /><p className="mt-1 text-xs text-muted-foreground">{t('git.email.help')}</p></div>
        <Button type="submit" disabled={!gitName.trim() || !gitEmail.trim()} className="min-h-11 max-w-full whitespace-normal">{states.save?.pending ? t('git.actions.saving') : t('git.actions.save')}</Button>
      </fieldset>
    </form>
    <SettingsFeedback state={states.save} />
  </section>;
}
