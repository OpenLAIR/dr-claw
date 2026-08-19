import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let tempRoot;
let projectRoot;

describe('project skill-link routing', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'drclaw-project-skills-'));
    projectRoot = path.join(tempRoot, 'project');
    await mkdir(projectRoot, { recursive: true });
    process.env.HOME = path.join(tempRoot, 'home');
    process.env.USERPROFILE = process.env.HOME;
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
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('keeps only core skills native and safely migrates the legacy library', async () => {
    const accelerateSource = path.join(repositoryRoot, 'skills', 'distributed-training', 'accelerate');
    const agentsSkills = path.join(projectRoot, '.agents', 'skills');
    const legacyLibrary = path.join(agentsSkills, 'library');
    const customSkill = path.join(tempRoot, 'custom-skill');
    await mkdir(legacyLibrary, { recursive: true });
    await mkdir(customSkill, { recursive: true });
    await writeFile(path.join(customSkill, 'SKILL.md'), 'custom skill\n', 'utf8');
    await symlink(accelerateSource, path.join(agentsSkills, 'accelerate'), 'dir');
    await symlink(accelerateSource, path.join(legacyLibrary, 'stale-generated-link'), 'dir');
    await symlink(customSkill, path.join(legacyLibrary, 'user-owned-link'), 'dir');
    await mkdir(path.join(legacyLibrary, 'user-owned'), { recursive: true });
    await writeFile(path.join(legacyLibrary, 'user-owned', 'note.txt'), 'preserve me\n', 'utf8');
    await writeFile(
      path.join(projectRoot, 'AGENTS.md'),
      '# Custom project guidance\n\nUse `.agents/skills/library/<name>/SKILL.md`.\n\n'
        + '- **SANDBOX**: All file reads MUST stay inside this project directory. Never access files outside it.\n',
      'utf8',
    );

    vi.resetModules();
    const { ensureProjectSkillLinks } = await import('../projects.js');
    await ensureProjectSkillLinks(projectRoot);

    expect((await lstat(path.join(agentsSkills, 'dataset-discovery'))).isSymbolicLink()).toBe(true);
    await expect(access(path.join(agentsSkills, 'accelerate'))).rejects.toMatchObject({ code: 'ENOENT' });

    const routedLibraryLink = path.join(projectRoot, '.drclaw', 'skill-library', 'accelerate');
    expect((await lstat(routedLibraryLink)).isSymbolicLink()).toBe(true);
    expect(path.resolve(path.dirname(routedLibraryLink), await readlink(routedLibraryLink))).toBe(accelerateSource);

    await expect(access(path.join(legacyLibrary, 'stale-generated-link'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await lstat(path.join(legacyLibrary, 'user-owned-link'))).isSymbolicLink()).toBe(true);
    await expect(readFile(path.join(legacyLibrary, 'user-owned', 'note.txt'), 'utf8')).resolves.toBe('preserve me\n');

    const index = await readFile(path.join(agentsSkills, 'skills-index.md'), 'utf8');
    expect(index).toContain('huggingface-accelerate');
    expect(index).toContain('`.drclaw/skill-library/accelerate/SKILL.md`');
    expect(index).not.toContain('`.agents/skills/library/accelerate/SKILL.md`');

    const agentsGuidance = await readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8');
    expect(agentsGuidance).toContain('# Custom project guidance');
    expect(agentsGuidance).toContain('<!-- DRCLAW:SKILL-ROUTING:START -->');
    expect(agentsGuidance).toContain('`.drclaw/skill-library/`');
    expect(agentsGuidance).toContain('approved **read-only** symlink exceptions');
    expect(agentsGuidance.match(/DRCLAW:SKILL-ROUTING:START/g)).toHaveLength(1);
  });

  it('does not write through a .drclaw ancestor symlink or remove rollback links', async () => {
    const accelerateSource = path.join(repositoryRoot, 'skills', 'distributed-training', 'accelerate');
    const agentsSkills = path.join(projectRoot, '.agents', 'skills');
    const legacyLibrary = path.join(agentsSkills, 'library');
    const outsideDirectory = path.join(tempRoot, 'outside');
    await mkdir(legacyLibrary, { recursive: true });
    await mkdir(outsideDirectory, { recursive: true });
    await symlink(accelerateSource, path.join(legacyLibrary, 'accelerate'), 'dir');
    await symlink(outsideDirectory, path.join(projectRoot, '.drclaw'), 'dir');

    vi.resetModules();
    const { ensureProjectSkillLinks } = await import('../projects.js');
    await ensureProjectSkillLinks(projectRoot);

    expect((await lstat(path.join(legacyLibrary, 'accelerate'))).isSymbolicLink()).toBe(true);
    await expect(readdir(outsideDirectory)).resolves.toEqual([]);
    const index = await readFile(path.join(agentsSkills, 'skills-index.md'), 'utf8');
    expect(index).toContain('`.agents/skills/library/accelerate/SKILL.md`');
    expect(index).not.toContain('`.drclaw/skill-library/accelerate/SKILL.md`');
  });
});
