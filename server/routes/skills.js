import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { extractProjectDirectory, ensureProjectSkillLinks } from '../projects.js';
import { FORBIDDEN_PATHS } from './projects.js';
import { findSkillMdPath } from '../utils/skillExpander.js';

const GLOBAL_SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');

const router = express.Router();

/**
 * Sync a skill directory + tag config to the global skills/ folder.
 * Failures are logged but never throw — local upload must always succeed.
 */
async function syncSkillToGlobal(name, srcDir, tags) {
  try {
    await fs.mkdir(GLOBAL_SKILLS_DIR, { recursive: true });
    const destDir = path.join(GLOBAL_SKILLS_DIR, name);
    // Remove stale copy then copy fresh
    await fs.rm(destDir, { recursive: true, force: true });
    await fs.cp(srcDir, destDir, { recursive: true });

    // Update global skill-tag-mapping.json
    const tagMappingPath = path.join(GLOBAL_SKILLS_DIR, 'skill-tag-mapping.json');
    let tagMapping = { version: 1, stageOverrides: {}, domainOverrides: {}, platformNativeSkills: [], domainCsAiExceptions: [] };
    try {
      tagMapping = JSON.parse(await fs.readFile(tagMappingPath, 'utf8'));
    } catch { /* use defaults */ }

    if (tags && tags.stageOverride) {
      tagMapping.stageOverrides = tagMapping.stageOverrides || {};
      tagMapping.stageOverrides[name] = tags.stageOverride;
    }
    if (tags && tags.domainOverride) {
      tagMapping.domainOverrides = tagMapping.domainOverrides || {};
      tagMapping.domainOverrides[name] = tags.domainOverride;
    }
    await fs.writeFile(tagMappingPath, JSON.stringify(tagMapping, null, 2), 'utf8');

    // Update global stage-skill-map.json
    const stageSkillMapPath = path.join(GLOBAL_SKILLS_DIR, 'stage-skill-map.json');
    let stageSkillMap = { skillOrigins: {} };
    try {
      stageSkillMap = JSON.parse(await fs.readFile(stageSkillMapPath, 'utf8'));
    } catch { /* use defaults */ }

    stageSkillMap.skillOrigins = stageSkillMap.skillOrigins || {};
    stageSkillMap.skillOrigins[name] = (tags && tags.origin) || 'downloaded';
    await fs.writeFile(stageSkillMapPath, JSON.stringify(stageSkillMap, null, 2), 'utf8');
  } catch (err) {
    console.warn('[skills] syncSkillToGlobal failed (non-fatal):', err.message);
  }
}

/**
 * Remove a skill directory + clean its entries from global config files.
 */
async function removeSkillFromGlobal(name) {
  try {
    const destDir = path.join(GLOBAL_SKILLS_DIR, name);
    await fs.rm(destDir, { recursive: true, force: true });

    // Clean global skill-tag-mapping.json
    const tagMappingPath = path.join(GLOBAL_SKILLS_DIR, 'skill-tag-mapping.json');
    try {
      const tagMapping = JSON.parse(await fs.readFile(tagMappingPath, 'utf8'));
      if (tagMapping.stageOverrides) delete tagMapping.stageOverrides[name];
      if (tagMapping.domainOverrides) delete tagMapping.domainOverrides[name];
      await fs.writeFile(tagMappingPath, JSON.stringify(tagMapping, null, 2), 'utf8');
    } catch { /* file missing or unparseable — nothing to clean */ }

    // Clean global stage-skill-map.json
    const stageSkillMapPath = path.join(GLOBAL_SKILLS_DIR, 'stage-skill-map.json');
    try {
      const stageSkillMap = JSON.parse(await fs.readFile(stageSkillMapPath, 'utf8'));
      if (stageSkillMap.skillOrigins) delete stageSkillMap.skillOrigins[name];
      await fs.writeFile(stageSkillMapPath, JSON.stringify(stageSkillMap, null, 2), 'utf8');
    } catch { /* file missing or unparseable — nothing to clean */ }
  } catch (err) {
    console.warn('[skills] removeSkillFromGlobal failed (non-fatal):', err.message);
  }
}

/**
 * Update tag overrides for a skill in the global config.
 */
async function updateGlobalTags(name, tags) {
  try {
    const tagMappingPath = path.join(GLOBAL_SKILLS_DIR, 'skill-tag-mapping.json');
    let tagMapping = { version: 1, stageOverrides: {}, domainOverrides: {}, platformNativeSkills: [], domainCsAiExceptions: [] };
    try {
      tagMapping = JSON.parse(await fs.readFile(tagMappingPath, 'utf8'));
    } catch { /* use defaults */ }

    const { stageOverride, domainOverride } = tags;

    if (stageOverride !== undefined) {
      tagMapping.stageOverrides = tagMapping.stageOverrides || {};
      if (stageOverride === null) {
        delete tagMapping.stageOverrides[name];
      } else {
        tagMapping.stageOverrides[name] = stageOverride;
      }
    }

    if (domainOverride !== undefined) {
      tagMapping.domainOverrides = tagMapping.domainOverrides || {};
      if (domainOverride === null) {
        delete tagMapping.domainOverrides[name];
      } else {
        tagMapping.domainOverrides[name] = domainOverride;
      }
    }

    await fs.writeFile(tagMappingPath, JSON.stringify(tagMapping, null, 2), 'utf8');

    // Also sync origin if provided
    if (tags.origin !== undefined) {
      const stageSkillMapPath = path.join(GLOBAL_SKILLS_DIR, 'stage-skill-map.json');
      let stageSkillMap = { skillOrigins: {} };
      try {
        stageSkillMap = JSON.parse(await fs.readFile(stageSkillMapPath, 'utf8'));
      } catch { /* use defaults */ }

      stageSkillMap.skillOrigins = stageSkillMap.skillOrigins || {};
      if (tags.origin === null) {
        delete stageSkillMap.skillOrigins[name];
      } else {
        stageSkillMap.skillOrigins[name] = tags.origin;
      }
      await fs.writeFile(stageSkillMapPath, JSON.stringify(stageSkillMap, null, 2), 'utf8');
    }
  } catch (err) {
    console.warn('[skills] updateGlobalTags failed (non-fatal):', err.message);
  }
}

/**
 * Locate SKILL.md inside a zip (root or one level deep).
 * Returns { entry, prefix } where prefix is '' or 'dirname/'.
 */
function findSkillMd(zip) {
  // Check root
  const rootEntry = zip.getEntry('SKILL.md');
  if (rootEntry) return { entry: rootEntry, prefix: '' };

  // Check one level deep
  for (const entry of zip.getEntries()) {
    const parts = entry.entryName.split('/').filter(Boolean);
    if (parts.length === 2 && parts[1] === 'SKILL.md' && entry.isDirectory === false) {
      return { entry, prefix: parts[0] + '/' };
    }
  }
  return null;
}

/**
 * Parse YAML frontmatter from SKILL.md content using gray-matter.
 */
async function parseFrontmatter(content) {
  const matter = (await import('gray-matter')).default;
  const { data, content: body } = matter(content);
  return { data, body };
}

/**
 * Sanitize skill name for use as directory name.
 */
function safeDirName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Validate that a zip buffer contains a valid skill package.
 */
async function validateZipBuffer(buffer) {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(buffer);

  const result = findSkillMd(zip);
  if (!result) {
    return { valid: false, error: 'No SKILL.md found at root or one directory deep.' };
  }

  const content = result.entry.getData().toString('utf8');
  const { data: frontmatter, body } = await parseFrontmatter(content);

  if (!frontmatter || !frontmatter.name) {
    return { valid: false, error: 'SKILL.md must contain YAML frontmatter with a "name" field.' };
  }

  const entries = zip.getEntries();
  const prefix = result.prefix;
  const relevantEntries = prefix
    ? entries.filter(e => e.entryName.startsWith(prefix))
    : entries;
  const fileCount = relevantEntries.filter(e => !e.isDirectory).length;
  const hasPrompts = relevantEntries.some(e => {
    const rel = prefix ? e.entryName.slice(prefix.length) : e.entryName;
    return rel.startsWith('prompts/') || rel.startsWith('prompt/');
  });
  const hasReferences = relevantEntries.some(e => {
    const rel = prefix ? e.entryName.slice(prefix.length) : e.entryName;
    return rel.startsWith('references/') || rel.startsWith('reference/');
  });

  return {
    valid: true,
    skillName: frontmatter.name,
    frontmatter,
    description: body.trim().split('\n')[0] || '',
    fileCount,
    hasPrompts,
    hasReferences,
    prefix,
    zip,
  };
}

// GET /resolve — resolve a skill name to its SKILL.md path and content
router.get('/resolve', async (req, res) => {
  try {
    const { name, workingDir } = req.query;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name query parameter is required' });
    }
    // Prevent path traversal
    if (/[/\\]|\.\./.test(name)) {
      return res.status(400).json({ error: 'Invalid skill name' });
    }
    const effectiveWorkingDir = (typeof workingDir === 'string' && workingDir.trim()) || process.cwd();
    const skillMdPath = await findSkillMdPath(name, effectiveWorkingDir);
    if (!skillMdPath) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    const content = await fs.readFile(skillMdPath, 'utf-8');
    res.json({ path: skillMdPath, content });
  } catch (error) {
    console.error('[skills] resolve error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET / — return the file tree of the global skills/ directory
router.get('/', async (req, res) => {
  try {
    await fs.access(GLOBAL_SKILLS_DIR);

    const { getFileTree } = await import('../file-tree.js').catch(() => ({}));
    // Prefer shared helper when available, but fall back if it throws.
    if (typeof getFileTree === 'function') {
      try {
        const tree = await getFileTree(GLOBAL_SKILLS_DIR, 5, 0, false);
        return res.json(tree);
      } catch (helperError) {
        console.warn('[skills] getFileTree failed, falling back to local walker:', helperError.message);
      }
    }
    // Manual recursive tree building (mirrors getFileTree from index.js)
    async function buildTree(dirPath, maxDepth, depth) {
      const items = [];
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (['node_modules', 'dist', 'build', '.git'].includes(entry.name)) continue;
        const itemPath = path.join(dirPath, entry.name);
        let isDir = entry.isDirectory();
        if (!isDir && entry.isSymbolicLink()) {
          try { isDir = (await fs.stat(itemPath)).isDirectory(); } catch { /* ignore */ }
        }
        const item = { name: entry.name, path: itemPath, type: isDir ? 'directory' : 'file' };
        if (isDir && depth < maxDepth) {
          try {
            item.children = await buildTree(itemPath, maxDepth, depth + 1);
          } catch (childError) {
            console.warn('[skills] Skipping unreadable directory:', itemPath, childError.message);
            item.children = [];
          }
        }
        items.push(item);
      }
      return items;
    }
    const tree = await buildTree(GLOBAL_SKILLS_DIR, 5, 0);
    res.json(tree);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Global skills directory not found' });
    }
    console.error('[ERROR] Skills tree error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /file — read a single file from the global skills/ directory
router.get('/file', async (req, res) => {
  try {
    const { filePath } = req.query;
    if (!filePath) {
      return res.status(400).json({ error: 'filePath is required' });
    }
    const skillsDir = path.resolve(GLOBAL_SKILLS_DIR);
    const resolved = path.resolve(skillsDir, filePath);
    if (!resolved.startsWith(skillsDir + path.sep) && resolved !== skillsDir) {
      return res.status(403).json({ error: 'Path must be under skills root' });
    }
    const content = await fs.readFile(resolved, 'utf8');
    res.json({ content });
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'File not found' });
    } else {
      console.error('[ERROR] Skill file read error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }
});

// PUT /file — write a single file in the global skills/ directory
router.put('/file', async (req, res) => {
  try {
    const { filePath, content } = req.body || {};
    if (!filePath || typeof content !== 'string') {
      return res.status(400).json({ error: 'filePath and content are required' });
    }
    const skillsDir = path.resolve(GLOBAL_SKILLS_DIR);
    const resolved = path.resolve(skillsDir, filePath);
    if (!resolved.startsWith(skillsDir + path.sep) && resolved !== skillsDir) {
      return res.status(403).json({ error: 'Path must be under skills root' });
    }
    await fs.writeFile(resolved, content, 'utf8');
    res.json({ success: true });
  } catch (error) {
    console.error('[ERROR] Skill file write error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /scan-local — scan a local directory for skill subdirectories
router.get('/scan-local', async (req, res) => {
  try {
    const rawPath = req.query.path || '~/.claude/skills';
    const resolvedPath = rawPath.replace(/^~/, os.homedir());
    const absolutePath = path.resolve(resolvedPath);

    // Security: reject forbidden system paths
    const normalizedPath = path.normalize(absolutePath);
    for (const forbidden of FORBIDDEN_PATHS) {
      if (normalizedPath === forbidden || normalizedPath.startsWith(forbidden + path.sep)) {
        return res.status(403).json({ error: `Scanning system directory "${forbidden}" is not allowed.` });
      }
    }

    // Validate the path exists and is a directory
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      return res.status(404).json({ error: `Path does not exist: ${rawPath}` });
    }
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: `Path is not a directory: ${rawPath}` });
    }

    // Scan for subdirectories (1-level deep)
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    const skills = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;

      const skillDir = path.join(absolutePath, entry.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      let hasSkillMd = false;
      try {
        await fs.access(skillMdPath);
        hasSkillMd = true;
      } catch {
        // No SKILL.md
      }

      // Check if already imported in GLOBAL_SKILLS_DIR
      let alreadyImported = false;
      try {
        await fs.access(path.join(GLOBAL_SKILLS_DIR, entry.name));
        alreadyImported = true;
      } catch {
        // Not imported
      }

      skills.push({
        name: entry.name,
        hasSkillMd,
        alreadyImported,
        sourcePath: skillDir,
      });
    }

    res.json({ path: rawPath, resolvedPath: absolutePath, skills });
  } catch (error) {
    console.error('[skills] scan-local error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /import-from-local — copy selected skills from a local directory into GLOBAL_SKILLS_DIR
router.post('/import-from-local', async (req, res) => {
  try {
    const { sourcePath: rawPath, skillNames } = req.body || {};
    const resolvedPath = (rawPath || '~/.claude/skills').replace(/^~/, os.homedir());
    const absolutePath = path.resolve(resolvedPath);

    // Security: reject forbidden system paths
    const normalizedPath = path.normalize(absolutePath);
    for (const forbidden of FORBIDDEN_PATHS) {
      if (normalizedPath === forbidden || normalizedPath.startsWith(forbidden + path.sep)) {
        return res.status(403).json({ error: `Importing from system directory "${forbidden}" is not allowed.` });
      }
    }

    // Validate the path exists and is a directory
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      return res.status(404).json({ error: `Path does not exist: ${rawPath || '~/.claude/skills'}` });
    }
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: `Path is not a directory: ${rawPath || '~/.claude/skills'}` });
    }

    // If skillNames is provided, only import those; otherwise scan all subdirectories
    let dirsToImport = [];
    if (Array.isArray(skillNames) && skillNames.length > 0) {
      for (const name of skillNames) {
        const skillDir = path.join(absolutePath, name);
        try {
          const s = await fs.stat(skillDir);
          if (s.isDirectory()) {
            dirsToImport.push({ name, sourcePath: skillDir });
          }
        } catch {
          // Skip missing
        }
      }
    } else {
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        dirsToImport.push({ name: entry.name, sourcePath: path.join(absolutePath, entry.name) });
      }
    }

    await fs.mkdir(GLOBAL_SKILLS_DIR, { recursive: true });

    const imported = [];
    const skipped = [];
    const errors = [];

    for (const { name, sourcePath: srcDir } of dirsToImport) {
      const destDir = path.join(GLOBAL_SKILLS_DIR, name);
      try {
        // Check if already exists
        try {
          await fs.access(destDir);
          skipped.push(name);
          continue;
        } catch {
          // Does not exist — proceed with copy
        }

        await fs.cp(srcDir, destDir, { recursive: true });

        // Update stage-skill-map.json with origin 'local-import'
        const stageSkillMapPath = path.join(GLOBAL_SKILLS_DIR, 'stage-skill-map.json');
        let stageSkillMap = { skillOrigins: {} };
        try {
          stageSkillMap = JSON.parse(await fs.readFile(stageSkillMapPath, 'utf8'));
        } catch { /* use defaults */ }
        stageSkillMap.skillOrigins = stageSkillMap.skillOrigins || {};
        stageSkillMap.skillOrigins[name] = 'local-import';
        await fs.writeFile(stageSkillMapPath, JSON.stringify(stageSkillMap, null, 2), 'utf8');

        imported.push(name);
      } catch (err) {
        errors.push(`${name}: ${err.message}`);
      }
    }

    res.json({ imported, skipped, errors });
  } catch (error) {
    console.error('[skills] import-from-local error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /:projectName/import-user-skills — import from ~/.claude/skills/ into GLOBAL_SKILLS_DIR then re-sync symlinks
router.post('/:projectName/import-user-skills', async (req, res) => {
  try {
    const projectName = req.params.projectName;
    const projectRoot = await extractProjectDirectory(projectName);
    if (!projectRoot) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    // Resolve ~/.claude/skills/
    const userSkillsDir = path.join(os.homedir(), '.claude', 'skills');
    let stat;
    try {
      stat = await fs.stat(userSkillsDir);
    } catch {
      return res.status(404).json({ error: 'User skills directory not found (~/.claude/skills/).' });
    }
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: '~/.claude/skills/ is not a directory.' });
    }

    // Scan for subdirs containing SKILL.md
    const entries = await fs.readdir(userSkillsDir, { withFileTypes: true });
    await fs.mkdir(GLOBAL_SKILLS_DIR, { recursive: true });

    const imported = [];
    const skipped = [];
    const errors = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      const srcDir = path.join(userSkillsDir, entry.name);

      // Verify SKILL.md exists
      try {
        await fs.access(path.join(srcDir, 'SKILL.md'));
      } catch {
        continue; // Skip dirs without SKILL.md
      }

      const destDir = path.join(GLOBAL_SKILLS_DIR, entry.name);

      try {
        // Check if already exists in global skills
        try {
          await fs.access(destDir);
          skipped.push(entry.name);
          continue;
        } catch {
          // Does not exist — proceed
        }

        await fs.cp(srcDir, destDir, { recursive: true });

        // Parse frontmatter from SKILL.md for tag extraction
        let frontmatter = {};
        try {
          const skillMdContent = await fs.readFile(path.join(srcDir, 'SKILL.md'), 'utf8');
          const parsed = await parseFrontmatter(skillMdContent);
          frontmatter = parsed.data || {};
        } catch { /* ignore parse errors */ }

        // Update skill-tag-mapping.json with tag overrides from frontmatter
        const tagMappingPath = path.join(GLOBAL_SKILLS_DIR, 'skill-tag-mapping.json');
        let tagMapping = { version: 1, stageOverrides: {}, domainOverrides: {}, platformNativeSkills: [], domainCsAiExceptions: [] };
        try {
          tagMapping = JSON.parse(await fs.readFile(tagMappingPath, 'utf8'));
        } catch { /* use defaults */ }
        if (frontmatter.stage) {
          tagMapping.stageOverrides = tagMapping.stageOverrides || {};
          tagMapping.stageOverrides[entry.name] = typeof frontmatter.stage === 'string'
            ? { en: `Stage: ${frontmatter.stage}`, zh: `阶段: ${frontmatter.stage}` }
            : frontmatter.stage;
        }
        if (frontmatter.domain) {
          tagMapping.domainOverrides = tagMapping.domainOverrides || {};
          tagMapping.domainOverrides[entry.name] = typeof frontmatter.domain === 'string'
            ? { en: `Domain: ${frontmatter.domain}`, zh: `领域: ${frontmatter.domain}` }
            : frontmatter.domain;
        }
        await fs.writeFile(tagMappingPath, JSON.stringify(tagMapping, null, 2), 'utf8');

        // Update stage-skill-map.json with origin
        const stageSkillMapPath = path.join(GLOBAL_SKILLS_DIR, 'stage-skill-map.json');
        let stageSkillMap = { skillOrigins: {} };
        try {
          stageSkillMap = JSON.parse(await fs.readFile(stageSkillMapPath, 'utf8'));
        } catch { /* use defaults */ }
        stageSkillMap.skillOrigins = stageSkillMap.skillOrigins || {};
        stageSkillMap.skillOrigins[entry.name] = 'user-import';
        await fs.writeFile(stageSkillMapPath, JSON.stringify(stageSkillMap, null, 2), 'utf8');

        imported.push(entry.name);
      } catch (err) {
        errors.push(`${entry.name}: ${err.message}`);
      }
    }

    // Re-sync symlinks for the requesting project
    if (imported.length > 0) {
      try {
        await ensureProjectSkillLinks(projectRoot);
      } catch (err) {
        console.warn('[skills] ensureProjectSkillLinks after import failed (non-fatal):', err.message);
      }
    }

    res.json({ imported, skipped, errors });
  } catch (error) {
    console.error('[skills] import-user-skills error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /:projectName/validate-skill-zip
router.post('/:projectName/validate-skill-zip', async (req, res) => {
  try {
    const multer = (await import('multer')).default;
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    });

    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: 'Failed to process uploaded file: ' + err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided.' });
      }

      try {
        const result = await validateZipBuffer(req.file.buffer);
        if (!result.valid) {
          return res.status(400).json({ valid: false, error: result.error });
        }

        return res.json({
          valid: true,
          skillName: result.skillName,
          frontmatter: result.frontmatter,
          description: result.description,
          fileCount: result.fileCount,
          hasPrompts: result.hasPrompts,
          hasReferences: result.hasReferences,
        });
      } catch (parseErr) {
        return res.status(400).json({ valid: false, error: 'Failed to parse zip: ' + parseErr.message });
      }
    });
  } catch (error) {
    console.error('[skills] validate-skill-zip error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:projectName/upload-skill
router.post('/:projectName/upload-skill', async (req, res) => {
  try {
    const multer = (await import('multer')).default;
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    });

    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: 'Failed to process uploaded file: ' + err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided.' });
      }

      let extractedDir = null;

      try {
        // Resolve project root
        const projectName = req.params.projectName;
        const projectRoot = await extractProjectDirectory(projectName);
        if (!projectRoot) {
          return res.status(404).json({ error: 'Project not found.' });
        }

        // Validate zip
        const result = await validateZipBuffer(req.file.buffer);
        if (!result.valid) {
          return res.status(400).json({ error: result.error });
        }

        const safeSkillName = safeDirName(result.skillName);
        if (!safeSkillName) {
          return res.status(400).json({ error: 'Invalid skill name.' });
        }

        // Determine skills directory (use skills/ relative to project root)
        const skillsDir = path.join(projectRoot, 'skills');
        await fs.mkdir(skillsDir, { recursive: true });

        extractedDir = path.join(skillsDir, safeSkillName);

        // Check for conflicts
        try {
          await fs.access(extractedDir);
          return res.status(409).json({ error: `Skill directory "${safeSkillName}" already exists.` });
        } catch {
          // Directory doesn't exist — good
        }

        await fs.mkdir(extractedDir, { recursive: true });

        // Extract files with path traversal protection
        const { zip, prefix } = result;
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory) continue;

          let relativePath = entry.entryName;
          if (prefix && relativePath.startsWith(prefix)) {
            relativePath = relativePath.slice(prefix.length);
          } else if (prefix) {
            continue; // Skip files outside the skill directory
          }

          // Path traversal protection
          const resolved = path.resolve(extractedDir, relativePath);
          if (!resolved.startsWith(extractedDir)) {
            continue; // Skip dangerous paths
          }

          const dir = path.dirname(resolved);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(resolved, entry.getData());
        }

        // Parse tags from request body
        let tags = {};
        try {
          if (req.body && req.body.tags) {
            tags = typeof req.body.tags === 'string' ? JSON.parse(req.body.tags) : req.body.tags;
          }
        } catch {
          // Ignore invalid tags JSON
        }

        // Update skill-tag-mapping.json
        const tagMappingPath = path.join(projectRoot, 'skills', 'skill-tag-mapping.json');
        let tagMapping = { version: 1, stageOverrides: {}, domainOverrides: {}, platformNativeSkills: [], domainCsAiExceptions: [] };
        try {
          const raw = await fs.readFile(tagMappingPath, 'utf8');
          tagMapping = JSON.parse(raw);
        } catch {
          // Use defaults
        }

        if (tags.stageOverride) {
          tagMapping.stageOverrides = tagMapping.stageOverrides || {};
          tagMapping.stageOverrides[safeSkillName] = tags.stageOverride;
        }
        if (tags.domainOverride) {
          tagMapping.domainOverrides = tagMapping.domainOverrides || {};
          tagMapping.domainOverrides[safeSkillName] = tags.domainOverride;
        }

        await fs.writeFile(tagMappingPath, JSON.stringify(tagMapping, null, 2), 'utf8');

        // Update stage-skill-map.json with origin
        const stageSkillMapPath = path.join(projectRoot, 'skills', 'stage-skill-map.json');
        let stageSkillMap = { skillOrigins: {} };
        try {
          const raw = await fs.readFile(stageSkillMapPath, 'utf8');
          stageSkillMap = JSON.parse(raw);
        } catch {
          // Use defaults
        }

        stageSkillMap.skillOrigins = stageSkillMap.skillOrigins || {};
        stageSkillMap.skillOrigins[safeSkillName] = tags.origin || 'downloaded';

        await fs.writeFile(stageSkillMapPath, JSON.stringify(stageSkillMap, null, 2), 'utf8');

        // Sync to global skills directory
        await syncSkillToGlobal(safeSkillName, extractedDir, tags);

        return res.json({
          success: true,
          skillName: result.skillName,
          dirName: safeSkillName,
          path: extractedDir,
          frontmatter: result.frontmatter,
        });
      } catch (uploadErr) {
        // Cleanup on failure
        if (extractedDir) {
          try {
            await fs.rm(extractedDir, { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors
          }
        }
        console.error('[skills] upload-skill error:', uploadErr);
        return res.status(500).json({ error: 'Failed to extract skill: ' + uploadErr.message });
      }
    });
  } catch (error) {
    console.error('[skills] upload-skill error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /global-skill — delete a skill from the global GLOBAL_SKILLS_DIR by relative dirPath
router.delete('/global-skill', async (req, res) => {
  try {
    const { dirPath } = req.body || {};
    if (!dirPath || typeof dirPath !== 'string') {
      return res.status(400).json({ error: 'dirPath is required' });
    }
    const skillsDir = path.resolve(GLOBAL_SKILLS_DIR);
    const resolved = path.resolve(skillsDir, dirPath);
    if (!resolved.startsWith(skillsDir + path.sep) && resolved !== skillsDir) {
      return res.status(403).json({ error: 'Path must be under skills root' });
    }
    try {
      const stat = await fs.stat(resolved);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }
    } catch {
      return res.status(404).json({ error: 'Skill directory not found' });
    }
    await fs.rm(resolved, { recursive: true, force: true });

    // Clean config files using the skill folder name
    const skillName = path.basename(resolved);
    const tagMappingPath = path.join(GLOBAL_SKILLS_DIR, 'skill-tag-mapping.json');
    try {
      const tagMapping = JSON.parse(await fs.readFile(tagMappingPath, 'utf8'));
      if (tagMapping.stageOverrides) delete tagMapping.stageOverrides[skillName];
      if (tagMapping.domainOverrides) delete tagMapping.domainOverrides[skillName];
      await fs.writeFile(tagMappingPath, JSON.stringify(tagMapping, null, 2), 'utf8');
    } catch { /* file missing or unparseable */ }

    const stageSkillMapPath = path.join(GLOBAL_SKILLS_DIR, 'stage-skill-map.json');
    try {
      const stageSkillMap = JSON.parse(await fs.readFile(stageSkillMapPath, 'utf8'));
      if (stageSkillMap.skillOrigins) delete stageSkillMap.skillOrigins[skillName];
      await fs.writeFile(stageSkillMapPath, JSON.stringify(stageSkillMap, null, 2), 'utf8');
    } catch { /* file missing or unparseable */ }

    res.json({ success: true, deleted: dirPath });
  } catch (error) {
    console.error('[skills] delete-global-skill error:', error);
    res.status(500).json({ error: 'Failed to delete skill: ' + error.message });
  }
});

// DELETE /:projectName/:skillDirName
router.delete('/:projectName/:skillDirName', async (req, res) => {
  try {
    const { projectName, skillDirName } = req.params;
    const projectRoot = await extractProjectDirectory(projectName);
    if (!projectRoot) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    // Search candidate locations for the skill directory
    const candidateBases = ['skills', '.claude/skills', '.agents/skills', '.cursor/skills'];
    let foundDir = null;
    for (const base of candidateBases) {
      const candidate = path.join(projectRoot, base, skillDirName);
      try {
        const stat = await fs.stat(candidate);
        if (stat.isDirectory()) {
          foundDir = candidate;
          break;
        }
      } catch {
        // Not found in this location
      }
    }

    if (!foundDir) {
      return res.status(404).json({ error: `Skill directory "${skillDirName}" not found.` });
    }

    // Delete the skill directory
    await fs.rm(foundDir, { recursive: true, force: true });

    // Determine the parent skills dir from the found location for config cleanup
    const foundSkillsBase = path.dirname(foundDir);

    // Clean up skill-tag-mapping.json in the skills base where the skill was found
    // Also clean from the legacy skills/ location for backwards compat
    const tagMappingCandidates = [
      path.join(foundSkillsBase, 'skill-tag-mapping.json'),
      path.join(projectRoot, 'skills', 'skill-tag-mapping.json'),
    ];
    for (const tagMappingPath of [...new Set(tagMappingCandidates)]) {
      try {
        const raw = await fs.readFile(tagMappingPath, 'utf8');
        const tagMapping = JSON.parse(raw);
        if (tagMapping.stageOverrides) delete tagMapping.stageOverrides[skillDirName];
        if (tagMapping.domainOverrides) delete tagMapping.domainOverrides[skillDirName];
        await fs.writeFile(tagMappingPath, JSON.stringify(tagMapping, null, 2), 'utf8');
      } catch {
        // Tag mapping file doesn't exist or can't be parsed; skip cleanup
      }
    }

    // Clean up stage-skill-map.json in the skills base + legacy location
    const stageMapCandidates = [
      path.join(foundSkillsBase, 'stage-skill-map.json'),
      path.join(projectRoot, 'skills', 'stage-skill-map.json'),
    ];
    for (const stageSkillMapPath of [...new Set(stageMapCandidates)]) {
      try {
        const raw = await fs.readFile(stageSkillMapPath, 'utf8');
        const stageSkillMap = JSON.parse(raw);
        if (stageSkillMap.skillOrigins) delete stageSkillMap.skillOrigins[skillDirName];
        await fs.writeFile(stageSkillMapPath, JSON.stringify(stageSkillMap, null, 2), 'utf8');
      } catch {
        // Stage-skill-map file doesn't exist or can't be parsed; skip cleanup
      }
    }

    // Remove from global skills directory
    await removeSkillFromGlobal(skillDirName);

    return res.json({ success: true, deleted: skillDirName });
  } catch (error) {
    console.error('[skills] delete-skill error:', error);
    res.status(500).json({ error: 'Failed to delete skill: ' + error.message });
  }
});

export default router;
