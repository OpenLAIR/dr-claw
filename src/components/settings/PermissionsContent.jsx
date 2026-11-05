import { useId, useRef } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { AlertTriangle, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Common tool patterns for Claude
const commonClaudeTools = [
  'Bash(git log:*)',
  'Bash(git diff:*)',
  'Bash(git status:*)',
  'Write',
  'Read',
  'Edit',
  'Glob',
  'Grep',
  'MultiEdit',
  'Task',
  'TodoWrite',
  'TodoRead',
  'WebFetch',
  'WebSearch'
];

// Common tool patterns for Gemini CLI (official native tool names)
const commonGeminiTools = [
  'run_shell_command',
  'read_file',
  'read_many_files',
  'write_file',
  'replace',
  'glob',
  'grep_search',
  'list_directory',
  'write_todos',
  'ask_user',
  'google_web_search',
  'web_fetch',
  'activate_skill',
  'save_memory',
  'get_internal_docs',
  'enter_plan_mode',
  'exit_plan_mode',
  'complete_task'
];

// Common shell commands for Cursor
const commonCursorCommands = [
  'Shell(ls)',
  'Shell(mkdir)',
  'Shell(cd)',
  'Shell(cat)',
  'Shell(echo)',
  'Shell(git status)',
  'Shell(git diff)',
  'Shell(git log)',
  'Shell(npm install)',
  'Shell(npm run)',
  'Shell(python)',
  'Shell(node)'
];

const permissionModes = ['default', 'acceptEdits', 'bypassPermissions'];

function PermissionList({ section, items, setItems, draft, setDraft, suggestions = [] }) {
  const { t } = useTranslation('settings');
  const id = useId();
  const input = useRef(null);
  const prefix = `permissions.${section}`;
  const add = (value) => {
    const normalized = value.trim();
    if (!normalized || items.includes(normalized)) return;
    setItems(previous => previous.includes(normalized) ? previous : [...previous, normalized]);
    setDraft('');
    input.current?.focus();
  };
  return <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-3">
    <div className="space-y-1">
      <h3 id={`${id}-title`} className="text-base font-semibold">{t(`${prefix}.title`)}</h3>
      <p id={`${id}-help`} className="text-sm text-muted-foreground">{t(`${prefix}.description`)}</p>
    </div>
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">{t(`${prefix}.inputLabel`)}</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input ref={input} id={id} aria-describedby={`${id}-help`} value={draft} onChange={event => setDraft(event.target.value)} placeholder={t(`${prefix}.placeholder`)} className="h-11 min-h-11 min-w-0 flex-1" onFocus={event => {
          const field = event.currentTarget;
          const footer = field.closest('dialog')?.querySelector('[data-settings-footer]');
          if (footer && field.getBoundingClientRect().bottom > footer.getBoundingClientRect().top - 8) {
            field.scrollIntoView({ block: 'center' });
          }
        }} onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault(); add(draft);
          }
        }} />
        <Button type="button" className="min-h-11" disabled={!draft.trim() || items.includes(draft.trim())} onClick={() => add(draft)}><Plus className="h-4 w-4" />{t('permissions.actions.add')}</Button>
      </div>
    </div>
    {suggestions.length > 0 && <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{t(`${prefix}.quickAdd`)}</p>
      <div className="flex flex-wrap gap-2">{suggestions.map(value => <Button type="button" key={value} variant="outline" className="min-h-11 h-auto max-w-full whitespace-normal break-all py-2 text-xs" disabled={items.includes(value)} onClick={() => add(value)}>{value}</Button>)}</div>
    </div>}
    {items.length > 0 ? <ul className="divide-y divide-border rounded-md border border-border">{items.map(value => <li key={value} className="flex items-center justify-between gap-2 px-3 py-1">
      <code className="min-w-0 break-all text-sm">{value}</code>
      <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11 shrink-0 text-muted-foreground" aria-label={t('permissions.actions.remove', { value })} onClick={() => { setItems(previous => previous.filter(item => item !== value)); input.current?.focus(); }}><X className="h-4 w-4" /></Button>
    </li>)}</ul> : <p className="py-2 text-sm text-muted-foreground">{t(`${prefix}.empty`)}</p>}
  </section>;
}

function SkipPermissions({ agent, checked, onChange }) {
  const { t } = useTranslation('settings');
  return <section className="space-y-3">
    <h3 className="text-base font-semibold">{t('permissions.title')}</h3>
    <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${checked ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30' : 'border-border'}`}>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" />
      <span className="min-w-0 space-y-1"><span className="block font-medium">{t('permissions.skipPermissions.label')}</span><span className="block text-sm text-muted-foreground">{t(`permissions.skipPermissions.${agent}Description`)}</span></span>
      {checked && <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />}
    </label>
  </section>;
}

function PermissionModes({ agent, value, onChange }) {
  const { t } = useTranslation('settings');
  const id = useId();
  const prefix = `permissions.${agent}`;
  return <fieldset className="min-w-0 space-y-3">
    <legend className="text-base font-semibold">{t(`${prefix}.permissionMode`)}</legend>
    <p className="text-sm text-muted-foreground">{t(`${prefix}.description`)}</p>
    {permissionModes.map(mode => <label key={mode} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${value === mode ? mode === 'bypassPermissions' ? 'border-amber-500 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30' : 'border-foreground/50 bg-muted' : 'border-border hover:bg-muted/50'}`}>
      <input type="radio" name={id} value={mode} checked={value === mode} onChange={() => onChange(mode)} className="mt-1 h-4 w-4 shrink-0 accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" />
      <span className="min-w-0 space-y-1"><span className="block font-medium">{t(`${prefix}.modes.${mode}.title`)}</span><span className="block text-sm text-muted-foreground">{t(`${prefix}.modes.${mode}.description`)}</span></span>
      {mode === 'bypassPermissions' && <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />}
    </label>)}
    <details className="text-sm">
      <summary className="min-h-11 cursor-pointer py-3 text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{t(`${prefix}.technicalDetails`)}</summary>
      <div className="space-y-2 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">{permissionModes.map(mode => <p key={mode}><strong>{t(`${prefix}.modes.${mode}.title`)}:</strong> {t(`${prefix}.technicalInfo.${mode}`)}</p>)}{agent === 'codex' && <p>{t(`${prefix}.technicalInfo.overrideNote`)}</p>}</div>
    </details>
  </fieldset>;
}

const examples = {
  claude: { prefix: 'toolExamples', rows: [['Bash(git log:*)', 'bashGitLog'], ['Bash(git diff:*)', 'bashGitDiff'], ['Write', 'write'], ['Bash(rm:*)', 'bashRm']] },
  cursor: { prefix: 'shellExamples', rows: [['Shell(ls)', 'ls'], ['Shell(git status)', 'gitStatus'], ['Shell(npm install)', 'npmInstall'], ['Shell(rm -rf)', 'rmRf']] },
};

export default function PermissionsContent({ agent, ...props }) {
  const { t } = useTranslation('settings');
  if (!['claude', 'cursor', 'codex', 'gemini'].includes(agent)) return null;
  const commands = agent === 'cursor';
  const allowed = commands ? 'allowedCommands' : 'allowedTools';
  const blocked = commands ? 'disallowedCommands' : 'disallowedTools';
  const allowedDraft = commands ? 'newAllowedCommand' : 'newAllowedTool';
  const blockedDraft = commands ? 'newDisallowedCommand' : 'newDisallowedTool';
  const setter = name => props[`set${name[0].toUpperCase()}${name.slice(1)}`];
  const help = examples[agent];
  return <div data-permissions={agent} className="min-w-0 space-y-6">
    {agent === 'claude' || commands ? <SkipPermissions agent={agent} checked={props.skipPermissions} onChange={props.setSkipPermissions} /> : <PermissionModes agent={agent} value={props.permissionMode} onChange={props.setPermissionMode} />}
    {agent !== 'codex' && <>
      <PermissionList section={commands ? 'allowedCommands' : 'allowedTools'} items={props[allowed]} setItems={setter(allowed)} draft={props[allowedDraft]} setDraft={setter(allowedDraft)} suggestions={commands ? commonCursorCommands : agent === 'gemini' ? commonGeminiTools : commonClaudeTools} />
      <PermissionList section={commands ? 'blockedCommands' : 'blockedTools'} items={props[blocked]} setItems={setter(blocked)} draft={props[blockedDraft]} setDraft={setter(blockedDraft)} />
    </>}
    {help && <section className="space-y-2 border-t border-border pt-4">
      <h4 className="font-medium">{t(`permissions.${help.prefix}.title`)}</h4>
      <ul className="space-y-2 text-sm text-muted-foreground">{help.rows.map(([code, key]) => <li key={key}><code className="break-all text-foreground">{code}</code> {t(`permissions.${help.prefix}.${key}`)}</li>)}</ul>
    </section>}
  </div>;
}
