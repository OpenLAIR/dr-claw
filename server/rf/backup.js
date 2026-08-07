// ResearchFlow — backup / restore / pending-restore (Phase 5)
//
// - Backups are consistent SQLite snapshots taken with better-sqlite3's
//   `db.backup()` API (never a bare file copy of a live DB), packaged into a
//   zip with a manifest + non-sensitive settings.
// - The snapshot is SANITIZED: sensitive legacy tables (users, api_keys,
//   user_credentials, session_metadata, app_settings) are emptied after the
//   snapshot is taken, so a backup NEVER contains password hashes, provider
//   API keys, credentials, or tokens. Their schema stays intact so a restored
//   database remains structurally valid.
// - Restore is two-phase so the running server never has to close its live DB:
//   1) `restoreBackup()` validates the zip, creates a pre-restore safety
//      backup, and stages the replacement DB under `<dataDir>/restore-pending/`.
//   2) `applyPendingRestore()` runs on next process start (before the DB is
//      opened) and atomically swaps the file in.
// - Backups/restores never include datasets, checkpoints, or large external
//   artifacts.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import AdmZip from 'adm-zip';

export const BACKUP_FORMAT = 'researchflow-backup';
export const BACKUP_FORMAT_VERSION = 1;

// Legacy tables that may hold secrets or credentials. Emptied (rows deleted,
// schema preserved) in every backup snapshot. ResearchFlow state itself lives
// entirely in rf_* tables, which are always fully preserved.
export const SENSITIVE_TABLES = [
  'users',
  'api_keys',
  'user_credentials',
  'session_metadata',
  'app_settings',
];

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

// dataDir = directory that holds the SQLite DB (its parent in Electron is the
// userData dir). All phase-5 file operations stay under this directory.
export function dataDirFromDbPath(dbPath) {
  if (!dbPath || dbPath === ':memory:') {
    return null;
  }
  return path.dirname(dbPath);
}

export function backupsDirFor(dataDir) {
  return dataDir ? path.join(dataDir, 'backups') : null;
}

// researchflow-backup-2026-08-07T203000.zip — filesystem-safe, sortable.
export function backupFileName(stamp) {
  return `researchflow-backup-${stamp}.zip`;
}

export function safeTimestamp(now = new Date()) {
  // Millisecond precision so multiple backups within the same second never
  // collide (e.g. a pre-restore safety backup right after a manual one).
  return now.toISOString().replace(/\.\d{3}Z$/, (ms) => ms.slice(1, 4)).replace(/[-:]/g, '');
}

// ---------------------------------------------------------------------------
// Settings collection (non-sensitive only)
// ---------------------------------------------------------------------------

export function collectAppSettings(db) {
  const settings = {};
  try {
    const hasTable = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_settings'"
    ).get();
    if (hasTable) {
      for (const row of db.prepare('SELECT key, value FROM app_settings').all()) {
        // Skip keys that could carry secrets regardless of table contents.
        const key = String(row.key || '').toLowerCase();
        if (/(key|secret|token|credential|password|api)/.test(key)) {
          continue;
        }
        settings[row.key] = row.value;
      }
    }
  } catch {
    // App settings are best-effort; a missing/broken table must not fail a backup.
  }
  return settings;
}

export function collectSchemaVersion(db) {
  try {
    const row = db
      .prepare('SELECT MAX(version) AS v FROM rf_schema_migrations')
      .get();
    return row && row.v != null ? row.v : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Snapshot sanitization
// ---------------------------------------------------------------------------

function sanitizeSnapshot(dbPath) {
  let snapshotDb;
  try {
    snapshotDb = new Database(dbPath);
    for (const table of SENSITIVE_TABLES) {
      try {
        snapshotDb.prepare(`DELETE FROM ${table}`).run();
      } catch {
        // Table may not exist in this DB — skip.
      }
    }
    // DELETE only marks rows as free; VACUUM rewrites the file so sensitive
    // bytes are actually removed from the snapshot (not left in freelist pages).
    snapshotDb.exec('VACUUM');
  } finally {
    if (snapshotDb) {
      snapshotDb.close();
    }
  }
}

// ---------------------------------------------------------------------------
// Create backup
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db        open DB (source)
 * @param {string} opts.backupsDir                           destination dir
 * @param {string} [opts.appVersion]
 * @param {number|null} [opts.schemaVersion]
 * @param {Date} [opts.now]
 * @returns {{ file: string, path: string, createdAt: string, size: number, manifest: object }}
 */
export async function createBackup({
  db,
  backupsDir,
  appVersion = '0.0.0',
  schemaVersion = null,
  now = new Date(),
}) {
  if (!backupsDir) {
    throw new Error('Backup requires a filesystem database path (not :memory:)');
  }
  fs.mkdirSync(backupsDir, { recursive: true });

  const stamp = safeTimestamp(now);
  const zipPath = path.join(backupsDir, backupFileName(stamp));
  const tmpDb = path.join(backupsDir, `.tmp-${stamp}.db`);

  try {
    // Consistent snapshot via SQLite backup API — safe while the DB is live.
    await db.backup(tmpDb);

    // Sanitize the snapshot: empty sensitive legacy tables (schema preserved)
    // so the backup never contains password hashes / API keys / credentials.
    sanitizeSnapshot(tmpDb);

    const manifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion,
      schemaVersion,
      exportedAt: now.toISOString(),
      databaseFile: 'researchflow.db',
      includes: ['researchflow.db', 'manifest.json', 'settings.json'],
      excludes: [
        'password hashes / API keys / credentials / tokens (sensitive legacy tables are emptied in the snapshot)',
        'datasets / checkpoints / result artifacts',
        'external repositories',
      ],
    };

    const zip = new AdmZip();
    zip.addLocalFile(tmpDb, '', 'researchflow.db');
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
    zip.addFile(
      'settings.json',
      Buffer.from(JSON.stringify(collectAppSettings(db), null, 2))
    );
    zip.writeZip(zipPath);

    const size = fs.statSync(zipPath).size;
    return {
      file: path.basename(zipPath),
      path: zipPath,
      createdAt: now.toISOString(),
      size,
      manifest,
    };
  } finally {
    fs.rmSync(tmpDb, { force: true });
  }
}

// ---------------------------------------------------------------------------
// List backups
// ---------------------------------------------------------------------------

export function listBackups(backupsDir) {
  if (!backupsDir || !fs.existsSync(backupsDir)) {
    return [];
  }
  return fs
    .readdirSync(backupsDir)
    .filter((name) => name.startsWith('researchflow-backup-') && name.endsWith('.zip'))
    .map((name) => {
      const fullPath = path.join(backupsDir, name);
      let manifest = null;
      try {
        const zip = new AdmZip(fullPath);
        const entry = zip.getEntry('manifest.json');
        if (entry) {
          manifest = JSON.parse(entry.getData('utf8'));
        }
      } catch {
        // Unreadable manifest → still listable, manifest stays null.
      }
      return {
        file: name,
        path: fullPath,
        size: fs.statSync(fullPath).size,
        createdAt: manifest?.exportedAt || null,
        appVersion: manifest?.appVersion || null,
        schemaVersion: manifest?.schemaVersion ?? null,
        valid: manifest?.format === BACKUP_FORMAT,
      };
    })
    .sort((a, b) => b.file.localeCompare(a.file));
}

// ---------------------------------------------------------------------------
// Restore (two-phase)
// ---------------------------------------------------------------------------

const PENDING_DIR = 'restore-pending';
const PENDING_MARKER = 'restore-pending.json';

function validateBackupZip(zipPath) {
  if (!fs.existsSync(zipPath)) {
    throw new Error(`Backup file not found: ${zipPath}`);
  }
  let zip;
  try {
    zip = new AdmZip(zipPath);
  } catch {
    throw new Error('Invalid backup file: not a readable zip archive');
  }

  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) {
    throw new Error('Invalid backup: missing manifest.json');
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.getData('utf8'));
  } catch {
    throw new Error('Invalid backup: manifest.json is not valid JSON');
  }
  if (manifest.format !== BACKUP_FORMAT) {
    throw new Error(`Invalid backup: unknown format "${manifest.format || '(none)'}"`);
  }
  if (!zip.getEntry('researchflow.db')) {
    throw new Error('Invalid backup: missing researchflow.db');
  }
  return { manifest, zip };
}

/**
 * Stage a restore for the next process start. Never touches the live DB file.
 * Always creates a pre-restore safety backup first.
 *
 * @param {object} opts
 * @param {string} opts.backupPath   zip to restore from
 * @param {import('better-sqlite3').Database} opts.db  live DB (for pre-restore safety backup)
 * @param {string} opts.dataDir      dir holding the DB + backups/ + restore-pending/
 * @param {string} [opts.appVersion]
 * @returns {{ stagedAt: string, preRestoreBackup: object, requiresRestart: true, manifest: object }}
 */
export async function restoreBackup({
  backupPath,
  db,
  dataDir,
  appVersion = '0.0.0',
  now = new Date(),
}) {
  if (!dataDir) {
    throw new Error('Restore requires a filesystem database path (not :memory:)');
  }

  // 1. Validate the backup zip structure first.
  const { manifest } = validateBackupZip(backupPath);

  // 2. Pre-restore safety backup of the current DB (never silently overwrite).
  const backupsDir = backupsDirFor(dataDir);
  const preRestoreBackup = await createBackup({
    db,
    backupsDir,
    appVersion,
    schemaVersion: collectSchemaVersion(db),
    now,
  });

  // 3. Stage the replacement DB + marker; applied on next startup.
  const pendingDir = path.join(dataDir, PENDING_DIR);
  fs.mkdirSync(pendingDir, { recursive: true });
  const stagedDb = path.join(pendingDir, 'researchflow.db');
  const zip = new AdmZip(backupPath);
  fs.writeFileSync(stagedDb, zip.getEntry('researchflow.db').getData());

  const marker = {
    format: BACKUP_FORMAT,
    stagedAt: now.toISOString(),
    sourceBackup: path.basename(backupPath),
    sourceBackupPath: backupPath,
    appVersion,
    manifest,
    preRestoreBackup: path.basename(preRestoreBackup.path),
  };
  fs.writeFileSync(path.join(pendingDir, PENDING_MARKER), JSON.stringify(marker, null, 2));

  return {
    stagedAt: now.toISOString(),
    preRestoreBackup: {
      file: path.basename(preRestoreBackup.path),
      path: preRestoreBackup.path,
    },
    requiresRestart: true,
    manifest,
  };
}

/**
 * Apply a staged restore. Call BEFORE opening the DB on process start.
 * Idempotent: with no pending marker it is a no-op.
 *
 * @param {object} opts
 * @param {string} opts.dataDir
 * @param {string} opts.dbPath       target DB file to replace
 * @param {(msg: string, details?: object) => void} [opts.log]
 * @returns {boolean} true if a pending restore was applied
 */
export function applyPendingRestore({ dataDir, dbPath, log = () => {} }) {
  if (!dataDir || !dbPath) {
    return false;
  }
  const pendingDir = path.join(dataDir, PENDING_DIR);
  const markerPath = path.join(pendingDir, PENDING_MARKER);
  if (!fs.existsSync(markerPath)) {
    return false;
  }

  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch (error) {
    log('Invalid restore-pending marker; ignoring', { error: error.message });
    fs.rmSync(markerPath, { force: true });
    return false;
  }

  const stagedDb = path.join(pendingDir, 'researchflow.db');
  if (!fs.existsSync(stagedDb)) {
    log('Restore-pending marker without staged DB; ignoring', { markerPath });
    fs.rmSync(markerPath, { force: true });
    return false;
  }

  // Validate the staged file is a real SQLite database before swapping.
  try {
    const header = fs.readFileSync(stagedDb).subarray(0, 16).toString('latin1');
    if (!header.startsWith('SQLite format 3')) {
      throw new Error('staged DB is not a SQLite database');
    }
  } catch (error) {
    log('Staged restore DB failed validation; discarding', { error: error.message });
    fs.rmSync(pendingDir, { recursive: true, force: true });
    return false;
  }

  // Swap atomically: displace the current DB (kept until the swap succeeds),
  // move the staged DB into place, then drop the displaced old file. On
  // failure (e.g. Windows EPERM while an orphan backend still holds the file)
  // the displaced DB is rolled back, and the marker + staged file are retained
  // so the restore can be retried on the next start.
  const displacedPath = `${dbPath}.pending-restore-old`;
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    if (fs.existsSync(dbPath)) {
      fs.rmSync(displacedPath, { force: true }); // stale leftover from a prior crash
      fs.renameSync(dbPath, displacedPath);
    }
    for (const sidecar of ['-wal', '-shm']) {
      fs.rmSync(`${dbPath}${sidecar}`, { force: true });
    }
    fs.renameSync(stagedDb, dbPath);
    fs.rmSync(displacedPath, { force: true });
  } catch (error) {
    try {
      if (!fs.existsSync(dbPath) && fs.existsSync(displacedPath)) {
        fs.renameSync(displacedPath, dbPath); // roll back the displacement
      }
    } catch {
      // Best-effort rollback; the pre-restore safety backup still exists.
    }
    log('Failed to apply pending restore; marker retained for retry', { error: error.message, dbPath });
    return false;
  }

  log('Applied pending restore', {
    source: marker.sourceBackup || marker.sourceBackupPath || '(unknown)',
    restoredAt: new Date().toISOString(),
    preRestoreBackup: marker.preRestoreBackup || null,
  });

  fs.rmSync(markerPath, { force: true });
  fs.rmSync(pendingDir, { recursive: true, force: true });
  return true;
}
