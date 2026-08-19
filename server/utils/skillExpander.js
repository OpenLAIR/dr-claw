import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const SAFE_SKILL_NAME = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const MAX_SKILL_SCAN_DEPTH = 8;
const MAX_SKILL_SCAN_DIRS = 4000;
const PACKAGED_SKILLS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'skills',
);

/**
 * Strip leading [Context: ...] prefixes the frontend injects for new sessions.
 * Returns { prefix, body } so the prefix can be re-prepended after expansion.
 */
function splitContextPrefix(text) {
  const m = text.match(/^(\s*\[Context:[^\]]*\]\s*)+/i);
  if (!m) return { prefix: '', body: text };
  return { prefix: m[0], body: text.slice(m[0].length) };
}

/**
 * Build the ordered list of skill roots to search. Project-local sources take
 * precedence over repository and user-level fallbacks.
 */
function buildSkillSearchRoots(workingDir) {
  const roots = [
    // Search canonical names among native skills, but do not let the nested
    // legacy library bypass the preferred .drclaw location below.
    {
      root: path.join(workingDir, '.agents', 'skills'),
      ignoredTopLevel: new Set(['library']),
      projectAnchor: workingDir,
    },
    { root: path.join(workingDir, '.drclaw', 'skill-library'), projectAnchor: workingDir },
    // Backward-compatible read path for projects created before the library
    // moved out of Codex's recursively discovered .agents/skills tree.
    { root: path.join(workingDir, '.agents', 'skills', 'library'), projectAnchor: workingDir },
    { root: path.join(workingDir, '.claude', 'skills'), projectAnchor: workingDir },
    { root: path.join(workingDir, '.cursor', 'skills'), projectAnchor: workingDir },
    { root: path.join(workingDir, '.gemini', 'skills'), projectAnchor: workingDir },
    { root: path.join(process.cwd(), 'skills') },
    { root: PACKAGED_SKILLS_ROOT },
    { root: path.join(os.homedir(), '.agents', 'skills') },
    { root: path.join(os.homedir(), '.claude', 'skills') },
  ];

  const seen = new Set();
  return roots
    .map(({ root, ignoredTopLevel, projectAnchor }) => ({
      root: path.resolve(root),
      ignoredTopLevel,
      projectAnchor: projectAnchor ? path.resolve(projectAnchor) : null,
    }))
    .filter(({ root }) => {
      if (seen.has(root)) return false;
      seen.add(root);
      return true;
    });
}

function parseFrontmatterName(content) {
  const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) return null;

  const match = frontmatter[1].match(/^name\s*:\s*(.*?)\s*$/m);
  if (!match) return null;

  let name = match[1].trim();
  if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'"))) {
    name = name.slice(1, -1).trim();
  }
  return SAFE_SKILL_NAME.test(name) ? name : null;
}

function isRealPathWithin(candidatePath, allowedRoot) {
  return candidatePath === allowedRoot || candidatePath.startsWith(`${allowedRoot}${path.sep}`);
}

async function projectPathChainIsLocal(projectAnchor, root) {
  if (!isRealPathWithin(root, projectAnchor)) return false;
  const relative = path.relative(projectAnchor, root);
  let current = projectAnchor;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function isTrustedSkillFile(skillMdPath, trustedRealRoots) {
  try {
    const stat = await fs.stat(skillMdPath);
    if (!stat.isFile()) return false;
    const realSkillMdPath = await fs.realpath(skillMdPath);
    return trustedRealRoots.some((root) => isRealPathWithin(realSkillMdPath, root));
  } catch {
    return false;
  }
}

/**
 * Resolve a directory alias or canonical frontmatter name under one approved
 * root. Logical traversal stays inside the root; directory symlinks are
 * followed because generated skill entries intentionally point to the source
 * library outside the project.
 */
async function findSkillInRoot(
  skillName,
  root,
  ignoredTopLevel = new Set(),
  projectAnchor = null,
) {
  if (projectAnchor && !await projectPathChainIsLocal(projectAnchor, root)) return null;

  let realRoot;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    return null;
  }

  const trustedRealRoots = [realRoot];
  const allowExternalTopLevelSymlinks = !projectAnchor;
  try {
    const realPackagedRoot = await fs.realpath(PACKAGED_SKILLS_ROOT);
    if (!trustedRealRoots.includes(realPackagedRoot)) trustedRealRoots.push(realPackagedRoot);
  } catch {
    // A distribution without bundled skills can still use physical local or
    // user-level skills, but cannot trust external project symlinks.
  }

  const directDir = path.resolve(root, skillName);
  if (directDir.startsWith(`${root}${path.sep}`)) {
    if (allowExternalTopLevelSymlinks) {
      try {
        const directStat = await fs.lstat(directDir);
        if (directStat.isSymbolicLink()) {
          const directRealPath = await fs.realpath(directDir);
          if (!trustedRealRoots.includes(directRealPath)) trustedRealRoots.push(directRealPath);
        }
      } catch {
        // The normal file check below handles absent or unreadable entries.
      }
    }
    const directSkillMd = path.join(directDir, 'SKILL.md');
    if (await isTrustedSkillFile(directSkillMd, trustedRealRoots)) return directSkillMd;
  }

  const visited = new Set();
  const scanState = { directories: 0 };

  async function walk(currentDir, depth) {
    if (depth > MAX_SKILL_SCAN_DEPTH || scanState.directories >= MAX_SKILL_SCAN_DIRS) return null;

    let realDir;
    let entries;
    try {
      realDir = await fs.realpath(currentDir);
      if (!trustedRealRoots.some((rootPath) => isRealPathWithin(realDir, rootPath))) return null;
      if (visited.has(realDir)) return null;
      visited.add(realDir);
      scanState.directories += 1;
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return null;
    }

    const skillMdPath = path.join(currentDir, 'SKILL.md');
    if (
      entries.some((entry) => entry.name === 'SKILL.md')
      && await isTrustedSkillFile(skillMdPath, trustedRealRoots)
    ) {
      if (path.basename(currentDir) === skillName) return skillMdPath;
      try {
        const content = await fs.readFile(skillMdPath, 'utf8');
        if (parseFrontmatterName(content) === skillName) return skillMdPath;
      } catch {
        // An unreadable candidate is not a resolvable skill.
      }
      return null;
    }

    const children = entries
      .filter((entry) => (
        !entry.name.startsWith('.')
        && entry.name !== 'node_modules'
        && (depth !== 0 || !ignoredTopLevel.has(entry.name))
      ))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of children) {
      const childPath = path.join(currentDir, entry.name);
      let isDirectory = entry.isDirectory();
      if (!isDirectory && entry.isSymbolicLink()) {
        try {
          isDirectory = (await fs.stat(childPath)).isDirectory();
        } catch {
          isDirectory = false;
        }
      }
      if (!isDirectory) continue;

      if (allowExternalTopLevelSymlinks && depth === 0 && entry.isSymbolicLink()) {
        try {
          const realChildPath = await fs.realpath(childPath);
          if (!trustedRealRoots.includes(realChildPath)) trustedRealRoots.push(realChildPath);
        } catch {
          continue;
        }
      }

      const match = await walk(childPath, depth + 1);
      if (match) return match;
    }
    return null;
  }

  return walk(root, 0);
}

/**
 * Try to find the SKILL.md path for a given skill name.
 * Returns the absolute path or null if not found.
 */
async function findSkillMdPath(skillName, workingDir) {
  if (typeof skillName !== 'string' || !SAFE_SKILL_NAME.test(skillName)) return null;
  if (typeof workingDir !== 'string' || !workingDir.trim()) return null;

  const searchRoots = buildSkillSearchRoots(path.resolve(workingDir));
  for (const { root, ignoredTopLevel, projectAnchor } of searchRoots) {
    const skillMdPath = await findSkillInRoot(skillName, root, ignoredTopLevel, projectAnchor);
    if (skillMdPath) return skillMdPath;
  }
  return null;
}

/**
 * Read SKILL.md content for a given skill name.
 */
async function readSkillMd(skillName, workingDir) {
  const skillMdPath = await findSkillMdPath(skillName, workingDir);
  if (!skillMdPath) return null;
  try {
    const content = await fs.readFile(skillMdPath, 'utf-8');
    if (!content.trim()) return null;
    return { content, path: skillMdPath };
  } catch {
    return null;
  }
}

/**
 * Scan text for /skill-name references and return unique skill names found.
 * Matches patterns like /aris-idea-discovery, /autoresearch:fix, etc.
 * Skips matches that are clearly URLs (preceded by http:// or similar).
 */
function findNestedSkillRefs(text) {
  const refs = new Set();
  const pattern = /(?<![a-zA-Z0-9:.])\/([a-zA-Z][a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?)\b/g;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    refs.add(m[1]);
  }
  return [...refs];
}

/**
 * Build a sub-skill lookup table: for each /skill-name referenced in the
 * top-level SKILL.md, resolve its file path so the model can read it on demand.
 * Only scans one level deep — the model reads sub-skills progressively.
 */
async function buildSubSkillIndex(content, workingDir, topSkillName) {
  const refs = findNestedSkillRefs(content);
  const candidates = refs
    .map((ref) => ({ ref, skillName: ref.includes(':') ? ref.split(':')[0] : ref }))
    .filter(({ skillName }) => skillName !== topSkillName);

  const results = await Promise.all(
    candidates.map(async ({ ref, skillName }) => {
      const skillMdPath = await findSkillMdPath(skillName, workingDir);
      return skillMdPath ? { ref, path: skillMdPath } : null;
    })
  );

  return results.filter(Boolean);
}

/**
 * Resolve a `/skill-name` or `/skill-name:variant` slash command into the
 * full SKILL.md content so non-Claude providers receive explicit instructions
 * instead of an opaque slash command they cannot interpret.
 *
 * Sub-skill references within the expanded content are NOT inlined. Instead,
 * a lookup table is appended so the model can read each sub-skill file on
 * demand (progressive expansion), keeping the initial prompt small.
 *
 * Returns the expanded prompt string, or the original command unchanged if
 * no matching skill is found.
 */
export async function expandSkillCommand(command, workingDir) {
  if (!command || typeof command !== 'string') return command;

  const { prefix, body } = splitContextPrefix(command);

  const match = body.match(/^\/([a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?)\s*([\s\S]*)$/);
  if (!match) return command;

  const skillCommand = match[1];
  const remainder = (match[2] || '').trim();

  const skillName = skillCommand.includes(':') ? skillCommand.split(':')[0] : skillCommand;
  const variant = skillCommand.includes(':') ? skillCommand.split(':').slice(1).join(':') : null;

  const result = await readSkillMd(skillName, workingDir);
  if (!result) return command;

  console.log(`[SkillExpander] Expanded /${skillCommand} from ${result.path}`);
  const variantNote = variant ? `\n\n**Variant requested:** \`${variant}\`\n` : '';
  const userContext = remainder ? `\n\n**User context:**\n${remainder}` : '';

  // Build a path index for sub-skills referenced in this SKILL.md
  const subSkillIndex = await buildSubSkillIndex(result.content, workingDir, skillName);

  let subSkillNote = '';
  if (subSkillIndex.length > 0) {
    const lines = subSkillIndex.map(({ ref, path: p }) => `- \`/${ref}\` → \`${p}\``).join('\n');
    subSkillNote = `\n\n## Sub-Skill Loading\n\nThis procedure references other skills via \`/skill-name\`. You are NOT running inside Claude Code CLI, so slash commands are not available. Instead, when you reach a step that calls a sub-skill, **read its SKILL.md file** and follow those instructions inline.\n\nSub-skill file locations:\n${lines}\n\nExample: when the procedure says "run \`/aris-idea-discovery\`", do:\n1. Read the corresponding SKILL.md path listed above\n2. Follow the instructions in that file\n3. Continue with the next step in the parent procedure`;
  }

  return `${prefix}# Skill: ${skillCommand}\n\nFollow the procedure below exactly.\n${variantNote}\n${result.content}${userContext}${subSkillNote}`;
}

export { findSkillMdPath };
