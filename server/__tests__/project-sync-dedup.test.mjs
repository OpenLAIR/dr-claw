import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;

let tempRoot = null;

async function loadTestModules() {
  vi.resetModules();
  const database = await import('../database/db.js');
  await database.initializeDatabase();
  const projects = await import('../projects.js');
  return { projects, database };
}

/** Create a test user and return its numeric id */
function createTestUser(database, username = 'testuser') {
  const user = database.userDb.createUser(username, 'hash');
  return user.id;
}

describe('project sync and dedup (PR #89)', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dr-claw-project-dedup-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');
  });

  afterEach(async () => {
    vi.resetModules();

    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;

    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;

    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  describe('getProjectByPath', () => {
    it('returns unowned project when queried with a userId', async () => {
      const { database } = await loadTestModules();
      const testPath = '/tmp/test-project-alpha';

      database.projectDb.upsertProject('proj-alpha', null, 'Alpha', testPath, 0, null, null);

      const result = database.projectDb.getProjectByPath(testPath, 1);
      expect(result).not.toBeNull();
      expect(result.id).toBe('proj-alpha');
      expect(result.user_id).toBeNull();
    });

    it('prefers same-user record over unowned when both exist', async () => {
      const { database } = await loadTestModules();
      const userId = createTestUser(database);
      const testPath = '/tmp/test-project-beta';

      // Insert unowned record first
      database.projectDb.upsertProject('proj-beta-unowned', null, 'Beta Unowned', testPath, 0, null, null);
      // Insert user-owned record (different ID to allow both rows)
      database.projectDb.upsertProject('proj-beta-user1', userId, 'Beta User1', testPath, 0, null, null);

      const result = database.projectDb.getProjectByPath(testPath, userId);
      expect(result).not.toBeNull();
      expect(result.id).toBe('proj-beta-user1');
      expect(result.user_id).toBe(userId);
    });

    it('returns user-owned project when queried with userId=null', async () => {
      const { database } = await loadTestModules();
      const userId = createTestUser(database);
      const testPath = '/tmp/test-project-gamma';

      database.projectDb.upsertProject('proj-gamma', userId, 'Gamma', testPath, 0, null, null);

      const result = database.projectDb.getProjectByPath(testPath, null);
      expect(result).not.toBeNull();
      expect(result.id).toBe('proj-gamma');
      expect(result.user_id).toBe(userId);
    });
  });

  describe('addProjectManually — preserves existing values', () => {
    it('preserves is_starred and metadata when project already exists', async () => {
      const { database, projects } = await loadTestModules();

      // Create a real directory for addProjectManually's fs.access check
      const projectDir = path.join(tempRoot, 'my-project');
      await mkdir(projectDir, { recursive: true });

      const encodedId = projects.encodeProjectPath(projectDir);
      const customMetadata = { customKey: 'customValue', provider: 'claude' };

      // Seed the DB with a starred project that has metadata
      database.projectDb.upsertProject(
        encodedId, null, 'My Project', projectDir,
        1, '2026-01-01T00:00:00.000Z', customMetadata,
      );

      // Now call addProjectManually — should NOT wipe is_starred or metadata
      const result = await projects.addProjectManually(projectDir, null, null);

      expect(result.alreadyExists).toBe(true);

      // Verify DB state
      const dbRow = database.projectDb.getProjectByPath(projectDir, null);
      expect(dbRow.is_starred).toBe(1);
      expect(dbRow.metadata.customKey).toBe('customValue');
      expect(dbRow.metadata.provider).toBe('claude');
      expect(dbRow.metadata.manuallyAdded).toBe(true);
    });

    it('does not create duplicate when same path exists with different ID', async () => {
      const { database, projects } = await loadTestModules();

      const projectDir = path.join(tempRoot, 'dup-project');
      await mkdir(projectDir, { recursive: true });

      // Insert with a "legacy" ID that differs from encodeProjectPath output
      const legacyId = 'legacy-encoded-dup-project';
      database.projectDb.upsertProject(
        legacyId, null, 'Dup Project', projectDir,
        0, null, null,
      );

      // addProjectManually will compute a different ID via encodeProjectPath
      const result = await projects.addProjectManually(projectDir, null, null);
      expect(result.alreadyExists).toBe(true);

      // Should still be only one record for this path
      const all = database.projectDb.getAllProjects(null);
      const matching = all.filter(p => p.path === projectDir);
      expect(matching.length).toBe(1);
    });
  });

  describe('bootstrap throttle', () => {
    it('does not re-scan legacy sources within 60 seconds', async () => {
      const { projects, database } = await loadTestModules();

      // Set up minimal directory structure so getProjects doesn't error
      await mkdir(path.join(tempRoot, 'dr-claw'), { recursive: true });
      await mkdir(path.join(tempRoot, '.claude', 'projects'), { recursive: true });

      // Spy on bootstrapProjectsIndexFromLegacySources via upsertProject call count
      const upsertSpy = vi.spyOn(database.projectDb, 'upsertProject');

      await projects.getProjects(null);
      const callsAfterFirst = upsertSpy.mock.calls.length;

      // Second call within 60s — bootstrap should be skipped
      await projects.getProjects(null);
      const callsAfterSecond = upsertSpy.mock.calls.length;

      // No additional upsertProject calls from bootstrap on second run
      expect(callsAfterSecond).toBe(callsAfterFirst);

      upsertSpy.mockRestore();
    });
  });
});
