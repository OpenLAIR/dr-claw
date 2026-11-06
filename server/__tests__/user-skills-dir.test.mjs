import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  collectAllSkillDirs,
  getUserSkillsDir,
  isProtectedBundledPath,
  migrateUserSkillsOutOfBundle,
  readMergedSkillMetadataFile,
  resolveSkillsApiPath,
} from '../utils/skillRoots.js';
import { syncProjectSkillLinks } from '../utils/skillLinks.js';
import { isBundledSkillRead } from '../utils/bundledSkillAccess.js';
import { rewriteUnlinkedSkillCommand } from '../utils/skillExpander.js';
import { resolveSkillStates } from '../utils/skillDefaults.js';
import { listTrackedSkillDirs } from '../../scripts/export-bundled-skills-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const quiet = { log() {}, warn() {} };

async function exists(target) {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function makeSkill(dir, body = 'body') {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${path.basename(dir)}\ndescription: ${body}\n---\n${body}\n`);
}

/**
 * A bundled dir with two shipped skills (one nested in a category), a shipped
 * skill that skillOrigins calls "imported", and one user skill added by an
 * earlier import.
 */
async function makeBundled(root) {
  const bundledDir = path.join(root, 'app', 'skills');
  await makeSkill(path.join(bundledDir, 'shipped-a'));
  await makeSkill(path.join(bundledDir, 'category', 'shipped-b'));
  await makeSkill(path.join(bundledDir, 'shipped-imported'));
  await makeSkill(path.join(bundledDir, 'mine'), 'my own skill');
  await writeFile(path.join(bundledDir, 'mine', 'notes.md'), 'extra file');
  await writeFile(path.join(bundledDir, 'bundled-skills.json'), JSON.stringify({
    version: 1,
    skills: ['category/shipped-b', 'shipped-a', 'shipped-imported'],
  }));
  await writeFile(path.join(bundledDir, 'skill-tag-mapping.json'), JSON.stringify({
    platformNativeSkills: ['shipped-a'],
    stageOverrides: { mine: { en: 'Stage: Survey' }, 'shipped-a': { en: 'Stage: Idea' } },
    domainOverrides: {},
  }));
  await writeFile(path.join(bundledDir, 'stage-skill-map.json'), JSON.stringify({
    survey: { base: ['shipped-a'] },
    skillOrigins: { mine: 'user-import', 'shipped-imported': 'imported' },
  }));
  return bundledDir;
}

let tempRoot;
let bundledDir;
let userDir;

beforeEach(async () => {
  // Real path: the import routes refuse paths under /var (macOS tmpdir).
  tempRoot = await mkdtemp(path.join(fs.realpathSync(os.tmpdir()), 'user-skills-'));
  bundledDir = await makeBundled(tempRoot);
  userDir = path.join(tempRoot, 'home', '.dr-claw', 'skills');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempRoot, { recursive: true, force: true });
});

describe('getUserSkillsDir', () => {
  it('defaults to ~/.dr-claw/skills and honours DR_CLAW_USER_SKILLS_DIR', () => {
    expect(getUserSkillsDir({})).toBe(path.join(os.homedir(), '.dr-claw', 'skills'));
    expect(getUserSkillsDir({ DR_CLAW_USER_SKILLS_DIR: '/data/skills' })).toBe(path.resolve('/data/skills'));
    expect(getUserSkillsDir({ DR_CLAW_USER_SKILLS_DIR: '~/x' })).toBe(path.join(os.homedir(), 'x'));
  });
});

describe('migrateUserSkillsOutOfBundle', () => {
  it('moves only skills missing from the release manifest, with their metadata', async () => {
    const result = await migrateUserSkillsOutOfBundle({ bundledDir, userDir, logger: quiet });

    expect(result).toMatchObject({ migrated: ['mine'], skipped: [], failed: [], leftInBundle: [] });
    expect(await exists(path.join(bundledDir, 'mine'))).toBe(false);
    expect(await readFile(path.join(userDir, 'mine', 'notes.md'), 'utf8')).toBe('extra file');
    // Shipped skills stay, including one whose skillOrigins says "imported".
    for (const shipped of ['shipped-a', 'category/shipped-b', 'shipped-imported']) {
      expect(await exists(path.join(bundledDir, shipped, 'SKILL.md'))).toBe(true);
    }

    const userTags = JSON.parse(await readFile(path.join(userDir, 'skill-tag-mapping.json'), 'utf8'));
    const userStage = JSON.parse(await readFile(path.join(userDir, 'stage-skill-map.json'), 'utf8'));
    expect(userTags.stageOverrides).toEqual({ mine: { en: 'Stage: Survey' } });
    expect(userStage.skillOrigins).toEqual({ mine: 'user-import' });

    const bundledTags = JSON.parse(await readFile(path.join(bundledDir, 'skill-tag-mapping.json'), 'utf8'));
    const bundledStage = JSON.parse(await readFile(path.join(bundledDir, 'stage-skill-map.json'), 'utf8'));
    expect(bundledTags.stageOverrides).toEqual({ 'shipped-a': { en: 'Stage: Idea' } });
    expect(bundledStage.skillOrigins).toEqual({ 'shipped-imported': 'imported' });
    expect(bundledStage.survey).toEqual({ base: ['shipped-a'] });

    const merged = await readMergedSkillMetadataFile('stage-skill-map.json', { bundledDir, userDir });
    expect(merged.skillOrigins).toEqual({ 'shipped-imported': 'imported', mine: 'user-import' });

    // Running again changes nothing.
    const again = await migrateUserSkillsOutOfBundle({ bundledDir, userDir, logger: quiet });
    expect(again).toEqual({ migrated: [], skipped: [], failed: [], leftInBundle: [] });
  });

  it('keeps the original when copying fails', async () => {
    vi.spyOn(fs.promises, 'cp').mockRejectedValue(new Error('disk full'));
    const result = await migrateUserSkillsOutOfBundle({ bundledDir, userDir, logger: quiet });

    expect(result.migrated).toEqual([]);
    expect(result.failed).toEqual([{ name: 'mine', error: 'disk full' }]);
    expect(await readFile(path.join(bundledDir, 'mine', 'notes.md'), 'utf8')).toBe('extra file');
    expect(await exists(path.join(userDir, 'mine'))).toBe(false);
    // No temporary folder left behind, and the bundled metadata is untouched.
    expect((await readdir(userDir)).filter((name) => name.startsWith('.migrating-'))).toEqual([]);
    const bundledStage = JSON.parse(await readFile(path.join(bundledDir, 'stage-skill-map.json'), 'utf8'));
    expect(bundledStage.skillOrigins.mine).toBe('user-import');
  });

  it('keeps both copies when the user dir already has that name, and retries a removal it logged', async () => {
    await makeSkill(path.join(userDir, 'mine'), 'a different skill');
    const skipped = await migrateUserSkillsOutOfBundle({ bundledDir, userDir, logger: quiet });
    expect(skipped.skipped).toEqual(['mine']);
    expect(await exists(path.join(bundledDir, 'mine', 'notes.md'))).toBe(true);
    expect(await readFile(path.join(userDir, 'mine', 'SKILL.md'), 'utf8')).toContain('a different skill');

    // A copy that was moved earlier but could not be removed from the bundle.
    await rm(path.join(userDir, 'mine'), { recursive: true });
    const realRm = fs.promises.rm.bind(fs.promises);
    const rmSpy = vi.spyOn(fs.promises, 'rm').mockImplementation(async (target, options) => {
      if (target === path.join(bundledDir, 'mine')) throw new Error('read-only volume');
      return realRm(target, options);
    });
    const first = await migrateUserSkillsOutOfBundle({ bundledDir, userDir, logger: quiet });
    expect(first.leftInBundle).toEqual(['mine']);
    expect(await exists(path.join(userDir, 'mine', 'notes.md'))).toBe(true);
    expect(await exists(path.join(bundledDir, 'mine'))).toBe(true);

    rmSpy.mockRestore();
    const second = await migrateUserSkillsOutOfBundle({ bundledDir, userDir, logger: quiet });
    expect(second.migrated).toEqual(['mine']);
    expect(await exists(path.join(bundledDir, 'mine'))).toBe(false);
    expect(await exists(path.join(userDir, 'mine', 'notes.md'))).toBe(true);
  });

  it('skips a git checkout unless DR_CLAW_MIGRATE_BUNDLED_SKILLS=1', async () => {
    await mkdir(path.join(path.dirname(bundledDir), '.git'));
    const skipped = await migrateUserSkillsOutOfBundle({ bundledDir, userDir, logger: quiet, env: {} });
    expect(skipped).toMatchObject({ migrated: [], skippedReason: 'git-checkout' });
    expect(await exists(path.join(bundledDir, 'mine', 'notes.md'))).toBe(true);
    expect(await exists(path.join(userDir, 'mine'))).toBe(false);

    // A worktree has a .git file instead of a folder.
    await rm(path.join(path.dirname(bundledDir), '.git'), { recursive: true });
    await writeFile(path.join(path.dirname(bundledDir), '.git'), 'gitdir: /elsewhere\n');
    expect((await migrateUserSkillsOutOfBundle({ bundledDir, userDir, logger: quiet, env: {} })).skippedReason).toBe('git-checkout');

    const forced = await migrateUserSkillsOutOfBundle({
      bundledDir, userDir, logger: quiet, env: { DR_CLAW_MIGRATE_BUNDLED_SKILLS: '1' },
    });
    expect(forced.migrated).toEqual(['mine']);
    expect(forced.skippedReason).toBeUndefined();
    expect(await exists(path.join(bundledDir, 'mine'))).toBe(false);
    expect(await exists(path.join(userDir, 'mine', 'notes.md'))).toBe(true);
  });

  it('does nothing without a release manifest', async () => {
    await rm(path.join(bundledDir, 'bundled-skills.json'));
    const result = await migrateUserSkillsOutOfBundle({ bundledDir, userDir, logger: quiet });
    expect(result.migrated).toEqual([]);
    expect(await exists(path.join(bundledDir, 'mine'))).toBe(true);
  });
});

describe('skill roots', () => {
  it('lists both roots, user skills first and winning on a name clash', async () => {
    await migrateUserSkillsOutOfBundle({ bundledDir, userDir, logger: quiet });
    await makeSkill(path.join(userDir, 'shipped-a'), 'my edited copy');
    const skills = await collectAllSkillDirs({ bundledDir, userDir });
    const byName = Object.fromEntries(skills.map((skill) => [skill.name, skill]));

    expect(byName.mine).toMatchObject({ source: 'user', dirPath: 'mine', absolutePath: path.join(userDir, 'mine') });
    expect(byName['shipped-a']).toMatchObject({ source: 'user', absolutePath: path.join(userDir, 'shipped-a') });
    expect(byName['shipped-b']).toMatchObject({ source: 'bundled', dirPath: 'category/shipped-b' });
    expect(skills.filter((skill) => skill.name === 'shipped-a')).toHaveLength(1);
  });

  it('labels an unmigrated user skill in the bundled dir as a user skill', async () => {
    const skills = await collectAllSkillDirs({ bundledDir, userDir });
    expect(skills.find((skill) => skill.name === 'mine')).toMatchObject({ source: 'user', root: bundledDir });
  });

  it('protects shipped skills, their files, categories and release files', () => {
    const opts = { bundledDir };
    expect(isProtectedBundledPath(path.join(bundledDir, 'shipped-a'), opts)).toBe(true);
    expect(isProtectedBundledPath(path.join(bundledDir, 'shipped-a', 'SKILL.md'), opts)).toBe(true);
    expect(isProtectedBundledPath(path.join(bundledDir, 'category'), opts)).toBe(true);
    expect(isProtectedBundledPath(path.join(bundledDir, 'category', 'shipped-b', 'x.md'), opts)).toBe(true);
    expect(isProtectedBundledPath(path.join(bundledDir, 'skill-tag-mapping.json'), opts)).toBe(true);
    expect(isProtectedBundledPath(bundledDir, opts)).toBe(true);
    expect(isProtectedBundledPath(path.join(bundledDir, 'mine'), opts)).toBe(false);
    expect(isProtectedBundledPath(path.join(userDir, 'mine'), opts)).toBe(false);
  });

  it('resolves API paths to the user dir only for user skills, and rejects escapes', async () => {
    await migrateUserSkillsOutOfBundle({ bundledDir, userDir, logger: quiet });
    const roots = { bundledDir, userDir };
    expect(resolveSkillsApiPath('mine/SKILL.md', roots)).toMatchObject({ rootKind: 'user', absolutePath: path.join(userDir, 'mine', 'SKILL.md') });
    expect(resolveSkillsApiPath('category/shipped-b/SKILL.md', roots)).toMatchObject({ rootKind: 'bundled' });
    expect(resolveSkillsApiPath('../outside', roots)).toBeNull();
    expect(resolveSkillsApiPath('mine/../../x', roots)).toBeNull();
    expect(resolveSkillsApiPath('/etc/passwd', roots)).toBeNull();
  });

  it('auto-allows reads in both libraries', async () => {
    await migrateUserSkillsOutOfBundle({ bundledDir, userDir, logger: quiet });
    const skillsDirs = [bundledDir, userDir];
    expect(isBundledSkillRead('Read', { file_path: path.join(userDir, 'mine', 'notes.md') }, { skillsDirs })).toBe(true);
    expect(isBundledSkillRead('Read', { file_path: path.join(bundledDir, 'shipped-a', 'SKILL.md') }, { skillsDirs })).toBe(true);
    expect(isBundledSkillRead('Write', { file_path: path.join(userDir, 'mine', 'notes.md') }, { skillsDirs })).toBe(false);
    expect(isBundledSkillRead('Read', { file_path: path.join(tempRoot, 'app', 'x') }, { skillsDirs })).toBe(false);
  });

  it('points /name at an unlinked user skill', async () => {
    await migrateUserSkillsOutOfBundle({ bundledDir, userDir, logger: quiet });
    const projectPath = path.join(tempRoot, 'proj');
    await mkdir(projectPath, { recursive: true });
    const out = await rewriteUnlinkedSkillCommand('/mine go', projectPath, { skillsDirs: [userDir, bundledDir] });
    expect(out).toContain(path.join(userDir, 'mine', 'SKILL.md'));
  });

  it('turns user skills on under the recommended baseline', () => {
    const states = resolveSkillStates({
      skillNames: ['shipped-a', 'mine'],
      manifest: { coreNames: new Set(), recommendedNames: new Set() },
      globalPrefs: { baseline: 'recommended', knownSkills: ['shipped-a'] },
      userSkillNames: ['mine'],
    });
    expect(states).toEqual([
      expect.objectContaining({ name: 'shipped-a', enabled: false, userSkill: false }),
      expect.objectContaining({ name: 'mine', enabled: true, userSkill: true, isNew: false }),
    ]);
  });
});

describe('syncProjectSkillLinks with two roots', () => {
  it('links from both roots and only removes links into them', async () => {
    await migrateUserSkillsOutOfBundle({ bundledDir, userDir, logger: quiet });
    await makeSkill(path.join(userDir, 'mine-off'));
    const projectPath = path.join(tempRoot, 'proj');
    const claudeSkills = path.join(projectPath, '.claude', 'skills');
    await mkdir(claudeSkills, { recursive: true });

    // Links left from before the migration and from other tools.
    const elsewhere = path.join(tempRoot, 'elsewhere', 'their-skill');
    await makeSkill(elsewhere);
    await symlink(elsewhere, path.join(claudeSkills, 'their-skill'), 'dir');
    await symlink(path.join(bundledDir, 'mine'), path.join(claudeSkills, 'mine'), 'dir'); // now dangling
    await symlink(path.join(userDir, 'gone'), path.join(claudeSkills, 'gone'), 'dir'); // dangling into the user dir

    const skillDirs = await collectAllSkillDirs({ bundledDir, userDir });
    const sync = (enabledNames) => syncProjectSkillLinks({
      projectPath,
      skillsRoot: bundledDir,
      skillsRoots: [userDir],
      skillDirs,
      enabledNames: new Set(enabledNames),
      coreNames: new Set(['shipped-a']),
      folders: ['.claude', '.agents'],
    });

    await sync(['shipped-a', 'shipped-b', 'mine', 'mine-off']);
    expect(await readlink(path.join(claudeSkills, 'mine'))).toBe(path.join(userDir, 'mine'));
    expect(await readlink(path.join(claudeSkills, 'mine-off'))).toBe(path.join(userDir, 'mine-off'));
    expect(await readlink(path.join(claudeSkills, 'shipped-b'))).toBe(path.join(bundledDir, 'category', 'shipped-b'));
    expect(await readlink(path.join(projectPath, '.agents', 'skills', 'library', 'mine'))).toBe(path.join(userDir, 'mine'));
    expect(await exists(path.join(claudeSkills, 'gone'))).toBe(false);
    expect(await readlink(path.join(claudeSkills, 'their-skill'))).toBe(elsewhere);

    await sync(['shipped-a', 'mine']);
    expect(await exists(path.join(claudeSkills, 'mine-off'))).toBe(false);
    expect(await exists(path.join(claudeSkills, 'shipped-b'))).toBe(false);
    expect(await readlink(path.join(claudeSkills, 'their-skill'))).toBe(elsewhere);

    const index = await readFile(path.join(projectPath, '.agents', 'skills', 'skills-index.md'), 'utf8');
    expect(index).toContain(path.join(userDir, 'mine-off', 'SKILL.md'));
  });
});

describe('bundled-skills.json', () => {
  it('lists exactly the skills tracked under skills/', async () => {
    let tracked;
    try {
      tracked = listTrackedSkillDirs(repoRoot);
    } catch {
      return; // not a git checkout
    }
    const manifest = JSON.parse(await readFile(path.join(repoRoot, 'skills', 'bundled-skills.json'), 'utf8'));
    expect(manifest.skills).toEqual(tracked);
  });
});

describe('skills routes with a user skills dir', () => {
  const originalHome = process.env.HOME;
  const originalDatabasePath = process.env.DATABASE_PATH;
  let server;
  let baseUrl;
  let projectsModule;

  beforeEach(async () => {
    process.env.HOME = path.join(tempRoot, 'home');
    process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');
    vi.resetModules();
    vi.doMock('../utils/skillRoots.js', async (importOriginal) => ({
      ...(await importOriginal()),
      BUNDLED_SKILLS_DIR: bundledDir,
    }));
    const database = await import('../database/db.js');
    await database.initializeDatabase();
    database.userDb.createUser('alice', 'x');
    projectsModule = await import('../projects.js');
    const { default: skillsRoutes } = await import('../routes/skills.js');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
    app.use('/api/skills', skillsRoutes);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api/skills`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    vi.doUnmock('../utils/skillRoots.js');
    process.env.HOME = originalHome;
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
  });

  async function call(method, url, body) {
    const res = await fetch(`${baseUrl}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  }

  it('refuses to delete or edit built-in skills', async () => {
    const del = await call('DELETE', '/global-skill', { dirPath: 'shipped-a' });
    expect(del.status).toBe(403);
    expect((await call('DELETE', '/global-skill', { dirPath: 'category' })).status).toBe(403);
    expect((await call('DELETE', '/global-skill', { dirPath: '../app' })).status).toBe(403);
    const put = await call('PUT', '/file', { filePath: 'shipped-a/SKILL.md', content: 'x' });
    expect(put.status).toBe(403);
    expect((await call('PUT', '/file', { filePath: 'skill-tag-mapping.json', content: '{}' })).status).toBe(403);
    expect(await readFile(path.join(bundledDir, 'shipped-a', 'SKILL.md'), 'utf8')).toContain('name: shipped-a');
  });

  it('imports into the user dir, lists sources, edits, and deletes user skills', async () => {
    // The import route refuses system paths such as /tmp (os.tmpdir() on Linux),
    // so the source folder lives under node_modules/.cache instead.
    const cacheDir = path.join(process.cwd(), 'node_modules', '.cache');
    await mkdir(cacheDir, { recursive: true });
    const source = await mkdtemp(path.join(cacheDir, 'skills-import-'));
    onTestFinished(() => rm(source, { recursive: true, force: true }));
    await makeSkill(path.join(source, 'imported-one'));
    await makeSkill(path.join(source, 'shipped-a'));

    const imported = await call('POST', '/import-from-local', { sourcePath: source });
    expect(imported.body).toMatchObject({ imported: ['imported-one'], skipped: ['shipped-a'], errors: [] });
    expect(await exists(path.join(userDir, 'imported-one', 'SKILL.md'))).toBe(true);
    expect(await exists(path.join(bundledDir, 'imported-one'))).toBe(false);

    const tree = (await call('GET', '/')).body;
    const nodes = [];
    const walk = (list) => list.forEach((node) => { if (node.source) nodes.push(node); if (node.children) walk(node.children); });
    walk(tree);
    const sourceOf = Object.fromEntries(nodes.map((node) => [node.dirPath, node.source]));
    expect(sourceOf).toMatchObject({ 'imported-one': 'user', 'shipped-a': 'bundled', 'category/shipped-b': 'bundled', mine: 'user' });

    const origins = JSON.parse((await call('GET', '/file?filePath=stage-skill-map.json')).body.content).skillOrigins;
    expect(origins).toMatchObject({ 'imported-one': 'local-import', 'shipped-imported': 'imported' });

    expect((await call('PUT', '/file', { filePath: 'imported-one/SKILL.md', content: 'edited' })).status).toBe(200);
    expect(await readFile(path.join(userDir, 'imported-one', 'SKILL.md'), 'utf8')).toBe('edited');
    expect((await call('GET', '/file?filePath=imported-one/SKILL.md')).body).toMatchObject({ content: 'edited', source: 'user' });

    // A user skill still left in the bundled dir can be deleted too.
    expect((await call('DELETE', '/global-skill', { dirPath: 'mine' })).status).toBe(200);
    expect(await exists(path.join(bundledDir, 'mine'))).toBe(false);

    expect((await call('DELETE', '/global-skill', { dirPath: 'imported-one' })).status).toBe(200);
    expect(await exists(path.join(userDir, 'imported-one'))).toBe(false);
    const after = JSON.parse((await call('GET', '/file?filePath=stage-skill-map.json')).body.content).skillOrigins;
    expect(after['imported-one']).toBeUndefined();
  });

  it('copies a built-in skill to the user dir, where it replaces the built-in one', async () => {
    const copied = await call('POST', '/copy-to-user', { dirPath: 'category/shipped-b' });
    expect(copied.status).toBe(200);
    expect(copied.body.dirPath).toBe('shipped-b');
    expect(await exists(path.join(userDir, 'shipped-b', 'SKILL.md'))).toBe(true);
    expect((await call('POST', '/copy-to-user', { dirPath: 'category/shipped-b' })).status).toBe(409);
    expect((await call('POST', '/copy-to-user', { dirPath: 'mine' })).status).toBe(404);

    const tree = (await call('GET', '/')).body;
    const category = tree.find((node) => node.name === 'category');
    expect(category.children.some((node) => node.name === 'shipped-b')).toBe(false);
    expect(tree.find((node) => node.name === 'shipped-b')).toMatchObject({ source: 'user', dirPath: 'shipped-b' });

    // Deleting the copy brings the built-in skill back.
    expect((await call('DELETE', '/global-skill', { dirPath: 'shipped-b' })).status).toBe(200);
    expect(await exists(path.join(bundledDir, 'category', 'shipped-b', 'SKILL.md'))).toBe(true);
  });

  it('links user skills into projects', async () => {
    await migrateUserSkillsOutOfBundle({ bundledDir, userDir, logger: quiet });
    const projectPath = path.join(tempRoot, 'proj');
    await mkdir(projectPath, { recursive: true });
    await projectsModule.ensureProjectSkillLinks(projectPath);
    const link = path.join(projectPath, '.claude', 'skills', 'mine');
    expect(await readlink(link)).toBe(path.join(userDir, 'mine'));
    await access(path.join(link, 'notes.md'));
    expect(await readlink(path.join(projectPath, '.claude', 'skills', 'shipped-a'))).toBe(path.join(bundledDir, 'shipped-a'));
  });

  it('removing a skill from a project keeps the built-in skill and its metadata', async () => {
    const projectPath = path.join(tempRoot, 'proj2');
    await mkdir(projectPath, { recursive: true });
    const project = await projectsModule.addProjectManually(projectPath, 'Proj2', 1);
    const tagsBefore = await readFile(path.join(bundledDir, 'skill-tag-mapping.json'), 'utf8');
    const stageBefore = await readFile(path.join(bundledDir, 'stage-skill-map.json'), 'utf8');

    const res = await call('DELETE', `/${encodeURIComponent(project.name)}/shipped-a`);
    expect(res.status).toBe(200);
    expect(await exists(path.join(projectPath, '.claude', 'skills', 'shipped-a'))).toBe(false);
    expect(await exists(path.join(bundledDir, 'shipped-a', 'SKILL.md'))).toBe(true);
    expect(await readFile(path.join(bundledDir, 'skill-tag-mapping.json'), 'utf8')).toBe(tagsBefore);
    expect(await readFile(path.join(bundledDir, 'stage-skill-map.json'), 'utf8')).toBe(stageBefore);
  });
});
