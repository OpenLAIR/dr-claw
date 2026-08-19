import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { expandSkillCommand, findSkillMdPath } from '../skillExpander.js';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

let tempRoot;
let projectRoot;
let userHome;

async function writeSkill(root, directoryAlias, canonicalName, body = 'Follow this procedure.') {
  const skillDir = path.join(root, directoryAlias);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${canonicalName}\ndescription: Test skill\n---\n\n${body}\n`,
    'utf8',
  );
  return path.join(skillDir, 'SKILL.md');
}

describe('skillExpander library routing', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'drclaw-skill-expander-'));
    projectRoot = path.join(tempRoot, 'project');
    userHome = path.join(tempRoot, 'home');
    await mkdir(projectRoot, { recursive: true });
    await mkdir(userHome, { recursive: true });
    process.env.HOME = userHome;
    process.env.USERPROFILE = userHome;
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('resolves both a directory alias and canonical frontmatter name in .drclaw', async () => {
    const expected = await writeSkill(
      path.join(projectRoot, '.drclaw', 'skill-library'),
      'accelerate',
      'huggingface-accelerate',
    );

    await expect(findSkillMdPath('accelerate', projectRoot)).resolves.toBe(expected);
    await expect(findSkillMdPath('huggingface-accelerate', projectRoot)).resolves.toBe(expected);
  });

  it('keeps the legacy .agents/skills/library location readable', async () => {
    const expected = await writeSkill(
      path.join(projectRoot, '.agents', 'skills', 'library'),
      'legacy-alias',
      'legacy-canonical',
    );

    await expect(findSkillMdPath('legacy-canonical', projectRoot)).resolves.toBe(expected);
  });

  it('keeps provider-specific Cursor project skills readable', async () => {
    const expected = await writeSkill(
      path.join(projectRoot, '.cursor', 'skills'),
      'cursor-alias',
      'cursor-canonical',
    );

    await expect(findSkillMdPath('cursor-canonical', projectRoot)).resolves.toBe(expected);
  });

  it('prefers the new routed library over a duplicate legacy entry', async () => {
    const expected = await writeSkill(
      path.join(projectRoot, '.drclaw', 'skill-library'),
      'preferred-alias',
      'duplicate-canonical',
      'new library copy',
    );
    await writeSkill(
      path.join(projectRoot, '.agents', 'skills', 'library'),
      'legacy-alias',
      'duplicate-canonical',
      'legacy copy',
    );

    await expect(findSkillMdPath('duplicate-canonical', projectRoot)).resolves.toBe(expected);
  });

  it('falls back to user-level ~/.agents/skills', async () => {
    const expected = await writeSkill(
      path.join(userHome, '.agents', 'skills'),
      'user-alias',
      'user-canonical',
    );

    await expect(findSkillMdPath('user-canonical', projectRoot)).resolves.toBe(expected);
  });

  it('follows an explicitly installed top-level user skill symlink', async () => {
    const source = await writeSkill(
      path.join(tempRoot, 'approved-user-sources'),
      'router-source',
      'user-router',
    );
    const userSkills = path.join(userHome, '.agents', 'skills');
    await mkdir(userSkills, { recursive: true });
    await symlink(path.dirname(source), path.join(userSkills, 'user-router'), 'dir');

    await expect(findSkillMdPath('user-router', projectRoot)).resolves.toBe(
      path.join(userSkills, 'user-router', 'SKILL.md'),
    );
  });

  it('expands a command addressed by canonical name', async () => {
    await writeSkill(
      path.join(projectRoot, '.drclaw', 'skill-library'),
      'paper-helper',
      'canonical-paper-helper',
      'Use the selected paper workflow.',
    );

    const expanded = await expandSkillCommand('/canonical-paper-helper focus on citations', projectRoot);
    expect(expanded).toContain('# Skill: canonical-paper-helper');
    expect(expanded).toContain('Use the selected paper workflow.');
    expect(expanded).toContain('focus on citations');
  });

  it('rejects traversal and path-shaped skill names', async () => {
    await expect(findSkillMdPath('../outside', projectRoot)).resolves.toBeNull();
    await expect(findSkillMdPath('/absolute', projectRoot)).resolves.toBeNull();
    await expect(findSkillMdPath('nested/skill', projectRoot)).resolves.toBeNull();
    await expect(findSkillMdPath('skill..name', projectRoot)).resolves.toBeNull();
  });

  it('rejects untrusted directory and SKILL.md symlink escapes', async () => {
    const outsideDirectorySkill = await writeSkill(
      path.join(tempRoot, 'outside-directory-skills'),
      'outside-directory',
      'directory-symlink-escape',
    );
    const outsideFileSkill = await writeSkill(
      path.join(tempRoot, 'outside-file-skills'),
      'outside-file',
      'file-symlink-escape',
    );
    const libraryRoot = path.join(projectRoot, '.drclaw', 'skill-library');
    await mkdir(libraryRoot, { recursive: true });
    await symlink(path.dirname(outsideDirectorySkill), path.join(libraryRoot, 'directory-symlink-escape'), 'dir');
    await mkdir(path.join(libraryRoot, 'file-symlink-escape'), { recursive: true });
    await symlink(outsideFileSkill, path.join(libraryRoot, 'file-symlink-escape', 'SKILL.md'), 'file');

    await expect(findSkillMdPath('directory-symlink-escape', projectRoot)).resolves.toBeNull();
    await expect(findSkillMdPath('file-symlink-escape', projectRoot)).resolves.toBeNull();
  });
});
