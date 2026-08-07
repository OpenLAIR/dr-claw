// ResearchFlow REST API tests — authenticated (JWT) mode.
// Uses an isolated temporary DATABASE_PATH and dynamic imports so the legacy
// db.js singleton binds to the test database, not the real one.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let tmpDir;
let dbPath;
let express;
let dbModule;
let auth;
let rfRoutes;
let app;
let server;
let baseUrl;
let userA;
let tokenA;
let userB;
let tokenB;

const listen = (appInstance) => new Promise((resolve) => {
  const instance = appInstance.listen(0, '127.0.0.1', () => {
    resolve(instance);
  });
});

const api = (method, url, { body, token } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}${url}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
};

beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'rf-api-'));
  dbPath = path.join(tmpDir, 'auth.db');
  process.env.DATABASE_PATH = dbPath;

  vi.resetModules();
  express = (await import('express')).default;
  dbModule = await import('../database/db.js');
  await dbModule.initializeDatabase();
  const rf = await import('../rf/index.js');
  await rf.runResearchFlowMigrations(dbModule.db);
  auth = await import('../middleware/auth.js');
  rfRoutes = (await import('../routes/rf.js')).default;

  userA = dbModule.userDb.createUser('rfa', 'hash');
  userB = dbModule.userDb.createUser('rfb', 'hash');
  tokenA = auth.generateToken(userA);
  tokenB = auth.generateToken(userB);

  app = express();
  app.use(express.json());
  app.use('/api/rf', auth.authenticateToken, rfRoutes);
  server = await listen(app);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) server.close();
  if (dbModule?.db) dbModule.db.close();
  delete process.env.DATABASE_PATH;
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

describe('ResearchFlow REST API (authenticated mode)', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await api('GET', '/api/rf/projects');
    expect(res.status).toBe(401);
  });

  it('creates a project and initializes 10 stages', async () => {
    const res = await api('POST', '/api/rf/projects', {
      token: tokenA,
      body: { name: 'API Project', targetVenue: 'NeurIPS 2027' },
    });
    expect(res.status).toBe(201);
    const { success, data } = await res.json();
    expect(success).toBe(true);
    expect(data.project.name).toBe('API Project');
    expect(data.project.targetVenue).toBe('NeurIPS 2027');
    expect(data.stages).toHaveLength(10);
    expect(data.stages[0].status).toBe('current');
  });

  it('rejects invalid payloads with 400', async () => {
    const res = await api('POST', '/api/rf/projects', { token: tokenA, body: {} });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('RF_VALIDATION');
  });

  it('requires all gates before completing a stage, then completes it', async () => {
    const created = await api('POST', '/api/rf/projects', {
      token: tokenA,
      body: { name: 'Gate Project' },
    });
    const { data } = await created.json();
    const stage = data.stages[0];

    const blocked = await api('POST', `/api/rf/stages/${stage.id}/complete`, { token: tokenA });
    expect(blocked.status).toBe(409);

    for (const gate of stage.gates) {
      const patched = await api('PATCH', `/api/rf/gates/${gate.id}`, {
        token: tokenA,
        body: { isPassed: true },
      });
      expect(patched.status).toBe(200);
    }

    const completed = await api('POST', `/api/rf/stages/${stage.id}/complete`, { token: tokenA });
    expect(completed.status).toBe(200);
    const { data: completedData } = await completed.json();
    expect(completedData.status).toBe('completed');
  });

  it('advances the current stage via the project endpoint', async () => {
    const created = await api('POST', '/api/rf/projects', {
      token: tokenA,
      body: { name: 'Advance Project' },
    });
    const { data } = await created.json();
    const projectId = data.project.id;
    const stage = data.stages[0];

    for (const gate of stage.gates) {
      await api('PATCH', `/api/rf/gates/${gate.id}`, { token: tokenA, body: { isPassed: true } });
    }

    const advanced = await api('POST', `/api/rf/projects/${projectId}/advance-stage`, { token: tokenA });
    expect(advanced.status).toBe(200);
    const { data: advancedData } = await advanced.json();
    expect(advancedData.stages[0].status).toBe('completed');
    expect(advancedData.stages[1].status).toBe('current');
  });

  it('manages tasks, dependencies and polymorphic links', async () => {
    const created = await api('POST', '/api/rf/projects', {
      token: tokenA,
      body: { name: 'Task Project' },
    });
    const { data } = await created.json();
    const projectId = data.project.id;

    const taskRes = await api('POST', `/api/rf/projects/${projectId}/tasks`, {
      token: tokenA,
      body: { title: 'Setup env', priority: 'critical', stageId: data.stages[0].id },
    });
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()).data;

    const otherTaskRes = await api('POST', `/api/rf/projects/${projectId}/tasks`, {
      token: tokenA,
      body: { title: 'Run benchmark' },
    });
    const otherTask = (await otherTaskRes.json()).data;

    const depRes = await api('POST', `/api/rf/tasks/${otherTask.id}/dependencies`, {
      token: tokenA,
      body: { dependsOnTaskId: task.id },
    });
    expect(depRes.status).toBe(201);

    const cycleRes = await api('POST', `/api/rf/tasks/${task.id}/dependencies`, {
      token: tokenA,
      body: { dependsOnTaskId: otherTask.id },
    });
    expect(cycleRes.status).toBe(409);

    const linkRes = await api('POST', `/api/rf/tasks/${task.id}/links`, {
      token: tokenA,
      body: { relationType: 'experiment', relationId: 'EXP-001' },
    });
    expect(linkRes.status).toBe(201);

    const badLinkRes = await api('POST', `/api/rf/tasks/${task.id}/links`, {
      token: tokenA,
      body: { relationType: 'banana', relationId: 'X' },
    });
    expect(badLinkRes.status).toBe(400);

    const links = await api('GET', `/api/rf/projects/${projectId}/task-links`, { token: tokenA });
    expect((await links.json()).data).toHaveLength(1);
  });

  it('lists activity for a project', async () => {
    const created = await api('POST', '/api/rf/projects', {
      token: tokenA,
      body: { name: 'Activity Project' },
    });
    const { data } = await created.json();

    const res = await api('GET', `/api/rf/projects/${data.project.id}/activity`, { token: tokenA });
    expect(res.status).toBe(200);
    const { data: entries } = await res.json();
    expect(entries.some((entry) => entry.action === 'project_created')).toBe(true);
  });

  it('serves the dashboard aggregate for a project', async () => {
    const created = await api('POST', '/api/rf/projects', {
      token: tokenA,
      body: { name: 'Dashboard Project', targetVenue: 'ICLR 2027', deadline: '2099-12-31' },
    });
    const { data } = await created.json();
    const projectId = data.project.id;

    const res = await api('GET', `/api/rf/projects/${projectId}/dashboard`, { token: tokenA });
    expect(res.status).toBe(200);
    const { data: dash } = await res.json();

    expect(dash.project.name).toBe('Dashboard Project');
    expect(dash.stages).toHaveLength(10);
    expect(dash.currentStage.id).toBe(dash.stages[0].id);
    expect(dash.currentStage.status).toBe('current');
    expect(typeof dash.overallProgress).toBe('number');
    expect(dash.daysRemaining).toBeGreaterThan(0);
    expect(dash.blockerCount).toBe(0);
    expect(dash.nextCriticalAction).toBeNull();
    // A fresh project has unfinished required gates and no open tasks yet.
    expect(dash.health.state).toBe('at_risk');
    expect(dash.health.reasons[0].code).toBe('unfinished_required_gates_no_progress');
    expect(dash.taskSummary.total).toBe(0);
    expect(dash.gateSummary.requiredTotal).toBeGreaterThan(0);
    expect(dash.gateSummary.passedRequired).toBe(0);

    // A blocker task bound to the current stage must surface in the dashboard.
    const taskRes = await api('POST', `/api/rf/projects/${projectId}/tasks`, {
      token: tokenA,
      body: { title: 'Big blocker', isBlocker: true, priority: 'high', stageId: dash.currentStage.id },
    });
    expect(taskRes.status).toBe(201);

    const dash2 = await (await api('GET', `/api/rf/projects/${projectId}/dashboard`, { token: tokenA })).json();
    expect(dash2.data.blockerCount).toBe(1);
    expect(dash2.data.nextCriticalAction.tier).toBe(1);
    expect(dash2.data.health.state).toBe('at_risk');
  });

  it('isolates users (user B cannot see or touch user A projects)', async () => {
    const created = await api('POST', '/api/rf/projects', {
      token: tokenA,
      body: { name: 'Secret Project' },
    });
    const { data } = await created.json();
    const projectId = data.project.id;

    const listB = await api('GET', '/api/rf/projects', { token: tokenB });
    const { data: projectsB } = await listB.json();
    expect(projectsB.some((project) => project.id === projectId)).toBe(false);

    const getB = await api('GET', `/api/rf/projects/${projectId}`, { token: tokenB });
    expect(getB.status).toBe(404);

    const stageB = await api('POST', `/api/rf/stages/${data.stages[0].id}/complete`, { token: tokenB });
    expect(stageB.status).toBe(404);
  });

  it('34. creates experiments and runs over HTTP with generated codes', async () => {
    const created = await api('POST', '/api/rf/projects', {
      token: tokenA,
      body: { name: 'P3 API Exp' },
    });
    const { data: projectData } = await created.json();
    const projectId = projectData.project.id;

    const expRes = await api('POST', `/api/rf/projects/${projectId}/experiments`, {
      token: tokenA,
      body: { title: 'HTTP experiment', type: 'ablation', priority: 'high' },
    });
    expect(expRes.status).toBe(201);
    const { data: experiment } = await expRes.json();
    expect(experiment.code).toBe('EXP-001');

    const runRes = await api('POST', `/api/rf/experiments/${experiment.id}/runs`, {
      token: tokenA,
      body: { seed: '42', status: 'running', gitCommit: 'deadbeef' },
    });
    expect(runRes.status).toBe(201);
    const { data: run } = await runRes.json();
    expect(run.runCode).toBe('RUN-001');
    expect(run.gitCommit).toBe('deadbeef');

    const runPatch = await api('PATCH', `/api/rf/experiment-runs/${run.id}`, {
      token: tokenA,
      body: { status: 'failed', failureClassification: 'training_instability', failureReason: 'diverged' },
    });
    expect(runPatch.status).toBe(200);
    const { data: failedRun } = await runPatch.json();
    expect(failedRun.status).toBe('failed');

    const listRes = await api('GET', `/api/rf/projects/${projectId}/experiments`, { token: tokenA });
    const { data: experiments } = await listRes.json();
    expect(experiments).toHaveLength(1);
    expect(experiments[0].runSummary.failed).toBe(1);
  });

  it('34b. claim-evidence matrix and evidence-health over HTTP', async () => {
    const created = await api('POST', '/api/rf/projects', {
      token: tokenA,
      body: { name: 'P3 API CE' },
    });
    const { data: projectData } = await created.json();
    const projectId = projectData.project.id;

    const claimRes = await api('POST', `/api/rf/projects/${projectId}/claims`, {
      token: tokenA,
      body: { statement: 'Core claim via HTTP', importance: 'core' },
    });
    const { data: claim } = await claimRes.json();
    expect(claim.code).toBe('C-01');

    const evRes = await api('POST', `/api/rf/projects/${projectId}/evidence`, {
      token: tokenA,
      body: { evidenceType: 'analysis_note', title: 'note', strength: 'strong' },
    });
    const { data: evidence } = await evRes.json();

    // core claim, no evidence yet -> critical missing
    const healthBefore = await api('GET', `/api/rf/projects/${projectId}/evidence-health`, { token: tokenA });
    const { data: healthDataBefore } = await healthBefore.json();
    expect(healthDataBefore.summary.coreClaimsMissingEvidence).toBe(1);

    const linkRes = await api('POST', '/api/rf/claim-evidence', {
      token: tokenA,
      body: { claimId: claim.id, evidenceId: evidence.id, relationType: 'supports' },
    });
    expect(linkRes.status).toBe(201);

    const healthAfter = await api('GET', `/api/rf/projects/${projectId}/evidence-health`, { token: tokenA });
    const { data: healthDataAfter } = await healthAfter.json();
    expect(healthDataAfter.summary.coreClaimsMissingEvidence).toBe(0);
    // claim.status was NOT auto-promoted by the HTTP flow either
    const claimGet = await api('GET', `/api/rf/claims/${claim.id}`, { token: tokenA });
    const { data: claimData } = await claimGet.json();
    expect(claimData.status).toBe('unverified');
  });

  it('34c. decisions + figures/tables + entity links over HTTP', async () => {
    const created = await api('POST', '/api/rf/projects', {
      token: tokenA,
      body: { name: 'P3 API Prov' },
    });
    const { data: projectData } = await created.json();
    const projectId = projectData.project.id;

    const decRes = await api('POST', `/api/rf/projects/${projectId}/decisions`, {
      token: tokenA,
      body: { title: 'Switch optimizer', reason: 'unstable' },
    });
    const { data: decision } = await decRes.json();
    expect(decision.code).toBe('DEC-001');

    const figRes = await api('POST', `/api/rf/projects/${projectId}/figures-tables`, {
      token: tokenA,
      body: { type: 'table', workingTitle: 'Main table' },
    });
    const { data: figure } = await figRes.json();
    expect(figure.code).toBe('TBL-01');

    const linkRes = await api('POST', '/api/rf/entity-links', {
      token: tokenA,
      body: { sourceType: 'decision', sourceId: decision.id, targetType: 'figure_table', targetId: figure.id, relationType: 'references' },
    });
    expect(linkRes.status).toBe(201);
    const { data: link } = await linkRes.json();
    expect(link.sourceType).toBe('decision');

    // idempotent duplicate
    const again = await api('POST', '/api/rf/entity-links', {
      token: tokenA,
      body: { sourceType: 'decision', sourceId: decision.id, targetType: 'figure_table', targetId: figure.id, relationType: 'references' },
    });
    expect(again.status).toBe(201);
    const links = await api('GET', `/api/rf/projects/${projectId}/entity-links`, { token: tokenA });
    const { data: linkList } = await links.json();
    expect(linkList).toHaveLength(1);
  });

  it('36. Phase 3 cross-project isolation over HTTP', async () => {
    const created = await api('POST', '/api/rf/projects', {
      token: tokenA,
      body: { name: 'P3 Iso A' },
    });
    const { data: projectData } = await created.json();
    const projectId = projectData.project.id;

    const expRes = await api('POST', `/api/rf/projects/${projectId}/experiments`, {
      token: tokenA,
      body: { title: 'Secret exp' },
    });
    const { data: experiment } = await expRes.json();

    const expB = await api('GET', `/api/rf/experiments/${experiment.id}`, { token: tokenB });
    expect(expB.status).toBe(404);

    const run = await api('POST', `/api/rf/experiments/${experiment.id}/runs`, { token: tokenA, body: { seed: '1' } });
    const { data: runData } = await run.json();
    const runB = await api('PATCH', `/api/rf/experiment-runs/${runData.id}`, { token: tokenB, body: { status: 'completed' } });
    expect(runB.status).toBe(404);

    const claim = await api('POST', `/api/rf/projects/${projectId}/claims`, { token: tokenA, body: { statement: 'C' } });
    const { data: claimData } = await claim.json();
    const claimB = await api('PATCH', `/api/rf/claims/${claimData.id}`, { token: tokenB, body: { status: 'supported' } });
    expect(claimB.status).toBe(404);
  });

  it('45. Phase 4 manuscript + freeze + review + submission over HTTP', async () => {
    const created = await api('POST', '/api/rf/projects', { token: tokenA, body: { name: 'P4 API' } });
    const { data: projectData } = await created.json();
    const projectId = projectData.project.id;

    // Manuscript
    const initRes = await api('POST', `/api/rf/projects/${projectId}/manuscript/initialize`, { token: tokenA });
    expect(initRes.status).toBe(201);
    const { data: sections } = await initRes.json();
    expect(sections).toHaveLength(9);
    const method = sections.find((section) => section.sectionKey === 'method');
    const patchSection = await api('PATCH', `/api/rf/manuscript-sections/${method.id}`, {
      token: tokenA, body: { status: 'draft' },
    });
    expect(patchSection.status).toBe(200);

    // Freeze readiness blocked -> override with reason -> 201
    const readinessRes = await api('GET', `/api/rf/projects/${projectId}/results-freeze/readiness`, { token: tokenA });
    const { data: readiness } = await readinessRes.json();
    expect(readiness.ready).toBe(false);

    const blocked = await api('POST', `/api/rf/projects/${projectId}/results-freezes`, { token: tokenA, body: {} });
    expect(blocked.status).toBe(409);

    const freezeRes = await api('POST', `/api/rf/projects/${projectId}/results-freezes`, {
      token: tokenA, body: { overrideReason: 'Accepting risk for now' },
    });
    expect(freezeRes.status).toBe(201);
    const { data: freeze } = await freezeRes.json();
    expect(freeze.freezeNumber).toBe(1);
    expect(freeze.overrideReason).toBe('Accepting risk for now');

    // Review comment
    const rcRes = await api('POST', `/api/rf/projects/${projectId}/review-comments`, {
      token: tokenA, body: { title: 'Critical issue', severity: 'critical' },
    });
    expect(rcRes.status).toBe(201);
    const { data: comment } = await rcRes.json();
    expect(comment.code).toBe('RC-001');

    // Submission profile + checklist
    const subRes = await api('POST', `/api/rf/projects/${projectId}/submissions`, {
      token: tokenA, body: { venue: 'NeurIPS 2027', anonymous: true },
    });
    expect(subRes.status).toBe(201);
    const { data: profile } = await subRes.json();
    expect(profile.items).toHaveLength(19);
    expect(profile.readiness.ready).toBe(false);

    // mark-submitted requires confirmation
    const noConfirm = await api('POST', `/api/rf/submissions/${profile.id}/mark-submitted`, { token: tokenA, body: {} });
    expect(noConfirm.status).toBe(400);

    const submittedRes = await api('POST', `/api/rf/submissions/${profile.id}/mark-submitted`, {
      token: tokenA, body: { confirmation: true, externalSubmissionId: 'CMT-1' },
    });
    expect(submittedRes.status).toBe(200);
    const { data: submitted } = await submittedRes.json();
    expect(submitted.status).toBe('submitted');
    expect(submitted.submittedAt).toBeTruthy();
  });

  it('47. Phase 4 cross-project isolation over HTTP', async () => {
    const created = await api('POST', '/api/rf/projects', { token: tokenA, body: { name: 'P4 Iso A' } });
    const { data: projectData } = await created.json();
    const projectId = projectData.project.id;

    const init = await api('POST', `/api/rf/projects/${projectId}/manuscript/initialize`, { token: tokenA });
    const { data: sections } = await init.json();

    const sectionB = await api('PATCH', `/api/rf/manuscript-sections/${sections[0].id}`, {
      token: tokenB, body: { status: 'final' },
    });
    expect(sectionB.status).toBe(404);

    const freezeRes = await api('POST', `/api/rf/projects/${projectId}/results-freezes`, {
      token: tokenA, body: { overrideReason: 'ok' },
    });
    const { data: freeze } = await freezeRes.json();
    const freezeB = await api('GET', `/api/rf/projects/${projectId}/results-freezes`, { token: tokenB });
    expect(freezeB.status).toBe(404);

    const rcRes = await api('POST', `/api/rf/projects/${projectId}/review-comments`, { token: tokenA, body: { title: 'X' } });
    const { data: comment } = await rcRes.json();
    const commentB = await api('PATCH', `/api/rf/review-comments/${comment.id}`, { token: tokenB, body: { status: 'resolved' } });
    expect(commentB.status).toBe(404);
  });
});
