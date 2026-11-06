import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const originalEnv = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  DATABASE_PATH: process.env.DATABASE_PATH,
  WORKSPACES_ROOT: process.env.WORKSPACES_ROOT,
};

let tempRoot = null;
let workspacesRoot = null;

async function loadTestModules() {
  vi.resetModules();
  const database = await import('../database/db.js');
  await database.initializeDatabase();
  const projects = await import('../projects.js');
  return { projects, database };
}

function cliEncode(projectPath) {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

async function writeClaudeSession(projectPath, sessionId) {
  await mkdir(projectPath, { recursive: true });
  const dir = path.join(tempRoot, '.claude', 'projects', cliEncode(projectPath));
  await mkdir(dir, { recursive: true });
  const entry = {
    sessionId,
    type: 'user',
    uuid: `u-${sessionId}`,
    cwd: projectPath,
    timestamp: '2026-06-09T10:00:00.000Z',
    message: { role: 'user', content: 'hello' },
  };
  await writeFile(path.join(dir, `${sessionId}.jsonl`), `${JSON.stringify(entry)}\n`, 'utf8');
  return cliEncode(projectPath);
}

describe('getProjects on a cold server', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dr-claw-projects-startup-'));
    workspacesRoot = path.join(tempRoot, 'dr-claw');
    await mkdir(workspacesRoot, { recursive: true });
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');
    process.env.WORKSPACES_ROOT = workspacesRoot;
  });

  afterEach(async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('waits for the Claude history scan when the project database is empty', async () => {
    const projectPath = path.join(workspacesRoot, 'first');
    const projectName = await writeClaudeSession(projectPath, 'a1b2c3d4-0000-4000-8000-000000000001');

    const { projects } = await loadTestModules();
    const list = await projects.getProjects(null);

    expect(list.map((project) => project.name)).toContain(projectName);
  });

  it('answers from the project database and publishes newly found projects afterwards', async () => {
    const knownPath = path.join(workspacesRoot, 'known');
    await mkdir(knownPath, { recursive: true });
    const newPath = path.join(workspacesRoot, 'created-by-cli');
    const newName = await writeClaudeSession(newPath, 'a1b2c3d4-0000-4000-8000-000000000002');

    const { projects, database } = await loadTestModules();
    database.projectDb.upsertProject('known', null, 'Known', knownPath, 0, null, { manuallyAdded: true });

    // The Codex discovery sync emits on the same channel; wait for ours.
    const changed = new Promise((resolve) => {
      const onChange = (detail) => {
        if (detail?.reason !== 'legacy-bootstrap') return;
        projects.projectsEvents.off('projects-changed', onChange);
        resolve(detail);
      };
      projects.projectsEvents.on('projects-changed', onChange);
    });

    const first = await projects.getProjects(null);
    expect(first.map((project) => project.name)).toEqual(['known']);

    await expect(changed).resolves.toMatchObject({ reason: 'legacy-bootstrap' });

    const second = await projects.getProjects(null);
    expect(second.map((project) => project.name).sort()).toEqual(['known', newName].sort());
  });
});
