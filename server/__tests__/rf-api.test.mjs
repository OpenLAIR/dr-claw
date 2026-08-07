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
});
