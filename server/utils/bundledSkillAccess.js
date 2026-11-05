import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dr. Claw's own skill library. Projects reach it through symlinks
// (<project>/.claude/skills/<name> -> <repo>/skills/<name>), so the real
// paths sit outside the project directory and Claude Code would ask for
// permission every time an agent reads a skill's reference files.
export const BUNDLED_SKILLS_DIR = path.resolve(__dirname, '..', '..', 'skills');

const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep']);

function realpathOrNull(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

function targetPathFor(toolName, input) {
  if (!input || typeof input !== 'object') return null;
  if (toolName === 'Read') return input.file_path || null;
  // Glob and Grep default to the session cwd when no path is given; only an
  // explicit path can point into the skill library.
  return input.path || null;
}

/**
 * True when a read-only tool call targets a file or directory inside the
 * bundled skill library (after resolving symlinks). Writes, shell commands
 * and anything outside the library are never matched.
 */
export function isBundledSkillRead(toolName, input, { skillsDir = BUNDLED_SKILLS_DIR, cwd } = {}) {
  if (!READ_ONLY_TOOLS.has(toolName)) return false;

  const rawTarget = targetPathFor(toolName, input);
  if (!rawTarget || typeof rawTarget !== 'string') return false;

  const absoluteTarget = path.isAbsolute(rawTarget)
    ? rawTarget
    : path.resolve(cwd || process.cwd(), rawTarget);

  const realTarget = realpathOrNull(absoluteTarget);
  const realSkillsDir = realpathOrNull(skillsDir);
  if (!realTarget || !realSkillsDir) return false;

  return realTarget === realSkillsDir || realTarget.startsWith(realSkillsDir + path.sep);
}
