// ResearchFlow Phase 5 REST API tests — backup / restore / export / workspace.
// Authenticated (JWT) mode with an isolated temp DATABASE_PATH + dynamic
// imports so the legacy db.js singleton binds to the test database.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

let tmpDir;
let dbPath;
let express;
let dbModule;
let rf;
let app;
let server;
let baseUrl;
let token;

const listen = (appInstance) => new Promise((resolve) => {
  const instance = appInstance.listen(0, '127.0.0.1', () => resolve(instance));
});

const api = (method, url, { body, token: t } = {}) => {
  const headers = {};
  if (t) headers.authorization = `Bearer ${t}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}${url}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
};

beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'rf-p5-api-'));
  dbPath = path.join(tmpDir, 'researchflow.db');
  process.env.DATABASE_PATH = dbPath;

  vi.resetModules();
  express = (await import('express')).default;
  dbModule = await import('../database/db.js');
  await dbModule.initializeDatabase();
  rf = await import('../rf/index.js');
  await rf.runResearchFlowMigrations(dbModule.db);

  const auth = await import('../middleware/auth.js');
  const routes = (await import('../routes/rf.js')).default;

  app = express();
  app.use(express.json());
  app.use('/api/rf', auth.authenticateToken, routes);
  server = await listen(app);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Create a user + JWT for authenticated calls.
  const users = dbModule.db.prepare(
    "INSERT INTO users (username, password_hash) VALUES ('p5user', 'hash')"
  ).run();
  token = auth.generateToken({ id: users.lastInsertRowid, username: 'p5user' });
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (dbModule?.db) dbModule.db.close();
  await rm(tmpDir, { recursive: true, force: true });
  delete process.env.DATABASE_PATH;
});

const createProject = async (name) => {
  const res = await api('POST', '/api/rf/projects', { body: { name }, token });
  return (await res.json()).data.project;
};

describe('Phase 5 API — info / backup / restore', () => {
  it('1. GET /api/rf/info exposes deterministic data paths without secrets', async () => {
    const res = await api('GET', '/api/rf/info', { token });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.appVersion).toBeTruthy();
    expect(data.databasePath).toBe(dbPath);
    expect(data.dataDir).toBe(tmpDir);
    expect(data.schemaVersion).toBe(3);
    expect(data.backupsDir).toBe(path.join(tmpDir, 'backups'));
  });

  it('2. unauthenticated calls are rejected', async () => {
    const res = await api('GET', '/api/rf/info');
    expect(res.status).toBe(401);
  });

  it('3. POST /api/rf/backup creates a zip and GET /api/rf/backups lists it', async () => {
    const created = await api('POST', '/api/rf/backup', { token });
    expect(created.status).toBe(201);
    const backup = (await created.json()).data;
    expect(backup.file).toMatch(/^researchflow-backup-/);
    expect(fs.existsSync(backup.path)).toBe(true);

    const listed = await api('GET', '/api/rf/backups', { token });
    const { data } = await listed.json();
    expect(data.some((b) => b.file === backup.file)).toBe(true);
    expect(data.every((b) => b.valid)).toBe(true);
  });

  it('4. POST /api/rf/backup/restore stages a restore and requires restart', async () => {
    const project = await createProject('Restore Me');
    const backupRes = await api('POST', '/api/rf/backup', { token });
    const backup = (await backupRes.json()).data;

    // Archive the project so the restore is meaningful.
    const del = await api('DELETE', `/api/rf/projects/${project.id}`, { token });
    expect(del.status).toBe(200);

    const restore = await api('POST', '/api/rf/backup/restore', { body: { backupFile: backup.file }, token });
    expect(restore.status).toBe(200);
    const result = (await restore.json()).data;
    expect(result.requiresRestart).toBe(true);
    expect(result.preRestoreBackup.file).toMatch(/^researchflow-backup-/);
    expect(fs.existsSync(path.join(tmpDir, 'restore-pending', 'restore-pending.json'))).toBe(true);
  });

  it('5. restore rejects invalid files with 400', async () => {
    const res = await api('POST', '/api/rf/backup/restore', { body: { backupFile: '/etc/passwd' }, token });
    expect(res.status).toBe(400);
    const res2 = await api('POST', '/api/rf/backup/restore', { body: {}, token });
    expect(res2.status).toBe(400);
  });
});

describe('Phase 5 API — project export', () => {
  it('6. GET /api/rf/projects/:id/export downloads a portable zip', async () => {
    const project = await createProject('API Export 项目 (A)');
    const res = await fetch(`${baseUrl}/api/rf/projects/${project.id}/export`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/zip/);
    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = new AdmZip(buffer);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).toContain('project.json');
    expect(names).toContain('stages.json');
    expect(names).toContain('manifest.json');
    const manifest = JSON.parse(zip.getEntry('manifest.json').getData('utf8'));
    expect(manifest.projectId).toBe(project.id);
    expect(manifest.exportVersion).toBe(1);
  });

  it('7. export of another user\'s project is forbidden (404)', async () => {
    const project = await createProject('Owned By A');
    // Second user with no projects must not see it.
    const other = dbModule.db.prepare(
      "INSERT INTO users (username, password_hash) VALUES ('p5other', 'hash')"
    ).run();
    const auth = await import('../middleware/auth.js');
    const otherToken = auth.generateToken({ id: other.lastInsertRowid, username: 'p5other' });
    const res = await fetch(`${baseUrl}/api/rf/projects/${project.id}/export`, {
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(res.status).toBe(404);
  });
});

describe('Phase 5 API — workspace', () => {
  it('8. PUT workspace persists typed metadata; GET returns it', async () => {
    const project = await createProject('Workspace API');
    const put = await api('PUT', `/api/rf/projects/${project.id}/workspace`, {
      body: { workspaceType: 'wsl', wslDistro: 'Ubuntu-22.04', wslPath: '/home/user/proj' },
      token,
    });
    expect(put.status).toBe(200);
    const get = await api('GET', `/api/rf/projects/${project.id}/workspace`, { token });
    const { data } = await get.json();
    expect(data.workspaceType).toBe('wsl');
    expect(data.wslDistro).toBe('Ubuntu-22.04');
    expect(data.path).toBe('/home/user/proj');
  });

  it('9. PUT workspace rejects invalid combinations with 400', async () => {
    const project = await createProject('Bad Workspace');
    const bad = await api('PUT', `/api/rf/projects/${project.id}/workspace`, {
      body: { workspaceType: 'wsl' },
      token,
    });
    expect(bad.status).toBe(400);
    const bad2 = await api('PUT', `/api/rf/projects/${project.id}/workspace`, {
      body: { workspaceType: 'docker' },
      token,
    });
    expect(bad2.status).toBe(400);
  });

  it('10. validate reports unconfigured workspace without crashing', async () => {
    const project = await createProject('No Workspace API');
    const res = await api('POST', `/api/rf/projects/${project.id}/workspace/validate`, { token });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.ok).toBe(false);
    expect(data.errors[0]).toMatch(/No workspace configured/);
  });

  it('11. open-terminal without a workspace is rejected with 400', async () => {
    const project = await createProject('No Terminal');
    const res = await api('POST', `/api/rf/projects/${project.id}/workspace/open-terminal`, { token });
    expect(res.status).toBe(400);
  });

  it('12. workspace endpoints are project-scoped (404 for other users)', async () => {
    const project = await createProject('Scoped Workspace');
    const auth = await import('../middleware/auth.js');
    const other = dbModule.db.prepare(
      "INSERT INTO users (username, password_hash) VALUES ('p5scoped', 'hash')"
    ).run();
    const otherToken = auth.generateToken({ id: other.lastInsertRowid, username: 'p5scoped' });
    const res = await api('GET', `/api/rf/projects/${project.id}/workspace`, { token: otherToken });
    expect(res.status).toBe(404);
  });
});
