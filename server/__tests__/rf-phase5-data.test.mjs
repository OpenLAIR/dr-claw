// ResearchFlow Phase 5 data-safety tests — backup / restore / project export.
// Service-level, isolated temp DB (filesystem path so db.name is real).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { runResearchFlowMigrations, createResearchFlowServiceFor } from '../rf/index.js';
import {
  dataDirFromDbPath,
  backupsDirFor,
  safeTimestamp,
  backupFileName,
  createBackup,
  listBackups,
  restoreBackup,
  applyPendingRestore,
  collectAppSettings,
  collectSchemaVersion,
} from '../rf/backup.js';
import { exportProject, sanitizeExportName, exportFileName, EXPORT_FORMAT_VERSION } from '../rf/export.js';

const USER_ID = 1;

let tmpDir;
let dbPath;
let db;
let service;
let dataDir;

const reopenDb = () => {
  if (db) db.close();
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  runResearchFlowMigrations(db);
  service = createResearchFlowServiceFor(db);
  return db;
};

beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'rf-p5-data-'));
  dbPath = path.join(tmpDir, 'researchflow.db');
  dataDir = tmpDir;
  reopenDb();
});

afterAll(async () => {
  if (db) db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

const createProject = (name = 'P5 Project') => service.createProject(USER_ID, { name });
const passStageGates = (projectDetail, key) => {
  const stage = projectDetail.stages.find((s) => s.key === key);
  for (const gate of stage.gates) {
    service.patchGate(USER_ID, gate.id, { isPassed: true });
  }
};

describe('Phase 5 data-path helpers', () => {
  it('1. dataDirFromDbPath resolves the directory holding the DB', () => {
    expect(dataDirFromDbPath('/home/u/researchflow/researchflow.db')).toBe('/home/u/researchflow');
    expect(dataDirFromDbPath(':memory:')).toBeNull();
    expect(dataDirFromDbPath(null)).toBeNull();
  });

  it('2. backupsDirFor nests under the data dir', () => {
    expect(backupsDirFor('/data')).toBe(path.join('/data', 'backups'));
    expect(backupsDirFor(null)).toBeNull();
  });

  it('3. backup file names are timestamped and filesystem-safe', () => {
    const stamp = safeTimestamp(new Date('2026-08-07T20:30:00.000Z'));
    expect(stamp).toBe('20260807T203000000');
    expect(backupFileName(stamp)).toBe('researchflow-backup-20260807T203000000.zip');
  });

  it('4. collectSchemaVersion reads the rf migration version', () => {
    expect(collectSchemaVersion(db)).toBe(3);
  });
});

describe('Phase 5 backup creation', () => {
  it('5. creates a consistent zip with db + manifest + settings', async () => {
    const result = await service.createBackup();
    expect(result.file).toMatch(/^researchflow-backup-\d{8}T\d{9}\.zip$/);
    expect(fs.existsSync(result.path)).toBe(true);
    expect(result.size).toBeGreaterThan(0);
    expect(result.createdAt).toBeTruthy();

    const zip = new AdmZip(result.path);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).toEqual(expect.arrayContaining(['researchflow.db', 'manifest.json', 'settings.json']));

    const manifest = JSON.parse(zip.getEntry('manifest.json').getData('utf8'));
    expect(manifest.format).toBe('researchflow-backup');
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.appVersion).toBe('1.1.4');
    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.exportedAt).toBeTruthy();
    // Exactly the three intended entries — no large/external artifacts.
    expect(names).toHaveLength(3);
  });

  it('6. backups exclude secret-like app_settings keys AND sensitive tables are emptied in the snapshot', async () => {
    // app_settings is a legacy-table; create it in the isolated test DB.
    db.exec('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
    db.exec('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT)');
    db.exec('CREATE TABLE IF NOT EXISTS api_keys (id INTEGER PRIMARY KEY, name TEXT, key TEXT)');
    db.exec('CREATE TABLE IF NOT EXISTS user_credentials (id INTEGER PRIMARY KEY, provider TEXT, credential TEXT)');
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('theme', 'dark');
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('ANTHROPIC_API_KEY', 'sk-secret-do-not-leak');
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('language', 'zh-CN');
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', 'pbkdf2-hash-leak');
    db.prepare('INSERT INTO api_keys (name, key) VALUES (?, ?)').run('openai', 'sk-openai-leak-123');
    db.prepare('INSERT INTO user_credentials (provider, credential) VALUES (?, ?)').run('github', 'gho_token_leak');

    const settings = collectAppSettings(db);
    expect(settings.theme).toBe('dark');
    expect(settings.language).toBe('zh-CN');
    expect(Object.keys(settings)).not.toContain('ANTHROPIC_API_KEY');

    const result = await createBackup({ db, backupsDir: backupsDirFor(dataDir), appVersion: '1.1.4', schemaVersion: 3 });
    const zip = new AdmZip(result.path);
    const settingsOut = JSON.parse(zip.getEntry('settings.json').getData('utf8'));
    expect(settingsOut.theme).toBe('dark');
    expect(JSON.stringify(settingsOut)).not.toContain('sk-secret-do-not-leak');

    // The snapshot DB itself must not contain any secret values.
    const snapshotBuf = zip.getEntry('researchflow.db').getData();
    const allSnapshotText = snapshotBuf.toString('latin1');
    for (const secret of ['pbkdf2-hash-leak', 'sk-openai-leak-123', 'gho_token_leak', 'sk-secret-do-not-leak']) {
      expect(allSnapshotText).not.toContain(secret);
    }
    // And the sensitive tables are structurally present but empty.
    const tmp = path.join(dataDir, 'snapshot-check.db');
    fs.writeFileSync(tmp, snapshotBuf);
    const snapshotDb = new Database(tmp);
    try {
      expect(snapshotDb.prepare('SELECT COUNT(*) AS c FROM users').get().c).toBe(0);
      expect(snapshotDb.prepare('SELECT COUNT(*) AS c FROM api_keys').get().c).toBe(0);
      expect(snapshotDb.prepare('SELECT COUNT(*) AS c FROM user_credentials').get().c).toBe(0);
      expect(snapshotDb.prepare('SELECT COUNT(*) AS c FROM app_settings').get().c).toBe(0);
    } finally {
      snapshotDb.close();
      fs.rmSync(tmp, { force: true });
    }
  });

  it('7. listBackups returns sorted, validated backups', async () => {
    const backups = service.getBackups();
    expect(backups.length).toBeGreaterThanOrEqual(2);
    for (const b of backups) {
      expect(b.valid).toBe(true);
      expect(b.file).toMatch(/^researchflow-backup-/);
      expect(b.appVersion).toBe('1.1.4');
    }
    const files = backups.map((b) => b.file);
    expect([...files].sort().reverse()).toEqual(files);
  });

  it('8. backup snapshot is consistent with DB state at creation time', async () => {
    const project = createProject('P5 Snapshot');
    const projectId = project.project.id;
    const before = await service.createBackup();

    // Mutate after the backup was taken.
    service.archiveProject(USER_ID, projectId);
    const after = await service.createBackup();

    const beforeZip = new AdmZip(before.path);
    const beforeDb = beforeZip.getEntry('researchflow.db').getData();
    const afterDb = new AdmZip(after.path).getEntry('researchflow.db').getData();
    // The two snapshots must differ (one captured pre-archive, one post-archive).
    expect(Buffer.compare(beforeDb, afterDb)).not.toBe(0);
  });
});

describe('Phase 5 restore', () => {
  it('9. restore validates structure and stages a replacement + pre-restore backup', async () => {
    const project = createProject('P5 Restore');
    const projectId = project.project.id;
    const backup = await service.createBackup();

    // Break the current DB state, then restore.
    service.archiveProject(USER_ID, projectId);

    const backupsBefore = service.getBackups().length;
    const result = await service.restoreBackup({ backupFile: backup.file });
    expect(result.requiresRestart).toBe(true);
    expect(result.manifest.format).toBe('researchflow-backup');
    expect(result.preRestoreBackup.file).toMatch(/^researchflow-backup-/);
    expect(service.getBackups().length).toBe(backupsBefore + 1); // pre-restore safety backup

    // Pending marker + staged DB exist.
    const pendingDir = path.join(dataDir, 'restore-pending');
    expect(fs.existsSync(path.join(pendingDir, 'restore-pending.json'))).toBe(true);
    expect(fs.existsSync(path.join(pendingDir, 'researchflow.db'))).toBe(true);
  });

  it('10. applyPendingRestore swaps the DB on next start and cleans up', async () => {
    // Current DB still has the project archived (restore not yet applied).
    let list = service.listProjects(USER_ID);
    const archivedName = list.find((p) => p.name === 'P5 Restore');
    // db still open — applyPendingRestore is applied before open in production;
    // here we simulate by closing, applying, reopening.
    db.close();

    const applied = applyPendingRestore({
      dataDir,
      dbPath,
      log: () => {},
    });
    expect(applied).toBe(true);

    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    runResearchFlowMigrations(db);
    service = createResearchFlowServiceFor(db);

    // Project is back (not archived) after the restore took effect.
    list = service.listProjects(USER_ID);
    const restored = list.find((p) => p.name === 'P5 Restore');
    expect(restored).toBeTruthy();
    expect(restored.status).toBe('active');

    // Marker cleaned up.
    expect(fs.existsSync(path.join(dataDir, 'restore-pending', 'restore-pending.json'))).toBe(false);
  });

  it('11. applyPendingRestore is a no-op without a pending marker', () => {
    expect(applyPendingRestore({ dataDir, dbPath, log: () => {} })).toBe(false);
  });

  it('12. invalid backups are rejected', async () => {
    // Random non-zip file.
    const junk = path.join(backupsDirFor(dataDir), 'junk.bin');
    fs.writeFileSync(junk, 'this is not a zip');
    await expect(service.restoreBackup({ backupFile: path.basename(junk) })).rejects.toThrow(/not a readable zip/);

    // Zip missing manifest.json.
    const noManifest = path.join(backupsDirFor(dataDir), 'no-manifest.zip');
    const zip = new AdmZip();
    zip.addFile('researchflow.db', Buffer.from('SQLite format 3' + 'x'.repeat(100)));
    zip.writeZip(noManifest);
    await expect(service.restoreBackup({ backupFile: path.basename(noManifest) })).rejects.toThrow(/missing manifest/);

    // Zip with wrong format.
    const wrongFormat = path.join(backupsDirFor(dataDir), 'wrong-format.zip');
    const zip2 = new AdmZip();
    zip2.addFile('manifest.json', Buffer.from(JSON.stringify({ format: 'other-thing' })));
    zip2.addFile('researchflow.db', Buffer.from('SQLite format 3' + 'x'.repeat(100)));
    zip2.writeZip(wrongFormat);
    await expect(service.restoreBackup({ backupFile: path.basename(wrongFormat) })).rejects.toThrow(/unknown format/);

    // Path traversal outside backups dir is rejected.
    await expect(service.restoreBackup({ backupFile: '/etc/passwd' })).rejects.toThrow(/inside the backups directory/);
  });

  it('13. staged non-SQLite file is discarded without crashing startup', () => {
    const pendingDir = path.join(dataDir, 'restore-pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'restore-pending.json'), JSON.stringify({ format: 'researchflow-backup' }));
    fs.writeFileSync(path.join(pendingDir, 'researchflow.db'), 'not a real sqlite db at all');
    const applied = applyPendingRestore({ dataDir, dbPath, log: () => {} });
    expect(applied).toBe(false);
    expect(fs.existsSync(pendingDir)).toBe(false);
  });

  it('13b. a failed swap rolls back the current DB and retains the marker for retry', async () => {
    const { vi } = await import('vitest');
    // Build a pending restore with a valid staged DB.
    const pendingDir = path.join(dataDir, 'restore-pending-rollback');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'restore-pending.json'), JSON.stringify({ format: 'researchflow-backup', stagedAt: 'x' }));
    fs.copyFileSync(dbPath, path.join(pendingDir, 'researchflow.db'));

    // Snapshot current DB bytes so we can prove rollback.
    const beforeBytes = fs.readFileSync(dbPath);
    const markerPath = path.join(pendingDir, 'restore-pending.json');
    const stagedPath = path.join(pendingDir, 'researchflow.db');

    // Make the final rename (staged → dbPath) fail once; all other renames
    // must actually execute so the displacement/rollback path is exercised.
    const realRename = fs.renameSync.bind(fs);
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (from === stagedPath && to === dbPath) {
        throw new Error('EPERM: file locked (simulated orphan backend)');
      }
      return realRename(from, to);
    });
    try {
      const applied = applyPendingRestore({ dataDir: path.join(dataDir, 'restore-pending-rollback'), dbPath, log: () => {} });
      expect(applied).toBe(false);
      // Original DB restored (rollback of displacement), marker retained.
      expect(fs.readFileSync(dbPath).equals(beforeBytes)).toBe(true);
      expect(fs.existsSync(markerPath)).toBe(true);
      expect(fs.existsSync(stagedPath)).toBe(true);
    } finally {
      spy.mockRestore();
      fs.rmSync(pendingDir, { recursive: true, force: true });
    }
  });
});

describe('Phase 5 project export', () => {
  const makeFullProject = (name) => {
    const project = createProject(name);
    const projectId = project.project.id;
    passStageGates(project, 'validation');
    passStageGates(project, 'submission');

    service.createTask(USER_ID, projectId, { title: 'Run main ablations', priority: 'high' });

    const exp = service.createExperiment(USER_ID, projectId, {
      title: 'Main benchmark',
      experimentType: 'main',
      status: 'completed',
    });
    service.createRun(USER_ID, exp.id, {
      seed: 7,
      status: 'completed',
      gitCommit: 'abc1234',
      gitBranch: 'main',
      configPath: 'configs/exp-001.yaml',
      resultPath: 'results/exp-001.json',
    });

    const claim = service.createClaim(USER_ID, projectId, {
      statement: 'Method X beats baseline Y',
      importance: 'core',
    });
    const experimentWithRuns = service.getExperiment(USER_ID, exp.id);
    const evidence = service.createEvidence(USER_ID, projectId, {
      evidenceType: 'experiment_run',
      sourceId: experimentWithRuns.runs[0].id,
      strength: 'strong',
      title: 'EXP-001 run result',
    });
    service.linkClaimEvidence(USER_ID, { claimId: claim.id, evidenceId: evidence.id, relationType: 'supports' });

    service.createDecision(USER_ID, projectId, {
      title: 'Drop Top-1 router',
      context: '3/5 seeds collapse',
      decision: 'Drop',
      reason: 'Instability',
    });
    service.createLiterature(USER_ID, projectId, {
      title: 'A Closest Work',
      relation: 'closest_work',
      readStatus: 'read',
    });
    const fig = service.createFigureTable(USER_ID, projectId, { artifactType: 'figure', workingTitle: 'Figure 1' });
    service.createEntityLink(USER_ID, {
      sourceType: 'figure_table',
      sourceId: fig.id,
      targetType: 'experiment',
      targetId: exp.id,
      relationType: 'produces',
    });

    service.initializeManuscript(USER_ID, projectId);
    for (const section of service.getManuscript(USER_ID, projectId).sections) {
      service.updateManuscriptSection(USER_ID, section.id, { status: 'draft' });
    }
    service.createResultsFreeze(USER_ID, projectId, {});
    const profile = service.createSubmissionProfile(USER_ID, projectId, { venue: 'ICLR 2027' });
    for (const item of profile.items) {
      service.updateSubmissionItem(USER_ID, item.id, { status: 'done' });
    }
    service.createReviewComment(USER_ID, projectId, {
      title: 'Add baseline discussion',
      body: 'The baseline comparison needs more detail.',
      severity: 'major',
      status: 'open',
    });
    return { project, projectId };
  };

  it('14. exports all core objects with versioned manifest', () => {
    const { project, projectId } = makeFullProject('P5 Export A');
    const result = service.exportProject(USER_ID, projectId);
    expect(result.file).toMatch(/^P5 Export A-researchflow-export-\d{8}T\d{9}\.zip$/);
    expect(fs.existsSync(result.path)).toBe(true);
    expect(result.objectCount).toBeGreaterThan(5);

    const zip = new AdmZip(result.path);
    const names = zip.getEntries().map((e) => e.entryName);
    for (const expected of [
      'project.json', 'stages.json', 'stage-gates.json', 'tasks.json',
      'experiments.json', 'experiment-runs.json',
      'claims.json', 'evidence.json', 'claim-evidence.json',
      'decisions.json', 'literature.json', 'figures-tables.json', 'entity-links.json',
      'manuscript.json', 'reviews.json', 'result-freezes.json',
      'submission.json', 'submission-items.json', 'manifest.json',
    ]) {
      expect(names).toContain(expected);
    }

    const manifest = JSON.parse(zip.getEntry('manifest.json').getData('utf8'));
    expect(manifest.exportVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(manifest.format).toBe('researchflow-project-export');
    expect(manifest.projectId).toBe(projectId);
    expect(manifest.projectName).toBe('P5 Export A');
    expect(manifest.appVersion).toBe('1.1.4');
    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.exportedAt).toBeTruthy();
    expect(manifest.note).toMatch(/local path references/);

    // Path fields preserved as metadata.
    const runs = JSON.parse(zip.getEntry('experiment-runs.json').getData('utf8'));
    expect(runs[0].git_commit).toBe('abc1234');
    expect(runs[0].config_path).toBe('configs/exp-001.yaml');
  });

  it('15. one project cannot leak another project\'s data', () => {
    const { projectId: otherId } = makeFullProject('P5 Export B');
    // Project A from test 14 is in the same DB; export B and verify no A rows.
    const result = service.exportProject(USER_ID, otherId);
    const zip = new AdmZip(result.path);
    const claims = JSON.parse(zip.getEntry('claims.json').getData('utf8'));
    const statements = claims.map((c) => c.statement);
    expect(statements).toContain('Method X beats baseline Y'); // B's own claim (same helper)
    expect(claims.every((c) => c.project_id === otherId)).toBe(true);
  });

  it('16. export excludes secrets and non-rf tables', () => {
    const { projectId } = makeFullProject('P5 Export C');
    const result = service.exportProject(USER_ID, projectId);
    const zip = new AdmZip(result.path);
    const names = zip.getEntries().map((e) => e.entryName);
    for (const forbidden of ['users.json', 'api-keys.json', 'user-credentials.json', 'app-settings.json', 'session-metadata.json']) {
      expect(names).not.toContain(forbidden);
    }
    const all = JSON.stringify(zip.getEntries().map((e) => e.entryName));
    expect(all).not.toMatch(/api[_ -]?key/i);
  });

  it('17. export file names sanitize unsafe project names', () => {
    expect(sanitizeExportName('实验 (A) & 2026!')).toBe('实验 (A)  2026');
    const fileName = exportFileName('实验 (A) & 2026!', '20260807T203000000');
    expect(fileName).toBe('实验 (A)  2026-researchflow-export-20260807T203000000.zip');
    expect(fileName).not.toMatch(/[&/\\<>:"|?*]/);
    expect(sanitizeExportName('')).toBe('project');
  });

  it('18. export of a missing project is rejected', () => {
    expect(() => service.exportProject(USER_ID, 'no-such-project')).toThrow(/not found/i);
  });

  it('19. exportProject is project-scoped to the owning user', () => {
    const { projectId } = makeFullProject('P5 Export D');
    expect(() => service.exportProject(999, projectId)).toThrow(/not found/i);
  });
});
