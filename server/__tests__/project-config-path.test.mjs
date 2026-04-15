import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;

let tempRoot = null;
let activeDatabaseModule = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeTestDatabase() {
  if (!activeDatabaseModule?.db?.close) {
    return;
  }

  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      activeDatabaseModule.db.close();
      activeDatabaseModule = null;
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      await sleep(30 * attempt);
    }
  }
}

async function removeTempRootWithRetry(targetPath) {
  if (!targetPath) {
    return;
  }

  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== 'EBUSY' || attempt === maxAttempts) {
        throw error;
      }
      await sleep(50 * attempt);
    }
  }
}

async function loadProjectsModule() {
  vi.resetModules();
  const projects = await import('../projects.js');
  activeDatabaseModule = await import('../database/db.js');
  return projects;
}

describe('project config path migration', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dr-claw-project-config-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');
  });

  afterEach(async () => {
    await closeTestDatabase();
    vi.resetModules();

    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;

    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;

    if (tempRoot) {
      await removeTempRootWithRetry(tempRoot);
      tempRoot = null;
    }
  });

  it('prefers ~/.dr-claw/project-config.json when both current and legacy files exist', async () => {
    const currentConfigPath = path.join(tempRoot, '.dr-claw', 'project-config.json');
    const legacyConfigPath = path.join(tempRoot, '.claude', 'project-config.json');

    await mkdir(path.dirname(currentConfigPath), { recursive: true });
    await mkdir(path.dirname(legacyConfigPath), { recursive: true });

    await writeFile(currentConfigPath, JSON.stringify({ marker: 'current', _workspacesRoot: path.join(tempRoot, 'dr-claw') }, null, 2), 'utf8');
    await writeFile(legacyConfigPath, JSON.stringify({ marker: 'legacy', _workspacesRoot: path.join(tempRoot, 'legacy-root') }, null, 2), 'utf8');

    const projects = await loadProjectsModule();
    const config = await projects.loadProjectConfig();

    expect(config.marker).toBe('current');
    expect(config._workspacesRoot).toBe(path.join(tempRoot, 'dr-claw'));
  });

  it('migrates legacy ~/.claude/project-config.json into ~/.dr-claw/project-config.json once', async () => {
    const currentConfigPath = path.join(tempRoot, '.dr-claw', 'project-config.json');
    const legacyConfigPath = path.join(tempRoot, '.claude', 'project-config.json');
    const legacyConfig = {
      marker: 'legacy-only',
      _workspacesRoot: path.join(tempRoot, 'workspaces'),
    };

    await mkdir(path.dirname(legacyConfigPath), { recursive: true });
    await writeFile(legacyConfigPath, JSON.stringify(legacyConfig, null, 2), 'utf8');

    const projects = await loadProjectsModule();
    const loadedConfig = await projects.loadProjectConfig();
    expect(loadedConfig).toEqual(legacyConfig);

    const migratedRaw = await readFile(currentConfigPath, 'utf8');
    expect(JSON.parse(migratedRaw)).toEqual(legacyConfig);

    const updated = { ...loadedConfig, marker: 'saved-to-current' };
    await projects.saveProjectConfig(updated);

    const currentAfterSave = JSON.parse(await readFile(currentConfigPath, 'utf8'));
    expect(currentAfterSave.marker).toBe('saved-to-current');

    const legacyAfterSave = JSON.parse(await readFile(legacyConfigPath, 'utf8'));
    expect(legacyAfterSave.marker).toBe('legacy-only');
  });
});
