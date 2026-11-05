import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Edit3 } from 'lucide-react';
import { Button } from '../ui/button';
import WorkbenchDialog from '../ui/WorkbenchDialog';
import { useSettingsDraft } from './SettingsDraftGuard';
import SettingsFeedback from './SettingsFeedback';
import { settingsRequest, useSettingsRequest } from './useSettingsRequest';

const categories = ['general', 'preference', 'context', 'workflow'];
const actionClass = 'min-h-11 md:min-h-8 max-w-full whitespace-normal';
function MemoryFields({ id, content, category, onContent, onCategory, inputRef }) {
  const { t } = useTranslation('settings');
  return <>
    <div><label htmlFor={`${id}-content`} className="mb-2 block text-sm">{t('memorySettings.content')}</label><textarea ref={inputRef} id={`${id}-content`} required value={content} onChange={event => onContent(event.target.value)} maxLength={500} className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring md:text-sm" /></div>
    <div><label htmlFor={`${id}-category`} className="mb-2 block text-sm">{t('memorySettings.category')}</label><select id={`${id}-category`} value={category} onChange={event => onCategory(event.target.value)} className="min-h-11 max-w-full rounded-md border border-input bg-background px-3 text-base text-foreground md:text-sm">{categories.map(value => <option key={value} value={value}>{t(`memorySettings.categories.${value}`)}</option>)}</select></div>
  </>;
}
export default function MemoryContent() {
  const { t, i18n } = useTranslation('settings');
  const [memories, setMemories] = useState([]);
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('general');
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState('general');
  const [deleting, setDeleting] = useState(null);
  const newInput = useRef(null);
  const editInput = useRef(null);
  const editButtons = useRef(new Map());
  const { states, run, clear } = useSettingsRequest();
  const load = useCallback(() => run('load', () => Promise.all([settingsRequest('/api/memory'), settingsRequest('/api/memory/settings')]), ([data, settings]) => {
    setMemories(data.memories || []); setGlobalEnabled(Boolean(settings.enabled)); setLoaded(true);
  }), [run]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (editingId !== null) editInput.current?.focus(); }, [editingId]);
  const busy = states.change?.pending || states.remove?.pending || states.load?.pending;
  const editing = memories.find(item => item.id === editingId);
  const editDirty = editing && (editContent !== editing.content || editCategory !== (categories.includes(editing.category) ? editing.category : 'general'));
  useSettingsDraft(Boolean(newContent || newCategory !== 'general' || editDirty), { busy: states.change?.pending || states.remove?.pending });
  const focusEditorButton = id => requestAnimationFrame(() => editButtons.current.get(id)?.focus());
  const create = async event => {
    event.preventDefault();
    if (!newContent.trim()) return;
    const success = await run('change', () => settingsRequest('/api/memory', { method: 'POST', body: JSON.stringify({ content: newContent.trim(), category: newCategory }) }), data => {
      setMemories(previous => [data.memory, ...previous]); setNewContent(''); setNewCategory('general');
    });
    if (success) requestAnimationFrame(() => newInput.current?.focus());
  };
  const update = async event => {
    event.preventDefault();
    if (!editContent.trim()) return;
    const id = editingId;
    const success = await run('change', () => settingsRequest(`/api/memory/${id}`, { method: 'PUT', body: JSON.stringify({ content: editContent.trim(), category: editCategory }) }), data => {
      setMemories(previous => previous.map(memory => memory.id === id ? data.memory : memory)); setEditingId(null);
    });
    if (success) focusEditorButton(id);
  };
  const toggle = memory => run('change', () => settingsRequest(`/api/memory/${memory.id}/toggle`, { method: 'PATCH' }), data => setMemories(previous => previous.map(item => item.id === memory.id ? data.memory : item)));
  const remove = async () => {
    const success = await run('remove', () => settingsRequest(`/api/memory/${deleting.id}`, { method: 'DELETE' }), () => {
      setMemories(previous => previous.filter(memory => memory.id !== deleting.id)); setDeleting(null);
    });
    if (success) requestAnimationFrame(() => newInput.current?.focus());
  };
  const changed = setter => value => { setter(value); clear('change'); };
  return <div className="space-y-5" data-memory-settings>
    <div><h3 className="text-lg font-medium">{t('memorySettings.title')}</h3><p className="mt-1 text-sm text-muted-foreground">{t('memorySettings.description')}</p></div>
    <SettingsFeedback state={states.load} saved={false} onRetry={load} />
    {loaded && <>
      <Button type="button" role="switch" aria-checked={globalEnabled} variant="outline" disabled={busy} className={actionClass} onClick={() => run('change', () => settingsRequest('/api/memory/settings', { method: 'PATCH', body: JSON.stringify({ enabled: !globalEnabled }) }), () => setGlobalEnabled(value => !value))}><span className={`mr-2 h-2 w-2 shrink-0 rounded-full ${globalEnabled ? 'bg-foreground' : 'border border-muted-foreground'}`} aria-hidden="true" />{t('memorySettings.enabled')}</Button>
      {!globalEnabled && <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{t('memorySettings.disabled')}</p>}
      <form onSubmit={create} className="rounded-lg border border-border p-4"><fieldset disabled={busy} className="min-w-0 space-y-3"><h4 className="text-sm font-medium">{t('memorySettings.add')}</h4><MemoryFields id="new-memory" content={newContent} category={newCategory} onContent={changed(setNewContent)} onCategory={changed(setNewCategory)} inputRef={newInput} /><Button type="submit" disabled={!newContent.trim()} className={actionClass}><Plus className="mr-1 h-4 w-4" />{t('memorySettings.add')}</Button></fieldset></form>
      <SettingsFeedback state={states.change} />
      <div className="space-y-3"><h4 className="text-sm font-medium text-muted-foreground">{t('memorySettings.saved', { count: memories.length })}</h4>
        {memories.length === 0 ? <p className="text-sm text-muted-foreground">{t('memorySettings.empty')}</p> : memories.map(memory => <div key={memory.id} className="rounded-lg border border-border p-3" data-memory-row>
          {editingId === memory.id ? <form onSubmit={update}><fieldset disabled={busy} className="min-w-0 space-y-3"><MemoryFields id={`edit-memory-${memory.id}`} content={editContent} category={editCategory} onContent={changed(setEditContent)} onCategory={changed(setEditCategory)} inputRef={editInput} /><div className="flex flex-wrap gap-2"><Button type="submit" disabled={!editContent.trim()} className={actionClass}>{t('memorySettings.save')}</Button><Button type="button" variant="outline" className={actionClass} onClick={() => { setEditingId(null); clear('change'); focusEditorButton(memory.id); }}>{t('feedback.cancel')}</Button></div></fieldset></form> : <div className="space-y-3">
            <p className={`whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere] ${memory.is_enabled ? '' : 'text-muted-foreground'}`}>{memory.content}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="rounded border border-border px-2 py-1">{t(`memorySettings.categories.${categories.includes(memory.category) ? memory.category : 'general'}`)}</span><span>{new Date(memory.created_at).toLocaleDateString(i18n.language)}</span></div>
            <div className="flex flex-wrap items-center gap-1"><Button type="button" size="sm" variant="outline" role="switch" aria-checked={Boolean(memory.is_enabled)} aria-label={t('memorySettings.enableItem')} disabled={busy} className={actionClass} onClick={() => toggle(memory)}>{t(memory.is_enabled ? 'apiKeys.status.active' : 'apiKeys.status.inactive')}</Button><Button ref={node => { if (node) editButtons.current.set(memory.id, node); else editButtons.current.delete(memory.id); }} type="button" size="sm" variant="ghost" className={actionClass} disabled={busy} onClick={() => { clear('change'); setEditingId(memory.id); setEditContent(memory.content); setEditCategory(categories.includes(memory.category) ? memory.category : 'general'); }}><Edit3 className="mr-1 h-4 w-4" />{t('memorySettings.edit')}</Button><Button type="button" size="sm" variant="ghost" className={actionClass} disabled={busy} onClick={() => { clear('remove'); setDeleting(memory); }}><Trash2 className="mr-1 h-4 w-4" />{t('feedback.delete')}</Button></div>
          </div>}
        </div>)}
      </div>
    </>}
    {deleting && <WorkbenchDialog title={t('memorySettings.deleteTitle')} onClose={() => setDeleting(null)} busy={Boolean(states.remove?.pending)}><div className="space-y-4"><p className="break-words text-sm">{deleting.content}</p><p className="text-sm text-muted-foreground">{t('memorySettings.deleteQuestion')}</p><SettingsFeedback state={states.remove} saved={false} /><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={states.remove?.pending} onClick={() => setDeleting(null)}>{t('feedback.cancel')}</Button><Button variant="destructive" disabled={states.remove?.pending} onClick={remove}>{t('feedback.delete')}</Button></div></div></WorkbenchDialog>}
  </div>;
}
