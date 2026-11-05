import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktop } from '../../hooks/useDesktop';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import SettingsFeedback from './SettingsFeedback';
import { settingsRequest, useSettingsRequest } from './useSettingsRequest';
import { useSettingsDraft } from './SettingsDraftGuard';

export default function WorkspaceRootSettings() {
  const { t } = useTranslation('settings');
  const { isDesktop, selectDirectory } = useDesktop();
  const { states, run, clear } = useSettingsRequest();
  const [path, setPath] = useState('');
  const [saved, setSaved] = useState(null);
  const [defaultPath, setDefaultPath] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState('');
  const alive = useRef(false);
  const controller = useRef(null);
  const busy = Boolean(states.write?.pending || browsing);
  const ready = saved !== null;
  useSettingsDraft(ready && path !== saved, { busy });
  const load = () => run('read', () => {
    controller.current?.abort(); controller.current = new AbortController();
    return settingsRequest('/api/projects/workspace-root', { signal: controller.current.signal });
  }, data => {
    if (typeof data.path !== 'string' && data.path != null) throw new Error('Invalid workspace path response.');
    setPath(data.path || ''); setSaved(data.path || ''); setDefaultPath(data.defaultPath || '');
  });
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const edit = value => { setPath(value); clear('write'); setBrowseError(''); };
  const save = value => run('write', () => settingsRequest('/api/projects/workspace-root', { method: 'PUT', body: JSON.stringify({ path: value || null }) }), data => {
    setPath(data.path || ''); setSaved(data.path || ''); if (data.defaultPath) setDefaultPath(data.defaultPath);
  });
  const browse = async () => {
    setBrowsing(true); setBrowseError(''); clear('write');
    try {
      const selected = await selectDirectory({ title: t('appearanceSettings.defaultProjectPath.browseTitle'), defaultPath: path || defaultPath || undefined });
      if (alive.current && selected) edit(selected);
    } catch (error) { if (alive.current) setBrowseError(error.message); }
    finally { if (alive.current) setBrowsing(false); }
  };
  return <section data-workspace-root-settings className="space-y-3 rounded-lg border border-border p-4">
    <div className="space-y-1"><label htmlFor="settings-workspace-root" className="block font-medium">{t('appearanceSettings.defaultProjectPath.label')}</label><p className="text-sm text-muted-foreground">{t('appearanceSettings.defaultProjectPath.description')}</p></div>
    <SettingsFeedback state={states.read} onRetry={load} saved={false} failureMessage={t('appearanceSettings.defaultProjectPath.loadFailed')} />
    <form onSubmit={event => { event.preventDefault(); if (ready && !busy && path !== saved) save(path); }} className="space-y-3">
      <Input id="settings-workspace-root" disabled={!ready || busy} value={path} onChange={event => edit(event.target.value)} placeholder={defaultPath} className="min-h-11 min-w-0 w-full" />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" disabled={!ready || busy || path === saved}>{t('appearanceSettings.defaultProjectPath.save')}</Button>
        {isDesktop && <Button type="button" variant="outline" className="min-h-11" disabled={!ready || busy} onClick={browse}>{t('appearanceSettings.defaultProjectPath.browse')}</Button>}
        <Button type="button" variant="outline" className="min-h-11" disabled={!ready || busy} onClick={() => save(null)}>{t('appearanceSettings.defaultProjectPath.reset')}</Button>
      </div>
    </form>
    <SettingsFeedback state={states.write || (browseError ? { error: browseError } : null)} />
  </section>;
}
