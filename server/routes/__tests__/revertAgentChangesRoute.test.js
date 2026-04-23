/**
 * Route-level smoke test for POST /api/git/revert-agent-changes.
 *
 * Uses an in-process Express app + the node http module so we don't need
 * to pull in supertest as a new devDependency.  Auth middleware is not
 * mounted here — that layer has its own tests in the auth route suite.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';

// Path to the per-test temp git repo (assigned in beforeEach).
let REPO;

// Mock extractProjectDirectory so the route treats our temp repo as a project.
// vi.mock is hoisted, so REPO is read lazily inside the mock factory via ref.
vi.mock('../../projects.js', () => ({
  extractProjectDirectory: async () => REPO,
}));
// Avoid pulling in Claude SDK / cursor-cli side effects.
vi.mock('../../claude-sdk.js', () => ({ queryClaudeSDK: async () => ({}) }));
vi.mock('../../cursor-cli.js', () => ({ spawnCursor: async () => ({}) }));

const { default: gitRouter } = await import('../git.js');

let server;
let baseUrl;

function run(cmd, args) {
  execSync(`${cmd} ${args.map(a => JSON.stringify(a)).join(' ')}`, {
    cwd: REPO,
    stdio: 'pipe',
  });
}

function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request(
      {
        method,
        hostname: '127.0.0.1',
        port: new URL(baseUrl).port,
        path: pathname,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let out = '';
        res.on('data', (chunk) => { out += chunk; });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(out); } catch { parsed = out; }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/git', gitRouter);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'revert-route-')));
  run('git', ['init', '-q', '-b', 'main']);
  run('git', ['config', 'user.email', 'test@example.com']);
  run('git', ['config', 'user.name', 'Test']);
  run('git', ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(REPO, 'a.txt'), 'original\n');
  run('git', ['add', '.']);
  run('git', ['commit', '-q', '-m', 'initial']);
});

afterEach(() => {
  fs.rmSync(REPO, { recursive: true, force: true });
});

describe('POST /api/git/revert-agent-changes', () => {
  it('returns 400 when project is missing', async () => {
    const res = await request('POST', '/api/git/revert-agent-changes', { files: ['a.txt'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/project/i);
  });

  it('returns 400 when files is not an array', async () => {
    const res = await request('POST', '/api/git/revert-agent-changes', { project: 'demo', files: 'a.txt' });
    expect(res.status).toBe(400);
  });

  it('returns success with empty arrays for empty file list', async () => {
    const res = await request('POST', '/api/git/revert-agent-changes', { project: 'demo', files: [] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, reverted: [], skipped: [], errors: [] });
  });

  it('reverts a modified file end-to-end over HTTP', async () => {
    fs.writeFileSync(path.join(REPO, 'a.txt'), 'agent-edit\n');

    const res = await request('POST', '/api/git/revert-agent-changes', {
      project: 'demo',
      files: ['a.txt'],
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.reverted).toEqual(['a.txt']);
    expect(fs.readFileSync(path.join(REPO, 'a.txt'), 'utf8')).toBe('original\n');
  });

  it('reports partial success when some files error', async () => {
    fs.writeFileSync(path.join(REPO, 'a.txt'), 'agent-edit\n');

    const res = await request('POST', '/api/git/revert-agent-changes', {
      project: 'demo',
      files: ['a.txt', '../outside.txt'],
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.reverted).toEqual(['a.txt']);
    expect(res.body.errors).toHaveLength(1);
  });
});
