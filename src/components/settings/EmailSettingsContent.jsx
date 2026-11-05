import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useSettingsDraft } from './SettingsDraftGuard';
import SettingsFeedback from './SettingsFeedback';
import { settingsRequest, useSettingsRequest } from './useSettingsRequest';

const fields = {
  recipient: { path: '/api/user/profile', method: 'PUT', payload: value => ({ notificationEmail: value }), read: data => data.profile?.notificationEmail || '' },
  sender: { path: '/api/settings/auto-research-email', method: 'PUT', payload: value => ({ senderEmail: value }), read: data => data.senderEmail || '' },
  delivery: { path: '/api/settings/auto-research-resend-key', method: 'PUT', payload: value => ({ apiKey: value }), read: data => data.maskedKey || '' },
};
function EmailField({ kind }) {
  const { t } = useTranslation('settings');
  const config = fields[kind];
  const secret = kind === 'delivery';
  const [value, setValue] = useState('');
  const [masked, setMasked] = useState('');
  const [saved, setSaved] = useState('');
  const [loaded, setLoaded] = useState(false);
  const { states, run, clear } = useSettingsRequest();
  const load = useCallback(() => run('load', () => settingsRequest(config.path), data => {
    if (secret) setMasked(config.read(data)); else setValue(config.read(data));
    setSaved(secret ? '' : config.read(data));
    setLoaded(true);
  }), [run, config, secret]);
  useEffect(() => { void load(); }, [load]);
  useSettingsDraft(loaded && value !== saved, { busy: states.save?.pending });
  const save = event => {
    event.preventDefault();
    if (!value.trim()) return;
    void run('save', () => settingsRequest(config.path, { method: config.method, body: JSON.stringify(config.payload(value.trim())) }), data => {
      if (secret) { setMasked(config.read(data)); setValue(''); }
      else setValue(config.read(data) || value.trim());
      setSaved(secret ? '' : config.read(data) || value.trim());
    });
  };
  return <section className="space-y-3 border-t border-border pt-4" data-email-field={kind}>
    <h4 className="text-sm font-medium">{t(`emailSettings.${kind}.title`)}</h4>
    <SettingsFeedback state={states.load} onRetry={load} saved={false} />
    <form onSubmit={save}>
      <fieldset disabled={!loaded || states.load?.pending || states.save?.pending} className="min-w-0 space-y-3">
        <div><label htmlFor={`email-${kind}`} className="mb-2 block text-sm">{t(`emailSettings.${kind}.label`)}</label>
          <Input id={`email-${kind}`} type={secret ? 'password' : 'email'} required value={value} onChange={event => { setValue(event.target.value); clear('save'); }} autoComplete={secret ? 'new-password' : 'email'} className="min-h-11 text-base md:text-sm" aria-describedby={`email-${kind}-help`} />
          <p id={`email-${kind}-help`} className="mt-2 text-xs leading-relaxed text-muted-foreground">{t(`emailSettings.${kind}.help`)}</p>
          {secret && masked && <p className="mt-2 break-all text-xs text-muted-foreground">{t('emailSettings.configuredKey', { key: masked })}</p>}
        </div>
        <Button type="submit" variant="outline" disabled={!value.trim()} className="min-h-11 max-w-full whitespace-normal">{t(`emailSettings.${kind}.save`)}</Button>
      </fieldset>
    </form>
    <SettingsFeedback state={states.save} />
  </section>;
}
export default function EmailSettingsContent() {
  const { t } = useTranslation('settings');
  return <div className="space-y-5" data-email-settings>
    <div><h3 className="text-lg font-medium">{t('emailSettings.title')}</h3><p className="mt-1 text-sm text-muted-foreground">{t('emailSettings.description')}</p></div>
    {Object.keys(fields).map(kind => <EmailField key={kind} kind={kind} />)}
  </div>;
}
