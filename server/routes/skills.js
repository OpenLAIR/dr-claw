import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { extractProjectDirectory, ensureProjectSkillLinks } from '../projects.js';
import { FORBIDDEN_PATHS } from './projects.js';
import { findSkillMdPath } from '../utils/skillExpander.js';
import { collectSkillDirs } from '../utils/skillLinks.js';
import {
  BUNDLED_SKILLS_DIR,
  STAGE_SKILL_MAP_FILE,
  TAG_MAPPING_FILE,
  collectAllSkillDirs,
  getSkillRoots,
  getUserSkillsDir,
  isProtectedBundledPath,
  readMergedSkillMetadataFile,
  resolveSkillsApiPath,
  updateUserSkillMetadata,
} from '../utils/skillRoots.js';
import {
  SKILL_BASELINES,
  applyOverrideChanges,
  isValidSkillName,
  loadGlobalSkillPrefs,
  resolveProjectSkillStates,
  saveGlobalSkillPrefs,
  saveProjectSkillOverrides,
} from '../utils/skillDefaults.js';

const router = express.Router();

// Bundled skills ship with the app and are read-only (in the desktop app they
// sit inside the app bundle). Everything the user adds goes to the user skills
// directory; see utils/skillRoots.js.
function skillRootsNow() {
  return getSkillRoots({ bundledDir: BUNDLED_SKILLS_DIR, userDir: getUserSkillsDir() });
}

const READ_ONLY_MESSAGE = 'Built-in skills are read-only. Copy the skill to your skills to change it.';

/**
 * Where a skill named `name` already lives, if anywhere: 'user', 'bundled'
 * (shipped with the app) or null.
 */
async function findExistingSkill(name) {
  const skills = await collectAllSkillDirs(skillRootsNow());
  const match = skills.find((skill) => skill.name === name);
  return match ? match.source : null;
}

/**
 * Copy a skill directory into the user skills directory as `name`, replacing
 * an earlier user copy. The copy is made next to the destination and renamed
 * into place, so a failed copy leaves the previous version untouched.
 */
async function installUserSkill(name, srcDir) {
  const { userDir } = skillRootsNow();
  await fs.mkdir(userDir, { recursive: true });
  const destDir = path.join(userDir, name);
  const tmpDir = path.join(userDir, `.installing-${name}-${process.pid}-${Date.now()}`);
  const backupDir = path.join(userDir, `.replaced-${name}-${process.pid}-${Date.now()}`);
  try {
    await fs.cp(srcDir, tmpDir, { recursive: true });
    let replaced = false;
    try {
      await fs.rename(destDir, backupDir);
      replaced = true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    try {
      await fs.rename(tmpDir, destDir);
    } catch (err) {
      if (replaced) await fs.rename(backupDir, destDir).catch(() => {});
      throw err;
    }
    if (replaced) await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
  return destDir;
}

/**
 * Copy an uploaded skill + its tags into the user skills directory.
 * Failures are logged but never throw — local upload must always succeed.
 */
async function syncSkillToGlobal(name, srcDir, tags) {
  try {
    if ((await findExistingSkill(name)) === 'bundled') {
      console.warn(`[skills] Not installing uploaded "${name}": a built-in skill has that name`);
      return;
    }
    await installUserSkill(name, srcDir);
    await updateUserSkillMetadata({
      [name]: {
        stageOverride: tags?.stageOverride || undefined,
        domainOverride: tags?.domainOverride || undefined,
        origin: (tags && tags.origin) || 'downloaded',
      },
    }, { userDir: skillRootsNow().userDir });
  } catch (err) {
    console.warn('[skills] syncSkillToGlobal failed (non-fatal):', err.message);
  }
}

/**
 * Remove a user skill (from the user skills directory, or a user skill still
 * left in the bundled directory) and its metadata. Shipped skills are kept.
 * @returns {Promise<boolean>} whether anything was removed
 */
async function removeUserSkill(name) {
  if (!isValidSkillName(name)) return false;
  const { bundledDir, userDir } = skillRootsNow();
  let removed = false;
  const userCopy = path.join(userDir, name);
  try {
    await fs.access(userCopy);
    await fs.rm(userCopy, { recursive: true, force: true });
    removed = true;
  } catch { /* no user copy */ }

  const legacyCopy = path.join(bundledDir, name);
  if (!isProtectedBundledPath(legacyCopy, { bundledDir })) {
    try {
      await fs.access(legacyCopy);
      await fs.rm(legacyCopy, { recursive: true, force: true });
      removed = true;
    } catch { /* not there */ }
  }

  try {
    await updateUserSkillMetadata({ [name]: null }, { userDir });
  } catch (err) {
    console.warn('[skills] Failed to clean user skill metadata:', err.message);
  }
  return removed;
}

async function isSymlink(target) {
  try {
    return (await fs.lstat(target)).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Locate SKILL.md inside a zip (root or one level deep).
 * Returns { entry, prefix } where prefix is '' or 'dirname/'.
 */
function findSkillMd(zip) {
  // Check root
  const rootEntry = zip.getEntry('SKILL.md');
  if (rootEntry) return { entry: rootEntry, prefix: '' };

  // Check one level deep
  for (const entry of zip.getEntries()) {
    const parts = entry.entryName.split('/').filter(Boolean);
    if (parts.length === 2 && parts[1] === 'SKILL.md' && entry.isDirectory === false) {
      return { entry, prefix: parts[0] + '/' };
    }
  }
  return null;
}

/**
 * Parse YAML frontmatter from SKILL.md content using gray-matter.
 */
async function parseFrontmatter(content) {
  const matter = (await import('gray-matter')).default;
  const { data, content: body } = matter(content);
  return { data, body };
}

/**
 * Sanitize skill name for use as directory name.
 */
function safeDirName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Validate that a zip buffer contains a valid skill package.
 */
async function validateZipBuffer(buffer) {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(buffer);

  const result = findSkillMd(zip);
  if (!result) {
    return { valid: false, error: 'No SKILL.md found at root or one directory deep.' };
  }

  const content = result.entry.getData().toString('utf8');
  const { data: frontmatter, body } = await parseFrontmatter(content);

  if (!frontmatter || !frontmatter.name) {
    return { valid: false, error: 'SKILL.md must contain YAML frontmatter with a "name" field.' };
  }

  const entries = zip.getEntries();
  const prefix = result.prefix;
  const relevantEntries = prefix
    ? entries.filter(e => e.entryName.startsWith(prefix))
    : entries;
  const fileCount = relevantEntries.filter(e => !e.isDirectory).length;
  const hasPrompts = relevantEntries.some(e => {
    const rel = prefix ? e.entryName.slice(prefix.length) : e.entryName;
    return rel.startsWith('prompts/') || rel.startsWith('prompt/');
  });
  const hasReferences = relevantEntries.some(e => {
    const rel = prefix ? e.entryName.slice(prefix.length) : e.entryName;
    return rel.startsWith('references/') || rel.startsWith('reference/');
  });

  return {
    valid: true,
    skillName: frontmatter.name,
    frontmatter,
    description: body.trim().split('\n')[0] || '',
    fileCount,
    hasPrompts,
    hasReferences,
    prefix,
    zip,
  };
}

// ---------------------------------------------------------------------------
// Default skills: which bundled skills are linked into projects. See
// utils/skillDefaults.js for how project overrides, global overrides and the
// global baseline combine.
// ---------------------------------------------------------------------------

/** Names of every skill (bundled and user) and which of them are user skills. */
async function listSkillNames() {
  const dirs = await collectAllSkillDirs(skillRootsNow());
  return {
    skillNames: dirs.map((dir) => dir.name),
    userSkillNames: dirs.filter((dir) => dir.source === 'user').map((dir) => dir.name),
  };
}

function findOwnedProject(projectDb, projectName, user) {
  if (!projectName || typeof projectName !== 'string') return null;
  const row = projectDb.getProjectById(projectName);
  if (!row) return null;
  if (row.user_id && user?.id && row.user_id !== user.id) return null;
  return row;
}

async function buildSkillDefaultsState({ db, skillNames, userSkillNames, project }) {
  const { globalPrefs, projectOverrides, states } = await resolveProjectSkillStates({
    skillNames,
    userSkillNames,
    skillsDir: BUNDLED_SKILLS_DIR,
    projectId: project?.id ?? null,
    db,
  });
  return {
    baselines: SKILL_BASELINES,
    baseline: globalPrefs.baseline,
    globalOverrides: globalPrefs.overrides,
    project: project
      ? { name: project.id, displayName: project.display_name || null, overrides: projectOverrides }
      : null,
    skills: states,
    newSkills: states.filter((state) => state.isNew).map((state) => state.name),
  };
}

// GET /defaults?projectName= — enabled state of every bundled skill, for the
// global defaults or (with projectName) for one project.
router.get('/defaults', async (req, res) => {
  try {
    const db = await import('../database/db.js');
    const { projectName } = req.query;
    let project = null;
    if (projectName) {
      project = findOwnedProject(db.projectDb, projectName, req.user);
      if (!project) return res.status(404).json({ error: 'Project not found.' });
    }
    const { skillNames, userSkillNames } = await listSkillNames();
    res.json(await buildSkillDefaultsState({ db, skillNames, userSkillNames, project }));
  } catch (error) {
    console.error('[skills] get defaults error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT /defaults — { baseline?, overrides?: { name: true|false|null }, resetOverrides?, acknowledgeNew? }
// resetOverrides drops every global per-skill override (applied before
// `overrides`), so choosing a preset gives exactly that preset.
// Changes apply to each project on its next agent turn.
router.put('/defaults', async (req, res) => {
  try {
    const { baseline, overrides, resetOverrides, acknowledgeNew } = req.body || {};
    if (baseline !== undefined && !SKILL_BASELINES.includes(baseline)) {
      return res.status(400).json({ error: `baseline must be one of ${SKILL_BASELINES.join(', ')}` });
    }
    if (overrides !== undefined && (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides))) {
      return res.status(400).json({ error: 'overrides must be an object' });
    }
    const db = await import('../database/db.js');
    const { skillNames, userSkillNames } = await listSkillNames();
    const current = await loadGlobalSkillPrefs({ skillNames, db });
    const next = {
      baseline: baseline ?? current.baseline,
      overrides: applyOverrideChanges(resetOverrides ? {} : current.overrides, overrides, new Set(skillNames)),
      knownSkills: acknowledgeNew ? [...new Set([...current.knownSkills, ...skillNames])] : current.knownSkills,
    };
    await saveGlobalSkillPrefs(next, { db });
    res.json(await buildSkillDefaultsState({ db, skillNames, userSkillNames, project: null }));
  } catch (error) {
    console.error('[skills] put defaults error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT /project/:projectName/overrides — { overrides?: { name: true|false|null }, reset? }
// null (or reset) makes a skill follow the global defaults again. The project's
// skill links are updated right away.
router.put('/project/:projectName/overrides', async (req, res) => {
  try {
    const { overrides, reset } = req.body || {};
    if (!reset && (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides))) {
      return res.status(400).json({ error: 'overrides must be an object' });
    }
    const db = await import('../database/db.js');
    const project = findOwnedProject(db.projectDb, req.params.projectName, req.user);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const { skillNames, userSkillNames } = await listSkillNames();
    const current = project.metadata?.skills?.overrides || {};
    const nextOverrides = reset ? {} : applyOverrideChanges(current, overrides, new Set(skillNames));
    await saveProjectSkillOverrides(project.id, nextOverrides, { db });

    if (project.path) {
      try {
        await ensureProjectSkillLinks(project.path);
      } catch (err) {
        console.warn('[skills] Failed to update project skill links:', err.message);
      }
    }

    const updated = db.projectDb.getProjectById(project.id);
    res.json(await buildSkillDefaultsState({ db, skillNames, userSkillNames, project: updated }));
  } catch (error) {
    console.error('[skills] put project overrides error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /resolve — resolve a skill name to its SKILL.md path and content
router.get('/resolve', async (req, res) => {
  try {
    const { name, workingDir } = req.query;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name query parameter is required' });
    }
    // Prevent path traversal
    if (/[/\\]|\.\./.test(name)) {
      return res.status(400).json({ error: 'Invalid skill name' });
    }
    const effectiveWorkingDir = (typeof workingDir === 'string' && workingDir.trim()) || process.cwd();
    // Validate workingDir: must be absolute and not a forbidden system path
    if (effectiveWorkingDir !== process.cwd()) {
      if (!path.isAbsolute(effectiveWorkingDir)) {
        return res.status(400).json({ error: 'workingDir must be an absolute path' });
      }
      const normalized = path.normalize(effectiveWorkingDir);
      if (FORBIDDEN_PATHS.some((fp) => normalized === fp || normalized.startsWith(fp + path.sep))) {
        return res.status(400).json({ error: 'Invalid workingDir' });
      }
    }
    const skillMdPath = await findSkillMdPath(name, effectiveWorkingDir);
    if (!skillMdPath) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    const content = await fs.readFile(skillMdPath, 'utf-8');
    res.json({ path: skillMdPath, content });
  } catch (error) {
    console.error('[skills] resolve error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const TREE_SKIP = new Set(['node_modules', 'dist', 'build', '.git']);

async function buildSkillTree(dirPath, maxDepth, depth) {
  const items = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (TREE_SKIP.has(entry.name)) continue;
    const itemPath = path.join(dirPath, entry.name);
    let isDir = entry.isDirectory();
    if (!isDir && entry.isSymbolicLink()) {
      try { isDir = (await fs.stat(itemPath)).isDirectory(); } catch { /* ignore */ }
    }
    const item = { name: entry.name, path: itemPath, type: isDir ? 'directory' : 'file' };
    if (isDir && depth < maxDepth) {
      try {
        item.children = await buildSkillTree(itemPath, maxDepth, depth + 1);
      } catch (childError) {
        console.warn('[skills] Skipping unreadable directory:', itemPath, childError.message);
        item.children = [];
      }
    }
    items.push(item);
  }
  return items;
}

async function treeOrEmpty(root) {
  try {
    return await buildSkillTree(root, 5, 0);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function pruneTree(nodes, removedPaths) {
  if (removedPaths.size === 0) return nodes;
  return nodes
    .filter((node) => !removedPaths.has(node.path))
    .map((node) => (node.children ? { ...node, children: pruneTree(node.children, removedPaths) } : node));
}

/** Mark each skill directory in a tree with its source and API path. */
function annotateSkillNodes(nodes, root, sourceById) {
  for (const node of nodes) {
    if (node.type !== 'directory') continue;
    const dirPath = path.relative(root, node.path).split(path.sep).join('/');
    const source = sourceById.get(node.path);
    if (source) {
      node.source = source;
      node.dirPath = dirPath;
    }
    if (node.children) annotateSkillNodes(node.children, root, sourceById);
  }
}

// GET / — file tree of the bundled skills followed by the user's skills. Each
// skill directory carries `source` ('bundled' | 'user') and `dirPath`, the
// path to use with /file and /global-skill. A user skill with the same name as
// a bundled one replaces it.
router.get('/', async (req, res) => {
  try {
    const { bundledDir, userDir } = skillRootsNow();
    const skills = await collectAllSkillDirs({ bundledDir, userDir });
    const sourceById = new Map(skills.map((skill) => [skill.absolutePath, skill.source]));

    // Bundled skills replaced by a user skill of the same name are left out.
    const shadowed = new Set();
    try {
      for (const skill of await collectSkillDirs(bundledDir)) {
        if (!sourceById.has(skill.absolutePath)) shadowed.add(skill.absolutePath);
      }
    } catch { /* no bundled dir */ }
    const visibleBundled = pruneTree(await treeOrEmpty(bundledDir), shadowed);
    const userTree = (await treeOrEmpty(userDir)).filter((node) => node.type === 'directory');

    annotateSkillNodes(visibleBundled, bundledDir, sourceById);
    annotateSkillNodes(userTree, userDir, sourceById);

    const tree = [...visibleBundled, ...userTree];
    if (tree.length === 0) {
      return res.status(404).json({ error: 'Global skills directory not found' });
    }
    res.json(tree);
  } catch (error) {
    console.error('[ERROR] Skills tree error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const MERGED_METADATA_FILES = new Set([TAG_MAPPING_FILE, STAGE_SKILL_MAP_FILE]);

// GET /file — read a file of a bundled or user skill. skill-tag-mapping.json
// and stage-skill-map.json return the bundled file with the user's entries
// layered on top.
router.get('/file', async (req, res) => {
  try {
    const { filePath } = req.query;
    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({ error: 'filePath is required' });
    }
    if (MERGED_METADATA_FILES.has(filePath)) {
      const merged = await readMergedSkillMetadataFile(filePath, skillRootsNow());
      if (!merged) return res.status(404).json({ error: 'File not found' });
      return res.json({ content: JSON.stringify(merged, null, 2) });
    }
    const resolved = resolveSkillsApiPath(filePath, skillRootsNow());
    if (!resolved) {
      return res.status(403).json({ error: 'Path must be under skills root' });
    }
    const content = await fs.readFile(resolved.absolutePath, 'utf8');
    res.json({ content, source: resolved.rootKind });
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'File not found' });
    } else {
      console.error('[ERROR] Skill file read error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }
});

// PUT /file — write a file of a user skill. Built-in skills are read-only.
router.put('/file', async (req, res) => {
  try {
    const { filePath, content } = req.body || {};
    if (!filePath || typeof filePath !== 'string' || typeof content !== 'string') {
      return res.status(400).json({ error: 'filePath and content are required' });
    }
    const roots = skillRootsNow();
    const resolved = resolveSkillsApiPath(filePath, roots);
    if (!resolved) {
      return res.status(403).json({ error: 'Path must be under skills root' });
    }
    if (resolved.rootKind === 'bundled' && isProtectedBundledPath(resolved.absolutePath, roots)) {
      return res.status(403).json({ error: READ_ONLY_MESSAGE, readOnly: true });
    }
    await fs.writeFile(resolved.absolutePath, content, 'utf8');
    res.json({ success: true });
  } catch (error) {
    console.error('[ERROR] Skill file write error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /copy-to-user — { dirPath } copy a built-in skill to the user's skills
// so it can be edited. The copy keeps the name and replaces the built-in skill
// everywhere; deleting the copy brings the built-in one back.
router.post('/copy-to-user', async (req, res) => {
  try {
    const { dirPath } = req.body || {};
    if (!dirPath || typeof dirPath !== 'string') {
      return res.status(400).json({ error: 'dirPath is required' });
    }
    const roots = skillRootsNow();
    const resolved = resolveSkillsApiPath(dirPath, roots);
    if (!resolved || resolved.rootKind !== 'bundled') {
      return res.status(400).json({ error: 'Only built-in skills can be copied.' });
    }
    const bundledSkills = await collectSkillDirs(roots.bundledDir);
    const skill = bundledSkills.find((entry) => entry.absolutePath === resolved.absolutePath);
    if (!skill || !isProtectedBundledPath(skill.absolutePath, roots)) {
      return res.status(404).json({ error: 'Built-in skill not found.' });
    }
    try {
      await fs.access(path.join(roots.userDir, skill.name));
      return res.status(409).json({ error: `You already have a skill named "${skill.name}".` });
    } catch { /* free */ }
    await installUserSkill(skill.name, skill.absolutePath);
    await updateUserSkillMetadata({ [skill.name]: { origin: 'user-copy' } }, { userDir: roots.userDir });
    res.json({ success: true, name: skill.name, dirPath: skill.name });
  } catch (error) {
    console.error('[skills] copy-to-user error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /scan-local — scan a local directory for skill subdirectories
router.get('/scan-local', async (req, res) => {
  try {
    const rawPath = req.query.path || '~/.claude/skills';
    const resolvedPath = rawPath.replace(/^~/, os.homedir());
    const absolutePath = path.resolve(resolvedPath);

    // Security: reject forbidden system paths
    const normalizedPath = path.normalize(absolutePath);
    for (const forbidden of FORBIDDEN_PATHS) {
      if (normalizedPath === forbidden || normalizedPath.startsWith(forbidden + path.sep)) {
        return res.status(403).json({ error: `Scanning system directory "${forbidden}" is not allowed.` });
      }
    }

    // Validate the path exists and is a directory
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      return res.status(404).json({ error: `Path does not exist: ${rawPath}` });
    }
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: `Path is not a directory: ${rawPath}` });
    }

    // Scan for subdirectories (1-level deep)
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    const skills = [];
    const existingNames = new Set((await collectAllSkillDirs(skillRootsNow())).map((skill) => skill.name));

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;

      const skillDir = path.join(absolutePath, entry.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      let hasSkillMd = false;
      try {
        await fs.access(skillMdPath);
        hasSkillMd = true;
      } catch {
        // No SKILL.md
      }

      skills.push({
        name: entry.name,
        hasSkillMd,
        alreadyImported: existingNames.has(entry.name),
        sourcePath: skillDir,
      });
    }

    res.json({ path: rawPath, resolvedPath: absolutePath, skills });
  } catch (error) {
    console.error('[skills] scan-local error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Copy skill directories into the user skills directory. A name that is
 * already taken by a bundled or user skill is skipped.
 * @param {Array<{ name, sourcePath }>} dirs
 * @param {(name, srcDir) => Promise<object>} metadataFor - metadata change per skill
 */
async function importIntoUserSkills(dirs, metadataFor) {
  const existingNames = new Set((await collectAllSkillDirs(skillRootsNow())).map((skill) => skill.name));
  const imported = [];
  const skipped = [];
  const errors = [];

  for (const { name, sourcePath: srcDir } of dirs) {
    if (!isValidSkillName(name)) {
      errors.push(`${name}: invalid skill name`);
      continue;
    }
    if (existingNames.has(name)) {
      skipped.push(name);
      continue;
    }
    try {
      await installUserSkill(name, srcDir);
      existingNames.add(name);
      try {
        await updateUserSkillMetadata({ [name]: await metadataFor(name, srcDir) }, { userDir: skillRootsNow().userDir });
      } catch (err) {
        console.warn(`[skills] Imported ${name} but could not save its tags:`, err.message);
      }
      imported.push(name);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }
  return { imported, skipped, errors };
}

/** Stage/domain tags from SKILL.md frontmatter, in skill-tag-mapping.json form. */
async function tagsFromFrontmatter(srcDir) {
  let frontmatter = {};
  try {
    const skillMdContent = await fs.readFile(path.join(srcDir, 'SKILL.md'), 'utf8');
    frontmatter = (await parseFrontmatter(skillMdContent)).data || {};
  } catch { /* ignore parse errors */ }
  const tags = {};
  if (frontmatter.stage) {
    tags.stageOverride = typeof frontmatter.stage === 'string'
      ? { en: `Stage: ${frontmatter.stage}`, zh: `阶段: ${frontmatter.stage}` }
      : frontmatter.stage;
  }
  if (frontmatter.domain) {
    tags.domainOverride = typeof frontmatter.domain === 'string'
      ? { en: `Domain: ${frontmatter.domain}`, zh: `领域: ${frontmatter.domain}` }
      : frontmatter.domain;
  }
  return tags;
}

// POST /import-from-local — copy selected skills from a local directory into the user skills directory
router.post('/import-from-local', async (req, res) => {
  try {
    const { sourcePath: rawPath, skillNames } = req.body || {};
    const resolvedPath = (rawPath || '~/.claude/skills').replace(/^~/, os.homedir());
    const absolutePath = path.resolve(resolvedPath);

    // Security: reject forbidden system paths
    const normalizedPath = path.normalize(absolutePath);
    for (const forbidden of FORBIDDEN_PATHS) {
      if (normalizedPath === forbidden || normalizedPath.startsWith(forbidden + path.sep)) {
        return res.status(403).json({ error: `Importing from system directory "${forbidden}" is not allowed.` });
      }
    }

    // Validate the path exists and is a directory
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      return res.status(404).json({ error: `Path does not exist: ${rawPath || '~/.claude/skills'}` });
    }
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: `Path is not a directory: ${rawPath || '~/.claude/skills'}` });
    }

    // If skillNames is provided, only import those; otherwise scan all subdirectories
    const dirsToImport = [];
    if (Array.isArray(skillNames) && skillNames.length > 0) {
      for (const name of skillNames) {
        if (typeof name !== 'string' || !isValidSkillName(name)) continue;
        const skillDir = path.join(absolutePath, name);
        try {
          const s = await fs.stat(skillDir);
          if (s.isDirectory()) {
            dirsToImport.push({ name, sourcePath: skillDir });
          }
        } catch {
          // Skip missing
        }
      }
    } else {
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        dirsToImport.push({ name: entry.name, sourcePath: path.join(absolutePath, entry.name) });
      }
    }

    const result = await importIntoUserSkills(dirsToImport, async () => ({ origin: 'local-import' }));
    res.json(result);
  } catch (error) {
    console.error('[skills] import-from-local error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /:projectName/import-user-skills — import from ~/.claude/skills/ into the user skills directory, then re-sync symlinks
router.post('/:projectName/import-user-skills', async (req, res) => {
  try {
    const projectName = req.params.projectName;
    const projectRoot = await extractProjectDirectory(projectName);
    if (!projectRoot) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    // Resolve ~/.claude/skills/
    const claudeSkillsDir = path.join(os.homedir(), '.claude', 'skills');
    let stat;
    try {
      stat = await fs.stat(claudeSkillsDir);
    } catch {
      return res.status(404).json({ error: 'User skills directory not found (~/.claude/skills/).' });
    }
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: '~/.claude/skills/ is not a directory.' });
    }

    // Subdirs containing SKILL.md
    const entries = await fs.readdir(claudeSkillsDir, { withFileTypes: true });
    const dirsToImport = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const srcDir = path.join(claudeSkillsDir, entry.name);
      try {
        await fs.access(path.join(srcDir, 'SKILL.md'));
        dirsToImport.push({ name: entry.name, sourcePath: srcDir });
      } catch {
        // Skip dirs without SKILL.md
      }
    }

    const result = await importIntoUserSkills(dirsToImport, async (_name, srcDir) => ({
      ...(await tagsFromFrontmatter(srcDir)),
      origin: 'user-import',
    }));

    // Re-sync symlinks for the requesting project
    if (result.imported.length > 0) {
      try {
        await ensureProjectSkillLinks(projectRoot);
      } catch (err) {
        console.warn('[skills] ensureProjectSkillLinks after import failed (non-fatal):', err.message);
      }
    }

    res.json(result);
  } catch (error) {
    console.error('[skills] import-user-skills error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /:projectName/validate-skill-zip
router.post('/:projectName/validate-skill-zip', async (req, res) => {
  try {
    const multer = (await import('multer')).default;
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    });

    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: 'Failed to process uploaded file: ' + err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided.' });
      }

      try {
        const result = await validateZipBuffer(req.file.buffer);
        if (!result.valid) {
          return res.status(400).json({ valid: false, error: result.error });
        }

        return res.json({
          valid: true,
          skillName: result.skillName,
          frontmatter: result.frontmatter,
          description: result.description,
          fileCount: result.fileCount,
          hasPrompts: result.hasPrompts,
          hasReferences: result.hasReferences,
        });
      } catch (parseErr) {
        return res.status(400).json({ valid: false, error: 'Failed to parse zip: ' + parseErr.message });
      }
    });
  } catch (error) {
    console.error('[skills] validate-skill-zip error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:projectName/upload-skill
router.post('/:projectName/upload-skill', async (req, res) => {
  try {
    const multer = (await import('multer')).default;
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    });

    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: 'Failed to process uploaded file: ' + err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided.' });
      }

      let extractedDir = null;

      try {
        // Resolve project root
        const projectName = req.params.projectName;
        const projectRoot = await extractProjectDirectory(projectName);
        if (!projectRoot) {
          return res.status(404).json({ error: 'Project not found.' });
        }

        // Validate zip
        const result = await validateZipBuffer(req.file.buffer);
        if (!result.valid) {
          return res.status(400).json({ error: result.error });
        }

        const safeSkillName = safeDirName(result.skillName);
        if (!safeSkillName) {
          return res.status(400).json({ error: 'Invalid skill name.' });
        }
        if ((await findExistingSkill(safeSkillName)) === 'bundled') {
          return res.status(409).json({ error: `A built-in skill is already named "${safeSkillName}".` });
        }

        // Determine skills directory (use skills/ relative to project root)
        const skillsDir = path.join(projectRoot, 'skills');
        await fs.mkdir(skillsDir, { recursive: true });

        extractedDir = path.join(skillsDir, safeSkillName);

        // Check for conflicts
        try {
          await fs.access(extractedDir);
          return res.status(409).json({ error: `Skill directory "${safeSkillName}" already exists.` });
        } catch {
          // Directory doesn't exist — good
        }

        await fs.mkdir(extractedDir, { recursive: true });

        // Extract files with path traversal protection
        const { zip, prefix } = result;
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory) continue;

          let relativePath = entry.entryName;
          if (prefix && relativePath.startsWith(prefix)) {
            relativePath = relativePath.slice(prefix.length);
          } else if (prefix) {
            continue; // Skip files outside the skill directory
          }

          // Path traversal protection (zip-slip). Compare against a resolved root with a
          // trailing separator so a sibling dir sharing the prefix cannot escape extraction.
          const safeRoot = path.resolve(extractedDir);
          const resolved = path.resolve(extractedDir, relativePath);
          if (resolved !== safeRoot && !resolved.startsWith(safeRoot + path.sep)) {
            continue; // Skip dangerous paths
          }

          const dir = path.dirname(resolved);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(resolved, entry.getData());
        }

        // Parse tags from request body
        let tags = {};
        try {
          if (req.body && req.body.tags) {
            tags = typeof req.body.tags === 'string' ? JSON.parse(req.body.tags) : req.body.tags;
          }
        } catch {
          // Ignore invalid tags JSON
        }

        // Update skill-tag-mapping.json
        const tagMappingPath = path.join(projectRoot, 'skills', 'skill-tag-mapping.json');
        let tagMapping = { version: 1, stageOverrides: {}, domainOverrides: {}, platformNativeSkills: [], domainCsAiExceptions: [] };
        try {
          const raw = await fs.readFile(tagMappingPath, 'utf8');
          tagMapping = JSON.parse(raw);
        } catch {
          // Use defaults
        }

        if (tags.stageOverride) {
          tagMapping.stageOverrides = tagMapping.stageOverrides || {};
          tagMapping.stageOverrides[safeSkillName] = tags.stageOverride;
        }
        if (tags.domainOverride) {
          tagMapping.domainOverrides = tagMapping.domainOverrides || {};
          tagMapping.domainOverrides[safeSkillName] = tags.domainOverride;
        }

        await fs.writeFile(tagMappingPath, JSON.stringify(tagMapping, null, 2), 'utf8');

        // Update stage-skill-map.json with origin
        const stageSkillMapPath = path.join(projectRoot, 'skills', 'stage-skill-map.json');
        let stageSkillMap = { skillOrigins: {} };
        try {
          const raw = await fs.readFile(stageSkillMapPath, 'utf8');
          stageSkillMap = JSON.parse(raw);
        } catch {
          // Use defaults
        }

        stageSkillMap.skillOrigins = stageSkillMap.skillOrigins || {};
        stageSkillMap.skillOrigins[safeSkillName] = tags.origin || 'downloaded';

        await fs.writeFile(stageSkillMapPath, JSON.stringify(stageSkillMap, null, 2), 'utf8');

        // Sync to global skills directory
        await syncSkillToGlobal(safeSkillName, extractedDir, tags);

        return res.json({
          success: true,
          skillName: result.skillName,
          dirName: safeSkillName,
          path: extractedDir,
          frontmatter: result.frontmatter,
        });
      } catch (uploadErr) {
        // Cleanup on failure
        if (extractedDir) {
          try {
            await fs.rm(extractedDir, { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors
          }
        }
        console.error('[skills] upload-skill error:', uploadErr);
        return res.status(500).json({ error: 'Failed to extract skill: ' + uploadErr.message });
      }
    });
  } catch (error) {
    console.error('[skills] upload-skill error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /global-skill — delete a user skill by its dirPath from GET /.
// Built-in skills cannot be deleted (turn them off in the skill defaults instead).
router.delete('/global-skill', async (req, res) => {
  try {
    const { dirPath } = req.body || {};
    if (!dirPath || typeof dirPath !== 'string') {
      return res.status(400).json({ error: 'dirPath is required' });
    }
    const roots = skillRootsNow();
    const resolved = resolveSkillsApiPath(dirPath, roots);
    if (!resolved) {
      return res.status(403).json({ error: 'Path must be under skills root' });
    }
    if (resolved.rootKind === 'bundled' && isProtectedBundledPath(resolved.absolutePath, roots)) {
      return res.status(403).json({ error: 'Built-in skills cannot be deleted. Turn the skill off instead.', readOnly: true });
    }
    try {
      const stat = await fs.stat(resolved.absolutePath);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }
    } catch {
      return res.status(404).json({ error: 'Skill directory not found' });
    }
    await fs.rm(resolved.absolutePath, { recursive: true, force: true });

    const skillName = path.basename(resolved.absolutePath);
    try {
      await updateUserSkillMetadata({ [skillName]: null }, { userDir: roots.userDir });
    } catch (err) {
      console.warn('[skills] Failed to clean user skill metadata:', err.message);
    }

    res.json({ success: true, deleted: dirPath });
  } catch (error) {
    console.error('[skills] delete-global-skill error:', error);
    res.status(500).json({ error: 'Failed to delete skill: ' + error.message });
  }
});

// DELETE /:projectName/:skillDirName
router.delete('/:projectName/:skillDirName', async (req, res) => {
  try {
    const { projectName, skillDirName } = req.params;
    const projectRoot = await extractProjectDirectory(projectName);
    if (!projectRoot) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    // Search candidate locations for the skill directory
    const candidateBases = ['skills', '.claude/skills', '.agents/skills', '.cursor/skills'];
    let foundDir = null;
    for (const base of candidateBases) {
      const candidate = path.join(projectRoot, base, skillDirName);
      try {
        const stat = await fs.stat(candidate);
        if (stat.isDirectory()) {
          foundDir = candidate;
          break;
        }
      } catch {
        // Not found in this location
      }
    }

    if (!foundDir) {
      return res.status(404).json({ error: `Skill directory "${skillDirName}" not found.` });
    }

    // Delete the skill directory
    await fs.rm(foundDir, { recursive: true, force: true });

    // Determine the parent skills dir from the found location for config cleanup
    const foundSkillsBase = path.dirname(foundDir);

    // Clean up skill-tag-mapping.json in the skills base where the skill was found
    // Also clean from the legacy skills/ location for backwards compat
    const tagMappingCandidates = [
      path.join(foundSkillsBase, 'skill-tag-mapping.json'),
      path.join(projectRoot, 'skills', 'skill-tag-mapping.json'),
    ];
    for (const tagMappingPath of [...new Set(tagMappingCandidates)]) {
      // The project's copies are links to the bundled files; never write through them.
      if (await isSymlink(tagMappingPath)) continue;
      try {
        const raw = await fs.readFile(tagMappingPath, 'utf8');
        const tagMapping = JSON.parse(raw);
        if (tagMapping.stageOverrides) delete tagMapping.stageOverrides[skillDirName];
        if (tagMapping.domainOverrides) delete tagMapping.domainOverrides[skillDirName];
        await fs.writeFile(tagMappingPath, JSON.stringify(tagMapping, null, 2), 'utf8');
      } catch {
        // Tag mapping file doesn't exist or can't be parsed; skip cleanup
      }
    }

    // Clean up stage-skill-map.json in the skills base + legacy location
    const stageMapCandidates = [
      path.join(foundSkillsBase, 'stage-skill-map.json'),
      path.join(projectRoot, 'skills', 'stage-skill-map.json'),
    ];
    for (const stageSkillMapPath of [...new Set(stageMapCandidates)]) {
      if (await isSymlink(stageSkillMapPath)) continue;
      try {
        const raw = await fs.readFile(stageSkillMapPath, 'utf8');
        const stageSkillMap = JSON.parse(raw);
        if (stageSkillMap.skillOrigins) delete stageSkillMap.skillOrigins[skillDirName];
        await fs.writeFile(stageSkillMapPath, JSON.stringify(stageSkillMap, null, 2), 'utf8');
      } catch {
        // Stage-skill-map file doesn't exist or can't be parsed; skip cleanup
      }
    }

    // Remove the user's copy too; built-in skills are kept.
    await removeUserSkill(skillDirName);

    return res.json({ success: true, deleted: skillDirName });
  } catch (error) {
    console.error('[skills] delete-skill error:', error);
    res.status(500).json({ error: 'Failed to delete skill: ' + error.message });
  }
});

export default router;
