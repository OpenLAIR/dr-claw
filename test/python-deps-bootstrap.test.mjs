import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';

/**
 * Test bootstrapSkillPythonDeps logic.
 * We replicate the function here to test in isolation since importing
 * from projects.js pulls in heavy dependencies (sqlite, etc.).
 */

async function bootstrapSkillPythonDeps(projectPath, skillDirs) {
  const reqFiles = [];
  for (const { absolutePath } of skillDirs) {
    const reqPath = path.join(absolutePath, 'requirements.txt');
    try {
      await fs.access(reqPath);
      reqFiles.push(reqPath);
    } catch (_) {}
  }
  if (reqFiles.length === 0) return;

  const venvDir = path.join(projectPath, '.venv');

  const exec = (cmd, args) =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, { cwd: projectPath, timeout: 120_000 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

  try {
    await fs.access(path.join(venvDir, 'bin', 'python3'));
  } catch (_) {
    try {
      await exec('uv', ['venv', venvDir]);
    } catch (_uvErr) {
      try {
        await exec('python3', ['-m', 'venv', venvDir]);
      } catch (pyErr) {
        console.warn('[test] Failed to create .venv:', pyErr.message);
        return;
      }
    }
  }

  for (const reqFile of reqFiles) {
    try {
      await exec('uv', ['pip', 'install', '--python', path.join(venvDir, 'bin', 'python3'), '-r', reqFile]);
    } catch (_uvErr) {
      try {
        await exec(path.join(venvDir, 'bin', 'pip'), ['install', '-r', reqFile]);
      } catch (pipErr) {
        console.warn(`[test] Failed to install deps from ${reqFile}:`, pipErr.message);
      }
    }
  }
}

test('Skips when no skills have requirements.txt', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pydeps-test-'));
  const skillDir = path.join(tmpDir, 'empty-skill');
  await fs.mkdir(skillDir, { recursive: true });

  await bootstrapSkillPythonDeps(tmpDir, [{ absolutePath: skillDir }]);

  // .venv should NOT be created
  try {
    await fs.access(path.join(tmpDir, '.venv'));
    assert.fail('.venv should not exist when no requirements.txt found');
  } catch (err) {
    assert.equal(err.code, 'ENOENT');
  }

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('Creates .venv and installs requests from requirements.txt', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pydeps-test-'));
  const skillDir = path.join(tmpDir, 'test-skill');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'requirements.txt'), 'requests\n');

  await bootstrapSkillPythonDeps(tmpDir, [{ absolutePath: skillDir }]);

  // .venv should exist
  const venvPython = path.join(tmpDir, '.venv', 'bin', 'python3');
  const stat = await fs.access(venvPython);

  // requests should be importable
  const importCheck = await new Promise((resolve) => {
    execFile(venvPython, ['-c', 'import requests; print(requests.__version__)'], (err, stdout) => {
      resolve({ err, stdout: stdout?.trim() });
    });
  });
  assert.ok(!importCheck.err, `requests should be importable, got: ${importCheck.err?.message}`);
  assert.ok(importCheck.stdout, 'requests version should be printed');

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('requirements.txt files exist for Python skills', async () => {
  const skillsDir = path.resolve('skills');
  const expectedSkills = ['gemini-deep-research', 'biorxiv-database', 'inno-reference-audit'];

  for (const skill of expectedSkills) {
    const reqPath = path.join(skillsDir, skill, 'requirements.txt');
    try {
      const content = await fs.readFile(reqPath, 'utf8');
      assert.ok(content.includes('requests'), `${skill}/requirements.txt should include requests`);
    } catch (err) {
      assert.fail(`${skill}/requirements.txt should exist: ${err.message}`);
    }
  }
});

test('SKILL.md files reference .venv/bin/python3', async () => {
  const skillsDir = path.resolve('skills');

  const geminiSkillMd = await fs.readFile(path.join(skillsDir, 'gemini-deep-research', 'SKILL.md'), 'utf8');
  assert.ok(geminiSkillMd.includes('.venv/bin/python3'), 'gemini-deep-research SKILL.md should reference .venv/bin/python3');
  assert.ok(!geminiSkillMd.includes('\npython3 '), 'gemini-deep-research SKILL.md should not use bare python3');

  const biorxivSkillMd = await fs.readFile(path.join(skillsDir, 'biorxiv-database', 'SKILL.md'), 'utf8');
  assert.ok(biorxivSkillMd.includes('.venv/bin/python3'), 'biorxiv-database SKILL.md should reference .venv/bin/python3');
});
