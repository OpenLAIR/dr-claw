import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isBundledSkillRead } from '../utils/bundledSkillAccess.js';

let root;
let skillsDir;
let projectDir;
let refFile;
let outsideFile;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'drclaw-skill-access-'));
  skillsDir = path.join(root, 'repo', 'skills');
  fs.mkdirSync(path.join(skillsDir, 'planner', 'references'), { recursive: true });
  refFile = path.join(skillsDir, 'planner', 'references', 'schema.md');
  fs.writeFileSync(refFile, '# schema');

  projectDir = path.join(root, 'project');
  fs.mkdirSync(path.join(projectDir, '.claude', 'skills'), { recursive: true });
  fs.symlinkSync(path.join(skillsDir, 'planner'), path.join(projectDir, '.claude', 'skills', 'planner'), 'dir');

  outsideFile = path.join(root, 'secret.txt');
  fs.writeFileSync(outsideFile, 'nope');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('isBundledSkillRead', () => {
  it('allows Read of a skill file reached through the project symlink', () => {
    const viaLink = path.join(projectDir, '.claude', 'skills', 'planner', 'references', 'schema.md');
    expect(isBundledSkillRead('Read', { file_path: viaLink }, { skillsDir })).toBe(true);
  });

  it('allows Read of the real skill path and relative paths from the project', () => {
    expect(isBundledSkillRead('Read', { file_path: refFile }, { skillsDir })).toBe(true);
    expect(isBundledSkillRead('Read', { file_path: '.claude/skills/planner/references/schema.md' }, { skillsDir, cwd: projectDir })).toBe(true);
  });

  it('allows Glob and Grep only with an explicit path inside the library', () => {
    expect(isBundledSkillRead('Glob', { pattern: '*.md', path: path.join(skillsDir, 'planner') }, { skillsDir })).toBe(true);
    expect(isBundledSkillRead('Grep', { pattern: 'x', path: skillsDir }, { skillsDir })).toBe(true);
    expect(isBundledSkillRead('Glob', { pattern: '**/*.md' }, { skillsDir, cwd: projectDir })).toBe(false);
  });

  it('rejects Glob patterns that could reach outside the library', () => {
    const base = { path: skillsDir };
    expect(isBundledSkillRead('Glob', { ...base, pattern: '**/references/*.md' }, { skillsDir })).toBe(true);
    expect(isBundledSkillRead('Glob', { ...base, pattern: `${root}/**` }, { skillsDir })).toBe(false);
    expect(isBundledSkillRead('Glob', { ...base, pattern: '../**/*.txt' }, { skillsDir })).toBe(false);
    expect(isBundledSkillRead('Glob', { ...base, pattern: 'planner/../../**' }, { skillsDir })).toBe(false);
    expect(isBundledSkillRead('Glob', { ...base, pattern: '~/**' }, { skillsDir })).toBe(false);
    expect(isBundledSkillRead('Glob', { ...base }, { skillsDir })).toBe(false);
  });

  it('never allows writes or shell commands, even inside the library', () => {
    expect(isBundledSkillRead('Write', { file_path: refFile }, { skillsDir })).toBe(false);
    expect(isBundledSkillRead('Edit', { file_path: refFile }, { skillsDir })).toBe(false);
    expect(isBundledSkillRead('Bash', { command: `cat ${refFile}` }, { skillsDir })).toBe(false);
  });

  it('rejects paths outside the library, prefix look-alikes, and missing files', () => {
    expect(isBundledSkillRead('Read', { file_path: outsideFile }, { skillsDir })).toBe(false);
    const lookAlike = `${skillsDir}-evil`;
    fs.mkdirSync(lookAlike, { recursive: true });
    fs.writeFileSync(path.join(lookAlike, 'x.md'), 'x');
    expect(isBundledSkillRead('Read', { file_path: path.join(lookAlike, 'x.md') }, { skillsDir })).toBe(false);
    expect(isBundledSkillRead('Read', { file_path: path.join(skillsDir, 'missing.md') }, { skillsDir })).toBe(false);
    expect(isBundledSkillRead('Read', {}, { skillsDir })).toBe(false);
  });

  it('rejects a symlink inside the library that points outside it', () => {
    const escape = path.join(skillsDir, 'planner', 'escape.txt');
    fs.symlinkSync(outsideFile, escape);
    expect(isBundledSkillRead('Read', { file_path: escape }, { skillsDir })).toBe(false);
  });
});
