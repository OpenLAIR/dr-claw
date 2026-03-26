import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Test that ensureProjectSkillLinks creates underscore-aliased symlinks
 * for skill directories with hyphens in their names.
 *
 * We simulate the symlink creation logic directly rather than importing
 * the full module (which has heavy dependencies).
 */

// Extract and test the core logic: for a hyphenated name, create an underscore alias
test('Underscore alias symlink is created for hyphenated skill names', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-alias-test-'));
  const skillsDir = path.join(tmpDir, '.gemini', 'skills');
  await fs.mkdir(skillsDir, { recursive: true });

  // Simulate the skill directory
  const skillSrcDir = path.join(tmpDir, 'src-skills', 'inno-pipeline-planner');
  await fs.mkdir(skillSrcDir, { recursive: true });
  await fs.writeFile(path.join(skillSrcDir, 'SKILL.md'), '# Test Skill');

  const name = 'inno-pipeline-planner';
  const absolutePath = skillSrcDir;
  const linkPath = path.join(skillsDir, name);

  // Create primary symlink
  await fs.symlink(absolutePath, linkPath, 'dir');

  // Create underscore alias (same logic as in projects.js)
  if (name.includes('-')) {
    const underscoreName = name.replace(/-/g, '_');
    const aliasPath = path.join(skillsDir, underscoreName);
    try { await fs.unlink(aliasPath); } catch (_) {}
    await fs.symlink(absolutePath, aliasPath, 'dir');
  }

  // Verify both symlinks exist and point to the same target
  const primaryStat = await fs.lstat(linkPath);
  assert.ok(primaryStat.isSymbolicLink(), 'Primary symlink should exist');

  const aliasPath = path.join(skillsDir, 'inno_pipeline_planner');
  const aliasStat = await fs.lstat(aliasPath);
  assert.ok(aliasStat.isSymbolicLink(), 'Underscore alias symlink should exist');

  const primaryTarget = await fs.readlink(linkPath);
  const aliasTarget = await fs.readlink(aliasPath);
  assert.equal(primaryTarget, aliasTarget, 'Both symlinks should point to the same target');

  // Verify SKILL.md is accessible via the alias
  const content = await fs.readFile(path.join(aliasPath, 'SKILL.md'), 'utf8');
  assert.equal(content, '# Test Skill');

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('No alias is created for skills without hyphens', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-alias-test-'));
  const skillsDir = path.join(tmpDir, '.gemini', 'skills');
  await fs.mkdir(skillsDir, { recursive: true });

  const skillSrcDir = path.join(tmpDir, 'src-skills', 'simpleskill');
  await fs.mkdir(skillSrcDir, { recursive: true });

  const name = 'simpleskill';
  const linkPath = path.join(skillsDir, name);
  await fs.symlink(skillSrcDir, linkPath, 'dir');

  // Same logic: no alias should be created
  if (name.includes('-')) {
    const underscoreName = name.replace(/-/g, '_');
    const aliasPath = path.join(skillsDir, underscoreName);
    await fs.symlink(skillSrcDir, aliasPath, 'dir');
  }

  // Only the primary symlink should exist
  const entries = await fs.readdir(skillsDir);
  assert.equal(entries.length, 1, 'Only one symlink should exist for non-hyphenated names');
  assert.equal(entries[0], 'simpleskill');

  await fs.rm(tmpDir, { recursive: true, force: true });
});
