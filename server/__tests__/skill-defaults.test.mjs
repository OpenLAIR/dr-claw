import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  applyOverrideChanges,
  loadGlobalSkillPrefs,
  normalizeGlobalPrefs,
  readSkillManifest,
  resolveSkillStates,
} from '../utils/skillDefaults.js';
import { collectSkillDirs, syncProjectSkillLinks } from '../utils/skillLinks.js';
import { rewriteUnlinkedSkillCommand } from '../utils/skillExpander.js';

const manifest = {
  coreNames: new Set(['core-a']),
  recommendedNames: new Set(['rec-b']),
};
const names = ['core-a', 'rec-b', 'other-c', 'brand-new'];

function stateOf(states, name) {
  return states.find((state) => state.name === name);
}

describe('resolveSkillStates', () => {
  it('recommended baseline enables core and recommended skills only', () => {
    const states = resolveSkillStates({
      skillNames: names,
      manifest,
      globalPrefs: { baseline: 'recommended', overrides: {}, knownSkills: names },
    });
    expect(states.filter((s) => s.enabled).map((s) => s.name)).toEqual(['core-a', 'rec-b']);
    expect(states.every((s) => s.source === 'baseline')).toBe(true);
  });

  it('all and none baselines', () => {
    const all = resolveSkillStates({ skillNames: names, manifest, globalPrefs: { baseline: 'all' } });
    const none = resolveSkillStates({ skillNames: names, manifest, globalPrefs: { baseline: 'none' } });
    expect(all.every((s) => s.enabled)).toBe(true);
    expect(none.some((s) => s.enabled)).toBe(false);
  });

  it('project override beats global override beats baseline', () => {
    const states = resolveSkillStates({
      skillNames: names,
      manifest,
      globalPrefs: { baseline: 'recommended', overrides: { 'other-c': true, 'core-a': false } },
      projectOverrides: { 'core-a': true, 'rec-b': false },
    });
    expect(stateOf(states, 'core-a')).toMatchObject({ enabled: true, source: 'project', globalEnabled: false });
    expect(stateOf(states, 'rec-b')).toMatchObject({ enabled: false, source: 'project', globalEnabled: true });
    expect(stateOf(states, 'other-c')).toMatchObject({ enabled: true, source: 'global', globalEnabled: true });
    expect(stateOf(states, 'brand-new')).toMatchObject({ enabled: false, source: 'baseline' });
  });

  it('flags skills missing from knownSkills as new, and follows the baseline for them', () => {
    const known = ['core-a', 'rec-b', 'other-c'];
    const recommended = resolveSkillStates({ skillNames: names, manifest, globalPrefs: { baseline: 'recommended', knownSkills: known } });
    const all = resolveSkillStates({ skillNames: names, manifest, globalPrefs: { baseline: 'all', knownSkills: known } });
    expect(stateOf(recommended, 'brand-new')).toMatchObject({ isNew: true, enabled: false });
    expect(stateOf(all, 'brand-new')).toMatchObject({ isNew: true, enabled: true });
    expect(stateOf(all, 'core-a').isNew).toBe(false);
  });

  it('flags nothing as new before knownSkills is recorded', () => {
    const states = resolveSkillStates({ skillNames: names, manifest, globalPrefs: { baseline: 'all' } });
    expect(states.some((s) => s.isNew)).toBe(false);
  });
});

describe('override helpers', () => {
  it('normalizes bad input', () => {
    expect(normalizeGlobalPrefs({ baseline: 'bogus', overrides: { ok: true, bad: 'yes', '../x': false } })).toEqual({
      baseline: 'recommended',
      overrides: { ok: true },
      knownSkills: [],
    });
  });

  it('applies true/false/null changes and drops unknown names', () => {
    const next = applyOverrideChanges(
      { a: true, b: false },
      { a: null, b: true, c: false, ghost: true, '../evil': true },
      new Set(['a', 'b', 'c']),
    );
    expect(next).toEqual({ b: true, c: false });
  });

  it('reads recommendedSkills and core skills from the bundled manifest', () => {
    const real = readSkillManifest(path.resolve(__dirname, '..', '..', 'skills'));
    expect(real.coreNames.has('inno-pipeline-planner')).toBe(true);
    expect(real.coreNames.has('inno-idea-generation')).toBe(true);
    expect(real.recommendedNames.size).toBeGreaterThan(0);
  });
});

describe('loadGlobalSkillPrefs first run', () => {
  function fakeDb(projectCount) {
    const store = new Map();
    return {
      store,
      appSettingsDb: {
        get: (key) => store.get(key) ?? null,
        set: (key, value) => { store.set(key, value); return value; },
      },
      projectDb: { getAllProjects: () => Array.from({ length: projectCount }, (_, i) => ({ id: `p${i}` })) },
    };
  }

  it('keeps every skill on for installs that already have projects', async () => {
    const db = fakeDb(2);
    const prefs = await loadGlobalSkillPrefs({ skillNames: ['a', 'b'], db });
    expect(prefs).toEqual({ baseline: 'all', overrides: {}, knownSkills: ['a', 'b'] });
    expect(JSON.parse(db.store.get('skills.defaults')).baseline).toBe('all');
  });

  it('uses the recommended set on a fresh install', async () => {
    const prefs = await loadGlobalSkillPrefs({ skillNames: ['a'], db: fakeDb(0) });
    expect(prefs.baseline).toBe('recommended');
  });

  it('does not re-run the first-run choice once saved', async () => {
    const db = fakeDb(0);
    await loadGlobalSkillPrefs({ skillNames: ['a'], db });
    db.projectDb.getAllProjects = () => [{ id: 'later' }];
    const prefs = await loadGlobalSkillPrefs({ skillNames: ['a', 'b'], db });
    expect(prefs.baseline).toBe('recommended');
    expect(prefs.knownSkills).toEqual(['a']);
  });
});

describe('syncProjectSkillLinks', () => {
  let tempRoot;
  let skillsRoot;
  let projectPath;
  let skillDirs;

  async function makeSkill(rel, description = 'does things') {
    const dir = path.join(skillsRoot, rel);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${path.basename(rel)}\ndescription: ${description}\n---\nbody\n`);
  }

  async function isLink(target) {
    try {
      return (await lstat(target)).isSymbolicLink();
    } catch {
      return false;
    }
  }

  async function sync(enabled) {
    await syncProjectSkillLinks({
      projectPath,
      skillsRoot,
      skillDirs,
      enabledNames: new Set(enabled),
      coreNames: new Set(['core-a']),
      folders: ['.claude', '.agents'],
    });
  }

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'skill-links-'));
    skillsRoot = path.join(tempRoot, 'skills');
    projectPath = path.join(tempRoot, 'project');
    await mkdir(projectPath, { recursive: true });
    await makeSkill('core-a');
    await makeSkill('lib-b');
    await makeSkill('category/nested-c');
    skillDirs = await collectSkillDirs(skillsRoot);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('links enabled skills and lists disabled ones as on-request', async () => {
    await sync(['core-a', 'nested-c']);

    expect(await readlink(path.join(projectPath, '.claude/skills/core-a'))).toBe(path.join(skillsRoot, 'core-a'));
    expect(await isLink(path.join(projectPath, '.claude/skills/nested-c'))).toBe(true);
    expect(await isLink(path.join(projectPath, '.claude/skills/lib-b'))).toBe(false);
    expect(await isLink(path.join(projectPath, '.agents/skills/core-a'))).toBe(true);
    expect(await isLink(path.join(projectPath, '.agents/skills/library/nested-c'))).toBe(true);

    const index = await readFile(path.join(projectPath, '.agents/skills/skills-index.md'), 'utf8');
    expect(index).toContain('`.agents/skills/core-a/SKILL.md`');
    expect(index).toContain('`.agents/skills/library/nested-c/SKILL.md`');
    expect(index).toContain('## On-request Skills');
    expect(index).toContain(`\`${path.join(skillsRoot, 'lib-b', 'SKILL.md')}\``);
  });

  it('unlinks skills that are turned off and relinks them when turned back on', async () => {
    await sync(['core-a', 'lib-b', 'nested-c']);
    expect(await isLink(path.join(projectPath, '.agents/skills/library/lib-b'))).toBe(true);

    await sync(['core-a']);
    expect(await isLink(path.join(projectPath, '.claude/skills/lib-b'))).toBe(false);
    expect(await isLink(path.join(projectPath, '.agents/skills/library/lib-b'))).toBe(false);

    await sync(['core-a', 'lib-b']);
    expect(await isLink(path.join(projectPath, '.claude/skills/lib-b'))).toBe(true);
  });

  it('never removes the user’s own skill folders or links to elsewhere', async () => {
    const own = path.join(projectPath, '.claude/skills/lib-b');
    await mkdir(own, { recursive: true });
    await writeFile(path.join(own, 'SKILL.md'), 'mine');
    const elsewhere = path.join(tempRoot, 'elsewhere', 'nested-c');
    await mkdir(elsewhere, { recursive: true });
    await symlink(elsewhere, path.join(projectPath, '.claude/skills/nested-c'), 'dir');

    await sync(['core-a']);

    expect(await readFile(path.join(own, 'SKILL.md'), 'utf8')).toBe('mine');
    expect(await readlink(path.join(projectPath, '.claude/skills/nested-c'))).toBe(elsewhere);
  });

  it('removes dangling links into the library left by deleted skills', async () => {
    await sync(['core-a', 'lib-b', 'nested-c']);
    await rm(path.join(skillsRoot, 'lib-b'), { recursive: true });
    skillDirs = await collectSkillDirs(skillsRoot);

    await sync(['core-a', 'nested-c']);

    expect(await isLink(path.join(projectPath, '.claude/skills/lib-b'))).toBe(false);
    expect(await isLink(path.join(projectPath, '.agents/skills/library/lib-b'))).toBe(false);
  });
});

describe('rewriteUnlinkedSkillCommand', () => {
  let tempRoot;
  let skillsRoot;
  let projectPath;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'skill-cmd-'));
    process.env.HOME = tempRoot;
    skillsRoot = path.join(tempRoot, 'skills');
    projectPath = path.join(tempRoot, 'project');
    await mkdir(path.join(skillsRoot, 'cat', 'off-skill'), { recursive: true });
    await writeFile(path.join(skillsRoot, 'cat', 'off-skill', 'SKILL.md'), '---\nname: off-skill\n---\n');
    await mkdir(path.join(skillsRoot, 'on-skill'), { recursive: true });
    await writeFile(path.join(skillsRoot, 'on-skill', 'SKILL.md'), '---\nname: on-skill\n---\n');
    await mkdir(path.join(projectPath, '.claude', 'skills'), { recursive: true });
    await symlink(path.join(skillsRoot, 'on-skill'), path.join(projectPath, '.claude', 'skills', 'on-skill'), 'dir');
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('points Claude at the SKILL.md of a skill that is not linked', async () => {
    const out = await rewriteUnlinkedSkillCommand('/off-skill:fast compare these', projectPath, { skillsDir: skillsRoot });
    expect(out).toContain(path.join(skillsRoot, 'cat', 'off-skill', 'SKILL.md'));
    expect(out).toContain('Variant requested: `fast`');
    expect(out).toContain('compare these');
  });

  it('keeps the context prefix', async () => {
    const out = await rewriteUnlinkedSkillCommand('[Context: x] /off-skill', projectPath, { skillsDir: skillsRoot });
    expect(out.startsWith('[Context: x] Use the `off-skill` skill')).toBe(true);
  });

  it('leaves linked skills, unknown commands and plain text alone', async () => {
    for (const command of ['/on-skill go', '/compact', 'hello /off-skill', '']) {
      expect(await rewriteUnlinkedSkillCommand(command, projectPath, { skillsDir: skillsRoot })).toBe(command);
    }
  });
});

describe('skill defaults routes', () => {
  const originalHome = process.env.HOME;
  const originalDatabasePath = process.env.DATABASE_PATH;
  let tempRoot;
  let server;
  let baseUrl;
  let database;
  let currentUser;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'skill-routes-'));
    process.env.HOME = tempRoot;
    process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');
    vi.resetModules();
    database = await import('../database/db.js');
    await database.initializeDatabase();
    database.userDb.createUser('alice', 'x');
    database.userDb.createUser('bob', 'x');
    const { default: skillsRoutes } = await import('../routes/skills.js');
    currentUser = { id: 1 };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = currentUser; next(); });
    app.use('/api/skills', skillsRoutes);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api/skills`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    process.env.HOME = originalHome;
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function call(method, url, body) {
    const res = await fetch(`${baseUrl}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  }

  it('starts a fresh install on the recommended set and saves global changes', async () => {
    const first = await call('GET', '/defaults');
    expect(first.status).toBe(200);
    expect(first.body.baseline).toBe('recommended');
    const planner = first.body.skills.find((s) => s.name === 'inno-pipeline-planner');
    expect(planner).toMatchObject({ enabled: true, core: true });
    const offByDefault = first.body.skills.find((s) => !s.enabled);
    expect(offByDefault).toBeTruthy();

    const updated = await call('PUT', '/defaults', { overrides: { [offByDefault.name]: true, 'no-such-skill': true } });
    expect(updated.status).toBe(200);
    expect(updated.body.globalOverrides).toEqual({ [offByDefault.name]: true });
    expect(updated.body.skills.find((s) => s.name === offByDefault.name)).toMatchObject({ enabled: true, source: 'global' });

    const preset = await call('PUT', '/defaults', { baseline: 'all', resetOverrides: true });
    expect(preset.body.baseline).toBe('all');
    expect(preset.body.globalOverrides).toEqual({});
    expect(preset.body.skills.every((s) => s.enabled && s.source === 'baseline')).toBe(true);

    const bulk = await call('PUT', '/defaults', { overrides: { [offByDefault.name]: false, 'inno-pipeline-planner': false } });
    expect(Object.keys(bulk.body.globalOverrides).sort()).toEqual([offByDefault.name, 'inno-pipeline-planner'].sort());

    const bad = await call('PUT', '/defaults', { baseline: 'everything' });
    expect(bad.status).toBe(400);
  });

  it('stores project overrides, relinks the project, and resets them', async () => {
    const projectPath = path.join(tempRoot, 'proj');
    await mkdir(projectPath, { recursive: true });
    database.projectDb.upsertProject('proj', 1, 'Proj', projectPath, 0, null, { keep: 'me' });

    // An install that already has projects keeps every skill on.
    const before = await call('GET', '/defaults?projectName=proj');
    expect(before.body.baseline).toBe('all');
    expect(before.body.skills.every((s) => s.enabled)).toBe(true);

    const narrowed = await call('PUT', '/defaults', { baseline: 'recommended' });
    const target = narrowed.body.skills.find((s) => !s.enabled);

    const on = await call('PUT', '/project/proj/overrides', { overrides: { [target.name]: true } });
    expect(on.status).toBe(200);
    expect(on.body.project.overrides).toEqual({ [target.name]: true });
    expect(on.body.skills.find((s) => s.name === target.name)).toMatchObject({ enabled: true, source: 'project', globalEnabled: false });
    expect((await lstat(path.join(projectPath, '.claude', 'skills', target.name))).isSymbolicLink()).toBe(true);
    expect(database.projectDb.getProjectById('proj').metadata).toMatchObject({ keep: 'me', skills: { overrides: { [target.name]: true } } });

    const reset = await call('PUT', '/project/proj/overrides', { reset: true });
    expect(reset.body.project.overrides).toEqual({});
    expect(database.projectDb.getProjectById('proj').metadata).toEqual({ keep: 'me' });
    await expect(lstat(path.join(projectPath, '.claude', 'skills', target.name))).rejects.toThrow();
  });

  it('hides other users’ projects', async () => {
    database.projectDb.upsertProject('theirs', 2, 'Theirs', path.join(tempRoot, 'theirs'));
    expect((await call('GET', '/defaults?projectName=theirs')).status).toBe(404);
    expect((await call('PUT', '/project/theirs/overrides', { overrides: {} })).status).toBe(404);
  });
});
