import fs from 'fs';
import path from 'path';

/**
 * Which skills (bundled and user skills, see skillRoots.js) are linked into a
 * project's agent folders.
 *
 * A skill is enabled for a project when, in order:
 *   1. the project overrides it (projects.metadata.skills.overrides), else
 *   2. the global defaults override it (app_settings 'skills.defaults'), else
 *   3. the global baseline decides: 'all', 'none', or 'recommended'
 *      (skill-tag-mapping.json `recommendedSkills`, or the core pipeline
 *      skills when that list is missing, plus skills the user added).
 *
 * Disabled skills are not linked, so harnesses do not load them on their own,
 * but they stay listed in .agents/skills/skills-index.md and `/name` still
 * resolves them from the skill libraries.
 */

export const SKILL_DEFAULTS_SETTING_KEY = 'skills.defaults';
export const SKILL_BASELINES = ['recommended', 'all', 'none'];

// Core skills that are not listed in platformNativeSkills by their directory
// name (bioinformatics-init-analysis lives at .../skills/init-analysis).
const ALWAYS_CORE_SKILLS = ['inno-pipeline-planner', 'init-analysis'];

const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isValidSkillName(name) {
  return typeof name === 'string' && SKILL_NAME_PATTERN.test(name) && !name.includes('..');
}

export function readSkillManifest(skillsDir) {
  let mapping = {};
  try {
    mapping = JSON.parse(fs.readFileSync(path.join(skillsDir, 'skill-tag-mapping.json'), 'utf8'));
  } catch {
    mapping = {};
  }
  const listOf = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);
  const coreNames = new Set([...listOf(mapping.platformNativeSkills), ...ALWAYS_CORE_SKILLS]);
  // The recommended preset is its own list: some core skills (e.g. single-cell
  // analysis, Overleaf sync) are too specialised to be on for everyone.
  const recommendedNames = Array.isArray(mapping.recommendedSkills)
    ? new Set(listOf(mapping.recommendedSkills))
    : new Set(coreNames);
  return { coreNames, recommendedNames };
}

export function normalizeOverrides(raw) {
  const result = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'boolean' && isValidSkillName(name)) result[name] = value;
  }
  return result;
}

export function normalizeGlobalPrefs(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    baseline: SKILL_BASELINES.includes(source.baseline) ? source.baseline : 'recommended',
    overrides: normalizeOverrides(source.overrides),
    knownSkills: Array.isArray(source.knownSkills) ? source.knownSkills.filter(isValidSkillName) : [],
  };
}

/**
 * Apply `{ name: true | false | null }` to an overrides map; null removes the
 * override so the skill inherits again. Names outside `allowedNames` are dropped.
 */
export function applyOverrideChanges(current, changes, allowedNames) {
  const next = { ...normalizeOverrides(current) };
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return next;
  for (const [name, value] of Object.entries(changes)) {
    if (!isValidSkillName(name)) continue;
    if (allowedNames && !allowedNames.has(name)) continue;
    if (value === null) delete next[name];
    else if (typeof value === 'boolean') next[name] = value;
  }
  return next;
}

/**
 * Skills the user added themselves (`userNames`) count as recommended: the
 * user chose them, so they are on unless the baseline is 'none'.
 */
export function isEnabledByBaseline(name, baseline, manifest, userNames = EMPTY_SET) {
  if (baseline === 'all') return true;
  if (baseline === 'none') return false;
  return manifest.recommendedNames.has(name) || userNames.has(name);
}

const EMPTY_SET = new Set();

/**
 * @returns {Array<{ name, enabled, source, globalEnabled, baselineEnabled, core, recommended, userSkill, isNew }>}
 *   source is 'project' | 'global' | 'baseline'; globalEnabled is the value a
 *   project inherits without its own override, baselineEnabled the value the
 *   global defaults have without their own override.
 */
export function resolveSkillStates({ skillNames, manifest, globalPrefs, projectOverrides = {}, userSkillNames = [] }) {
  const prefs = normalizeGlobalPrefs(globalPrefs);
  const known = new Set(prefs.knownSkills);
  const userNames = new Set(userSkillNames);
  return skillNames.map((name) => {
    const baselineEnabled = isEnabledByBaseline(name, prefs.baseline, manifest, userNames);
    const globalHasOverride = Object.hasOwn(prefs.overrides, name);
    const globalEnabled = globalHasOverride ? prefs.overrides[name] : baselineEnabled;
    const projectHasOverride = Object.hasOwn(projectOverrides, name);
    let source = 'baseline';
    if (projectHasOverride) source = 'project';
    else if (globalHasOverride) source = 'global';
    return {
      name,
      enabled: projectHasOverride ? projectOverrides[name] : globalEnabled,
      source,
      globalEnabled,
      baselineEnabled,
      core: manifest.coreNames.has(name),
      recommended: manifest.recommendedNames.has(name),
      userSkill: userNames.has(name),
      isNew: known.size > 0 && !known.has(name) && !userNames.has(name),
    };
  });
}

async function loadDb() {
  return import('../database/db.js');
}

function writeGlobalPrefs(appSettingsDb, prefs) {
  appSettingsDb.set(SKILL_DEFAULTS_SETTING_KEY, JSON.stringify(normalizeGlobalPrefs(prefs)));
}

/**
 * Read the global defaults, creating them on first use. Installs that already
 * have projects keep the old behaviour (every skill linked); fresh installs
 * start from the recommended set. Skills present now are recorded as known so
 * only skills added by a later release are flagged as new.
 */
export async function loadGlobalSkillPrefs({ skillNames = [], db } = {}) {
  const { appSettingsDb, projectDb } = db || await loadDb();
  const raw = appSettingsDb.get(SKILL_DEFAULTS_SETTING_KEY);
  if (raw) {
    try {
      const prefs = normalizeGlobalPrefs(JSON.parse(raw));
      if (prefs.knownSkills.length === 0 && skillNames.length > 0) {
        prefs.knownSkills = [...skillNames];
        writeGlobalPrefs(appSettingsDb, prefs);
      }
      return prefs;
    } catch {
      // Unreadable value: rebuild it below.
    }
  }
  const hasProjects = projectDb.getAllProjects().length > 0;
  const prefs = {
    baseline: hasProjects ? 'all' : 'recommended',
    overrides: {},
    knownSkills: [...skillNames],
  };
  writeGlobalPrefs(appSettingsDb, prefs);
  return prefs;
}

export async function saveGlobalSkillPrefs(prefs, { db } = {}) {
  const { appSettingsDb } = db || await loadDb();
  writeGlobalPrefs(appSettingsDb, prefs);
  return normalizeGlobalPrefs(prefs);
}

export function getProjectSkillOverrides(projectRow) {
  return normalizeOverrides(projectRow?.metadata?.skills?.overrides);
}

export async function saveProjectSkillOverrides(projectId, overrides, { db } = {}) {
  const { projectDb } = db || await loadDb();
  const row = projectDb.getProjectById(projectId);
  if (!row) return null;
  const metadata = { ...(row.metadata || {}) };
  const normalized = normalizeOverrides(overrides);
  if (Object.keys(normalized).length > 0) {
    metadata.skills = { ...(metadata.skills || {}), overrides: normalized };
  } else if (metadata.skills) {
    const { overrides: _removed, ...rest } = metadata.skills;
    if (Object.keys(rest).length > 0) metadata.skills = rest;
    else delete metadata.skills;
  }
  projectDb.updateProjectMetadata(projectId, metadata);
  return normalized;
}

function findProjectRowByPath(projectDb, projectPath) {
  if (!projectPath) return null;
  return projectDb.getProjectByPath(projectPath)
    || projectDb.getProjectByPath(path.resolve(projectPath))
    || null;
}

/**
 * Resolve skill states for a project, looked up by id or by path. With neither
 * (or an unknown project) the global defaults apply.
 */
export async function resolveProjectSkillStates({ skillNames, skillsDir, userSkillNames = [], projectId = null, projectPath = null, db } = {}) {
  const database = db || await loadDb();
  const manifest = readSkillManifest(skillsDir);
  const globalPrefs = await loadGlobalSkillPrefs({ skillNames, db: database });
  const projectRow = projectId
    ? database.projectDb.getProjectById(projectId)
    : findProjectRowByPath(database.projectDb, projectPath);
  const projectOverrides = getProjectSkillOverrides(projectRow);
  return {
    globalPrefs,
    projectRow: projectRow || null,
    projectOverrides,
    states: resolveSkillStates({ skillNames, manifest, globalPrefs, projectOverrides, userSkillNames }),
  };
}
