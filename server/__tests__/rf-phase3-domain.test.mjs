// ResearchFlow Phase 3 domain tests — experiments, runs, claims, evidence,
// claim-evidence matrix, evidence health, decisions, literature, figures/tables,
// provenance, migration v2, activity log. Service-level, isolated temp DB.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runResearchFlowMigrations, createResearchFlowServiceFor } from '../rf/index.js';
import { RfValidationError, RfNotFoundError } from '../rf/errors.js';

const USER_ID = 1;
const OTHER_USER_ID = 2;

let tmpDir;
let dbPath;
let db;
let service;

const reopenDb = () => {
  if (db) db.close();
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  runResearchFlowMigrations(db);
  service = createResearchFlowServiceFor(db);
  return db;
};

beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'rf-p3-domain-'));
  dbPath = path.join(tmpDir, 'rf.db');
  reopenDb();
});

afterAll(async () => {
  if (db) db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('Phase 3 experiments', () => {
  it('1. creates an experiment with auto EXP-001 code', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Exp' });
    const experiment = service.createExperiment(USER_ID, project.project.id, {
      title: 'Main benchmark', type: 'main', priority: 'high',
    });
    expect(experiment.code).toBe('EXP-001');
    expect(experiment.status).toBe('planned');
    expect(experiment.type).toBe('main');
    expect(experiment.projectId).toBe(project.project.id);
  });

  it('2. human-readable code is unique within a project', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Exp2' });
    service.createExperiment(USER_ID, project.project.id, { title: 'A' });
    service.createExperiment(USER_ID, project.project.id, { title: 'B' });
    const codes = service.listExperiments(USER_ID, project.project.id).map((e) => e.code);
    expect(codes).toEqual(['EXP-001', 'EXP-002']);
  });

  it('3. same code may exist across projects', () => {
    const p1 = service.createProject(USER_ID, { name: 'P3 Exp3a' });
    const p2 = service.createProject(USER_ID, { name: 'P3 Exp3b' });
    service.createExperiment(USER_ID, p1.project.id, { title: 'X' });
    const e2 = service.createExperiment(USER_ID, p2.project.id, { title: 'Y' });
    expect(e2.code).toBe('EXP-001');
  });

  it('4. experiment 1 -> N runs with RUN-001/RUN-002 codes', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Runs' });
    const experiment = service.createExperiment(USER_ID, project.project.id, { title: 'Seeds' });
    service.createRun(USER_ID, experiment.id, { seed: '42' });
    service.createRun(USER_ID, experiment.id, { seed: '7' });
    const detail = service.getExperiment(USER_ID, experiment.id);
    expect(detail.runs).toHaveLength(2);
    expect(detail.runs.map((r) => r.runCode)).toEqual(['RUN-001', 'RUN-002']);
    expect(detail.summary.total).toBe(2);
    expect(new Set(detail.summary.seeds)).toEqual(new Set(['7', '42']));
  });

  it('5. run seed persists', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Seed' });
    const experiment = service.createExperiment(USER_ID, project.project.id, { title: 'S' });
    service.createRun(USER_ID, experiment.id, { seed: 'seed-123' });
    const detail = service.getExperiment(USER_ID, experiment.id);
    expect(detail.runs[0].seed).toBe('seed-123');
  });

  it('6. failed run persists with failure reason and stays queryable', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Failed' });
    const experiment = service.createExperiment(USER_ID, project.project.id, { title: 'F' });
    const run = service.createRun(USER_ID, experiment.id, {
      seed: '1', status: 'failed', failureReason: 'NaN loss at step 5k',
      failureClassification: 'training_instability',
    });
    expect(run.status).toBe('failed');
    expect(run.failureReason).toBe('NaN loss at step 5k');
    const detail = service.getExperiment(USER_ID, experiment.id);
    expect(detail.runs[0].status).toBe('failed');
    expect(detail.runs[0].failureClassification).toBe('training_instability');
    expect(detail.summary.failed).toBe(1);
  });

  it('7. failed is NOT archived (soft delete is separate)', () => {
    const project = service.createProject(USER_ID, { name: 'P3 FailedVsArchived' });
    const experiment = service.createExperiment(USER_ID, project.project.id, { title: 'F2' });
    service.createRun(USER_ID, experiment.id, { status: 'failed', failureClassification: 'data_issue' });
    service.createRun(USER_ID, experiment.id, { status: 'completed' });

    const archiveResult = service.deleteExperiment(USER_ID, experiment.id);
    expect(archiveResult.archived).toBe(true);
    // archived experiment is no longer listed…
    expect(service.listExperiments(USER_ID, project.project.id)).toHaveLength(0);
    // …but the failed run rows still exist in the DB (not physically deleted).
    const rows = db.prepare('SELECT status, archived_at FROM rf_experiment_runs WHERE project_id = ? ORDER BY created_at').all(project.project.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status !== null)).toBe(true);
    expect(rows.every((r) => r.archived_at === null)).toBe(true);
  });

  it('8. failure classification is validated', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Classif' });
    const experiment = service.createExperiment(USER_ID, project.project.id, { title: 'C' });
    expect(() => service.createRun(USER_ID, experiment.id, {
      status: 'failed', failureClassification: 'not_a_real_classification',
    })).toThrow(RfValidationError);
  });

  it('9. cross-project access denied (user isolation)', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Iso' });
    const experiment = service.createExperiment(USER_ID, project.project.id, { title: 'Secret' });
    const run = service.createRun(USER_ID, experiment.id, { seed: '1' });
    expect(() => service.getExperiment(OTHER_USER_ID, experiment.id)).toThrow(RfNotFoundError);
    expect(() => service.updateRun(OTHER_USER_ID, run.id, { status: 'completed' })).toThrow(RfNotFoundError);
    // Another user with their own project cannot touch it either.
    service.createProject(OTHER_USER_ID, { name: 'Other' });
    expect(() => service.getExperiment(OTHER_USER_ID, experiment.id)).toThrow(RfNotFoundError);
  });
});

describe('Phase 3 claims & evidence', () => {
  it('10. creates a claim with auto C-01 code', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Claim' });
    const claim = service.createClaim(USER_ID, project.project.id, {
      statement: 'Router improves performance', importance: 'core',
    });
    expect(claim.code).toBe('C-01');
    expect(claim.importance).toBe('core');
    expect(claim.status).toBe('unverified');
  });

  it('11. creates evidence of type experiment', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Ev' });
    const evidence = service.createEvidence(USER_ID, project.project.id, {
      evidenceType: 'analysis_note', title: 'Sweep notes', strength: 'moderate',
    });
    expect(evidence.evidenceType).toBe('analysis_note');
    expect(evidence.strength).toBe('moderate');
  });

  it('12. claim-evidence supports link updates health', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Link' });
    const claim = service.createClaim(USER_ID, project.project.id, { statement: 'C1', importance: 'core' });
    const evidence = service.createEvidence(USER_ID, project.project.id, {
      evidenceType: 'experiment_run', title: 'RUN result', strength: 'strong',
    });
    const link = service.linkClaimEvidence(USER_ID, { claimId: claim.id, evidenceId: evidence.id, relationType: 'supports' });
    expect(link.relationType).toBe('supports');
    const health = service.getEvidenceHealth(USER_ID, project.project.id);
    const claimHealth = health.claims.find((c) => c.id === claim.id).evidenceHealth;
    expect(claimHealth.health).toBe('supported_by_evidence');
    expect(claimHealth.evidenceCount).toBe(1);
  });

  it('13. contradictory relation is surfaced', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Contradict' });
    const claim = service.createClaim(USER_ID, project.project.id, { statement: 'C2', importance: 'core' });
    const e1 = service.createEvidence(USER_ID, project.project.id, { evidenceType: 'analysis_note', title: 'pro', strength: 'strong' });
    const e2 = service.createEvidence(USER_ID, project.project.id, { evidenceType: 'analysis_note', title: 'con', strength: 'moderate' });
    service.linkClaimEvidence(USER_ID, { claimId: claim.id, evidenceId: e1.id, relationType: 'supports' });
    service.linkClaimEvidence(USER_ID, { claimId: claim.id, evidenceId: e2.id, relationType: 'contradicts' });
    const health = service.getEvidenceHealth(USER_ID, project.project.id);
    const claimHealth = health.claims.find((c) => c.id === claim.id).evidenceHealth;
    expect(claimHealth.hasContradictory).toBe(true);
    expect(claimHealth.health).toBe('has_contradictory_evidence');
    expect(health.summary.claimsWithContradictoryEvidence).toBe(1);
  });

  it('14. duplicate relation is idempotent (not duplicated)', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Dup' });
    const claim = service.createClaim(USER_ID, project.project.id, { statement: 'C3' });
    const evidence = service.createEvidence(USER_ID, project.project.id, { evidenceType: 'analysis_note', title: 'D', strength: 'weak' });
    service.linkClaimEvidence(USER_ID, { claimId: claim.id, evidenceId: evidence.id, relationType: 'supports' });
    const again = service.linkClaimEvidence(USER_ID, { claimId: claim.id, evidenceId: evidence.id, relationType: 'supports' });
    expect(again.id).toBeTruthy();
    const links = db.prepare('SELECT * FROM rf_claim_evidence WHERE claim_id = ?').all(claim.id);
    expect(links).toHaveLength(1);
  });

  it('15. cross-project claim-evidence relation rejected', () => {
    const pA = service.createProject(USER_ID, { name: 'P3 XA' });
    const pB = service.createProject(USER_ID, { name: 'P3 XB' });
    const claim = service.createClaim(USER_ID, pA.project.id, { statement: 'A' });
    const evidence = service.createEvidence(USER_ID, pB.project.id, { evidenceType: 'analysis_note', title: 'B' });
    expect(() => service.linkClaimEvidence(USER_ID, { claimId: claim.id, evidenceId: evidence.id }))
      .toThrow(RfValidationError);
  });

  it('16. core claim with no evidence -> critical missing', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Missing' });
    const claim = service.createClaim(USER_ID, project.project.id, { statement: 'Core claim', importance: 'core' });
    service.createClaim(USER_ID, project.project.id, { statement: 'Minor claim', importance: 'supporting' });
    const health = service.getEvidenceHealth(USER_ID, project.project.id);
    const claimHealth = health.claims.find((c) => c.id === claim.id).evidenceHealth;
    expect(claimHealth.health).toBe('critical_missing_evidence');
    expect(health.summary.coreClaimsTotal).toBe(1);
    expect(health.summary.coreClaimsMissingEvidence).toBe(1);
  });

  it('17. adding evidence removes the no-evidence health condition', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Fix' });
    const claim = service.createClaim(USER_ID, project.project.id, { statement: 'Core claim', importance: 'core' });
    const evidence = service.createEvidence(USER_ID, project.project.id, { evidenceType: 'analysis_note', title: 'E', strength: 'moderate' });
    service.linkClaimEvidence(USER_ID, { claimId: claim.id, evidenceId: evidence.id, relationType: 'supports' });
    const health = service.getEvidenceHealth(USER_ID, project.project.id);
    const claimHealth = health.claims.find((c) => c.id === claim.id).evidenceHealth;
    expect(claimHealth.health).not.toBe('critical_missing_evidence');
    expect(health.summary.coreClaimsMissingEvidence).toBe(0);
  });

  it('18b. dashboard evidence summary reflects evidence strength (review fix)', () => {
    const project = service.createProject(USER_ID, { name: 'P3 DashHealth' });
    const claim = service.createClaim(USER_ID, project.project.id, { statement: 'Core claim', importance: 'core' });
    const evidence = service.createEvidence(USER_ID, project.project.id, {
      evidenceType: 'analysis_note', title: 'Strong result', strength: 'strong',
    });
    service.linkClaimEvidence(USER_ID, { claimId: claim.id, evidenceId: evidence.id, relationType: 'supports' });
    const dashboard = service.getProjectDashboard(USER_ID, project.project.id);
    expect(dashboard.evidenceSummary.claimsSupported).toBe(1);
    expect(dashboard.evidenceSummary.claimsPartial).toBe(1);
    expect(dashboard.evidenceSummary.coreClaimsMissingEvidence).toBe(0);
  });

  it('18. claim status is NOT automatically promoted by evidence', () => {
    const project = service.createProject(USER_ID, { name: 'P3 NoPromote' });
    const claim = service.createClaim(USER_ID, project.project.id, { statement: 'Big claim', importance: 'core', status: 'unverified' });
    const evidence = service.createEvidence(USER_ID, project.project.id, { evidenceType: 'experiment', title: 'Strong result', strength: 'strong' });
    service.linkClaimEvidence(USER_ID, { claimId: claim.id, evidenceId: evidence.id, relationType: 'supports' });
    // Health reports supported_by_evidence, but claim.status stays unverified.
    const after = service.getClaim(USER_ID, claim.id);
    expect(after.status).toBe('unverified');
    const health = service.getEvidenceHealth(USER_ID, project.project.id);
    expect(health.claims.find((c) => c.id === claim.id).evidenceHealth.health).toBe('supported_by_evidence');
    // Promotion is an explicit user/service action:
    const promoted = service.updateClaim(USER_ID, claim.id, { status: 'supported' });
    expect(promoted.status).toBe('supported');
  });
});

describe('Phase 3 decisions', () => {
  it('20. creates a decision with auto DEC-001 code', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Dec' });
    const decision = service.createDecision(USER_ID, project.project.id, {
      title: 'Drop Top-1 routing', decision: 'Use Top-2 only', reason: '3/5 seeds collapse',
    });
    expect(decision.code).toBe('DEC-001');
    expect(decision.reason).toContain('3/5 seeds collapse');
  });

  it('21. decision links to experiment/evidence/claim', () => {
    const project = service.createProject(USER_ID, { name: 'P3 DecLink' });
    const experiment = service.createExperiment(USER_ID, project.project.id, { title: 'E' });
    const run = service.createRun(USER_ID, experiment.id, { seed: '1' });
    const claim = service.createClaim(USER_ID, project.project.id, { statement: 'C' });
    const evidence = service.createEvidence(USER_ID, project.project.id, { evidenceType: 'experiment_run', sourceId: run.id, title: 'Ev' });
    const decision = service.createDecision(USER_ID, project.project.id, { title: 'D1' });

    service.createEntityLink(USER_ID, { sourceType: 'decision', sourceId: decision.id, targetType: 'experiment', targetId: experiment.id, relationType: 'references' });
    service.createEntityLink(USER_ID, { sourceType: 'decision', sourceId: decision.id, targetType: 'claim', targetId: claim.id, relationType: 'references' });
    service.createEntityLink(USER_ID, { sourceType: 'decision', sourceId: decision.id, targetType: 'evidence', targetId: evidence.id, relationType: 'references' });

    const detail = service.getDecision(USER_ID, decision.id);
    expect(detail.relations).toHaveLength(3);
    const types = detail.relations.map((l) => l.targetType).sort();
    expect(types).toEqual(['claim', 'evidence', 'experiment']);
  });

  it('22. cross-project decision link is isolated', () => {
    const pA = service.createProject(USER_ID, { name: 'P3 DIsoA' });
    const pB = service.createProject(USER_ID, { name: 'P3 DIsoB' });
    const decision = service.createDecision(USER_ID, pA.project.id, { title: 'DA' });
    const claimB = service.createClaim(USER_ID, pB.project.id, { statement: 'B' });
    expect(() => service.createEntityLink(USER_ID, {
      sourceType: 'decision', sourceId: decision.id, targetType: 'claim', targetId: claimB.id, relationType: 'references',
    })).toThrow(RfValidationError);
  });
});

describe('Phase 3 literature', () => {
  it('23. literature CRUD', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Lit' });
    const item = service.createLiterature(USER_ID, project.project.id, {
      title: 'Attention Is All You Need', authors: 'Vaswani et al.', year: 2017,
      relation: 'baseline', readStatus: 'deep_read', priority: 'high', keyFinding: 'Transformer',
    });
    expect(item.title).toBe('Attention Is All You Need');
    const updated = service.updateLiterature(USER_ID, item.id, { readStatus: 'cited' });
    expect(updated.readStatus).toBe('cited');
    expect(service.listLiterature(USER_ID, project.project.id)).toHaveLength(1);
    service.deleteLiterature(USER_ID, item.id);
    expect(service.listLiterature(USER_ID, project.project.id)).toHaveLength(0);
  });

  it('24. literature enum validation', () => {
    const project = service.createProject(USER_ID, { name: 'P3 LitEnum' });
    expect(() => service.createLiterature(USER_ID, project.project.id, {
      title: 'X', relation: 'not_a_relation',
    })).toThrow(RfValidationError);
    expect(() => service.createLiterature(USER_ID, project.project.id, {
      title: 'X', readStatus: 'not_a_status',
    })).toThrow(RfValidationError);
  });
});

describe('Phase 3 figures & tables', () => {
  it('25. creates a figure with auto FIG-01 code', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Fig' });
    const figure = service.createFigureTable(USER_ID, project.project.id, {
      type: 'figure', workingTitle: 'Main results', status: 'draft',
    });
    expect(figure.code).toBe('FIG-01');
    expect(figure.frozen).toBe(false);
  });

  it('26. links figure -> run (provenance)', () => {
    const project = service.createProject(USER_ID, { name: 'P3 FigRun' });
    const experiment = service.createExperiment(USER_ID, project.project.id, { title: 'E' });
    const run = service.createRun(USER_ID, experiment.id, { seed: '1', status: 'completed' });
    const figure = service.createFigureTable(USER_ID, project.project.id, { type: 'figure', workingTitle: 'F' });
    service.createEntityLink(USER_ID, {
      sourceType: 'figure_table', sourceId: figure.id, targetType: 'experiment_run', targetId: run.id, relationType: 'produces',
    });
    const detail = service.getFigureTable(USER_ID, figure.id);
    expect(detail.relations[0].targetType).toBe('experiment_run');
    expect(detail.relations[0].targetId).toBe(run.id);
  });

  it('27. links figure -> claim', () => {
    const project = service.createProject(USER_ID, { name: 'P3 FigClaim' });
    const claim = service.createClaim(USER_ID, project.project.id, { statement: 'C' });
    const figure = service.createFigureTable(USER_ID, project.project.id, { type: 'figure', workingTitle: 'F2' });
    service.createEntityLink(USER_ID, {
      sourceType: 'figure_table', sourceId: figure.id, targetType: 'claim', targetId: claim.id, relationType: 'supports',
    });
    expect(service.listEntityLinksForEntity(USER_ID, 'figure_table', figure.id)).toHaveLength(1);
  });

  it('28. provenance traversal: figure -> run -> claim', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Prov' });
    const experiment = service.createExperiment(USER_ID, project.project.id, { title: 'E' });
    const run = service.createRun(USER_ID, experiment.id, { seed: '3', status: 'completed', gitCommit: 'abc1234' });
    const claim = service.createClaim(USER_ID, project.project.id, { statement: 'Provenance claim' });
    const figure = service.createFigureTable(USER_ID, project.project.id, { type: 'figure', workingTitle: 'Fig 4' });
    service.createEntityLink(USER_ID, { sourceType: 'figure_table', sourceId: figure.id, targetType: 'experiment_run', targetId: run.id, relationType: 'produces' });
    service.createEntityLink(USER_ID, { sourceType: 'figure_table', sourceId: figure.id, targetType: 'claim', targetId: claim.id, relationType: 'supports' });

    // "Where did Figure 4 come from?" -> run, with git commit + config.
    const figureDetail = service.getFigureTable(USER_ID, figure.id);
    const runLink = figureDetail.relations.find((l) => l.targetType === 'experiment_run');
    const runDetail = service.getRun(USER_ID, run.id);
    expect(runDetail.gitCommit).toBe('abc1234');
    expect(runDetail.seed).toBe('3');
    // Claim side also reachable.
    const claimLinks = service.listEntityLinksForEntity(USER_ID, 'claim', claim.id);
    expect(claimLinks.some((l) => l.sourceId === figure.id)).toBe(true);
    expect(runLink).toBeTruthy();
  });
});

describe('Phase 3 migration', () => {
  it('29. fresh DB applies both migrations with all 9 Phase 3 tables', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'rf_%' ORDER BY name"
    ).all().map((r) => r.name);
    for (const table of ['rf_experiments', 'rf_experiment_runs', 'rf_claims', 'rf_evidence',
      'rf_claim_evidence', 'rf_decisions', 'rf_literature', 'rf_figures_tables', 'rf_entity_links']) {
      expect(tables).toContain(table);
    }
    const versions = db.prepare('SELECT version FROM rf_schema_migrations ORDER BY version').all().map((r) => r.version);
    expect(versions).toEqual([1, 2, 3]);
  });

  it('30. migration re-run is idempotent', () => {
    const applied = runResearchFlowMigrations(db);
    expect(applied).toBe(0);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'rf_%' ORDER BY name"
    ).all().map((r) => r.name);
    expect(tables.filter((t) => t === 'rf_experiments')).toHaveLength(1);
  });

  it('31. migration upgrade path: drop v2 schema, re-run restores it', () => {
    db.exec('DROP TABLE rf_entity_links; DROP TABLE rf_figures_tables; DROP TABLE rf_literature; DROP TABLE rf_decisions; DROP TABLE rf_claim_evidence; DROP TABLE rf_evidence; DROP TABLE rf_claims; DROP TABLE rf_experiment_runs; DROP TABLE rf_experiments;');
    db.prepare('DELETE FROM rf_schema_migrations WHERE version = 2').run();
    const applied = runResearchFlowMigrations(db);
    expect(applied).toBe(1);
    const exists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rf_experiments'"
    ).get();
    expect(exists).toBeTruthy();
    // Phase 1 data untouched.
    expect(db.prepare('SELECT COUNT(*) AS c FROM rf_projects').get().c).toBeGreaterThan(0);
  });

  it('32. DB reopen persists Phase 3 data', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Persist' });
    const experiment = service.createExperiment(USER_ID, project.project.id, { title: 'Persist me' });
    const run = service.createRun(USER_ID, experiment.id, { seed: '99', status: 'failed', failureClassification: 'resource_limit' });
    reopenDb();
    const detail = service.getExperiment(USER_ID, experiment.id);
    expect(detail.title).toBe('Persist me');
    expect(detail.runs[0].status).toBe('failed');
    expect(detail.runs[0].failureClassification).toBe('resource_limit');
  });
});

describe('Phase 3 activity log', () => {
  it('33. experiment/run/claim/evidence mutations create expected events', () => {
    const project = service.createProject(USER_ID, { name: 'P3 Act' });
    const experiment = service.createExperiment(USER_ID, project.project.id, { title: 'A' });
    const run = service.createRun(USER_ID, experiment.id, { seed: '1' });
    service.updateRun(USER_ID, run.id, { status: 'failed', failureClassification: 'implementation_bug', failureReason: 'bug' });
    const claim = service.createClaim(USER_ID, project.project.id, { statement: 'C' });
    service.updateClaim(USER_ID, claim.id, { status: 'partial' });
    const evidence = service.createEvidence(USER_ID, project.project.id, { evidenceType: 'analysis_note', title: 'E' });
    service.linkClaimEvidence(USER_ID, { claimId: claim.id, evidenceId: evidence.id, relationType: 'supports' });

    const actions = service.listActivity(USER_ID, project.project.id, { limit: 100 }).map((a) => a.action);
    for (const expected of [
      'experiment_created', 'experiment_run_created', 'experiment_run_failed',
      'claim_created', 'claim_status_changed', 'evidence_created', 'claim_evidence_linked',
    ]) {
      expect(actions).toContain(expected);
    }
  });
});
