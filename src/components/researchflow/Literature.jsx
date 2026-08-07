// Literature (Phase 3) — compact reference list with search + filters.
// Not a Zotero replacement: title/authors/relation/read-status/priority only.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Plus, X } from 'lucide-react';
import { api } from '../../utils/api';

export default function Literature({ projectId }) {
  const { t } = useTranslation('researchflow');
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', authors: '', year: '', venue: '', url: '', relation: 'baseline', readStatus: 'inbox', priority: 'medium', keyFinding: '' });
  const [search, setSearch] = useState('');
  const [filterRelation, setFilterRelation] = useState('all');
  const [filterRead, setFilterRead] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.rf.listLiterature(projectId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEntries((await res.json()).data);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = () =>
    Promise.resolve(setBusy(true))
      .then(async () => {
        await api.rf.createLiterature(projectId, {
          ...form,
          year: form.year ? Number(form.year) : null,
        });
        setShowForm(false);
        setForm({ title: '', authors: '', year: '', venue: '', url: '', relation: 'baseline', readStatus: 'inbox', priority: 'medium', keyFinding: '' });
        await load();
      })
      .catch((mutationError) => setError(mutationError.message))
      .finally(() => setBusy(false));

  if (error && !entries) return <div className="p-4 text-sm text-red-500">{error}</div>;
  if (!entries) return <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>;

  const filtered = entries.filter((entry) => {
    if (search && !`${entry.title} ${entry.authors || ''} ${entry.venue || ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterRelation !== 'all' && entry.relation !== filterRelation) return false;
    if (filterRead !== 'all' && entry.readStatus !== filterRead) return false;
    if (filterPriority !== 'all' && entry.priority !== filterPriority) return false;
    return true;
  });

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-foreground">{t('literature.title')}</h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-accent"
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {t('literature.newEntry')}
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('literature.search')}
          className="w-48 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
        />
        <select value={filterRelation} onChange={(e) => setFilterRelation(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
          <option value="all">{t('literature.relation')}: all</option>
          {['closest_work', 'baseline', 'background', 'method_inspiration', 'evaluation', 'dataset', 'contradictory_evidence'].map((relation) => (
            <option key={relation} value={relation}>{t(`literature.relations.${relation}`)}</option>
          ))}
        </select>
        <select value={filterRead} onChange={(e) => setFilterRead(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
          <option value="all">{t('literature.readStatus')}: all</option>
          {['inbox', 'skimmed', 'read', 'deep_read', 'cited'].map((status) => (
            <option key={status} value={status}>{t(`literature.readStatuses.${status}`)}</option>
          ))}
        </select>
        <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
          <option value="all">{t('literature.priority')}: all</option>
          {['critical', 'high', 'medium', 'low'].map((priority) => (
            <option key={priority} value={priority}>{t(`tasks.priority_${priority}`)}</option>
          ))}
        </select>
      </div>

      {showForm && (
        <div className="mb-3 space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t('literature.titleCol')} className="rounded-lg border border-border bg-background px-2.5 py-1.5 outline-none focus:border-primary" />
            <input value={form.authors} onChange={(e) => setForm({ ...form, authors: e.target.value })} placeholder={t('literature.authors')} className="rounded-lg border border-border bg-background px-2.5 py-1.5 outline-none focus:border-primary" />
            <input value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder={t('literature.year')} className="rounded-lg border border-border bg-background px-2.5 py-1.5 outline-none focus:border-primary" />
            <input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder={t('literature.venue')} className="rounded-lg border border-border bg-background px-2.5 py-1.5 outline-none focus:border-primary" />
            <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder={t('literature.url')} className="rounded-lg border border-border bg-background px-2.5 py-1.5 outline-none focus:border-primary" />
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1.5">
              {['closest_work', 'baseline', 'background', 'method_inspiration', 'evaluation', 'dataset', 'contradictory_evidence'].map((relation) => (
                <option key={relation} value={relation}>{t(`literature.relations.${relation}`)}</option>
              ))}
            </select>
            <select value={form.readStatus} onChange={(e) => setForm({ ...form, readStatus: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1.5">
              {['inbox', 'skimmed', 'read', 'deep_read', 'cited'].map((status) => (
                <option key={status} value={status}>{t(`literature.readStatuses.${status}`)}</option>
              ))}
            </select>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1.5">
              {['critical', 'high', 'medium', 'low'].map((priority) => (
                <option key={priority} value={priority}>{t(`tasks.priority_${priority}`)}</option>
              ))}
            </select>
            <button type="button" disabled={busy || !form.title.trim()} onClick={handleCreate} className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50">
              {t('literature.add')}
            </button>
          </div>
        </div>
      )}

      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">{error}</div>}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t('literature.noEntries')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t('literature.titleCol')}</th>
                <th className="px-3 py-2 font-medium">{t('literature.yearVenue')}</th>
                <th className="px-3 py-2 font-medium">{t('literature.relation')}</th>
                <th className="px-3 py-2 font-medium">{t('literature.readStatus')}</th>
                <th className="px-3 py-2 font-medium">{t('literature.priority')}</th>
                <th className="px-3 py-2 font-medium">{t('literature.keyFinding')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id} className="border-t border-border hover:bg-accent/40">
                  <td className="max-w-[280px] px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-medium text-foreground" title={entry.title}>{entry.title}</span>
                    </div>
                    {entry.authors && <div className="mt-0.5 text-xs text-muted-foreground">{entry.authors}</div>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {[entry.year, entry.venue].filter(Boolean).join(' / ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{entry.relation ? t(`literature.relations.${entry.relation}`) : '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{t(`literature.readStatuses.${entry.readStatus}`)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{t(`tasks.priority_${entry.priority}`)}</td>
                  <td className="max-w-[240px] truncate px-3 py-2 text-muted-foreground" title={entry.keyFinding || ''}>
                    {entry.keyFinding || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
