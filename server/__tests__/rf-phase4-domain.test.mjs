// ResearchFlow Phase 4 domain tests — manuscript, results freeze, review,
// submission, migration v3, activity. Service-level, isolated temp DB.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runResearchFlowMigrations, createResearchFlowServiceFor } from '../rf/index.js';
import { RfValidationError, RfNotFoundError, RfConflictError } from '../rf/errors.js';

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
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'rf-p4-domain-'));
  dbPath = path.join(tmpDir, 'rf.db');
  reopenDb();
});

afterAll(async () => {
  if (db) db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

const createProject = (name = 'P4 Project') => service.createProject(USER_ID, { name });

const passStageGates = (projectDetail, key) => {
  const stage = projectDetail.stages.find((s) => s.key === key);
  for (const gate of stage.gates) {
    service.patchGate(USER_ID, gate.id, { isPassed: true });
  }
};

/** Project fully prepared for submission: gates, manuscript, freeze, checklist. */
const makeReadyProject = (name = 'P4 Ready') => {
  const project = createProject(name);
  const projectId = project.project.id;
  passStageGates(project, 'validation');
  passStageGates(project, 'submission');
  service.initializeManuscript(USER_ID, projectId);
  for (const section of service.getManuscript(USER_ID, projectId).sections) {
    service.updateManuscriptSection(USER_ID, section.id, { status: 'draft' });
  }
  service.createResultsFreeze(USER_ID, projectId, {});
  const profile = service.createSubmissionProfile(USER_ID, projectId, { venue: 'ICLR 2027' });
  for (const item of profile.items) {
    service.updateSubmissionItem(USER_ID, item.id, { status: 'done' });
  }
  return { project, projectId, profileId: profile.id };
};

describe('Phase 4 manuscript', () => {
  it('1. initializes the default manuscript template', () => {
    const project = createProject('P4 MS1');
    const sections = service.initializeManuscript(USER_ID, project.project.id);
    expect(sections).toHaveLength(9);
    expect(sections.map((section) => section.sectionKey)).toEqual([
      'abstract', 'introduction', 'related_work', 'method', 'experiments',
      'discussion', 'conclusion', 'references', 'appendix',
    ]);
    expect(sections.every((section) => section.status === 'not_started')).toBe(true);
  });

  it('2. initialization is idempotent', () => {
    const project = createProject('P4 MS2');
    service.initializeManuscript(USER_ID, project.project.id);
    const again = service.initializeManuscript(USER_ID, project.project.id);
    expect(again).toHaveLength(9);
    const rows = db.prepare('SELECT COUNT(*) AS c FROM rf_manuscript_sections WHERE project_id = ?').get(project.project.id);
    expect(rows.c).toBe(9);
  });

  it('3. section status transitions are explicit and logged', () => {
    const project = createProject('P4 MS3');
    service.initializeManuscript(USER_ID, project.project.id);
    const manuscript = service.getManuscript(USER_ID, project.project.id);
    const section = manuscript.sections.find((s) => s.sectionKey === 'introduction');
    service.updateManuscriptSection(USER_ID, section.id, { status: 'draft' });
    const updated = service.updateManuscriptSection(USER_ID, section.id, { status: 'final' });
    expect(updated.status).toBe('final');
    const actions = service.listActivity(USER_ID, project.project.id, { limit: 50 }).map((a) => a.action);
    expect(actions).toContain('manuscript_section_finalized');
    expect(actions).toContain('manuscript_section_status_changed');
  });

  it('4. required section completeness is deterministic', () => {
    const project = createProject('P4 MS4');
    service.initializeManuscript(USER_ID, project.project.id);
    let manuscript = service.getManuscript(USER_ID, project.project.id);
    // 7 required sections (discussion + appendix optional); none started.
    expect(manuscript.completeness.totalRequiredSections).toBe(7);
    expect(manuscript.completeness.requiredSectionsComplete).toBe(false);
    expect(manuscript.completeness.sectionsNotStarted).toBe(9);

    for (const section of manuscript.sections) {
      if (!section.isOptional) {
        service.updateManuscriptSection(USER_ID, section.id, { status: 'draft' });
      }
    }
    manuscript = service.getManuscript(USER_ID, project.project.id);
    expect(manuscript.completeness.requiredSectionsComplete).toBe(true);
    expect(manuscript.completeness.sectionsDraftOrBetter).toBe(7);
  });

  it('5. section <-> claim link via entity links', () => {
    const project = createProject('P4 MS5');
    service.initializeManuscript(USER_ID, project.project.id);
    const section = service.getManuscript(USER_ID, project.project.id).sections.find((s) => s.sectionKey === 'method');
    const claim = service.createClaim(USER_ID, project.project.id, { statement: 'Method claim', importance: 'core' });
    service.createEntityLink(USER_ID, {
      sourceType: 'manuscript_section', sourceId: section.id,
      targetType: 'claim', targetId: claim.id, relationType: 'references',
    });
    const manuscript = service.getManuscript(USER_ID, project.project.id);
    const methodSection = manuscript.sections.find((s) => s.sectionKey === 'method');
    expect(methodSection.relations.some((link) => link.targetType === 'claim' && link.targetId === claim.id)).toBe(true);
    expect(manuscript.completeness.claimsNotAssignedToSection).toBe(0);
  });

  it('6. section <-> figure/table link via entity links', () => {
    const project = createProject('P4 MS6');
    service.initializeManuscript(USER_ID, project.project.id);
    const section = service.getManuscript(USER_ID, project.project.id).sections.find((s) => s.sectionKey === 'experiments');
    const figure = service.createFigureTable(USER_ID, project.project.id, { type: 'figure', workingTitle: 'Fig 1' });
    const table = service.createFigureTable(USER_ID, project.project.id, { type: 'table', workingTitle: 'Tbl 1' });
    service.createEntityLink(USER_ID, {
      sourceType: 'manuscript_section', sourceId: section.id,
      targetType: 'figure_table', targetId: figure.id, relationType: 'references',
    });
    const manuscript = service.getManuscript(USER_ID, project.project.id);
    expect(manuscript.completeness.figuresNotAssignedToSection).toBe(0);
    expect(manuscript.completeness.tablesNotAssignedToSection).toBe(1);
  });

  it('7. cross-project section-claim links are rejected', () => {
    const pA = createProject('P4 MS7A');
    const pB = createProject('P4 MS7B');
    service.initializeManuscript(USER_ID, pA.project.id);
    const sectionA = service.getManuscript(USER_ID, pA.project.id).sections[0];
    const claimB = service.createClaim(USER_ID, pB.project.id, { statement: 'B' });
    expect(() => service.createEntityLink(USER_ID, {
      sourceType: 'manuscript_section', sourceId: sectionA.id,
      targetType: 'claim', targetId: claimB.id, relationType: 'references',
    })).toThrow(RfValidationError);
  });

  it('8. claim without section is detected', () => {
    const project = createProject('P4 MS8');
    service.initializeManuscript(USER_ID, project.project.id);
    const core = service.createClaim(USER_ID, project.project.id, { statement: 'Unassigned core claim', importance: 'core' });
    const assigned = service.createClaim(USER_ID, project.project.id, { statement: 'Assigned claim', importance: 'supporting' });
    const section = service.getManuscript(USER_ID, project.project.id).sections.find((s) => s.sectionKey === 'method');
    service.createEntityLink(USER_ID, {
      sourceType: 'manuscript_section', sourceId: section.id,
      targetType: 'claim', targetId: assigned.id, relationType: 'references',
    });
    const manuscript = service.getManuscript(USER_ID, project.project.id);
    expect(manuscript.completeness.claimsNotAssignedToSection).toBe(1);
    expect(core.id).toBeTruthy();
  });
});

describe('Phase 4 results freeze', () => {
  it('9. freeze readiness succeeds when validation gates pass and no blockers', () => {
    const project = createProject('P4 FZ9');
    passStageGates(project, 'validation');
    const readiness = service.getFreezeReadiness(USER_ID, project.project.id);
    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
  });

  it('10. critical missing evidence blocks freeze', () => {
    const project = createProject('P4 FZ10');
    passStageGates(project, 'validation');
    service.createClaim(USER_ID, project.project.id, { statement: 'Core claim', importance: 'core' });
    const readiness = service.getFreezeReadiness(USER_ID, project.project.id);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.some((blocker) => blocker.code === 'core_claim_missing_evidence')).toBe(true);
    expect(() => service.createResultsFreeze(USER_ID, project.project.id, {}))
      .toThrow(RfConflictError);
  });

  it('11. incomplete required gate blocks freeze', () => {
    const project = createProject('P4 FZ11');
    const readiness = service.getFreezeReadiness(USER_ID, project.project.id);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.some((blocker) => blocker.code === 'validation_gates_incomplete')).toBe(true);
  });

  it('12. override requires a non-empty reason', () => {
    const project = createProject('P4 FZ12');
    service.createClaim(USER_ID, project.project.id, { statement: 'Core claim', importance: 'core' });
    expect(() => service.createResultsFreeze(USER_ID, project.project.id, { overrideReason: '' }))
      .toThrow(RfConflictError);
    const freeze = service.createResultsFreeze(USER_ID, project.project.id, { overrideReason: 'We accept the risk; results are stable' });
    expect(freeze.overrideReason).toBe('We accept the risk; results are stable');
    expect(freeze.freezeNumber).toBe(1);
  });

  it('13. override is logged', () => {
    const project = createProject('P4 FZ13');
    passStageGates(project, 'validation');
    service.createClaim(USER_ID, project.project.id, { statement: 'Core claim', importance: 'core' });
    service.createResultsFreeze(USER_ID, project.project.id, { overrideReason: 'Accepting risk' });
    const actions = service.listActivity(USER_ID, project.project.id, { limit: 50 }).map((a) => a.action);
    expect(actions).toContain('results_freeze_overridden');
  });

  it('14. freeze snapshot is immutable (no mutation API, snapshot persists)', () => {
    const project = createProject('P4 FZ14');
    passStageGates(project, 'validation');
    service.createResultsFreeze(USER_ID, project.project.id, {});
    const freezes = service.listResultFreezes(USER_ID, project.project.id);
    expect(freezes).toHaveLength(1);
    const snapshot = freezes[0].snapshot;
    expect(snapshot.claims).toEqual([]);
    expect(snapshot.capturedAt).toBeTruthy();
    // No update/delete methods exist on the service surface.
    expect(typeof service.updateResultFreeze).toBe('undefined');
    expect(typeof service.deleteResultFreeze).toBe('undefined');
    // Snapshot stored verbatim in DB.
    const stored = db.prepare('SELECT snapshot_json FROM rf_result_freezes WHERE id = ?').get(freezes[0].id);
    expect(stored.snapshot_json).toBe(JSON.stringify(snapshot));
  });

  it('15. multiple freezes are supported with increasing numbers', () => {
    const project = createProject('P4 FZ15');
    passStageGates(project, 'validation');
    service.createResultsFreeze(USER_ID, project.project.id, {});
    service.createResultsFreeze(USER_ID, project.project.id, {});
    const freezes = service.listResultFreezes(USER_ID, project.project.id);
    expect(freezes.map((freeze) => freeze.freezeNumber)).toEqual([2, 1]);
  });

  it('16. post-freeze change marks the freeze stale', () => {
    const project = createProject('P4 FZ16');
    passStageGates(project, 'validation');
    service.createResultsFreeze(USER_ID, project.project.id, {});
    const statusBefore = service.buildFreezeStatus(USER_ID, project.project.id);
    expect(statusBefore.staleness.state).toBe('current');

    const claim = service.createClaim(USER_ID, project.project.id, { statement: 'Core claim', importance: 'core', status: 'unverified' });
    service.updateClaim(USER_ID, claim.id, { status: 'supported' });

    const statusAfter = service.buildFreezeStatus(USER_ID, project.project.id);
    expect(statusAfter.staleness.state).toBe('stale');
    expect(statusAfter.staleness.reasons.some((reason) => reason.includes('Claim'))).toBe(true);
  });

  it('17. unrelated project change does not mark a freeze stale', () => {
    const pA = createProject('P4 FZ17A');
    passStageGates(pA, 'validation');
    service.createResultsFreeze(USER_ID, pA.project.id, {});
    const pB = createProject('P4 FZ17B');
    service.createClaim(USER_ID, pB.project.id, { statement: 'B claim', importance: 'core' });
    const statusA = service.buildFreezeStatus(USER_ID, pA.project.id);
    expect(statusA.staleness.state).toBe('current');
  });
});

describe('Phase 4 review', () => {
  it('18. creates a review comment with auto RC-001 code', () => {
    const project = createProject('P4 RV18');
    const comment = service.createReviewComment(USER_ID, project.project.id, {
      title: 'Compute claim unsupported', severity: 'critical', body: 'No evidence for compute claim.',
    });
    expect(comment.code).toBe('RC-001');
    expect(comment.severity).toBe('critical');
    expect(comment.status).toBe('open');
  });

  it('19. severity is validated', () => {
    const project = createProject('P4 RV19');
    expect(() => service.createReviewComment(USER_ID, project.project.id, {
      title: 'X', severity: 'not_a_severity',
    })).toThrow(RfValidationError);
  });

  it('20. resolve/reopen are explicit actions', () => {
    const project = createProject('P4 RV20');
    const comment = service.createReviewComment(USER_ID, project.project.id, { title: 'Fix it', severity: 'major' });
    const resolved = service.updateReviewComment(USER_ID, comment.id, { status: 'resolved' });
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedAt).toBeTruthy();
    const reopened = service.updateReviewComment(USER_ID, comment.id, { status: 'open' });
    expect(reopened.status).toBe('open');
    expect(reopened.resolvedAt).toBeNull();
    const actions = service.listActivity(USER_ID, project.project.id, { limit: 50 }).map((a) => a.action);
    expect(actions).toContain('review_comment_resolved');
    expect(actions).toContain('review_comment_reopened');
  });

  it('21. unresolved Critical comments are detected', () => {
    const project = createProject('P4 RV21');
    service.createReviewComment(USER_ID, project.project.id, { title: 'Critical issue', severity: 'critical' });
    service.createReviewComment(USER_ID, project.project.id, { title: 'Minor note', severity: 'minor' });
    const { summary } = service.listReviewComments(USER_ID, project.project.id);
    expect(summary.openCritical).toBe(1);
    expect(summary.openMinor).toBe(1);
    expect(summary.hasOpenCritical).toBe(true);
  });

  it('22. review comment can relate to a manuscript section', () => {
    const project = createProject('P4 RV22');
    service.initializeManuscript(USER_ID, project.project.id);
    const section = service.getManuscript(USER_ID, project.project.id).sections.find((s) => s.sectionKey === 'method');
    const comment = service.createReviewComment(USER_ID, project.project.id, {
      title: 'Method clarity', manuscriptSectionId: section.id, severity: 'major',
    });
    expect(comment.manuscriptSectionId).toBe(section.id);
    const { comments } = service.listReviewComments(USER_ID, project.project.id);
    expect(comments[0].sectionTitle).toBe('Method');
  });

  it('23. cross-project review isolation', () => {
    const project = createProject('P4 RV23');
    const comment = service.createReviewComment(USER_ID, project.project.id, { title: 'Private' });
    expect(() => service.updateReviewComment(OTHER_USER_ID, comment.id, { status: 'resolved' })).toThrow(RfNotFoundError);
  });
});

describe('Phase 4 submission', () => {
  it('24. creates a submission profile', () => {
    const project = createProject('P4 SUB24');
    const profile = service.createSubmissionProfile(USER_ID, project.project.id, {
      venue: 'NeurIPS 2027', deadline: '2027-05-01', anonymous: true,
    });
    expect(profile.venue).toBe('NeurIPS 2027');
    expect(profile.anonymous).toBe(true);
    expect(profile.status).toBe('preparing');
  });

  it('25. default checklist is initialized', () => {
    const project = createProject('P4 SUB25');
    const profile = service.createSubmissionProfile(USER_ID, project.project.id, { venue: 'ICML 2027' });
    expect(profile.items).toHaveLength(19);
    const categories = new Set(profile.items.map((item) => item.category));
    expect(categories).toEqual(new Set(['paper', 'experiments', 'artifacts', 'portal']));
  });

  it('26. checklist initialization is idempotent per profile', () => {
    const project = createProject('P4 SUB26');
    const p1 = service.createSubmissionProfile(USER_ID, project.project.id, { venue: 'A' });
    const p2 = service.createSubmissionProfile(USER_ID, project.project.id, { venue: 'B' });
    expect(p1.items).toHaveLength(19);
    expect(p2.items).toHaveLength(19);
    const total = db.prepare('SELECT COUNT(*) AS c FROM rf_submission_items WHERE project_id = ?').get(project.project.id);
    expect(total.c).toBe(38);
  });

  it('27. required checklist incomplete -> not ready', () => {
    const project = createProject('P4 SUB27');
    const profile = service.createSubmissionProfile(USER_ID, project.project.id, { venue: 'A' });
    const readiness = service.getSubmissionReadiness(USER_ID, profile.id);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.some((blocker) => blocker.code === 'checklist_incomplete')).toBe(true);
  });

  it('28. all required complete + readiness conditions -> ready', () => {
    const { projectId, profileId } = makeReadyProject('P4 SUB28');
    const readiness = service.getSubmissionReadiness(USER_ID, profileId);
    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
    const profile = service.getSubmissionProfile(USER_ID, profileId);
    expect(profile.status).toBe('submission_ready');
    expect(projectId).toBeTruthy();
  });

  it('29. waived items count as satisfied', () => {
    const { profileId } = makeReadyProject('P4 SUB29');
    // Reopen one required item, then waive it: still ready.
    const profile = service.getSubmissionProfile(USER_ID, profileId);
    const item = profile.items.find((i) => i.required);
    service.updateSubmissionItem(USER_ID, item.id, { status: 'todo' });
    expect(service.getSubmissionReadiness(USER_ID, profileId).ready).toBe(false);
    service.updateSubmissionItem(USER_ID, item.id, { status: 'waived' });
    expect(service.getSubmissionReadiness(USER_ID, profileId).ready).toBe(true);
  });

  it('30. reopening a required item loses readiness', () => {
    const { profileId } = makeReadyProject('P4 SUB30');
    const profile = service.getSubmissionProfile(USER_ID, profileId);
    const item = profile.items.find((i) => i.required);
    service.updateSubmissionItem(USER_ID, item.id, { status: 'todo' });
    const readiness = service.getSubmissionReadiness(USER_ID, profileId);
    expect(readiness.ready).toBe(false);
    const after = service.getSubmissionProfile(USER_ID, profileId);
    expect(after.status).toBe('preparing');
    const actions = service.listActivity(USER_ID, after.projectId, { limit: 100 }).map((a) => a.action);
    expect(actions).toContain('submission_ready_lost');
  });

  it('31. stale freeze loses readiness', () => {
    const { projectId, profileId } = makeReadyProject('P4 SUB31');
    const claim = service.createClaim(USER_ID, projectId, { statement: 'Core claim', importance: 'core', status: 'unverified' });
    service.updateClaim(USER_ID, claim.id, { status: 'supported' });
    expect(service.getSubmissionReadiness(USER_ID, profileId).ready).toBe(false);
    const readiness = service.getSubmissionReadiness(USER_ID, profileId);
    expect(readiness.blockers.some((blocker) => blocker.code === 'freeze_stale')).toBe(true);
  });

  it('32. critical review comment loses readiness', () => {
    const { projectId, profileId } = makeReadyProject('P4 SUB32');
    service.createReviewComment(USER_ID, projectId, { title: 'Critical issue', severity: 'critical' });
    const readiness = service.getSubmissionReadiness(USER_ID, profileId);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.some((blocker) => blocker.code === 'critical_review_comments_open')).toBe(true);
  });

  it('32b. mutations flip persisted status without touching the checklist (review fix)', () => {
    const { projectId, profileId } = makeReadyProject('P4 SUB32b');
    expect(service.getSubmissionProfile(USER_ID, profileId).status).toBe('submission_ready');

    // Opening a Critical comment flips persisted status -> preparing.
    const comment = service.createReviewComment(USER_ID, projectId, { title: 'New critical', severity: 'critical' });
    expect(service.getSubmissionProfile(USER_ID, profileId).status).toBe('preparing');

    // Resolving it flips back -> submission_ready (mutation-triggered recalc).
    service.updateReviewComment(USER_ID, comment.id, { status: 'resolved' });
    expect(service.getSubmissionProfile(USER_ID, profileId).status).toBe('submission_ready');

    // A new core claim without evidence also flips it back down.
    service.createClaim(USER_ID, projectId, { statement: 'New core claim', importance: 'core' });
    expect(service.getSubmissionProfile(USER_ID, profileId).status).toBe('preparing');
  });

  it('33. missing core evidence loses readiness', () => {
    const { projectId, profileId } = makeReadyProject('P4 SUB33');
    service.createClaim(USER_ID, projectId, { statement: 'New core claim', importance: 'core' });
    const readiness = service.getSubmissionReadiness(USER_ID, profileId);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.some((blocker) => blocker.code === 'core_claim_missing_evidence')).toBe(true);
  });

  it('34. mark-submitted requires an explicit endpoint with confirmation', () => {
    const project = createProject('P4 SUB34');
    const profile = service.createSubmissionProfile(USER_ID, project.project.id, { venue: 'A' });
    expect(() => service.markSubmitted(USER_ID, profile.id, {}))
      .toThrow(RfValidationError);
    expect(() => service.markSubmitted(USER_ID, profile.id, { confirmation: false }))
      .toThrow(RfValidationError);
    const submitted = service.markSubmitted(USER_ID, profile.id, {
      confirmation: true, finalPaperPath: 'paper.pdf', externalSubmissionId: 'OPENREVIEW-123',
    });
    expect(submitted.status).toBe('submitted');
    expect(submitted.finalPaperPath).toBe('paper.pdf');
  });

  it('35. Submitted persists even if readiness later changes', () => {
    const { projectId, profileId } = makeReadyProject('P4 SUB35');
    const submitted = service.markSubmitted(USER_ID, profileId, { confirmation: true });
    expect(submitted.status).toBe('submitted');
    // Break readiness conditions through a scientific change (checklist is
    // locked once submitted).
    service.createClaim(USER_ID, projectId, { statement: 'Late core claim', importance: 'core' });
    const after = service.getSubmissionProfile(USER_ID, profileId);
    expect(after.status).toBe('submitted');
    const readiness = service.getSubmissionReadiness(USER_ID, profileId);
    expect(readiness.ready).toBe(false);
  });

  it('36. submission timestamp is persisted', () => {
    const project = createProject('P4 SUB36');
    const profile = service.createSubmissionProfile(USER_ID, project.project.id, { venue: 'A' });
    const submitted = service.markSubmitted(USER_ID, profile.id, { confirmation: true });
    expect(submitted.submittedAt).toBeTruthy();
    const stored = db.prepare('SELECT submitted_at FROM rf_submission_profiles WHERE id = ?').get(profile.id);
    expect(stored.submitted_at).toBeTruthy();
  });
});

describe('Phase 4 migration', () => {
  it('37. fresh DB applies migrations 1..3 with all Phase 4 tables', () => {
    const versions = db.prepare('SELECT version FROM rf_schema_migrations ORDER BY version').all().map((r) => r.version);
    expect(versions).toEqual([1, 2, 3]);
    for (const table of ['rf_manuscript_sections', 'rf_result_freezes', 'rf_review_comments',
      'rf_submission_profiles', 'rf_submission_items']) {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      expect(exists).toBeTruthy();
    }
  });

  it('38. upgrade path: drop v3 schema, re-run restores it without touching v1/v2 data', () => {
    const project = service.createProject(USER_ID, { name: 'P4 Mig38' });
    const experiment = service.createExperiment(USER_ID, project.project.id, { title: 'Keep me' });
    db.exec(`
      DROP TABLE rf_submission_items; DROP TABLE rf_submission_profiles;
      DROP TABLE rf_review_comments; DROP TABLE rf_result_freezes; DROP TABLE rf_manuscript_sections;
    `);
    db.prepare('DELETE FROM rf_schema_migrations WHERE version = 3').run();
    const applied = runResearchFlowMigrations(db);
    expect(applied).toBe(1);
    const section = service.initializeManuscript(USER_ID, project.project.id);
    expect(section).toHaveLength(9);
    // Phase 1/3 data untouched.
    expect(service.getExperiment(USER_ID, experiment.id).title).toBe('Keep me');
  });

  it('39. migration re-run is idempotent', () => {
    const applied = runResearchFlowMigrations(db);
    expect(applied).toBe(0);
  });

  it('40. DB reopen persists Phase 4 data', () => {
    const project = createProject('P4 Mig40');
    service.initializeManuscript(USER_ID, project.project.id);
    const profile = service.createSubmissionProfile(USER_ID, project.project.id, { venue: 'Persist' });
    service.updateManuscriptSection(USER_ID, service.getManuscript(USER_ID, project.project.id).sections[0].id, { status: 'draft' });
    reopenDb();
    const manuscript = service.getManuscript(USER_ID, project.project.id);
    expect(manuscript.sections[0].status).toBe('draft');
    expect(service.getSubmissionProfile(USER_ID, profile.id).venue).toBe('Persist');
  });
});

describe('Phase 4 activity log', () => {
  it('41. freeze activities are recorded', () => {
    const project = createProject('P4 ACT41');
    passStageGates(project, 'validation');
    service.createResultsFreeze(USER_ID, project.project.id, {});
    const actions = service.listActivity(USER_ID, project.project.id, { limit: 50 }).map((a) => a.action);
    expect(actions).toContain('results_freeze_created');
  });

  it('42. review activities are recorded', () => {
    const project = createProject('P4 ACT42');
    const comment = service.createReviewComment(USER_ID, project.project.id, { title: 'X', severity: 'minor' });
    service.updateReviewComment(USER_ID, comment.id, { status: 'resolved' });
    const actions = service.listActivity(USER_ID, project.project.id, { limit: 50 }).map((a) => a.action);
    expect(actions).toContain('review_comment_created');
    expect(actions).toContain('review_comment_resolved');
  });

  it('43. submission-ready achieved/lost activities are recorded', () => {
    const { projectId, profileId } = makeReadyProject('P4 ACT43');
    const profile = service.getSubmissionProfile(USER_ID, profileId);
    const item = profile.items.find((i) => i.required);
    service.updateSubmissionItem(USER_ID, item.id, { status: 'todo' });
    const actions = service.listActivity(USER_ID, projectId, { limit: 100 }).map((a) => a.action);
    expect(actions).toContain('submission_ready_achieved');
    expect(actions).toContain('submission_ready_lost');
  });

  it('44. submitted activity is recorded', () => {
    const project = createProject('P4 ACT44');
    const profile = service.createSubmissionProfile(USER_ID, project.project.id, { venue: 'A' });
    service.markSubmitted(USER_ID, profile.id, { confirmation: true });
    const actions = service.listActivity(USER_ID, project.project.id, { limit: 50 }).map((a) => a.action);
    expect(actions).toContain('paper_marked_submitted');
  });
});
