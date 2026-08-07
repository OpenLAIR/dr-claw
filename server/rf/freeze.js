// Results Freeze — deterministic readiness + staleness, pure functions.
// Freeze events are immutable; staleness is a derived, explainable state.

import { claimEvidenceHealth } from './evidence-health.js';
import { summarizeExperiment } from './experiment-summary.js';

/**
 * Readiness blockers for creating a Results Freeze.
 * Uses existing Stage Gate state as the primary lifecycle truth; does not
 * invent unsupported scientific rules (Phase 4 §10).
 *
 * @param {object} ctx
 * @param {Array} ctx.claims                    rf_claims rows (serialized)
 * @param {Array} ctx.claimEvidenceRows         claim-evidence rows incl. strength
 * @param {Array} ctx.experiments               rf_experiments rows
 * @param {Array} ctx.runs                      rf_experiment_runs rows
 * @param {Array} ctx.stages                    rf_stages rows
 * @param {Array} ctx.gates                     rf_stage_gates rows
 * @returns {{ready: boolean, blockers: Array<{code: string, message: string}>}}
 */
export const freezeReadiness = ({ claims = [], claimEvidenceRows = [], experiments = [], runs = [], stages = [], gates = [] } = {}) => {
  const blockers = [];

  const byClaim = new Map();
  for (const row of claimEvidenceRows) {
    if (!byClaim.has(row.claim_id)) byClaim.set(row.claim_id, []);
    byClaim.get(row.claim_id).push(row);
  }

  const coreClaimsMissing = [];
  const coreClaimsContradictedUnacknowledged = [];
  for (const claim of claims) {
    if (claim.archived_at || claim.importance !== 'core') continue;
    const health = claimEvidenceHealth(claim, byClaim.get(claim.id) || []);
    if (health.health === 'critical_missing_evidence') coreClaimsMissing.push(claim.claim_code || claim.code);
    if (health.hasContradictory && claim.status !== 'contradicted') {
      coreClaimsContradictedUnacknowledged.push(claim.claim_code || claim.code);
    }
  }
  if (coreClaimsMissing.length > 0) {
    blockers.push({
      code: 'core_claim_missing_evidence',
      message: `Core claim(s) without evidence: ${coreClaimsMissing.join(', ')}`,
      claimCodes: coreClaimsMissing,
    });
  }
  if (coreClaimsContradictedUnacknowledged.length > 0) {
    blockers.push({
      code: 'contradicted_core_claim_unacknowledged',
      message: `Core claim(s) with unacknowledged contradictory evidence: ${coreClaimsContradictedUnacknowledged.join(', ')}`,
      claimCodes: coreClaimsContradictedUnacknowledged,
    });
  }

  // Main experiments blocked: a main-type experiment with failed runs but no completed run.
  const runsByExperiment = new Map();
  for (const run of runs) {
    if (!runsByExperiment.has(run.experiment_id)) runsByExperiment.set(run.experiment_id, []);
    runsByExperiment.get(run.experiment_id).push(run);
  }
  const blockedMain = experiments.filter((experiment) => {
    if (experiment.archived_at || experiment.type !== 'main') return false;
    const expRuns = runsByExperiment.get(experiment.id) || [];
    return expRuns.length > 0 && expRuns.some((run) => run.status === 'failed')
      && !expRuns.some((run) => run.status === 'completed');
  });
  if (blockedMain.length > 0) {
    blockers.push({
      code: 'main_experiment_blocked',
      message: `Main experiment(s) with failed runs and no completed run: ${blockedMain.map((e) => e.experiment_code).join(', ')}`,
      experimentCodes: blockedMain.map((e) => e.experiment_code),
    });
  }

  // Validation stage required gates must all pass.
  const validationStage = stages.find((stage) => stage.key === 'validation' && !stage.archived_at);
  if (validationStage) {
    const stageGates = gates.filter((gate) => gate.stage_id === validationStage.id);
    const required = stageGates.filter((gate) => gate.is_required);
    const passed = required.filter((gate) => gate.is_passed);
    if (required.length > 0 && passed.length !== required.length) {
      const missing = required.filter((gate) => !gate.is_passed).map((gate) => gate.title);
      blockers.push({
        code: 'validation_gates_incomplete',
        message: `Validation required gate(s) incomplete: ${missing.join(', ')}`,
        gateTitles: missing,
      });
    }
  }

  return { ready: blockers.length === 0, blockers };
};

/**
 * Lightweight metadata snapshot captured at freeze time (immutable).
 */
export const buildFreezeSnapshot = ({ claims = [], claimEvidenceRows = [], figuresTables = [], experiments = [], runs = [] } = {}) => {
  const byClaim = new Map();
  for (const row of claimEvidenceRows) {
    if (!byClaim.has(row.claim_id)) byClaim.set(row.claim_id, []);
    byClaim.get(row.claim_id).push(row);
  }
  const runsByExperiment = new Map();
  for (const run of runs) {
    if (!runsByExperiment.has(run.experiment_id)) runsByExperiment.set(run.experiment_id, []);
    runsByExperiment.get(run.experiment_id).push(run);
  }
  return {
    claims: claims.map((claim) => ({
      id: claim.id,
      code: claim.claim_code,
      status: claim.status,
      importance: claim.importance,
      evidenceHealth: claimEvidenceHealth(claim, byClaim.get(claim.id) || []).health,
    })),
    figuresTables: figuresTables.map((artifact) => ({
      id: artifact.id,
      code: artifact.artifact_code,
      type: artifact.type,
      status: artifact.status,
      frozen: Boolean(artifact.frozen),
    })),
    experiments: experiments.map((experiment) => ({
      id: experiment.id,
      code: experiment.experiment_code,
      status: experiment.status,
      type: experiment.type,
      runSummary: summarizeExperiment(runsByExperiment.get(experiment.id) || []),
    })),
    capturedAt: new Date().toISOString(),
  };
};

/**
 * Detect whether a freeze may be stale by comparing its immutable snapshot
 * against the current project state. No binary diffing (Phase 4 §13).
 *
 * @param {object} freeze       serialized freeze row (snapshot_json parsed)
 * @param {object} current      same shape as buildFreezeSnapshot input
 * @returns {{state: 'current'|'stale', reasons: Array<string>}}
 */
export const freezeStaleness = (freeze, current = {}) => {
  const snapshot = freeze.snapshot || {};
  const reasons = [];

  const byCode = (rows) => {
    const map = new Map();
    for (const row of rows || []) map.set(row.code || row.claim_code || row.artifact_code, row);
    return map;
  };

  const snapshotClaims = byCode(snapshot.claims);
  const currentClaims = byCode(current.claims);
  for (const [code, snap] of snapshotClaims) {
    const now = currentClaims.get(code);
    if (!now) continue;
    if (now.status !== snap.status) reasons.push(`Claim ${code} status changed: ${snap.status} -> ${now.status}`);
    else if (now.evidenceHealth !== snap.evidenceHealth) reasons.push(`Claim ${code} evidence health changed: ${snap.evidenceHealth} -> ${now.evidenceHealth}`);
  }
  for (const [code, now] of currentClaims) {
    if (!snapshotClaims.has(code)) reasons.push(`Claim ${code} added after freeze`);
  }

  const snapshotArtifacts = byCode(snapshot.figuresTables);
  const currentArtifacts = byCode(current.figuresTables);
  for (const [code, snap] of snapshotArtifacts) {
    const now = currentArtifacts.get(code);
    if (!now) continue;
    if (now.status !== snap.status || Boolean(now.frozen) !== snap.frozen) {
      reasons.push(`${snap.type === 'table' ? 'Table' : 'Figure'} ${code} updated after freeze`);
    }
  }
  for (const [code] of currentArtifacts) {
    if (!snapshotArtifacts.has(code)) reasons.push(`Figure/table ${code} added after freeze`);
  }

  const snapshotExperiments = byCode(snapshot.experiments);
  const currentExperiments = byCode(current.experiments);
  for (const [code, snap] of snapshotExperiments) {
    const now = currentExperiments.get(code);
    if (!now) continue;
    const s = snap.runSummary || {};
    const n = now.runSummary || {};
    if (n.total !== s.total || n.completed !== s.completed || n.failed !== s.failed) {
      reasons.push(`Experiment ${code} runs changed after freeze (${s.total}/${s.completed} -> ${n.total}/${n.completed})`);
    }
  }
  for (const [code] of currentExperiments) {
    if (!snapshotExperiments.has(code)) reasons.push(`Experiment ${code} added after freeze`);
  }

  return { state: reasons.length > 0 ? 'stale' : 'current', reasons };
};
