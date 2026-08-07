// Evidence workspace (Phase 3) — sub-tabs: Claim–Evidence Matrix | Decision
// Log | Figures & Tables. Evidence health is computed by the backend
// (evidence-health endpoint); the UI never re-implements the rules.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, GitBranch, Plus, X } from 'lucide-react';
import { api } from '../../utils/api';

const IMPORTANCE_COLOR = {
  core: 'text-red-600 dark:text-red-400 font-semibold',
  major: 'text-amber-600 dark:text-amber-400',
  supporting: 'text-muted-foreground',
};

const CLAIM_STATUS_COLOR = {
  unverified: 'text-muted-foreground',
  partial: 'text-amber-600 dark:text-amber-400',
  supported: 'text-emerald-600 dark:text-emerald-400',
  strong: 'text-emerald-600 dark:text-emerald-400 font-semibold',
  contradicted: 'text-red-600 dark:text-red-400',
  dropped: 'text-muted-foreground line-through',
};

const HEALTH_STYLE = {
  critical_missing_evidence: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  no_evidence: 'bg-muted text-muted-foreground',
  weak_only: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  supported_by_evidence: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  has_contradictory_evidence: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
};

const SUBTABS = ['matrix', 'decisions', 'figuresTables'];

export default function EvidenceView({ projectId }) {
  const { t } = useTranslation('researchflow');
  const [subtab, setSubtab] = useState('matrix');

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
            {t(`evidence.subnav.${key}`)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {subtab === 'matrix' && <EvidenceMatrix projectId={projectId} t={t} />}
        {subtab === 'decisions' && <DecisionLog projectId={projectId} t={t} />}
        {subtab === 'figuresTables' && <FiguresTables projectId={projectId} t={t} />}
      </div>
    </div>
  );
}

function EvidenceMatrix({ projectId, t }) {
  const [health, setHealth] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ statement: '', importance: 'core', status: 'unverified' });
  const [expandedClaim, setExpandedClaim] = useState(null);
  const [linkForm, setLinkForm] = useState({ evidenceId: '', relationType: 'supports' });

  const load = useCallback(async () => {
    setError(null);
    try {
      const [healthRes, evRes] = await Promise.all([
        api.rf.getEvidenceHealth(projectId),
        api.rf.listEvidence(projectId),
      ]);
      if (!healthRes.ok || !evRes.ok) throw new Error('HTTP error');
      setHealth((await healthRes.json()).data);
      setEvidence((await evRes.json()).data);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [projectId]);

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

  const handleCreateClaim = () =>
    runMutation(async () => {
      await api.rf.createClaim(projectId, form);
      setShowForm(false);
      setForm({ statement: '', importance: 'core', status: 'unverified' });
    });

  const handleLink = (claimId) =>
    runMutation(async () => {
      await api.rf.linkClaimEvidence({ claimId, ...linkForm });
      setLinkForm({ evidenceId: '', relationType: 'supports' });
      setExpandedClaim(null);
    });

  const handleUnlink = (linkId) => runMutation(() => api.rf.unlinkClaimEvidence(linkId));

  if (error && !health) return <div className="p-4 text-sm text-red-500">{error}</div>;
  if (!health || !evidence) return <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>;

  const summary = health.summary;

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-foreground">{t('evidence.subnav.matrix')}</h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-accent"
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {t('evidence.newClaim')}
        </button>
      </div>

      {summary.coreClaimsTotal > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
            {t('dashboard.coreClaims')}: {summary.coreClaimsTotal}
          </span>
          <span className={`rounded-full border px-2 py-0.5 ${summary.coreClaimsMissingEvidence > 0 ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400' : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400'}`}>
            {t('dashboard.coreClaimsMissing')}: {summary.coreClaimsMissingEvidence}
          </span>
          {summary.claimsWithContradictoryEvidence > 0 && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
              {t('dashboard.contradictory')}: {summary.claimsWithContradictoryEvidence}
            </span>
          )}
        </div>
      )}

      {showForm && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <input
            value={form.statement}
            onChange={(e) => setForm({ ...form, statement: e.target.value })}
            placeholder={t('evidence.statement')}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
          />
          <div className="flex gap-2">
            <select value={form.importance} onChange={(e) => setForm({ ...form, importance: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
              {['core', 'major', 'supporting'].map((level) => (
                <option key={level} value={level}>{t(`evidence.importanceLevels.${level}`)}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !form.statement.trim()}
              onClick={handleCreateClaim}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {t('evidence.add')}
            </button>
          </div>
        </div>
      )}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">{error}</div>}

      {health.claims.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t('evidence.noClaims')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t('evidence.claim')}</th>
                <th className="px-3 py-2 font-medium">{t('evidence.importance')}</th>
                <th className="px-3 py-2 font-medium">{t('evidence.evidenceCount')}</th>
                <th className="px-3 py-2 font-medium">{t('evidence.strengthSummary')}</th>
                <th className="px-3 py-2 font-medium">{t('evidence.contradictory')}</th>
                <th className="px-3 py-2 font-medium">{t('evidence.status')}</th>
                <th className="px-3 py-2 font-medium">{t('evidence.health')}</th>
              </tr>
            </thead>
            <tbody>
              {health.claims.map((claim) => (
                <ClaimRow
                  key={claim.id}
                  claim={claim}
                  t={t}
                  evidence={evidence}
                  expanded={expandedClaim === claim.id}
                  onToggle={() => setExpandedClaim(expandedClaim === claim.id ? null : claim.id)}
                  linkForm={linkForm}
                  setLinkForm={setLinkForm}
                  onLink={handleLink}
                  onUnlink={handleUnlink}
                  busy={busy}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ClaimRow({ claim, t, evidence, expanded, onToggle, linkForm, setLinkForm, onLink, onUnlink, busy }) {
  const health = claim.evidenceHealth;
  const critical = health.health === 'critical_missing_evidence';
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-t border-border hover:bg-accent/40 ${critical ? 'bg-red-50/40 dark:bg-red-500/5' : ''}`}
      >
        <td className="max-w-[280px] px-3 py-2">
          <span className="font-mono text-xs text-muted-foreground">{claim.code}</span>
          <div className="truncate text-foreground" title={claim.statement}>{claim.statement}</div>
        </td>
        <td className={`px-3 py-2 ${IMPORTANCE_COLOR[claim.importance] || ''}`}>
          {t(`evidence.importanceLevels.${claim.importance}`)}
        </td>
        <td className="px-3 py-2">{health.evidenceCount}</td>
        <td className="px-3 py-2 text-muted-foreground">
          {health.strengths.length ? health.strengths.map((s) => t(`evidence.strengths.${s}`)).join(', ') : '—'}
        </td>
        <td className="px-3 py-2">
          {health.hasContradictory
            ? <span className="text-red-600 dark:text-red-400">✓</span>
            : <span className="text-muted-foreground">—</span>}
        </td>
        <td className={`px-3 py-2 ${CLAIM_STATUS_COLOR[claim.status] || ''}`}>
          {t(`evidence.statuses.${claim.status}`)}
        </td>
        <td className="px-3 py-2">
          {critical ? (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-400">
              {t('evidence.criticalMissing')}
            </span>
          ) : (
            <span className={`rounded-full px-2 py-0.5 text-xs ${HEALTH_STYLE[health.health] || 'bg-muted text-muted-foreground'}`}>
              {t(`evidence.healthStates.${health.health}`)}
            </span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border bg-muted/20">
          <td colSpan={7} className="px-4 py-3">
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <select
                  value={linkForm.evidenceId}
                  onChange={(e) => setLinkForm({ ...linkForm, evidenceId: e.target.value })}
                  className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
                >
                  <option value="">{t('evidence.linkEvidence')}…</option>
                  {evidence.map((item) => (
                    <option key={item.id} value={item.id}>{item.title}</option>
                  ))}
                </select>
                <select
                  value={linkForm.relationType}
                  onChange={(e) => setLinkForm({ ...linkForm, relationType: e.target.value })}
                  className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
                >
                  {['supports', 'contradicts', 'contextualized_by'].map((relation) => (
                    <option key={relation} value={relation}>{relation}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || !linkForm.evidenceId}
                  onClick={() => onLink(claim.id)}
                  className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  {t('evidence.linkEvidence')}
                </button>
              </div>
              {claim.relations ? (
                <div className="flex flex-wrap gap-1.5">
                  {claim.relations.map((relation) => (
                    <span key={relation.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5">
                      {t(`evidence.strengths.${relation.evidenceStrength || 'weak'}`)} · {relation.relationType}
                      <button
                        type="button"
                        onClick={() => onUnlink(relation.id)}
                        className="text-muted-foreground hover:text-red-500"
                        aria-label={t('evidence.unlink')}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {claim.relations.length === 0 && (
                    <span className="text-muted-foreground">{t('evidence.noEvidence')}</span>
                  )}
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DecisionLog({ projectId, t }) {
  const [decisions, setDecisions] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', context: '', decision: '', reason: '', alternatives: '', impact: '' });

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.rf.listDecisions(projectId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDecisions((await res.json()).data);
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
        await api.rf.createDecision(projectId, form);
        setShowForm(false);
        setForm({ title: '', context: '', decision: '', reason: '', alternatives: '', impact: '' });
        await load();
      })
      .catch((mutationError) => setError(mutationError.message))
      .finally(() => setBusy(false));

  if (error && !decisions) return <div className="p-4 text-sm text-red-500">{error}</div>;
  if (!decisions) return <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>;

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-foreground">{t('evidence.decisions.title')}</h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-accent"
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {t('evidence.decisions.newDecision')}
        </button>
      </div>

      {showForm && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder={t('evidence.decisions.newDecision')}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 outline-none focus:border-primary"
          />
          <textarea value={form.context} onChange={(e) => setForm({ ...form, context: e.target.value })} placeholder={t('evidence.decisions.context')} className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 outline-none focus:border-primary" rows={1} />
          <textarea value={form.decision} onChange={(e) => setForm({ ...form, decision: e.target.value })} placeholder={t('evidence.decisions.decision')} className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 outline-none focus:border-primary" rows={1} />
          <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={t('evidence.decisions.reason')} className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 outline-none focus:border-primary" rows={2} />
          <textarea value={form.alternatives} onChange={(e) => setForm({ ...form, alternatives: e.target.value })} placeholder={t('evidence.decisions.alternatives')} className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 outline-none focus:border-primary" rows={1} />
          <textarea value={form.impact} onChange={(e) => setForm({ ...form, impact: e.target.value })} placeholder={t('evidence.decisions.impact')} className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 outline-none focus:border-primary" rows={1} />
          <button
            type="button"
            disabled={busy || !form.title.trim()}
            onClick={handleCreate}
            className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
          >
            {t('evidence.decisions.add')}
          </button>
        </div>
      )}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">{error}</div>}

      {decisions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t('evidence.decisions.noDecisions')}
        </div>
      ) : (
        <div className="space-y-2">
          {decisions.map((decision) => (
            <div key={decision.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono text-xs text-muted-foreground">{decision.code}</span>
                <span className="text-sm font-semibold text-foreground">{decision.title}</span>
                {decision.date && <span className="ml-auto text-xs text-muted-foreground">{decision.date}</span>}
              </div>
              {decision.context && <p className="mt-1.5 text-xs text-muted-foreground">{decision.context}</p>}
              {decision.decision && (
                <p className="mt-1 text-sm text-foreground"><b>{t('evidence.decisions.decision')}:</b> {decision.decision}</p>
              )}
              {decision.reason && (
                <p className="mt-1 text-xs text-muted-foreground"><b>{t('evidence.decisions.reason')}:</b> {decision.reason}</p>
              )}
              {decision.impact && (
                <p className="mt-1 text-xs text-muted-foreground"><b>{t('evidence.decisions.impact')}:</b> {decision.impact}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FiguresTables({ projectId, t }) {
  const [artifacts, setArtifacts] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'figure', workingTitle: '', status: 'planned', filePath: '' });
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.rf.listFiguresTables(projectId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setArtifacts((await res.json()).data);
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
        await api.rf.createFigureTable(projectId, form);
        setShowForm(false);
        setForm({ type: 'figure', workingTitle: '', status: 'planned', filePath: '' });
        await load();
      })
      .catch((mutationError) => setError(mutationError.message))
      .finally(() => setBusy(false));

  const handleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
    if (expandedId !== id) {
      void api.rf.getFigureTable(id)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('HTTP'))))
        .then(({ data }) => setArtifacts((prev) => prev.map((artifact) => (artifact.id === id ? { ...artifact, relations: data.relations } : artifact))))
        .catch((loadError) => setError(loadError.message));
    }
  };

  if (error && !artifacts) return <div className="p-4 text-sm text-red-500">{error}</div>;
  if (!artifacts) return <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>;

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-foreground">{t('evidence.figuresTables.title')}</h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-accent"
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {t('evidence.figuresTables.newArtifact')}
        </button>
      </div>

      {showForm && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
          <input
            value={form.workingTitle}
            onChange={(e) => setForm({ ...form, workingTitle: e.target.value })}
            placeholder={t('evidence.figuresTables.workingTitle')}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 outline-none focus:border-primary"
          />
          <div className="flex flex-wrap gap-2">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1.5">
              {['figure', 'table'].map((type) => (
                <option key={type} value={type}>{t(`evidence.figuresTables.types.${type}`)}</option>
              ))}
            </select>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1.5">
              {['planned', 'draft', 'ready', 'frozen', 'deprecated'].map((status) => (
                <option key={status} value={status}>{t(`evidence.figuresTables.statuses.${status}`)}</option>
              ))}
            </select>
            <input
              value={form.filePath}
              onChange={(e) => setForm({ ...form, filePath: e.target.value })}
              placeholder={t('evidence.figuresTables.filePath')}
              className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 outline-none focus:border-primary"
            />
            <button
              type="button"
              disabled={busy || !form.workingTitle.trim()}
              onClick={handleCreate}
              className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
            >
              {t('evidence.figuresTables.add')}
            </button>
          </div>
        </div>
      )}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">{error}</div>}

      {artifacts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t('evidence.figuresTables.noArtifacts')}
        </div>
      ) : (
        <div className="space-y-2">
          {artifacts.map((artifact) => (
            <div key={artifact.id} className="rounded-lg border border-border bg-card">
              <button type="button" onClick={() => handleExpand(artifact.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono text-xs text-muted-foreground">{artifact.code}</span>
                <span className="text-sm font-medium text-foreground">{artifact.workingTitle}</span>
                <span className="text-xs text-muted-foreground">{t(`evidence.figuresTables.types.${artifact.type}`)}</span>
                <span className={`rounded-full border border-border px-2 py-0.5 text-xs ${artifact.status === 'frozen' ? 'text-sky-600 dark:text-sky-400' : 'text-muted-foreground'}`}>
                  {t(`evidence.figuresTables.statuses.${artifact.status}`)}
                </span>
                {artifact.frozen && <span className="text-xs text-sky-600 dark:text-sky-400">{t('evidence.figuresTables.frozen')}</span>}
                {artifact.filePath && <span className="ml-auto truncate font-mono text-xs text-muted-foreground">{artifact.filePath}</span>}
              </button>
              {expandedId === artifact.id && (
                <div className="border-t border-border px-3 py-2">
                  <div className="text-xs font-medium text-muted-foreground">{t('evidence.figuresTables.provenance')}</div>
                  {artifact.relations && artifact.relations.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {artifact.relations.map((relation) => (
                        <span key={relation.id} className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground">
                          {relation.targetType}:{relation.targetId.slice(0, 8)} · {relation.relationType}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1 text-xs text-muted-foreground">{t('common.none')}</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
