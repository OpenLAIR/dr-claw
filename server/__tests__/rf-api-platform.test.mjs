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
});
