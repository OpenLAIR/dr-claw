import fs from 'fs';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { collectSkillDirs } from './skillLinks.js';

/**
 * Where skills live.
 *
 * - Bundled skills ship in <app>/skills. In the desktop app that directory is
 *   inside the app bundle, so it is replaced on every update and must not be
 *   written to. It is treated as read-only.
 * - User skills (imported, uploaded or copied by the user) live in the user
 *   skills directory, ~/.dr-claw/skills by default, or DR_CLAW_USER_SKILLS_DIR.
 *
 * skills/bundled-skills.json lists the skill directories that ship with the
 * release (see scripts/export-bundled-skills-manifest.mjs). A skill found in
 * the bundled directory but not in that list was added by the user before
 * user skills had their own directory; migrateUserSkillsOutOfBundle() moves
 * those out.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BUNDLED_SKILLS_DIR = path.resolve(__dirname, '..', '..', 'skills');
export const BUNDLED_MANIFEST_FILE = 'bundled-skills.json';
export const TAG_MAPPING_FILE = 'skill-tag-mapping.json';
export const STAGE_SKILL_MAP_FILE = 'stage-skill-map.json';
const MIGRATION_LOG_FILE = '.migrated-from-bundle.json';

export function getUserSkillsDir(env = process.env) {
  const configured = typeof env.DR_CLAW_USER_SKILLS_DIR === 'string' ? env.DR_CLAW_USER_SKILLS_DIR.trim() : '';
  if (configured) return path.resolve(configured.replace(/^~(?=$|[\\/])/, os.homedir()));
  return path.join(os.homedir(), '.dr-claw', 'skills');
}

export function getSkillRoots({ bundledDir = BUNDLED_SKILLS_DIR, userDir = getUserSkillsDir() } = {}) {
  return { bundledDir: path.resolve(bundledDir), userDir: path.resolve(userDir) };
}

/**
 * @returns {Set<string> | null} skill dirPaths relative to the bundled dir
 *   (e.g. 'inference-serving/vllm'), or null when the manifest is missing.
 */
export function readBundledManifest(bundledDir = BUNDLED_SKILLS_DIR) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(bundledDir, BUNDLED_MANIFEST_FILE), 'utf8'));
    if (!Array.isArray(parsed?.skills)) return null;
    return new Set(parsed.skills.filter((item) => typeof item === 'string').map(toPosix));
  } catch {
    return null;
  }
}

function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

export function isInsideDir(target, root) {
  const relative = path.relative(root, target);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * True when `relPath` (relative to the bundled dir) is a shipped skill, a file
 * inside one, or a category folder that holds shipped skills. Without a
 * manifest everything in the bundled dir counts as shipped.
 */
export function isShippedPath(relPath, manifest) {
  if (!manifest) return true;
  const rel = toPosix(path.normalize(relPath)).replace(/^\.\/?/, '').replace(/\/$/, '');
  if (!rel) return true;
  for (const skill of manifest) {
    if (rel === skill || rel.startsWith(`${skill}/`) || skill.startsWith(`${rel}/`)) return true;
  }
  return false;
}

/**
 * Every skill in both roots. When the same directory name exists in both, the
 * user copy wins. Each entry carries `source`: 'bundled' for shipped skills,
 * 'user' for the rest (including user skills still left in the bundled dir).
 *
 * @returns {Promise<Array<{ name, absolutePath, dirPath, root, source }>>}
 */
export async function collectAllSkillDirs({ bundledDir = BUNDLED_SKILLS_DIR, userDir = getUserSkillsDir() } = {}) {
  const manifest = readBundledManifest(bundledDir);
  const byName = new Map();

  const add = async (root, sourceFor) => {
    let dirs;
    try {
      dirs = await collectSkillDirs(root);
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const dir of dirs) {
      if (byName.has(dir.name)) continue;
      const dirPath = toPosix(path.relative(root, dir.absolutePath));
      byName.set(dir.name, { ...dir, dirPath, root, source: sourceFor(dirPath) });
    }
  };

  await add(userDir, () => 'user');
  await add(bundledDir, (dirPath) => (isShippedPath(dirPath, manifest) ? 'bundled' : 'user'));
  return [...byName.values()];
}

/**
 * Resolve a path from the skills API ('<skill>/SKILL.md', 'inference-serving/vllm/x.md')
 * to a file in one of the roots. A first segment that names a directory in the
 * user dir resolves there; anything else resolves in the bundled dir.
 *
 * @returns {{ absolutePath, root, rootKind: 'user' | 'bundled', relPath } | null}
 *   null when the path escapes its root.
 */
export function resolveSkillsApiPath(relPath, { bundledDir = BUNDLED_SKILLS_DIR, userDir = getUserSkillsDir() } = {}) {
  if (typeof relPath !== 'string' || !relPath || path.isAbsolute(relPath)) return null;
  const normalized = path.normalize(relPath);
  const firstSegment = normalized.split(/[\\/]+/)[0];
  let rootKind = 'bundled';
  if (firstSegment && firstSegment !== '..' && firstSegment !== '.') {
    try {
      if (fs.statSync(path.join(userDir, firstSegment)).isDirectory()) rootKind = 'user';
    } catch { /* not a user skill */ }
  }
  const root = path.resolve(rootKind === 'user' ? userDir : bundledDir);
  const absolutePath = path.resolve(root, normalized);
  if (absolutePath === root || !isInsideDir(absolutePath, root)) return null;
  return { absolutePath, root, rootKind, relPath: toPosix(path.relative(root, absolutePath)) };
}

/**
 * True when writing to or deleting `absolutePath` would change a shipped skill.
 */
export function isProtectedBundledPath(absolutePath, { bundledDir = BUNDLED_SKILLS_DIR } = {}) {
  const root = path.resolve(bundledDir);
  const target = path.resolve(absolutePath);
  if (!isInsideDir(target, root)) return false;
  if (target === root) return true;
  const rel = path.relative(root, target);
  // Release metadata files at the root of the bundled dir.
  if (!rel.includes(path.sep)) {
    try {
      if (fs.statSync(target).isFile()) return true;
    } catch { /* missing: fall through */ }
  }
  return isShippedPath(rel, readBundledManifest(root));
}

// ---------------------------------------------------------------------------
// Tag / origin metadata. Shipped metadata stays in the bundled JSON files;
// metadata for user skills is kept in files of the same name in the user dir
// and layered on top when read.
// ---------------------------------------------------------------------------

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, filePath);
}

/**
 * Change user-skill metadata. `changes` maps a skill name to
 * { stageOverride?, domainOverride?, origin? }; a null value removes the entry,
 * and `null` instead of an object removes the skill from every map.
 */
export async function updateUserSkillMetadata(changes, { userDir = getUserSkillsDir() } = {}) {
  const tagPath = path.join(userDir, TAG_MAPPING_FILE);
  const stagePath = path.join(userDir, STAGE_SKILL_MAP_FILE);
  const tagMapping = await readJson(tagPath, {});
  const stageMap = await readJson(stagePath, {});
  tagMapping.stageOverrides = tagMapping.stageOverrides || {};
  tagMapping.domainOverrides = tagMapping.domainOverrides || {};
  stageMap.skillOrigins = stageMap.skillOrigins || {};

  const setOrDelete = (map, name, value) => {
    if (value === undefined) return;
    if (value === null) delete map[name];
    else map[name] = value;
  };

  for (const [name, change] of Object.entries(changes || {})) {
    if (change === null) {
      delete tagMapping.stageOverrides[name];
      delete tagMapping.domainOverrides[name];
      delete stageMap.skillOrigins[name];
      continue;
    }
    setOrDelete(tagMapping.stageOverrides, name, change.stageOverride);
    setOrDelete(tagMapping.domainOverrides, name, change.domainOverride);
    setOrDelete(stageMap.skillOrigins, name, change.origin);
  }

  await writeJsonAtomic(tagPath, tagMapping);
  await writeJsonAtomic(stagePath, stageMap);
}

/**
 * The bundled JSON file with the user dir's file of the same name layered on
 * top (stageOverrides, domainOverrides and skillOrigins are merged per key).
 */
export async function readMergedSkillMetadataFile(fileName, { bundledDir = BUNDLED_SKILLS_DIR, userDir = getUserSkillsDir() } = {}) {
  const bundled = await readJson(path.join(bundledDir, fileName), null);
  const user = await readJson(path.join(userDir, fileName), null);
  if (!user) return bundled;
  const merged = { ...(bundled || {}) };
  for (const key of ['stageOverrides', 'domainOverrides', 'skillOrigins']) {
    if (user[key] && typeof user[key] === 'object') {
      merged[key] = { ...(merged[key] || {}), ...user[key] };
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// One-time migration out of the bundled dir
// ---------------------------------------------------------------------------

/** True when the app root (the parent of the bundled skills dir) holds a `.git` file or folder. */
export function isGitCheckout(bundledDir = BUNDLED_SKILLS_DIR) {
  return fs.existsSync(path.join(path.dirname(path.resolve(bundledDir)), '.git'));
}

async function pathExists(target) {
  try {
    await fsp.lstat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move user skills that were written into the bundled dir to the user dir.
 * Each skill is copied to a temporary folder in the user dir, renamed into
 * place, and only then removed from the bundled dir, so a failure at any step
 * leaves the original where it was. A skill whose name already exists in the
 * user dir is left alone (the user copy wins when both exist).
 *
 * Without a bundled manifest nothing is moved. Nothing is moved either when
 * the app runs from a git checkout (a `.git` next to skills/): there a skill
 * missing from the manifest is usually one a developer just added, not a user
 * import. DR_CLAW_MIGRATE_BUNDLED_SKILLS=1 turns the migration on anyway.
 *
 * @returns {Promise<{ migrated: string[], skipped: string[], failed: Array<{ name, error }>, leftInBundle: string[], skippedReason?: string }>}
 */
export async function migrateUserSkillsOutOfBundle({
  bundledDir = BUNDLED_SKILLS_DIR,
  userDir = getUserSkillsDir(),
  logger = console,
  env = process.env,
} = {}) {
  const result = { migrated: [], skipped: [], failed: [], leftInBundle: [] };
  if (isGitCheckout(bundledDir) && env.DR_CLAW_MIGRATE_BUNDLED_SKILLS !== '1') {
    result.skippedReason = 'git-checkout';
    logger.log?.(`[skills] Running from a git checkout; not moving unlisted skills out of ${bundledDir} (set DR_CLAW_MIGRATE_BUNDLED_SKILLS=1 to move them)`);
    return result;
  }
  const manifest = readBundledManifest(bundledDir);
  if (!manifest) return result;

  let bundledSkills;
  try {
    bundledSkills = await collectSkillDirs(bundledDir);
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn?.('[skills] Could not scan bundled skills for migration:', err.message);
    return result;
  }

  const candidates = bundledSkills.filter(
    (skill) => !isShippedPath(path.relative(bundledDir, skill.absolutePath), manifest),
  );
  if (candidates.length === 0) return result;

  await fsp.mkdir(userDir, { recursive: true });
  const logPath = path.join(userDir, MIGRATION_LOG_FILE);
  const migrationLog = await readJson(logPath, {});

  for (const skill of candidates) {
    const dest = path.join(userDir, skill.name);
    if (await pathExists(dest)) {
      // Moved on an earlier run but the bundled copy could not be removed then.
      if (migrationLog[skill.name]?.from === skill.absolutePath) {
        try {
          await fsp.rm(skill.absolutePath, { recursive: true, force: true });
          result.migrated.push(skill.name);
        } catch (err) {
          result.leftInBundle.push(skill.name);
          logger.warn?.(`[skills] Could not remove ${skill.absolutePath} after migration:`, err.message);
        }
      } else {
        result.skipped.push(skill.name);
        logger.warn?.(`[skills] Not migrating ${skill.absolutePath}: ${dest} already exists`);
      }
      continue;
    }

    const tmp = path.join(userDir, `.migrating-${skill.name}-${process.pid}-${Date.now()}`);
    try {
      await fsp.cp(skill.absolutePath, tmp, { recursive: true, errorOnExist: true, verbatimSymlinks: true });
      await fsp.access(path.join(tmp, 'SKILL.md'));
      await fsp.rename(tmp, dest);
    } catch (err) {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
      result.failed.push({ name: skill.name, error: err.message });
      logger.warn?.(`[skills] Failed to move ${skill.name} to ${userDir}; it stays in ${bundledDir}:`, err.message);
      continue;
    }

    migrationLog[skill.name] = { from: skill.absolutePath, at: new Date().toISOString() };
    try {
      await writeJsonAtomic(logPath, migrationLog);
    } catch { /* the log only helps retry the removal below */ }

    try {
      await fsp.rm(skill.absolutePath, { recursive: true, force: true });
      result.migrated.push(skill.name);
    } catch (err) {
      result.migrated.push(skill.name);
      result.leftInBundle.push(skill.name);
      logger.warn?.(`[skills] Copied ${skill.name} to ${userDir} but could not remove the bundled copy:`, err.message);
    }
  }

  const moved = [...result.migrated];
  if (moved.length > 0) {
    await migrateSkillMetadata(moved, { bundledDir, userDir, manifest, logger });
    logger.log?.(`[skills] Moved ${moved.length} user skill(s) to ${userDir}: ${moved.join(', ')}`);
  }
  return result;
}

/**
 * Copy tag and origin entries of migrated skills into the user dir, then drop
 * them from the bundled files when that is possible. Entries of shipped skills
 * are never touched.
 */
async function migrateSkillMetadata(names, { bundledDir, userDir, manifest, logger }) {
  const shippedNames = new Set([...manifest].map((dirPath) => dirPath.split('/').pop()));
  const ownNames = names.filter((name) => !shippedNames.has(name));
  if (ownNames.length === 0) return;

  const bundledTagPath = path.join(bundledDir, TAG_MAPPING_FILE);
  const bundledStagePath = path.join(bundledDir, STAGE_SKILL_MAP_FILE);
  const bundledTags = await readJson(bundledTagPath, null);
  const bundledStage = await readJson(bundledStagePath, null);

  const changes = {};
  for (const name of ownNames) {
    const change = {};
    const stage = bundledTags?.stageOverrides?.[name];
    const domain = bundledTags?.domainOverrides?.[name];
    const origin = bundledStage?.skillOrigins?.[name];
    if (stage !== undefined) change.stageOverride = stage;
    if (domain !== undefined) change.domainOverride = domain;
    change.origin = origin !== undefined ? origin : 'user-import';
    changes[name] = change;
  }

  try {
    await updateUserSkillMetadata(changes, { userDir });
  } catch (err) {
    logger.warn?.('[skills] Failed to copy metadata of migrated skills:', err.message);
    return; // keep the bundled entries; they are still the only copy
  }

  const strip = (map) => {
    let changed = false;
    if (!map) return changed;
    for (const name of ownNames) {
      if (Object.hasOwn(map, name)) {
        delete map[name];
        changed = true;
      }
    }
    return changed;
  };
  try {
    if (bundledTags && (strip(bundledTags.stageOverrides) | strip(bundledTags.domainOverrides))) {
      await writeJsonAtomic(bundledTagPath, bundledTags);
    }
    if (bundledStage && strip(bundledStage.skillOrigins)) {
      await writeJsonAtomic(bundledStagePath, bundledStage);
    }
  } catch {
    // Read-only bundle: the leftover entries are harmless.
  }
}
