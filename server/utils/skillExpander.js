import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

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
 * Build the ordered list of directories to search for a skill SKILL.md.
 */
function buildSkillSearchPaths(skillName, workingDir) {
  return [
    path.join(workingDir, '.agents', 'skills', skillName),
    path.join(workingDir, '.claude', 'skills', skillName),
    path.join(workingDir, '.gemini', 'skills', skillName),
    path.join(process.cwd(), 'skills', skillName),
    path.join(os.homedir(), '.claude', 'skills', skillName),
  ];
}

/**
 * Try to find the SKILL.md path for a given skill name.
 * Returns the absolute path or null if not found.
 */
async function findSkillMdPath(skillName, workingDir) {
  const searchPaths = buildSkillSearchPaths(skillName, workingDir);
  for (const skillDir of searchPaths) {
    try {
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      const stat = await fs.stat(skillMdPath);
      if (stat.isFile()) return skillMdPath;
    } catch {
      // not found, try next
    }
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
