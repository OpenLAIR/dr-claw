// ResearchFlow — project export (Phase 5)
//
// Exports the full structured ResearchFlow metadata for ONE project into a
// portable zip (<ProjectName>-researchflow-export-<stamp>.zip) with:
//   - per-domain JSON files (stages/tasks/experiments/claims/evidence/...)
//   - manifest.json with exportVersion / appVersion / schemaVersion / timestamp
//     / project UUID
//
// Explicitly excluded (never exported):
//   - API keys, credentials, tokens (users/api_keys/user_credentials/app_settings)
//   - datasets, checkpoints, result artifacts, external repositories
// Path-like fields (git commit/branch, config/result paths, workspace paths)
// are exported as local path references and identified in the manifest.
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { safeTimestamp } from './backup.js';

export const EXPORT_FORMAT = 'researchflow-project-export';
export const EXPORT_FORMAT_VERSION = 1;

// Maps exported file name → table / query. Keys are the portable file names
// documented in DATA_AND_BACKUP.md (and used by a future import).
const TABLE_FILE_MAP = {
  'stages.json': 'rf_stages',
  'stage-gates.json': 'rf_stage_gates',
  'tasks.json': 'rf_tasks',
  'task-dependencies.json': 'rf_task_dependencies',
  'experiments.json': 'rf_experiments',
  'experiment-runs.json': 'rf_experiment_runs',
  'claims.json': 'rf_claims',
  'evidence.json': 'rf_evidence',
  'claim-evidence.json': 'rf_claim_evidence',
  'decisions.json': 'rf_decisions',
  'literature.json': 'rf_literature',
  'figures-tables.json': 'rf_figures_tables',
  'entity-links.json': 'rf_entity_links',
  'manuscript.json': 'rf_manuscript_sections',
  'result-freezes.json': 'rf_result_freezes',
  'reviews.json': 'rf_review_comments',
  'submission.json': 'rf_submission_profiles',
  'submission-items.json': 'rf_submission_items',
  'activity-log.json': 'rf_activity_log',
};

function exportFileBuilders(db, projectId) {
  const builders = {};
  for (const [fileName, table] of Object.entries(TABLE_FILE_MAP)) {
    builders[fileName] = () =>
      db.prepare(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY created_at`).all(projectId);
  }
  // rf_task_links: no project_id column — join through rf_tasks.
  builders['task-links.json'] = () =>
    db
      .prepare(
        `SELECT tl.* FROM rf_task_links tl
         JOIN rf_tasks t ON t.id = tl.task_id
         WHERE t.project_id = ? ORDER BY tl.created_at`
      )
      .all(projectId);
  return builders;
}

export function sanitizeExportName(name) {
  // Keep unicode letters/digits plus - _ ( ) space; strip everything else.
  const cleaned = String(name || 'project')
    .replace(/[^\p{L}\p{N} _()\-]/gu, '')
    .trim();
  return cleaned || 'project';
}

export function exportFileName(projectName, stamp) {
  return `${sanitizeExportName(projectName)}-researchflow-export-${stamp}.zip`;
}

/**
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db
 * @param {string} opts.projectId
 * @param {string} opts.destDir
 * @param {string} [opts.appVersion]
 * @param {number|null} [opts.schemaVersion]
 * @param {Date} [opts.now]
 * @returns {{ file: string, path: string, exportedAt: string, size: number, manifest: object, objectCount: number }}
 */
export function exportProject({
  db,
  projectId,
  destDir,
  appVersion = '0.0.0',
  schemaVersion = null,
  now = new Date(),
}) {
  const project = db.prepare('SELECT * FROM rf_projects WHERE id = ?').get(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  fs.mkdirSync(destDir, { recursive: true });
  const stamp = safeTimestamp(now);
  const zipPath = path.join(destDir, exportFileName(project.name, stamp));

  const manifest = {
    exportVersion: EXPORT_FORMAT_VERSION,
    format: EXPORT_FORMAT,
    appVersion,
    schemaVersion,
    exportedAt: now.toISOString(),
    projectId: project.id,
    projectName: project.name,
    note: 'Path fields (git/config/result/workspace) are local path references. No API keys, credentials, or tokens are exported.',
  };

  const zip = new AdmZip();
  let objectCount = 0;

  zip.addFile('project.json', Buffer.from(JSON.stringify(project, null, 2)));
  objectCount += 1;

  const builders = exportFileBuilders(db, projectId);
  for (const [fileName, build] of Object.entries(builders)) {
    const rows = build();
    if (rows.length === 0) {
      continue;
    }
    zip.addFile(fileName, Buffer.from(JSON.stringify(rows, null, 2)));
    objectCount += rows.length;
  }

  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.writeZip(zipPath);

  return {
    file: path.basename(zipPath),
    path: zipPath,
    exportedAt: now.toISOString(),
    size: fs.statSync(zipPath).size,
    manifest,
    objectCount,
  };
}
