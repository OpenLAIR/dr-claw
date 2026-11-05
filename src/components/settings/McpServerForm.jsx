import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import WorkbenchDialog from '../ui/WorkbenchDialog';
import { Button } from '../ui/button';
import SettingsFeedback from './SettingsFeedback';

const pairsText = value => Object.entries(value || {}).map(([key, item]) => `${key}=${item}`).join('\n');
export const withMcpTextDrafts = data => ({ ...data, argsText: (data.config?.args || []).join('\n'), envText: pairsText(data.config?.env), headersText: pairsText(data.config?.headers) });
const pairs = text => Object.fromEntries((text || '').split('\n').filter(line => line.trim()).map(line => {
  const separator = line.indexOf('=');
  if (separator < 1 || !line.slice(0, separator).trim()) throw new Error('Use KEY=value on each line.');
  return [line.slice(0, separator).trim(), line.slice(separator + 1)];
}));
export const parseMcpTextDrafts = data => ({ ...data, config: { ...data.config, args: (data.argsText || '').split('\n').filter(line => line.trim()), env: pairs(data.envText), headers: pairs(data.headersText) } });

export default function McpServerForm({ agent, data, setData, editing, projects, pending, error, onSubmit, onClose }) {
  const { t } = useTranslation('settings');
  const prefix = useId();
  const nameInput = useRef(null);
  useEffect(() => { nameInput.current?.focus(); }, []);
  const codex = agent === 'codex';
  const json = !codex && data.importMode === 'json';
  const remote = !codex && ['http', 'sse'].includes(data.type);
  const patch = values => setData(previous => ({ ...previous, ...values }));
  const config = (key, value) => setData(previous => ({ ...previous, config: { ...previous.config, [key]: value } }));
  const control = 'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
  const field = (name, child) => <div className="space-y-2"><label htmlFor={`${prefix}-${name}`} className="block text-sm font-medium">{t(`mcpForm.fields.${name}`)}</label>{child(`${prefix}-${name}`)}</div>;
  return <WorkbenchDialog title={editing ? t('mcpForm.title.edit') : t('mcpForm.title.add')} onClose={onClose} busy={pending}>
    <form onSubmit={onSubmit} data-mcp-form={agent} className="space-y-4">
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        {!codex && !editing && <div className="flex gap-2" role="group" aria-label={t('mcpForm.importMode.label')}>
          {['form', 'json'].map(mode => <Button key={mode} type="button" variant={data.importMode === mode ? 'default' : 'outline'} className="min-h-11 flex-1" aria-pressed={data.importMode === mode} onClick={() => patch({ importMode: mode })}>{t(`mcpForm.importMode.${mode}`)}</Button>)}
        </div>}
        {!codex && <div className="space-y-2">
          <label htmlFor={`${prefix}-scope`} className="block text-sm font-medium">{t('mcpForm.scope.label')}</label>
          <select id={`${prefix}-scope`} value={data.scope} disabled={!!editing} onChange={event => patch({ scope: event.target.value, projectPath: '' })} className={control}>
            <option value="user">{t('mcpForm.scope.userGlobal')}</option><option value="local">{t('mcpForm.scope.projectLocal')}</option>
          </select>
          {editing && <p className="text-sm text-muted-foreground">{t('mcpForm.scope.cannotChange')}</p>}
          {data.scope === 'local' && (editing ? <p className="break-words text-sm text-muted-foreground">{data.projectPath}</p> : field('selectProject', id => <select id={id} required value={data.projectPath} onChange={event => patch({ projectPath: event.target.value })} className={control}><option value="">{t('mcpForm.fields.selectProject')}</option>{projects.map(project => <option key={project.name} value={project.path || project.fullPath}>{project.displayName || project.name}</option>)}</select>))}
        </div>}
        {field('serverName', id => <input id={id} ref={nameInput} required value={data.name} onChange={event => patch({ name: event.target.value })} placeholder="my-server" className={control} />)}
        {json ? field('jsonConfig', id => <textarea id={id} required value={data.jsonInput} onChange={event => patch({ jsonInput: event.target.value })} rows={8} spellCheck={false} className={`${control} font-mono`} />) : <>
          {!codex && field('transportType', id => <select id={id} value={data.type} onChange={event => patch({ type: event.target.value })} className={control}>{['stdio','http','sse'].map(type => <option key={type} value={type}>{type}</option>)}</select>)}
          {remote ? field('url', id => <input id={id} type="url" required value={data.config?.url || ''} onChange={event => config('url', event.target.value)} className={control} />) : <>
            {field('command', id => <input id={id} required value={data.config?.command || ''} onChange={event => config('command', event.target.value)} placeholder="/path/to/mcp-server" className={control} />)}
            {field('arguments', id => <textarea id={id} value={data.argsText || ''} onChange={event => patch({ argsText: event.target.value })} rows={3} placeholder={'--port\n3000'} spellCheck={false} className={control} />)}
            {field('envVars', id => <textarea id={id} value={data.envText || ''} onChange={event => patch({ envText: event.target.value })} rows={3} placeholder={'API_KEY=value\nDEBUG=true'} spellCheck={false} className={control} />)}
          </>}
          {remote && field('headers', id => <textarea id={id} value={data.headersText || ''} onChange={event => patch({ headersText: event.target.value })} rows={3} spellCheck={false} className={control} />)}
        </>}
      </fieldset>
      <SettingsFeedback state={error ? { error } : pending ? { pending } : null} />
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={onClose}>{t('mcpForm.actions.cancel')}</Button>
        <Button type="submit" className="min-h-11" disabled={pending}>{pending ? t('mcpForm.actions.saving') : editing ? t('mcpForm.actions.updateServer') : t('mcpForm.actions.addServer')}</Button>
      </div>
    </form>
  </WorkbenchDialog>;
}
