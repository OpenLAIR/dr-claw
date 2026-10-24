import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import WorkbenchDialog from '../ui/WorkbenchDialog';
import SettingsFeedback from './SettingsFeedback';
import { useSettingsRequest } from './useSettingsRequest';
import { useSettingsDraft } from './SettingsDraftGuard';

export default function McpServersContent({ agent, servers, loadState, onRefresh, onAdd, onEdit, onDelete }) {
  const { t } = useTranslation('settings');
  const [removing, setRemoving] = useState(null);
  const { states, run, clear } = useSettingsRequest();
  const add = useRef(null);
  const busy = Boolean(states.remove?.pending);
  useSettingsDraft(false, { busy });
  const canWrite = agent !== 'cursor';
  const close = () => { if (!busy) { setRemoving(null); clear('remove'); } };
  const remove = async () => {
    const result = await run('remove', () => onDelete(removing));
    if (result) { setRemoving(null); requestAnimationFrame(() => add.current?.focus()); }
  };
  return <section data-mcp-settings={agent} className="min-w-0 space-y-4">
    <div className="space-y-2"><h3 className="text-lg font-semibold">{t('mcpServers.title')}</h3><p className="text-sm text-muted-foreground">{t(`mcpServers.description.${agent}`)}</p></div>
    <div className="flex flex-wrap gap-2">
      {canWrite && <Button ref={add} onClick={onAdd} className="min-h-11"><Plus className="mr-2 h-4 w-4" />{t('mcpServers.addButton')}</Button>}
      <Button variant="outline" className="min-h-11" disabled={loadState?.pending} onClick={onRefresh}><RefreshCw className="mr-2 h-4 w-4" />{t('mcpServers.refresh')}</Button>
    </div>
    {!canWrite && <p className="text-sm text-muted-foreground">{t('mcpServers.cursorReadOnly')}</p>}
    <SettingsFeedback state={loadState?.error ? { error: t('mcpServers.loadFailed') } : loadState} onRetry={onRefresh} saved={false} />
    <div className="divide-y divide-border">
      {servers.map(server => <article key={server.id || server.name} data-mcp-server className="min-w-0 space-y-3 py-4">
        <div className="space-y-1"><h4 className="break-words text-sm font-semibold">{server.name}</h4><p className="text-xs text-muted-foreground">{server.type || 'stdio'} · {t(server.scope === 'local' ? 'mcpServers.scope.local' : 'mcpServers.scope.user')}</p></div>
        <dl className="space-y-2 text-sm">
          {[['command', server.config?.command], ['url', server.config?.url], ['args', server.config?.args?.join(' ')], ['environment', Object.keys(server.config?.env || {}).join(', ')]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{t(`mcpServers.config.${label}`)}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}
        </dl>
        {canWrite && <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11" disabled={agent === 'codex' && server.type !== 'stdio'} onClick={() => onEdit(server)}>{t('mcpServers.actions.edit')}</Button>
          <Button variant="ghost" className="min-h-11 text-destructive" onClick={() => { clear('remove'); setRemoving(server); }}>{t('mcpServers.actions.delete')}</Button>
        </div>}
        {agent === 'codex' && server.type !== 'stdio' && <p className="text-sm text-muted-foreground">{t('mcpServers.remoteReadOnly')}</p>}
      </article>)}
    </div>
    {loadState?.success && servers.length === 0 && <p className="py-6 text-sm text-muted-foreground">{t('mcpServers.empty')}</p>}
    {removing && <WorkbenchDialog title={t('mcpServers.actions.delete')} onClose={close} busy={busy}>
      <div className="space-y-4"><p className="break-words text-sm">{t('mcpServers.deleteConfirm', { name: removing.name })}</p><SettingsFeedback state={states.remove} saved={false} />
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" className="min-h-11" disabled={busy} onClick={close}>{t('feedback.cancel')}</Button><Button variant="destructive" className="min-h-11" disabled={busy} onClick={remove}>{t('feedback.delete')}</Button></div>
      </div>
    </WorkbenchDialog>}
  </section>;
}
