import fs from 'fs';
import path from 'path';
import { BUNDLED_SKILLS_DIR, getUserSkillsDir } from './skillRoots.js';

// Dr. Claw's skill libraries: the bundled skills and the user skills directory.
// Projects reach them through symlinks (<project>/.claude/skills/<name> ->
// <library>/<name>), so the real paths sit outside the project directory and
// Claude Code would ask for permission every time an agent reads a skill's
// reference files.
export { BUNDLED_SKILLS_DIR };

function defaultSkillsDirs() {
  return [BUNDLED_SKILLS_DIR, getUserSkillsDir()];
}

const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep']);

function realpathOrNull(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

function isContainedPattern(pattern) {
  if (!pattern || path.isAbsolute(pattern) || /^[a-zA-Z]:|^~/.test(pattern)) return false;
  return !pattern.split(/[\\/]+/).includes('..');
}

function targetPathFor(toolName, input) {
  if (!input || typeof input !== 'object') return null;
  if (toolName === 'Read') return input.file_path || null;
  // Glob and Grep default to the session cwd when no path is given; only an
  // explicit path can point into the skill library.
  return input.path || null;
}

/**
 * True when a read-only tool call targets a file or directory inside one of
 * the skill libraries (after resolving symlinks). Writes, shell commands and
 * anything outside the libraries are never matched. Pass `skillsDir` or
 * `skillsDirs` to check other directories.
 */
export function isBundledSkillRead(toolName, input, { skillsDir, skillsDirs, cwd } = {}) {
  if (!READ_ONLY_TOOLS.has(toolName)) return false;

  const rawTarget = targetPathFor(toolName, input);
  if (!rawTarget || typeof rawTarget !== 'string') return false;

  // A Glob pattern is matched from `path`, but an absolute or `..` pattern
  // could reach outside it; only relative patterns stay inside the library.
  if (toolName === 'Glob') {
    const pattern = input.pattern;
    if (typeof pattern !== 'string' || !isContainedPattern(pattern)) return false;
  }

  const absoluteTarget = path.isAbsolute(rawTarget)
    ? rawTarget
    : path.resolve(cwd || process.cwd(), rawTarget);

  const realTarget = realpathOrNull(absoluteTarget);
  if (!realTarget) return false;

  const dirs = skillsDirs || (skillsDir ? [skillsDir] : defaultSkillsDirs());
  return dirs.some((dir) => {
    const realSkillsDir = realpathOrNull(dir);
    return !!realSkillsDir && (realTarget === realSkillsDir || realTarget.startsWith(realSkillsDir + path.sep));
  });
}
