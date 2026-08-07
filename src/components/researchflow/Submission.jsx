// Submission workspace (Phase 4) — profile, readiness, grouped checklist,
// and the explicit Mark-as-Submitted action. Readiness is computed by the
// backend; Submitted is a privileged human action with confirmation.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, CheckCircle2, Plus, Send, X } from 'lucide-react';
import { api } from '../../utils/api';

const CATEGORY_ORDER = ['paper', 'experiments', 'artifacts', 'portal'];

export default function Submission({ projectId }) {
  const { t } = useTranslation('researchflow');
  const [profiles, setProfiles] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ venue: '', deadline: '', anonymous: false });
  const [confirmSubmitted, setConfirmSubmitted] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.rf.listSubmissions(projectId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()).data;
      setProfiles(data);
      if (data.length > 0 && !selectedId) setSelectedId(data[0].id);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [projectId, selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runMutation = async (mutator) => {
    setBusy(true);
    setError(null);
    try {
      await mutator();
      await load();
    } catch (mutationError) {
      setError(mutationError.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = () =>
    runMutation(async () => {
      await api.rf.createSubmissionProfile(projectId, form);
      setShowForm(false);
      setForm({ venue: '', deadline: '', anonymous: false });
    });

  const handleMarkSubmitted = () =>
    runMutation(async () => {
      const res = await api.rf.markSubmitted(selectedId, { confirmation: true });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${res.status}`);
      }
      setConfirmSubmitted(false);
    });

  if (error && !profiles) return <div className="p-4 text-sm text-red-500">{error}</div>;
  if (!profiles) return <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>;

  if (profiles.length === 0) {
    return (
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-foreground">{t('submission.title')}</h2>
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-accent"
          >
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {t('submission.newProfile')}
          </button>
        </div>
        {showForm && <ProfileForm form={form} setForm={setForm} onCreate={handleCreate} busy={busy} t={t} />}
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t('submission.noProfiles')}
        </div>
      </div>
    );
  }

  const profile = profiles.find((entry) => entry.id === selectedId) || profiles[0];
  const readiness = profile.readiness;

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-foreground">{t('submission.title')}</h2>
        <div className="flex items-center gap-1.5">
          {profiles.length > 1 && (
            <select
              value={profile.id}
              onChange={(e) => setSelectedId(e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
            >
              {profiles.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.venue}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-accent"
          >
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {t('submission.newProfile')}
          </button>
        </div>
      </div>

      {showForm && <ProfileForm form={form} setForm={setForm} onCreate={handleCreate} busy={busy} t={t} />}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-lg font-bold text-foreground">{profile.venue}</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {profile.track && <span>{profile.track}</span>}
              {profile.anonymous && <span>{t('submission.anonymous')}</span>}
              {profile.deadline && (
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3 w-3" />
                  {profile.deadline}
                </span>
              )}
            </div>
          </div>
          <span className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold ${
            profile.status === 'submitted'
              ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400'
              : readiness.ready
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400'
          }`}>
            {profile.status === 'submitted' ? t('submission.submitted') : readiness.ready ? t('submission.ready') : t('submission.notReady')}
          </span>
        </div>

        {profile.status === 'submitted' && (
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>{t('submission.submittedAt')}: {profile.submittedAt}</span>
            {profile.finalPaperPath && <span className="font-mono">{profile.finalPaperPath}</span>}
            {profile.externalSubmissionId && <span>{profile.externalSubmissionId}</span>}
          </div>
        )}

        {!readiness.ready && profile.status !== 'submitted' && (
          <div className="mt-2 space-y-0.5">
            <div className="text-xs font-medium text-muted-foreground">{t('submission.blockers')} ({readiness.blockers.length})</div>
            {readiness.blockers.map((blocker, index) => (
              <div key={index} className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
                <span>•</span>
                <span>{blocker.message}</span>
              </div>
            ))}
          </div>
        )}

        {profile.status !== 'submitted' && (
          <div className="mt-3">
            {confirmSubmitted ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2 dark:border-red-500/30 dark:bg-red-500/10">
                <span className="text-xs text-red-700 dark:text-red-400">{t('submission.confirmation')}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleMarkSubmitted}
                  className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  <Send className="inline h-3 w-3" /> {t('submission.markSubmitted')}
                </button>
                <button type="button" onClick={() => setConfirmSubmitted(false)} className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent">
                  {t('common.cancel')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmSubmitted(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                <Send className="h-3.5 w-3.5" />
                {t('submission.markSubmitted')}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
          {t('submission.checklist')}: {readiness.requiredChecks ?? profile.items.filter((item) => item.required).length}/{profile.items.filter((item) => item.required).length} {t('submission.requiredChecks')}
        </span>
      </div>

      <Checklist
        items={profile.items}
        t={t}
        busy={busy}
        disabled={profile.status === 'submitted'}
        onToggleStatus={(itemId, status) => runMutation(() => api.rf.updateSubmissionItem(itemId, { status }))}
      />
    </div>
  );
}

function ProfileForm({ form, setForm, onCreate, busy, t }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
      <input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder={t('submission.venue')} className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 outline-none focus:border-primary" />
      <div className="flex flex-wrap gap-2">
        <input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1.5" />
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={form.anonymous} onChange={(e) => setForm({ ...form, anonymous: e.target.checked })} />
          {t('submission.anonymous')}
        </label>
        <button type="button" disabled={busy || !form.venue.trim()} onClick={onCreate} className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50">
          {t('submission.add')}
        </button>
      </div>
    </div>
  );
}

function Checklist({ items, t, busy, disabled, onToggleStatus }) {
  return (
    <div className="space-y-3">
      {CATEGORY_ORDER.map((category) => {
        const categoryItems = items.filter((item) => item.category === category);
        if (categoryItems.length === 0) return null;
        const done = categoryItems.filter((item) => item.status === 'done' || item.status === 'waived').length;
        return (
          <div key={category} className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-semibold text-foreground">{t(`submission.categories.${category}`)}</span>
              <span className="text-xs text-muted-foreground">{done}/{categoryItems.length}</span>
            </div>
            {categoryItems.map((item) => (
              <div key={item.id} className="flex items-center gap-2 border-b border-border/50 px-3 py-2 last:border-b-0">
                <button
                  type="button"
                  disabled={busy || disabled}
                  onClick={() => onToggleStatus(item.id, item.status === 'done' ? 'todo' : 'done')}
                  className={`inline-flex h-4 w-4 items-center justify-center rounded border ${
                    item.status === 'done'
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-border'
                  }`}
                >
                  {item.status === 'done' && <CheckCircle2 className="h-3 w-3" />}
                </button>
                <span className={`text-sm ${item.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                  {item.title}
                </span>
                {item.required ? (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t('submission.required')}</span>
                ) : (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t('submission.optional')}</span>
                )}
                {item.status === 'waived' && (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">{t('submission.itemStatuses.waived')}</span>
                )}
                <div className="ml-auto">
                  {item.status === 'waived' ? (
                    <button type="button" disabled={busy || disabled} onClick={() => onToggleStatus(item.id, 'todo')} className="rounded-lg border border-border px-2 py-0.5 text-xs hover:bg-accent">
                      {t('submission.unwaive')}
                    </button>
                  ) : (
                    <button type="button" disabled={busy || disabled} onClick={() => onToggleStatus(item.id, 'waived')} className="rounded-lg border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent">
                      {t('submission.waive')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
