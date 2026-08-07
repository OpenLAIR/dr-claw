// Manuscript workspace (Phase 4) — sub-tabs: Sections | Results Freeze |
// Internal Review. All completeness/readiness/staleness come from the backend;
// the UI only performs explicit human actions (status transitions, freeze
// creation, resolve/reopen).

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Plus, Snowflake, X } from 'lucide-react';
import { api } from '../../utils/api';

const SECTION_STATUS_COLOR = {
  not_started: 'text-muted-foreground',
  outline: 'text-muted-foreground',
  draft: 'text-sky-600 dark:text-sky-400',
  internal_review: 'text-amber-600 dark:text-amber-400',
  revised: 'text-violet-600 dark:text-violet-400',
  final: 'text-emerald-600 dark:text-emerald-400 font-semibold',
};

const SEVERITY_COLOR = {
  minor: 'text-muted-foreground',
  major: 'text-amber-600 dark:text-amber-400',
  critical: 'text-red-600 dark:text-red-400 font-semibold',
};

const REVIEW_STATUS_COLOR = {
  open: 'text-red-600 dark:text-red-400',
  in_progress: 'text-amber-600 dark:text-amber-400',
  resolved: 'text-emerald-600 dark:text-emerald-400',
  wont_fix: 'text-muted-foreground',
};

const SUBTABS = ['sections', 'freeze', 'review'];

export default function Manuscript({ projectId }) {
  const { t } = useTranslation('researchflow');
  const [subtab, setSubtab] = useState('sections');

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-0.5 border-b border-border px-3 py-1.5">
        {SUBTABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSubtab(key)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              subtab === key ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/50'
            }`}
          >
            {key === 'sections' ? t('manuscript.sections') : key === 'freeze' ? t('manuscript.freeze.title') : t('manuscript.review.title')}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {subtab === 'sections' && <SectionsTab projectId={projectId} t={t} />}
        {subtab === 'freeze' && <FreezeTab projectId={projectId} t={t} />}
        {subtab === 'review' && <ReviewTab projectId={projectId} t={t} />}
      </div>
    </div>
  );
}

function SectionsTab({ projectId, t }) {
  const [manuscript, setManuscript] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.rf.getManuscript(projectId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setManuscript((await res.json()).data);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleInitialize = () =>
    Promise.resolve(setBusy(true))
      .then(async () => {
        await api.rf.initializeManuscript(projectId);
        await load();
      })
      .catch((mutationError) => setError(mutationError.message))
      .finally(() => setBusy(false));

  const handleSetStatus = (sectionId, status) =>
    Promise.resolve(setBusy(true))
      .then(async () => {
        await api.rf.updateManuscriptSection(sectionId, { status });
        await load();
      })
      .catch((mutationError) => setError(mutationError.message))
      .finally(() => setBusy(false));

  if (error && !manuscript) return <div className="p-4 text-sm text-red-500">{error}</div>;
  if (!manuscript) return <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>;

  if (manuscript.sections.length === 0) {
    return (
      <div className="space-y-3 p-4">
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">{t('manuscript.noSections')}</p>
          <button
            type="button"
            disabled={busy}
            onClick={handleInitialize}
            className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {t('manuscript.initialize')}
          </button>
        </div>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      </div>
    );
  }

  const completeness = manuscript.completeness;
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
          {t('manuscript.completeness.required')}: {completeness.totalRequiredSections}
        </span>
        <span className={`rounded-full border px-2 py-0.5 ${completeness.requiredSectionsComplete ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
          {t('manuscript.requiredComplete')}
        </span>
        <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
          {t('manuscript.completeness.draftOrBetter')}: {completeness.sectionsDraftOrBetter}
        </span>
        <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
          {t('manuscript.completeness.final')}: {completeness.sectionsFinal}
        </span>
        {completeness.claimsNotAssignedToSection > 0 && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700">
            {t('manuscript.completeness.claimsNotAssigned')}: {completeness.claimsNotAssignedToSection}
          </span>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="space-y-1.5">
        {manuscript.sections.map((section) => (
          <SectionRow
            key={section.id}
            section={section}
            t={t}
            selected={selectedId === section.id}
            onToggle={() => setSelectedId(selectedId === section.id ? null : section.id)}
            onSetStatus={handleSetStatus}
            busy={busy}
          />
        ))}
      </div>
    </div>
  );
}

function SectionRow({ section, t, selected, onToggle, onSetStatus, busy }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{section.title}</span>
        {section.isOptional && <span className="text-xs text-muted-foreground">({t('submission.optional')})</span>}
        <span className={`ml-auto rounded-full border border-border px-2 py-0.5 text-xs ${SECTION_STATUS_COLOR[section.status] || 'text-muted-foreground'}`}>
          {t(`manuscript.${section.status === 'internal_review' ? 'internalReview' : section.status}`)}
        </span>
      </button>
      {selected && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('manuscript.setStatus')}:</span>
            {['not_started', 'outline', 'draft', 'internal_review', 'revised', 'final'].map((status) => (
              <button
                key={status}
                type="button"
                disabled={busy || status === section.status}
                onClick={() => onSetStatus(section.id, status)}
                className={`rounded-lg border border-border px-2 py-0.5 text-xs disabled:opacity-40 ${
                  status === section.status ? 'bg-accent text-foreground' : 'hover:bg-accent/50'
                }`}
              >
                {t(`manuscript.${status === 'internal_review' ? 'internalReview' : status}`)}
              </button>
            ))}
          </div>
          {section.relations && section.relations.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {section.relations.map((relation) => (
                <span key={relation.id} className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground">
                  {relation.targetType}:{relation.targetId.slice(0, 8)}
                </span>
              ))}
            </div>
          )}
          {section.notes && <p className="text-xs text-muted-foreground">{section.notes}</p>}
          {section.filePath && <p className="font-mono text-xs text-muted-foreground">{section.filePath}</p>}
        </div>
      )}
    </div>
  );
}

function FreezeTab({ projectId, t }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [readinessRes, freezesRes] = await Promise.all([
        api.rf.getFreezeReadiness(projectId),
        api.rf.listResultFreezes(projectId),
      ]);
      if (!readinessRes.ok || !freezesRes.ok) throw new Error('HTTP error');
      setData({
        readiness: (await readinessRes.json()).data,
        freezes: (await freezesRes.json()).data,
      });
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = (override) =>
    Promise.resolve(setBusy(true))
      .then(async () => {
        const body = override ? { overrideReason } : {};
        const res = await api.rf.createResultsFreeze(projectId, body);
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || `HTTP ${res.status}`);
        }
        setShowOverride(false);
        setOverrideReason('');
        await load();
      })
      .catch((mutationError) => setError(mutationError.message))
      .finally(() => setBusy(false));

  if (error && !data) return <div className="p-4 text-sm text-red-500">{error}</div>;
  if (!data) return <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>;

  const { readiness, freezes } = data;
  const latest = freezes[0] || null;

  return (
    <div className="space-y-3 p-4">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <Snowflake className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">{t('manuscript.freeze.title')}</span>
          <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${
            readiness.ready
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
          }`}>
            {readiness.ready ? t('manuscript.freeze.ready') : t('manuscript.freeze.blocked')}
          </span>
        </div>
        {!readiness.ready && (
          <div className="mt-2 space-y-1">
            <div className="text-xs font-medium text-muted-foreground">{t('manuscript.freeze.blockers')}</div>
            {readiness.blockers.map((blocker, index) => (
              <div key={index} className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
                <span>•</span>
                <span>{blocker.message}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy || readiness.ready}
            onClick={() => handleCreate(false)}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {t('manuscript.freeze.createFreeze')}
          </button>
          <button
            type="button"
            disabled={busy || readiness.ready}
            onClick={() => setShowOverride((value) => !value)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            {t('manuscript.freeze.createOverride')}
          </button>
        </div>
        {showOverride && (
          <div className="mt-2 flex items-center gap-2">
            <input
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder={t('manuscript.freeze.overrideReason')}
              className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
            />
            <button
              type="button"
              disabled={busy || !overrideReason.trim()}
              onClick={() => handleCreate(true)}
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-50 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400"
            >
              {t('manuscript.freeze.createOverride')}
            </button>
          </div>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {latest ? (
        <div className="space-y-2">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-foreground">
                {t('manuscript.freeze.freezeNumber')}{latest.freezeNumber}
              </span>
              {latest.overrideReason ? (
                <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                  {t('manuscript.freeze.overridden')}
                </span>
              ) : (
                <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
                  {t('manuscript.freeze.normal')}
                </span>
              )}
              <span className={`ml-auto rounded-full border border-border px-2 py-0.5 text-xs ${
                latest.staleness?.state === 'stale' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
              }`}>
                {latest.staleness?.state === 'stale' ? t('manuscript.freeze.stale') : t('manuscript.freeze.current')}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
              <div>{t('manuscript.freeze.createdAt')}: {latest.createdAt}</div>
              <div>{t('manuscript.freeze.gitCommit')}: {latest.gitCommit || '—'}</div>
              <div>{t('manuscript.freeze.versions')}: {[latest.resultVersion, latest.datasetVersion, latest.configVersion].filter(Boolean).join(' / ') || '—'}</div>
              {latest.overrideReason && <div className="col-span-2 sm:col-span-1">Override: {latest.overrideReason}</div>}
            </div>
            {latest.staleness?.state === 'stale' && latest.staleness.reasons.length > 0 && (
              <div className="mt-2 space-y-0.5 text-xs text-red-600 dark:text-red-400">
                {latest.staleness.reasons.map((reason, index) => (
                  <div key={index}>• {reason}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t('manuscript.freeze.noFreezes')}
        </div>
      )}
    </div>
  );
}

function ReviewTab({ projectId, t }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', severity: 'major', status: 'open', source: 'self_review', body: '' });
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.rf.listReviewComments(projectId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()).data);
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
        await api.rf.createReviewComment(projectId, form);
        setShowForm(false);
        setForm({ title: '', severity: 'major', status: 'open', source: 'self_review', body: '' });
        await load();
      })
      .catch((mutationError) => setError(mutationError.message))
      .finally(() => setBusy(false));

  const handleStatus = (commentId, status) =>
    Promise.resolve(setBusy(true))
      .then(async () => {
        await api.rf.updateReviewComment(commentId, { status });
        await load();
      })
      .catch((mutationError) => setError(mutationError.message))
      .finally(() => setBusy(false));

  if (error && !data) return <div className="p-4 text-sm text-red-500">{error}</div>;
  if (!data) return <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>;

  const summary = data.summary;
  const filtered = data.comments.filter((comment) => {
    if (filterSeverity !== 'all' && comment.severity !== filterSeverity) return false;
    if (filterStatus !== 'all' && comment.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-foreground">{t('manuscript.review.title')}</h2>
        <button
          type="button"
          onClick={() => setShowForm((value) => !value)}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-accent"
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {t('manuscript.review.newComment')}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {summary.openCritical > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-400">
            {t('manuscript.review.summary.openCritical')}: {summary.openCritical}
          </span>
        )}
        {summary.openMajor > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
            {t('manuscript.review.summary.openMajor')}: {summary.openMajor}
          </span>
        )}
        <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
          {t('manuscript.review.summary.resolved')}: {summary.resolvedComments}
        </span>
        <select value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1 text-xs">
          <option value="all">{t('manuscript.review.severity')}: all</option>
          {['minor', 'major', 'critical'].map((severity) => (
            <option key={severity} value={severity}>{t(`manuscript.review.severities.${severity}`)}</option>
          ))}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1 text-xs">
          <option value="all">{t('manuscript.review.status')}: all</option>
          {['open', 'in_progress', 'resolved', 'wont_fix'].map((status) => (
            <option key={status} value={status}>{t(`manuscript.review.statuses.${status}`)}</option>
          ))}
        </select>
      </div>

      {showForm && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t('manuscript.review.title')} className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 outline-none focus:border-primary" />
          <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder={t('manuscript.review.body')} className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 outline-none focus:border-primary" rows={2} />
          <div className="flex flex-wrap gap-2">
            <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1.5">
              {['minor', 'major', 'critical'].map((severity) => (
                <option key={severity} value={severity}>{t(`manuscript.review.severities.${severity}`)}</option>
              ))}
            </select>
            <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1.5">
              {['self_review', 'advisor', 'coauthor', 'internal_review', 'other'].map((source) => (
                <option key={source} value={source}>{t(`manuscript.review.sources.${source}`)}</option>
              ))}
            </select>
            <button type="button" disabled={busy || !form.title.trim()} onClick={handleCreate} className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50">
              {t('manuscript.review.add')}
            </button>
          </div>
        </div>
      )}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t('manuscript.review.noComments')}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((comment) => (
            <div key={comment.id} className={`rounded-lg border border-border bg-card p-3 ${comment.severity === 'critical' && (comment.status === 'open' || comment.status === 'in_progress') ? 'border-red-300 dark:border-red-500/30' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{comment.code}</span>
                <span className={`text-sm font-semibold ${SEVERITY_COLOR[comment.severity]}`}>{comment.title}</span>
                <span className={`ml-auto rounded-full border border-border px-2 py-0.5 text-xs ${REVIEW_STATUS_COLOR[comment.status] || 'text-muted-foreground'}`}>
                  {t(`manuscript.review.statuses.${comment.status}`)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{t(`manuscript.review.severities.${comment.severity}`)}</span>
                <span>·</span>
                <span>{t(`manuscript.review.sources.${comment.source}`)}</span>
                {comment.sectionTitle && <span>· {comment.sectionTitle}</span>}
                {comment.resolvedAt && <span>· {t('manuscript.review.statuses.resolved')}: {comment.resolvedAt}</span>}
              </div>
              {comment.body && <p className="mt-1.5 text-sm text-foreground">{comment.body}</p>}
              <div className="mt-2">
                {comment.status === 'resolved' || comment.status === 'wont_fix' ? (
                  <button type="button" disabled={busy} onClick={() => handleStatus(comment.id, 'open')} className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent">
                    {t('manuscript.review.reopen')}
                  </button>
                ) : (
                  <button type="button" disabled={busy} onClick={() => handleStatus(comment.id, 'resolved')} className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent">
                    {t('manuscript.review.resolve')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
