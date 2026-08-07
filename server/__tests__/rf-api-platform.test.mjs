// ResearchFlow REST API tests — IS_PLATFORM single-user mode.
//
// IS_PLATFORM is read once at module load (server/constants/config.js), so this
// file sets the env var at the very top, before any dynamic import, and lives in
// its own vitest process (isolated) — see rf-api.test.mjs for the regular mode.

process.env.VITE_IS_PLATFORM = 'true';

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

const listen = (appInstance) => new Promise((resolve) => {
  const instance = appInstance.listen(0, '127.0.0.1', () => resolve(instance));
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
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'rf-api-platform-'));
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

  // Platform mode authenticates as the first user; seed exactly one.
  dbModule.userDb.createUser('platform-user', 'hash');

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
  delete process.env.VITE_IS_PLATFORM;
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

describe('ResearchFlow REST API (IS_PLATFORM single-user mode)', () => {
  it('serves requests without a token (first-user short-circuit)', async () => {
    const res = await api('GET', '/api/rf/projects');
    expect(res.status).toBe(200);
    const { success, data } = await res.json();
    expect(success).toBe(true);
    expect(data).toEqual([]);
  });

  it('creates a project and initializes stages/gates under platform auth', async () => {
    const res = await api('POST', '/api/rf/projects', {
      body: { name: 'Platform Project' },
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.project.name).toBe('Platform Project');
    expect(data.stages).toHaveLength(10);
    expect(data.stages[0].status).toBe('current');
    expect(data.stages[0].gates.length).toBeGreaterThan(0);
  });

  it('enforces the gate invariant under platform auth', async () => {
    const created = await api('POST', '/api/rf/projects', {
      body: { name: 'Platform Gate Project' },
    });
    const { data } = await created.json();
    const stage = data.stages[0];

    const blocked = await api('POST', `/api/rf/stages/${stage.id}/complete`);
    expect(blocked.status).toBe(409);

    for (const gate of stage.gates) {
      await api('PATCH', `/api/rf/gates/${gate.id}`, { body: { isPassed: true } });
    }
    const completed = await api('POST', `/api/rf/stages/${stage.id}/complete`);
    expect(completed.status).toBe(200);
  });

  it('35. Phase 3 resources work in IS_PLATFORM single-user mode (no token)', async () => {
    const created = await api('POST', '/api/rf/projects', { body: { name: 'Platform P3' } });
    const { data: projectData } = await created.json();
    const projectId = projectData.project.id;

    const expRes = await api('POST', `/api/rf/projects/${projectId}/experiments`, {
      body: { title: 'Platform exp', type: 'main' },
    });
    expect(expRes.status).toBe(201);
    const { data: experiment } = await expRes.json();
    expect(experiment.code).toBe('EXP-001');

    const runRes = await api('POST', `/api/rf/experiments/${experiment.id}/runs`, {
      body: { seed: '1', status: 'completed', metrics: { acc: 0.9 } },
    });
    expect(runRes.status).toBe(201);
    const { data: run } = await runRes.json();
    expect(run.runCode).toBe('RUN-001');

    const claimRes = await api('POST', `/api/rf/projects/${projectId}/claims`, {
      body: { statement: 'Platform claim', importance: 'core' },
    });
    const { data: claim } = await claimRes.json();
    expect(claim.code).toBe('C-01');

    const healthRes = await api('GET', `/api/rf/projects/${projectId}/evidence-health`);
    expect(healthRes.status).toBe(200);
    const { data: health } = await healthRes.json();
    expect(health.summary.coreClaimsTotal).toBe(1);
    expect(health.summary.coreClaimsMissingEvidence).toBe(1);

    const decRes = await api('POST', `/api/rf/projects/${projectId}/decisions`, {
      body: { title: 'Platform decision' },
    });
    const { data: decision } = await decRes.json();
    expect(decision.code).toBe('DEC-001');

    const figRes = await api('POST', `/api/rf/projects/${projectId}/figures-tables`, {
      body: { type: 'figure', workingTitle: 'Platform fig' },
    });
    const { data: figure } = await figRes.json();
    expect(figure.code).toBe('FIG-01');

    const litRes = await api('POST', `/api/rf/projects/${projectId}/literature`, {
      body: { title: 'A paper', relation: 'baseline' },
    });
    expect(litRes.status).toBe(201);
  });

  it('46. Phase 4 resources work in IS_PLATFORM single-user mode', async () => {
    const created = await api('POST', '/api/rf/projects', { body: { name: 'Platform P4' } });
    const { data: projectData } = await created.json();
    const projectId = projectData.project.id;

    const init = await api('POST', `/api/rf/projects/${projectId}/manuscript/initialize`);
    expect(init.status).toBe(201);
    const { data: sections } = await init.json();
    expect(sections).toHaveLength(9);

    const patch = await api('PATCH', `/api/rf/manuscript-sections/${sections[0].id}`, { body: { status: 'draft' } });
    expect(patch.status).toBe(200);

    const freeze = await api('POST', `/api/rf/projects/${projectId}/results-freezes`, {
      body: { overrideReason: 'platform override' },
    });
    expect(freeze.status).toBe(201);

    const rc = await api('POST', `/api/rf/projects/${projectId}/review-comments`, {
      body: { title: 'Platform comment', severity: 'major' },
    });
    expect(rc.status).toBe(201);

    const sub = await api('POST', `/api/rf/projects/${projectId}/submissions`, { body: { venue: 'Platform venue' } });
    expect(sub.status).toBe(201);
    const { data: profile } = await sub.json();
    expect(profile.items).toHaveLength(19);

    const item = profile.items[0];
    const itemPatch = await api('PATCH', `/api/rf/submission-items/${item.id}`, { body: { status: 'done' } });
    expect(itemPatch.status).toBe(200);

    const readiness = await api('GET', `/api/rf/submissions/${profile.id}/readiness`);
    expect(readiness.status).toBe(200);

    const submitted = await api('POST', `/api/rf/submissions/${profile.id}/mark-submitted`, {
      body: { confirmation: true },
    });
    expect(submitted.status).toBe(200);
  });
});
