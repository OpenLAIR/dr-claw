import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getFileTree } from '../utils/fileTree.js';

let tmp;
let project;
let sharedSkills;

const byName = (items, name) => items.find((item) => item.name === name);
const countNodes = (items) => items.reduce((n, item) => n + 1 + (Array.isArray(item.children) ? countNodes(item.children) : 0), 0);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'file-tree-'));
  project = path.join(tmp, 'project');
  sharedSkills = path.join(tmp, 'shared-skills');

  // A shared skills library outside the project, like Dr. Claw's skills/ folder.
  for (let i = 0; i < 20; i++) {
    const skill = path.join(sharedSkills, `skill-${i}`, 'references', 'deep');
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(sharedSkills, `skill-${i}`, 'SKILL.md'), '# skill\n');
    fs.writeFileSync(path.join(skill, 'notes.md'), 'notes\n');
  }

  // Ordinary project content.
  fs.mkdirSync(path.join(project, 'Survey', 'references'), { recursive: true });
  fs.writeFileSync(path.join(project, 'Survey', 'references', 'paper.md'), 'paper\n');
  fs.writeFileSync(path.join(project, 'README.md'), 'hello\n');
  fs.mkdirSync(path.join(project, 'node_modules', 'pkg'), { recursive: true });

  // What ensureProjectSkillLinks() creates: one symlink per skill in each agent folder.
  for (const agent of ['.claude', '.agents', '.cursor', '.gemini']) {
    const skillsDir = path.join(project, agent, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    for (let i = 0; i < 20; i++) {
      fs.symlinkSync(path.join(sharedSkills, `skill-${i}`), path.join(skillsDir, `skill-${i}`), 'dir');
    }
  }
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('getFileTree', () => {
  it('lists symlinked skill folders as directories without walking into them', async () => {
    const readdir = vi.spyOn(fs.promises, 'readdir');
    try {
      const tree = await getFileTree(project, 10, 0, true);

      const skills = byName(byName(tree, '.claude').children, 'skills').children;
      expect(skills).toHaveLength(20);
      const skill = byName(skills, 'skill-0');
      expect(skill).toMatchObject({
        name: 'skill-0',
        path: path.join(project, '.claude', 'skills', 'skill-0'),
        type: 'directory',
        isSymlink: true,
        children: null,
      });
      // Metadata comes from the link target, as before.
      expect(skill.permissionsRwx).toMatch(/^([r-][w-][x-]){3}$/);
      expect(typeof skill.modified).toBe('string');

      // No readdir ever went through a symlink into the shared library.
      const visited = readdir.mock.calls.map(([dir]) => String(dir));
      expect(visited.some((dir) => dir.includes(`${path.sep}skills${path.sep}skill-`))).toBe(false);
      // project, Survey, Survey/references, and skills/ in each of the four agent folders.
      expect(visited).toHaveLength(3 + 4 * 2);
    } finally {
      readdir.mockRestore();
    }
  });

  it('lists ordinary project files in full and symlinks only as entries', async () => {
    const tree = await getFileTree(project, 10, 0, true);

    expect(tree.map((item) => item.name)).toEqual([
      '.agents', '.claude', '.cursor', '.gemini', 'Survey', 'README.md',
    ]);
    const references = byName(byName(tree, 'Survey').children, 'references');
    expect(references.type).toBe('directory');
    // Only links carry the flag, so the panel can mark them.
    expect(byName(tree, 'Survey').isSymlink).toBeUndefined();
    expect(byName(tree, 'README.md').isSymlink).toBeUndefined();
    expect(references.children).toEqual([
      expect.objectContaining({ name: 'paper.md', type: 'file', size: 6 }),
    ]);
    expect(byName(tree, 'node_modules')).toBeUndefined();
    // 6 top-level + Survey/references/paper.md + 4 × skills/ + 4 × 20 links
    expect(countNodes(tree)).toBe(6 + 2 + 4 + 80);
  });

  it('lists a symlinked folder when it is opened directly (lazy expand)', async () => {
    const skillPath = path.join(project, '.claude', 'skills', 'skill-3');
    const children = await getFileTree(skillPath, 2, 0, true);

    expect(children.map((item) => item.name)).toEqual(['references', 'SKILL.md']);
    const deep = byName(byName(children, 'references').children, 'deep');
    expect(deep.children).toEqual([expect.objectContaining({ name: 'notes.md', type: 'file' })]);
  });

  it('marks directories below maxDepth as not loaded instead of leaving them out', async () => {
    const tree = await getFileTree(project, 0, 0, true);
    const survey = byName(tree, 'Survey');
    expect(survey).toMatchObject({ type: 'directory', children: null });
    expect(byName(tree, 'README.md').children).toBeUndefined();
  });

  it('treats a broken symlink as a file and does not throw', async () => {
    fs.symlinkSync(path.join(tmp, 'missing'), path.join(project, 'dangling'));
    const tree = await getFileTree(project, 10, 0, true);
    expect(byName(tree, 'dangling')).toMatchObject({ type: 'file', size: 0, permissions: '000' });
  });

  it('does not loop on a symlink cycle', async () => {
    fs.symlinkSync(project, path.join(project, 'Survey', 'loop'), 'dir');
    const tree = await getFileTree(project, 10, 0, true);
    expect(byName(byName(tree, 'Survey').children, 'loop')).toMatchObject({ type: 'directory', children: null });
  });
});
