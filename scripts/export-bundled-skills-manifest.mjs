#!/usr/bin/env node
/**
 * Write skills/bundled-skills.json: every skill directory (one with a SKILL.md)
 * that is tracked by git under skills/. The server treats these as the
 * read-only skills that ship with Dr. Claw; any other skill found in skills/
 * is a user skill and is moved to the user skills directory on startup.
 *
 * Usage: node scripts/export-bundled-skills-manifest.mjs [--check]
 *   --check  exit 1 if the committed manifest is out of date instead of writing it
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(repoRoot, 'skills', 'bundled-skills.json');

export function listTrackedSkillDirs(cwd = repoRoot) {
  const output = execFileSync('git', ['ls-files', '-z', '--', 'skills'], { cwd, encoding: 'utf8' });
  const dirs = new Set();
  for (const file of output.split('\0')) {
    if (!file) continue;
    const parts = file.split('/');
    if (parts[parts.length - 1] !== 'SKILL.md' || parts.length < 3) continue;
    dirs.add(parts.slice(1, -1).join('/'));
  }
  // A skill directory is not walked into, so drop skills nested inside another skill.
  const sorted = [...dirs].sort();
  return sorted.filter((dir) => !sorted.some((other) => other !== dir && dir.startsWith(`${other}/`)));
}

export function buildManifest(skillDirs) {
  return { version: 1, skills: skillDirs };
}

async function main() {
  const manifest = buildManifest(listTrackedSkillDirs());
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const current = await fs.readFile(manifestPath, 'utf8').catch(() => '');
    if (current !== content) {
      console.error('skills/bundled-skills.json is out of date. Run: npm run skills:manifest');
      process.exit(1);
    }
    return;
  }
  await fs.writeFile(manifestPath, content, 'utf8');
  console.log(`Wrote ${manifest.skills.length} skills to ${path.relative(repoRoot, manifestPath)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
