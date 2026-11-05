import { promises as fs } from 'fs';
import path from 'path';

/**
 * Find every skill directory (one containing SKILL.md) under baseDir. Nested
 * category folders are walked; a skill directory itself is not.
 * @returns {Promise<Array<{ name: string, absolutePath: string }>>}
 */
export async function collectSkillDirs(baseDir) {
  const results = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
      results.push({ name: path.basename(dir), absolutePath: dir });
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await walk(path.join(dir, entry.name));
      }
    }
  }

  await walk(baseDir);
  return results;
}

function escapeCell(text) {
  return String(text).replace(/[\r\n]+/g, ' ').replace(/\|/g, '/').trim();
}

async function readSkillSummary(absolutePath, fallbackName) {
  const matter = (await import('gray-matter')).default;
  const content = await fs.readFile(path.join(absolutePath, 'SKILL.md'), 'utf8');
  const { data } = matter(content);
  let description = '';
  if (data.description) {
    const cleaned = escapeCell(data.description);
    description = cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned;
  }
  return { skillName: data.name ? escapeCell(data.name) : fallbackName, description };
}

/**
 * Markdown index for .agents/skills/. Enabled skills are listed by their link
 * path; disabled ones are listed by their path in the bundled library so an
 * agent can still read them when the user asks for one.
 *
 * @param {Array<{ name, absolutePath, enabled?: boolean }>} skillDirs
 * @param {Set<string>} coreNames
 */
export async function generateSkillsIndex(skillDirs, coreNames) {
  const core = [];
  const library = [];
  const onRequest = [];

  for (const { name, absolutePath, enabled = true } of skillDirs) {
    let summary;
    try {
      summary = await readSkillSummary(absolutePath, name);
    } catch {
      continue; // unreadable SKILL.md
    }
    const entry = { dirName: name, absolutePath, ...summary };
    if (!enabled) onRequest.push(entry);
    else if (coreNames.has(name)) core.push(entry);
    else library.push(entry);
  }

  const byName = (a, b) => a.dirName.localeCompare(b.dirName);
  core.sort(byName);
  library.sort(byName);
  onRequest.sort(byName);

  const lines = [
    '# Skills Index',
    '',
    '> **Do NOT read all SKILL.md files at once.** Use this index to find the right skill, then read only that one.',
    '',
    '## Core Pipeline Skills',
    '',
    '| Skill | Path | Description |',
    '|-------|------|-------------|',
  ];
  for (const s of core) {
    lines.push(`| ${s.skillName} | \`.agents/skills/${s.dirName}/SKILL.md\` | ${s.description} |`);
  }

  lines.push('', '## Library Skills', '');
  lines.push('| Skill | Path | Description |');
  lines.push('|-------|------|-------------|');
  for (const s of library) {
    lines.push(`| ${s.skillName} | \`.agents/skills/library/${s.dirName}/SKILL.md\` | ${s.description} |`);
  }

  if (onRequest.length > 0) {
    lines.push('', '## On-request Skills', '');
    lines.push('> Not enabled for this project. Use one only when the user asks for it by name or the task clearly needs it; read the SKILL.md at the path below.');
    lines.push('');
    lines.push('| Skill | Path | Description |');
    lines.push('|-------|------|-------------|');
    for (const s of onRequest) {
      lines.push(`| ${s.skillName} | \`${path.join(s.absolutePath, 'SKILL.md')}\` | ${s.description} |`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function isInside(target, root) {
  const relative = path.relative(root, target);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

async function realpathOrSelf(target) {
  try {
    return await fs.realpath(target);
  } catch {
    return target;
  }
}

/**
 * True when linkPath is a symlink that points into one of `roots`. Real
 * directories and links to anything else belong to the user and are kept.
 */
async function isLinkIntoRoots(linkPath, roots) {
  let stat;
  try {
    stat = await fs.lstat(linkPath);
  } catch {
    return false;
  }
  if (!stat.isSymbolicLink()) return false;
  const rawTarget = await fs.readlink(linkPath);
  const target = path.resolve(path.dirname(linkPath), rawTarget);
  return roots.some((root) => isInside(target, root));
}

async function removeLinkIntoRoots(linkPath, roots) {
  if (await isLinkIntoRoots(linkPath, roots)) {
    await fs.unlink(linkPath);
    return true;
  }
  return false;
}

async function pathExists(target) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Remove links into the library whose target no longer exists. */
async function pruneDanglingLinks(dir, roots) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue;
    const linkPath = path.join(dir, entry.name);
    if (await pathExists(linkPath)) continue;
    try {
      await removeLinkIntoRoots(linkPath, roots);
    } catch (err) {
      console.error(`[skills] Failed to remove dangling link ${linkPath}:`, err.message);
    }
  }
}

/**
 * Make each project skills folder match the enabled set: link enabled skills,
 * unlink disabled ones and dangling links. Only symlinks that point into
 * `skillsRoot` are ever removed.
 *
 * @param {object} options
 * @param {string} options.projectPath
 * @param {string} options.skillsRoot - bundled skill library
 * @param {Array<{ name: string, absolutePath: string }>} options.skillDirs
 * @param {Set<string>} options.enabledNames
 * @param {Set<string>} options.coreNames
 * @param {string[]} options.folders - e.g. ['.claude', '.agents', '.cursor', '.gemini']
 */
export async function syncProjectSkillLinks({ projectPath, skillsRoot, skillDirs, enabledNames, coreNames, folders }) {
  const roots = [...new Set([path.resolve(skillsRoot), await realpathOrSelf(path.resolve(skillsRoot))])];

  for (const dir of folders) {
    const skillsSubdir = path.join(projectPath, dir, 'skills');
    const isAgents = dir === '.agents';
    try {
      await fs.mkdir(skillsSubdir, { recursive: true });
      if (isAgents) await fs.mkdir(path.join(skillsSubdir, 'library'), { recursive: true });
    } catch (err) {
      console.error(`[skills] Failed to create ${dir}/skills:`, err.message);
      continue;
    }

    for (const { name, absolutePath } of skillDirs) {
      // In .agents/, core skills sit at the top level and the rest under library/.
      const inLibrary = isAgents && !coreNames.has(name);
      const linkPath = inLibrary ? path.join(skillsSubdir, 'library', name) : path.join(skillsSubdir, name);
      const otherPath = isAgents
        ? (inLibrary ? path.join(skillsSubdir, name) : path.join(skillsSubdir, 'library', name))
        : null;

      try {
        if (enabledNames.has(name)) {
          try { await fs.unlink(linkPath); } catch { /* missing, or a real directory */ }
          if (otherPath) await removeLinkIntoRoots(otherPath, roots);
          await fs.symlink(absolutePath, linkPath, 'dir');
        } else {
          await removeLinkIntoRoots(linkPath, roots);
          if (otherPath) await removeLinkIntoRoots(otherPath, roots);
        }
      } catch (err) {
        console.error(`[skills] Failed to update ${name} in ${dir}/skills:`, err.message);
      }
    }

    await pruneDanglingLinks(skillsSubdir, roots);
    if (isAgents) await pruneDanglingLinks(path.join(skillsSubdir, 'library'), roots);

    if (isAgents) {
      try {
        const indexEntries = skillDirs.map((skill) => ({ ...skill, enabled: enabledNames.has(skill.name) }));
        const indexContent = await generateSkillsIndex(indexEntries, coreNames);
        await fs.writeFile(path.join(skillsSubdir, 'skills-index.md'), indexContent, 'utf8');
      } catch (err) {
        console.error('[skills] Failed to write skills-index.md:', err.message);
      }
    }

    for (const jsonFile of ['skill-tag-mapping.json', 'stage-skill-map.json']) {
      const srcJson = path.join(skillsRoot, jsonFile);
      const destJson = path.join(skillsSubdir, jsonFile);
      try {
        await fs.access(srcJson);
        try { await fs.unlink(destJson); } catch { /* not there yet */ }
        await fs.symlink(srcJson, destJson, 'file');
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`[skills] Failed to link ${jsonFile} in ${dir}/skills:`, err.message);
        }
      }
    }
  }
}
