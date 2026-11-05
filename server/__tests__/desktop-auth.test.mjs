import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import express from 'express';
import {
  DESKTOP_LOCAL_USERNAME,
  desktopTokenMatches,
  readDesktopToken,
  resolveDesktopUser,
} from '../utils/desktopAuth.js';

const SECRET = crypto.randomBytes(32).toString('hex');

describe('readDesktopToken', () => {
  it('is off unless the server was started by the desktop shell', () => {
    expect(readDesktopToken({ DR_CLAW_DESKTOP_TOKEN: SECRET })).toBeNull();
    expect(readDesktopToken({ DR_CLAW_DESKTOP: '0', DR_CLAW_DESKTOP_TOKEN: SECRET })).toBeNull();
  });

  it('ignores a missing, blank or short secret', () => {
    expect(readDesktopToken({ DR_CLAW_DESKTOP: '1' })).toBeNull();
    expect(readDesktopToken({ DR_CLAW_DESKTOP: '1', DR_CLAW_DESKTOP_TOKEN: '   ' })).toBeNull();
    expect(readDesktopToken({ DR_CLAW_DESKTOP: '1', DR_CLAW_DESKTOP_TOKEN: 'short' })).toBeNull();
  });

  it('returns the secret in desktop mode', () => {
    expect(readDesktopToken({ DR_CLAW_DESKTOP: '1', DR_CLAW_DESKTOP_TOKEN: SECRET })).toBe(SECRET);
  });
});

describe('desktopTokenMatches', () => {
  it('accepts only the exact secret', () => {
    expect(desktopTokenMatches(SECRET, SECRET)).toBe(true);
    const lastCharFlipped = SECRET.slice(0, -1) + (SECRET.endsWith('a') ? 'b' : 'a');
    expect(desktopTokenMatches(SECRET, lastCharFlipped)).toBe(false);
    expect(desktopTokenMatches(SECRET, SECRET.slice(0, 10))).toBe(false);
    expect(desktopTokenMatches(SECRET, `${SECRET}x`)).toBe(false);
  });

  it('rejects missing values on either side', () => {
    expect(desktopTokenMatches(SECRET, undefined)).toBe(false);
    expect(desktopTokenMatches(SECRET, '')).toBe(false);
    expect(desktopTokenMatches(SECRET, ['array'])).toBe(false);
    expect(desktopTokenMatches(null, SECRET)).toBe(false);
  });
});

describe('resolveDesktopUser', () => {
  const fakeUserDb = (overrides = {}) => ({
    getMostRecentUser: vi.fn(() => undefined),
    createUser: vi.fn((username) => ({ id: 7, username, notification_email: null })),
    getUserById: vi.fn((id) => ({ id, username: DESKTOP_LOCAL_USERNAME })),
    ...overrides,
  });

  it('reuses the most recently logged-in user when one exists', () => {
    const existing = { id: 3, username: 'alice' };
    const userDb = fakeUserDb({ getMostRecentUser: vi.fn(() => existing) });
    expect(resolveDesktopUser(userDb)).toBe(existing);
    expect(userDb.createUser).not.toHaveBeenCalled();
  });

  it('creates a "local" user with an unusable random password on first run', () => {
    const userDb = fakeUserDb();
    const user = resolveDesktopUser(userDb);
    expect(user).toMatchObject({ id: 7, username: 'local' });
    const [username, passwordHash, email] = userDb.createUser.mock.calls[0];
    expect(username).toBe('local');
    expect(passwordHash).toMatch(/^\$2[aby]\$/);
    expect(email).toBeNull();
  });

  it('falls back to a suffixed name when "local" is taken by a deactivated user', () => {
    const unique = Object.assign(new Error('UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
    const createUser = vi.fn()
      .mockImplementationOnce(() => { throw unique; })
      .mockImplementationOnce((username) => ({ id: 9, username }));
    const userDb = fakeUserDb({ createUser, getUserById: vi.fn(() => undefined) });
    const user = resolveDesktopUser(userDb);
    expect(user.username).toMatch(/^local-[0-9a-f]{6}$/);
  });
});

// Real HTTP against the real routes and a throwaway SQLite database.
describe('POST /api/auth/desktop-session (desktop mode)', () => {
  let tmpDir;
  let server;
  let baseUrl;
  let authMiddleware;
  let userDb;
  const savedEnv = {};

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drclaw-desktop-auth-'));
    const env = {
      DATABASE_PATH: path.join(tmpDir, 'auth.db'),
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      DR_CLAW_DESKTOP: '1',
      DR_CLAW_DESKTOP_TOKEN: SECRET,
    };
    for (const [key, value] of Object.entries(env)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }

    const dbModule = await import('../database/db.js');
    await dbModule.initializeDatabase();
    userDb = dbModule.userDb;
    authMiddleware = await import('../middleware/auth.js');
    const { default: authRoutes } = await import('../routes/auth.js');

    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    app.get('/api/protected', authMiddleware.authenticateToken, (req, res) => {
      res.json({ username: req.user.username });
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const desktopSession = (headers = {}, query = '') =>
    fetch(`${baseUrl}/api/auth/desktop-session${query}`, { method: 'POST', headers });

  it('removes the secret from process.env so child processes never inherit it', () => {
    expect(process.env.DR_CLAW_DESKTOP_TOKEN).toBeUndefined();
  });

  it('rejects a missing, wrong, or query-string secret with 401', async () => {
    expect((await desktopSession()).status).toBe(401);
    expect((await desktopSession({ 'X-Dr-Claw-Desktop-Token': 'nope' })).status).toBe(401);
    expect((await desktopSession({}, `?token=${SECRET}`)).status).toBe(401);
    expect(userDb.hasUsers()).toBe(false);
  });

  it('does not treat the secret as a credential on other routes or the WebSocket', async () => {
    const res = await fetch(`${baseUrl}/api/protected`, {
      headers: { 'X-Dr-Claw-Desktop-Token': SECRET, Authorization: `Bearer ${SECRET}` },
    });
    expect(res.status).toBe(401);
    expect(authMiddleware.authenticateWebSocket(SECRET)).toBeNull();
  });

  it('creates a "local" user on first run and returns a working JWT', async () => {
    const res = await desktopSession({ 'X-Dr-Claw-Desktop-Token': SECRET });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.username).toBe('local');
    expect(typeof body.token).toBe('string');

    const statusRes = await fetch(`${baseUrl}/api/auth/status`);
    expect((await statusRes.json()).needsSetup).toBe(false);

    const protectedRes = await fetch(`${baseUrl}/api/protected`, {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    expect(protectedRes.status).toBe(200);
    expect((await protectedRes.json()).username).toBe('local');
    expect(authMiddleware.authenticateWebSocket(body.token)).toMatchObject({ username: 'local' });

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'local', password: '' }),
    });
    expect(loginRes.status).toBe(400);
  });

  it('maps to the most recently logged-in user when several exist', async () => {
    const alice = userDb.createUser('alice', 'x', null);
    const bob = userDb.createUser('bob', 'x', null);
    const { db } = await import('../database/db.js');
    db.prepare("UPDATE users SET last_login = '2020-01-01 00:00:00' WHERE username = 'local'").run();
    db.prepare("UPDATE users SET last_login = '2026-01-01 00:00:00' WHERE id = ?").run(bob.id);
    db.prepare("UPDATE users SET last_login = '2025-01-01 00:00:00' WHERE id = ?").run(alice.id);

    const res = await desktopSession({ 'X-Dr-Claw-Desktop-Token': SECRET });
    expect(res.status).toBe(200);
    expect((await res.json()).user.username).toBe('bob');
  });
});

describe('POST /api/auth/desktop-session (web / npx mode)', () => {
  let tmpDir;
  let server;
  let baseUrl;
  const savedEnv = {};

  beforeAll(async () => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drclaw-web-auth-'));
    const env = {
      DATABASE_PATH: path.join(tmpDir, 'auth.db'),
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      DR_CLAW_DESKTOP: undefined,
      DR_CLAW_DESKTOP_TOKEN: SECRET,
    };
    for (const [key, value] of Object.entries(env)) {
      savedEnv[key] = process.env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    const dbModule = await import('../database/db.js');
    await dbModule.initializeDatabase();
    const { default: authRoutes } = await import('../routes/auth.js');
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is unavailable even when a secret is present, and setup is still required', async () => {
    const res = await fetch(`${baseUrl}/api/auth/desktop-session`, {
      method: 'POST',
      headers: { 'X-Dr-Claw-Desktop-Token': SECRET },
    });
    expect(res.status).toBe(404);
    const status = await (await fetch(`${baseUrl}/api/auth/status`)).json();
    expect(status.needsSetup).toBe(true);
  });
});
