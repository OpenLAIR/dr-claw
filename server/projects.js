/**
 * PROJECT DISCOVERY AND MANAGEMENT SYSTEM
 * ========================================
 *
 * This module manages project discovery for both Claude CLI and Cursor CLI sessions.
 *
 * ## Architecture Overview
 *
 * 1. **Claude Projects** (stored in ~/.claude/projects/)
 *    - Each project is a directory named with the project path encoded (/ replaced with -)
 *    - Contains .jsonl files with conversation history including 'cwd' field
 *    - Project metadata stored in ~/.claude/project-config.json
 *
 * 2. **Cursor Projects** (stored in ~/.cursor/chats/)
 *    - Each project directory is named with MD5 hash of the absolute project path
 *    - Example: /Users/john/myproject -> MD5 -> a1b2c3d4e5f6...
 *    - Contains session directories with SQLite databases (store.db)
 *    - Project path is NOT stored in the database - only in the MD5 hash
 *
 * ## Project Discovery Strategy
 *
 * 1. **Claude Projects Discovery**:
 *    - Scan ~/.claude/projects/ directory for Claude project folders
 *    - Extract actual project path from .jsonl files (cwd field)
 *    - Fall back to decoded directory name if no sessions exist
 *
 * 2. **Cursor Sessions Discovery**:
 *    - For each KNOWN project (from Claude or manually added)
 *    - Compute MD5 hash of the project's absolute path
 *    - Check if ~/.cursor/chats/{md5_hash}/ directory exists
 *    - Read session metadata from SQLite store.db files
 *
 * 3. **Manual Project Addition**:
 *    - Users can manually add project paths via UI
 *    - Stored in ~/.claude/project-config.json with 'manuallyAdded' flag
 *    - Allows discovering Cursor sessions for projects without Claude sessions
 *
 * ## Critical Limitations
 *
 * - **CANNOT discover Cursor-only projects**: From a quick check, there was no mention of
 *   the cwd of each project. if someone has the time, you can try to reverse engineer it.
 *
 * - **Project relocation breaks history**: If a project directory is moved or renamed,
 *   the MD5 hash changes, making old Cursor sessions inaccessible unless the old
 *   path is known and manually added.
 *
 * ## Error Handling
 *
 * - Missing ~/.claude directory is handled gracefully with automatic creation
 * - ENOENT errors are caught and handled without crashing
 * - Empty arrays returned when no projects/sessions exist
 *
 * ## Caching Strategy
 *
 * - Project directory extraction is cached to minimize file I/O
 * - Cache is cleared when project configuration changes
 * - Session data is fetched on-demand, not cached
 */

import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import os from 'os';
import { stripInternalContextPrefix } from './utils/sessionFormatting.js';
import {
  extractSessionModeFromMetadata,
  extractSessionModeFromText,
  inferSessionModeFromUserMessage,
  normalizeSessionMode,
  readExplicitSessionModeFromMetadata,
} from './utils/sessionMode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRCLAW_SKILLS_DIR = path.join(__dirname, '..', 'skills');
const PROJECT_SKILL_FOLDERS = ['.claude', '.agents', '.cursor', '.gemini'];
const PROJECT_PIPELINE_FOLDERS = ['Survey', 'Ideation', 'Experiment', 'Publication', 'Promotion'];
const LEGACY_DEFAULT_WORKSPACES_ROOT = path.join(os.homedir(), 'vibelab');
const CURRENT_DEFAULT_WORKSPACES_ROOT = path.join(os.homedir(), 'dr-claw');
const DELETED_PROJECTS_CONFIG_KEY = '_deletedProjects';

let projectConfigMutationQueue = Promise.resolve();
const _lastBootstrapByUser = new Map(); // userId -> timestamp
const BOOTSTRAP_STALENESS_MS = 60_000; // Only re-scan legacy sources every 60 seconds

function isProjectTrashed(projectInfo = null, dbEntry = null) {
  return Boolean(projectInfo?.trash?.trashedAt || dbEntry?.metadata?.trash?.trashedAt);
}

function getSuppressedProjectMetadata(projectName, config = null, projectInfo = null) {
  return projectInfo?.deleted || config?.[DELETED_PROJECTS_CONFIG_KEY]?.[projectName] || null;
}

function isProjectSuppressed(projectName, config = null, projectInfo = null) {
  return Boolean(getSuppressedProjectMetadata(projectName, config, projectInfo)?.deletedAt);
}

function getProjectOwnerUserId(projectInfo = null, dbEntry = null) {
  return dbEntry?.user_id
    ?? projectInfo?.ownerUserId
    ?? projectInfo?.trash?.ownerUserId
    ?? projectInfo?.deleted?.ownerUserId
    ?? null;
}

function getDeletedProjectsStore(config) {
  if (!config[DELETED_PROJECTS_CONFIG_KEY] || typeof config[DELETED_PROJECTS_CONFIG_KEY] !== 'object') {
    config[DELETED_PROJECTS_CONFIG_KEY] = {};
  }

  return config[DELETED_PROJECTS_CONFIG_KEY];
}

function clearDeletedProjectMetadata(config, projectName) {
  if (!config?.[DELETED_PROJECTS_CONFIG_KEY]?.[projectName]) {
    return;
  }

  delete config[DELETED_PROJECTS_CONFIG_KEY][projectName];
  if (Object.keys(config[DELETED_PROJECTS_CONFIG_KEY]).length === 0) {
    delete config[DELETED_PROJECTS_CONFIG_KEY];
  }
}

async function readProjectInstanceId(projectPath) {
  if (!projectPath) {
    return null;
  }

  try {
    const instanceRaw = await fs.readFile(path.join(projectPath, 'instance.json'), 'utf8');
    const instanceData = JSON.parse(instanceRaw);
    return typeof instanceData?.instance_id === 'string' && instanceData.instance_id.trim()
      ? instanceData.instance_id.trim()
      : null;
  } catch (_) {
    return null;
  }
}

async function mutateProjectConfig(mutator) {
  const operation = projectConfigMutationQueue.then(async () => {
    const config = await loadProjectConfig();
    const result = await mutator(config);
    await saveProjectConfig(config);
    return result;
  });

  projectConfigMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function pathExists(targetPath) {
  if (!targetPath) {
    return false;
  }

  try {
    await fs.access(targetPath);
    return true;
  } catch (_) {
    return false;
  }
}

async function bootstrapProjectsIndexFromLegacySources(config, projectDb, userId = null, visibleWorkspaceRoots = []) {
  const candidateProjectNames = new Set(Object.keys(config).filter((key) => !key.startsWith('_')));
  const claudeProjectsRoot = path.join(os.homedir(), '.claude', 'projects');

  try {
    const entries = await fs.readdir(claudeProjectsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        candidateProjectNames.add(entry.name);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[projects] Failed to read Claude projects for bootstrap:', error.message);
    }
  }

  let seededCount = 0;

  for (const projectName of candidateProjectNames) {
    const projectInfo = config[projectName];
    if (isProjectSuppressed(projectName, config, projectInfo)) {
      continue;
    }

    let projectPath = projectInfo?.originalPath || projectInfo?.path || null;
    if (!projectPath) {
      projectPath = await extractProjectDirectory(projectName);
    }
    if (!projectPath) {
      continue;
    }

    const isManuallyAdded = Boolean(projectInfo?.manuallyAdded);
    if (!isManuallyAdded && visibleWorkspaceRoots.length > 0 && !await isPathWithinWorkspaceRoots(projectPath, visibleWorkspaceRoots)) {
      continue;
    }

    const existing = projectDb.getProjectById(projectName);
    const ownerUserId = existing?.user_id ?? getProjectOwnerUserId(projectInfo, existing) ?? userId ?? null;
    const metadata = { ...(existing?.metadata || {}) };

    if (isManuallyAdded) {
      metadata.manuallyAdded = true;
    } else {
      delete metadata.manuallyAdded;
    }

    if (projectInfo?.trash?.trashedAt) {
      metadata.trash = {
        ...projectInfo.trash,
        ownerUserId: projectInfo.trash.ownerUserId ?? ownerUserId,
      };
    }

    projectDb.upsertProject(
      projectName,
      ownerUserId,
      existing?.display_name || projectInfo?.displayName || null,
      projectPath,
      existing?.is_starred || 0,
      existing?.last_accessed || null,
      Object.keys(metadata).length > 0 ? metadata : null,
    );
    seededCount += 1;
  }

  return seededCount;
}

function collectCodexProjectCandidates(sessionsByProject = new Map()) {
  const candidatesByProject = new Map();

  for (const sessions of sessionsByProject.values()) {
    if (!Array.isArray(sessions) || sessions.length === 0) {
      continue;
    }

    const projectPath = sessions.find((session) => typeof session?.cwd === 'string' && session.cwd.trim())?.cwd?.trim();
    if (!projectPath) {
      continue;
    }

    const projectName = encodeProjectPath(projectPath);
    if (!projectName) {
      continue;
    }

    if (!candidatesByProject.has(projectName)) {
      candidatesByProject.set(projectName, {
        projectName,
        projectPath,
        sessions: [],
      });
    }

    const candidate = candidatesByProject.get(projectName);
    const sessionIds = new Set(candidate.sessions.map((session) => session.id));

    for (const session of sessions) {
      if (!session?.id || sessionIds.has(session.id)) {
        continue;
      }

      candidate.sessions.push(session);
      sessionIds.add(session.id);
    }
  }

  return Array.from(candidatesByProject.values());
}

const CODEX_SYNC_COOLDOWN_MS = 30_000;
let lastCodexSyncTimestamp = 0;

async function syncDiscoveredProjectsFromCodexSessions(config, projectDb, userId = null, visibleWorkspaceRoots = []) {
  const now = Date.now();
  if (now - lastCodexSyncTimestamp < CODEX_SYNC_COOLDOWN_MS) {
    return 0;
  }

  const { sessionDb } = await import('./database/db.js');
  const discoveredSessions = await buildCodexSessionsIndex();
  const candidates = collectCodexProjectCandidates(discoveredSessions);
  let syncedProjects = 0;

  for (const candidate of candidates) {
    const { projectName, projectPath, sessions } = candidate;

    if (!projectPath || !await pathExists(projectPath)) {
      continue;
    }

    if (visibleWorkspaceRoots.length > 0 && !await isPathWithinWorkspaceRoots(projectPath, visibleWorkspaceRoots)) {
      continue;
    }

    const projectInfo = config[projectName];
    const existing = projectDb.getProjectById(projectName);
    if (isProjectSuppressed(projectName, config, projectInfo) || isProjectTrashed(projectInfo, existing)) {
      continue;
    }

    const ownerUserId = existing?.user_id ?? getProjectOwnerUserId(projectInfo, existing) ?? userId ?? null;
    const metadata = { ...(existing?.metadata || {}) };

    if (projectInfo?.trash?.trashedAt) {
      metadata.trash = {
        ...projectInfo.trash,
        ownerUserId: projectInfo.trash.ownerUserId ?? ownerUserId,
      };
    }

    projectDb.upsertProject(
      projectName,
      ownerUserId,
      existing?.display_name || projectInfo?.displayName || null,
      projectPath,
      existing?.is_starred || 0,
      existing?.last_accessed || null,
      Object.keys(metadata).length > 0 ? metadata : null,
    );

    for (const session of sessions) {
      sessionDb.upsertSessionFromSource(session.id, projectName, 'codex', {
        displayName: session.summary || session.name || 'Codex Session',
        lastActivity: session.lastActivity || new Date(),
        messageCount: session.messageCount || 0,
        createdAt: session.createdAt || session.lastActivity || new Date(),
        metadata: {
          projectPath,
          sessionMode: normalizeSessionMode(session.mode),
          indexState: 'synced',
        },
      });
    }

    syncedProjects += 1;
  }

  lastCodexSyncTimestamp = Date.now();
  return syncedProjects;
}

function buildTrashEntry(projectName, projectInfo = null, dbEntry = null) {
  const trashMeta = dbEntry?.metadata?.trash || projectInfo?.trash;
  if (!trashMeta?.trashedAt) {
    return null;
  }

  const filesExist = trashMeta.filesExist !== false;

  return {
    name: projectName,
    displayName: dbEntry?.display_name || projectInfo?.displayName || trashMeta.displayName || projectName,
    fullPath: trashMeta.originalPath || dbEntry?.path || projectInfo?.originalPath || '',
    path: trashMeta.originalPath || dbEntry?.path || projectInfo?.originalPath || '',
    originalPath: trashMeta.originalPath || projectInfo?.originalPath || '',
    trashPath: trashMeta.trashPath || dbEntry?.path || '',
    claudeTrashPath: trashMeta.claudeTrashPath || '',
    trashedAt: trashMeta.trashedAt,
    sessionCount:
      typeof trashMeta.sessionCount === 'number'
        ? trashMeta.sessionCount
        : Array.isArray(dbEntry?.metadata?.sessions)
          ? dbEntry.metadata.sessions.length
          : 0,
    canRestore: Boolean(trashMeta.originalPath && filesExist),
    filesExist,
  };
}

function normalizeTaskStatus(status) {
    const raw = String(status || '').trim().toLowerCase();
    if (!raw) return 'pending';
    if (raw === 'completed' || raw === 'complete') return 'done';
    if (raw === 'in_progress' || raw === 'inprogress') return 'in-progress';
    if (raw === 'todo' || raw === 'open') return 'pending';
    return raw;
}

// Import TaskMaster detection functions
async function detectTaskMasterFolder(projectPath) {
    try {
        const pipelinePath = path.join(projectPath, '.pipeline');
        const legacyPath = path.join(projectPath, '.taskmaster');
        let taskMasterPath = pipelinePath;

        const hasPipeline = await fs.access(pipelinePath).then(() => true).catch(() => false);
        if (!hasPipeline) {
            const hasLegacy = await fs.access(legacyPath).then(() => true).catch(() => false);
            if (hasLegacy) {
                await fs.cp(legacyPath, pipelinePath, { recursive: true, force: false });
                taskMasterPath = pipelinePath;
            } else {
                taskMasterPath = pipelinePath;
            }
        }

        // Check if .pipeline directory exists
        try {
            const stats = await fs.stat(taskMasterPath);
            if (!stats.isDirectory()) {
                return {
                    hasTaskmaster: false,
                    reason: '.pipeline exists but is not a directory'
                };
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                return {
                    hasTaskmaster: false,
                    reason: '.pipeline directory not found'
                };
            }
            throw error;
        }

        // Check for key TaskMaster files
        const keyFiles = [
            'tasks/tasks.json',
            'config.json'
        ];

        const fileStatus = {};
        let hasEssentialFiles = true;

        for (const file of keyFiles) {
            const filePath = path.join(taskMasterPath, file);
            try {
                await fs.access(filePath);
                fileStatus[file] = true;
            } catch (error) {
                fileStatus[file] = false;
                if (file === 'tasks/tasks.json') {
                    hasEssentialFiles = false;
                }
            }
        }

        // Parse tasks.json if it exists for metadata
        let taskMetadata = null;
        if (fileStatus['tasks/tasks.json']) {
            try {
                const tasksPath = path.join(taskMasterPath, 'tasks/tasks.json');
                const tasksContent = await fs.readFile(tasksPath, 'utf8');
                const tasksData = JSON.parse(tasksContent);

                // Handle both tagged and legacy formats
                let tasks = [];
                if (tasksData.tasks) {
                    // Legacy format
                    tasks = tasksData.tasks;
                } else {
                    // Tagged format - get tasks from all tags
                    Object.values(tasksData).forEach(tagData => {
                        if (tagData.tasks) {
                            tasks = tasks.concat(tagData.tasks);
                        }
                    });
                }

                // Calculate task statistics
                const stats = tasks.reduce((acc, task) => {
                    const taskStatus = normalizeTaskStatus(task.status);
                    acc.total++;
                    acc[taskStatus] = (acc[taskStatus] || 0) + 1;

                    // Count subtasks
                    if (task.subtasks) {
                        task.subtasks.forEach(subtask => {
                            const subtaskStatus = normalizeTaskStatus(subtask.status);
                            acc.subtotalTasks++;
                            acc.subtasks = acc.subtasks || {};
                            acc.subtasks[subtaskStatus] = (acc.subtasks[subtaskStatus] || 0) + 1;
                        });
                    }

                    return acc;
                }, {
                    total: 0,
                    subtotalTasks: 0,
                    pending: 0,
                    'in-progress': 0,
                    done: 0,
                    review: 0,
                    deferred: 0,
                    cancelled: 0,
                    subtasks: {}
                });

                taskMetadata = {
                    taskCount: stats.total,
                    subtaskCount: stats.subtotalTasks,
                    completed: stats.done || 0,
                    pending: stats.pending || 0,
                    inProgress: stats['in-progress'] || 0,
                    review: stats.review || 0,
                    completionPercentage: stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0,
                    lastModified: (await fs.stat(tasksPath)).mtime.toISOString()
                };
            } catch (parseError) {
                console.warn('Failed to parse tasks.json:', parseError.message);
                taskMetadata = { error: 'Failed to parse tasks.json' };
            }
        }

        return {
            hasTaskmaster: true,
            hasEssentialFiles,
            files: fileStatus,
            metadata: taskMetadata,
            path: taskMasterPath
        };

    } catch (error) {
        console.error('Error detecting TaskMaster folder:', error);
        return {
            hasTaskmaster: false,
            reason: `Error checking directory: ${error.message}`
        };
    }
}

// Cache for extracted project directories
const projectDirectoryCache = new Map();

// Clear cache when needed (called when project files change)
function clearProjectDirectoryCache() {
  projectDirectoryCache.clear();
}

// Load project configuration file
async function loadProjectConfig() {
  const configPath = path.join(os.homedir(), '.claude', 'project-config.json');
  try {
    const configData = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    // Return empty config if file doesn't exist
    return {};
  }
}

async function migrateLegacyDefaultWorkspacesRoot(targetRoot = CURRENT_DEFAULT_WORKSPACES_ROOT) {
  if (targetRoot !== CURRENT_DEFAULT_WORKSPACES_ROOT) {
    return targetRoot;
  }

  const legacyExists = fsSync.existsSync(LEGACY_DEFAULT_WORKSPACES_ROOT);
  const currentExists = fsSync.existsSync(CURRENT_DEFAULT_WORKSPACES_ROOT);

  if (!legacyExists || currentExists) {
    return targetRoot;
  }

  try {
    await fs.rename(LEGACY_DEFAULT_WORKSPACES_ROOT, CURRENT_DEFAULT_WORKSPACES_ROOT);
    return CURRENT_DEFAULT_WORKSPACES_ROOT;
  } catch (error) {
    console.warn('[projects] Failed to migrate legacy default workspace root, using legacy path:', error.message);
    return LEGACY_DEFAULT_WORKSPACES_ROOT;
  }
}

async function resolveConfiguredWorkspacesRoot(configRoot = null) {
  if (!configRoot) {
    return migrateLegacyDefaultWorkspacesRoot();
  }

  if (configRoot === LEGACY_DEFAULT_WORKSPACES_ROOT) {
    return migrateLegacyDefaultWorkspacesRoot();
  }

  return configRoot;
}

async function normalizeWorkspaceRoots(roots) {
  const normalizedRoots = [];

  for (const root of roots) {
    if (!root) continue;

    try {
      const normalizedRoot = await normalizeComparablePath(root);
      if (!normalizedRoots.includes(normalizedRoot)) {
        normalizedRoots.push(normalizedRoot);
      }
    } catch (error) {
      console.warn('[projects] Failed to normalize workspace root:', root, error.message);
    }
  }

  return normalizedRoots;
}

async function getVisibleWorkspaceRoots(configRoot = null) {
  const resolvedRoot = process.env.WORKSPACES_ROOT || await resolveConfiguredWorkspacesRoot(configRoot);
  const candidateRoots = [resolvedRoot];

  const usesDefaultWorkspaceRoot =
    !process.env.WORKSPACES_ROOT &&
    (!configRoot ||
      configRoot === LEGACY_DEFAULT_WORKSPACES_ROOT ||
      configRoot === CURRENT_DEFAULT_WORKSPACES_ROOT ||
      resolvedRoot === LEGACY_DEFAULT_WORKSPACES_ROOT ||
      resolvedRoot === CURRENT_DEFAULT_WORKSPACES_ROOT);

  if (usesDefaultWorkspaceRoot) {
    candidateRoots.push(LEGACY_DEFAULT_WORKSPACES_ROOT);
    candidateRoots.push(CURRENT_DEFAULT_WORKSPACES_ROOT);
  }

  return normalizeWorkspaceRoots(candidateRoots);
}

async function isPathWithinWorkspaceRoots(candidatePath, normalizedRoots) {
  const normalizedPath = await normalizeComparablePath(candidatePath);
  return normalizedRoots.some((root) => normalizedPath === root || normalizedPath.startsWith(root + path.sep));
}

function remapLegacyProjectPath(projectPath) {
  if (!projectPath) return null;

  const normalizedPath = path.resolve(projectPath);
  if (
    normalizedPath !== LEGACY_DEFAULT_WORKSPACES_ROOT &&
    !normalizedPath.startsWith(LEGACY_DEFAULT_WORKSPACES_ROOT + path.sep)
  ) {
    return null;
  }

  return path.join(
    CURRENT_DEFAULT_WORKSPACES_ROOT,
    path.relative(LEGACY_DEFAULT_WORKSPACES_ROOT, normalizedPath)
  );
}

function remapCurrentProjectPathToLegacy(projectPath) {
  if (!projectPath) return null;

  const normalizedPath = path.resolve(projectPath);
  if (
    normalizedPath !== CURRENT_DEFAULT_WORKSPACES_ROOT &&
    !normalizedPath.startsWith(CURRENT_DEFAULT_WORKSPACES_ROOT + path.sep)
  ) {
    return null;
  }

  return path.join(
    LEGACY_DEFAULT_WORKSPACES_ROOT,
    path.relative(CURRENT_DEFAULT_WORKSPACES_ROOT, normalizedPath)
  );
}

async function maybeMigrateLegacyProject(projectName, projectInfo, projectDb) {
  const legacyPath = projectInfo?.originalPath || projectInfo?.path;
  const migratedPath = remapLegacyProjectPath(legacyPath);

  if (!legacyPath || !migratedPath || migratedPath === legacyPath) {
    return null;
  }

  const legacyProjectId = projectName || encodeProjectPath(legacyPath);
  const migratedProjectId = encodeProjectPath(migratedPath);
  const legacyClaudeDir = path.join(os.homedir(), '.claude', 'projects', legacyProjectId);
  const migratedClaudeDir = path.join(os.homedir(), '.claude', 'projects', migratedProjectId);

  let legacyExists = false;
  let migratedExists = false;

  try {
    await fs.access(legacyPath);
    legacyExists = true;
  } catch (_) {}

  try {
    await fs.access(migratedPath);
    migratedExists = true;
  } catch (_) {}

  if (legacyExists && !migratedExists) {
    try {
      await fs.mkdir(path.dirname(migratedPath), { recursive: true });
      await fs.rename(legacyPath, migratedPath);
      migratedExists = true;
      legacyExists = false;
    } catch (error) {
      console.warn('[projects] Failed to move legacy project directory:', legacyPath, '->', migratedPath, error.message);
      return null;
    }
  }

  if (!migratedExists) {
    return null;
  }

  try {
    await fs.access(legacyClaudeDir);
    try {
      await fs.access(migratedClaudeDir);
    } catch (_) {
      await fs.rename(legacyClaudeDir, migratedClaudeDir);
    }
  } catch (_) {}

  if (projectDb && legacyProjectId !== migratedProjectId) {
    const existingMigratedProject = projectDb.getProjectById(migratedProjectId);
    if (!existingMigratedProject) {
      const existingLegacyProject = projectDb.getProjectById(legacyProjectId);
      if (existingLegacyProject) {
        projectDb.migrateProjectIdentity(legacyProjectId, migratedProjectId, migratedPath);
      }
    }
  } else if (projectDb) {
    projectDb.updateProjectPath(migratedProjectId, migratedPath);
  }

  return {
    oldId: legacyProjectId,
    newId: migratedProjectId,
    oldPath: legacyPath,
    newPath: migratedPath
  };
}

async function migrateLegacyProjects(config, projectDb) {
  let configDirty = false;

  for (const [projectName, projectInfo] of Object.entries(config)) {
    if (projectName.startsWith('_') || !projectInfo?.originalPath) {
      continue;
    }

    const migration = await maybeMigrateLegacyProject(projectName, projectInfo, projectDb);
    if (!migration) {
      continue;
    }

    const nextProjectInfo = {
      ...projectInfo,
      originalPath: migration.newPath
    };

    if (migration.oldId !== migration.newId) {
      if (!config[migration.newId]) {
        config[migration.newId] = nextProjectInfo;
      }
      delete config[projectName];
    } else {
      config[projectName] = nextProjectInfo;
    }
    configDirty = true;
  }

  if (configDirty) {
    await saveProjectConfig(config);
    clearProjectDirectoryCache();
  }

  return configDirty;
}

// Save project configuration file
async function saveProjectConfig(config) {
  const claudeDir = path.join(os.homedir(), '.claude');
  const configPath = path.join(claudeDir, 'project-config.json');

  // Ensure the .claude directory exists
  try {
    await fs.mkdir(claudeDir, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

export function encodeProjectPath(projectPath) {
  return path.resolve(projectPath).replace(/[\\/:\s~_.]/g, '-');
}

// Generate better display name from path
async function generateDisplayName(projectName, actualProjectDir = null) {
  // Use actual project directory if provided, otherwise decode from project name
  let projectPath = actualProjectDir || projectName.replace(/-/g, '/');

  // Try to read package.json from the project path
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageData = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageData);

    // Return the name from package.json if it exists
    if (packageJson.name) {
      return packageJson.name;
    }
  } catch (error) {
    // Fall back to path-based naming if package.json doesn't exist or can't be read
  }

  // If it starts with /, it's an absolute path
  if (projectPath.startsWith('/')) {
    const parts = projectPath.split('/').filter(Boolean);
    // Return only the last folder name
    return parts[parts.length - 1] || projectPath;
  }

  return projectPath;
}

// Extract the actual project directory from JSONL sessions (with caching)
async function extractProjectDirectory(projectName) {
  // Check cache first
  if (projectDirectoryCache.has(projectName)) {
    return projectDirectoryCache.get(projectName);
  }

  // Check project config for originalPath (manually added projects via UI or platform)
  // This handles projects with dashes in their directory names correctly
  const config = await loadProjectConfig();
  if (config[projectName]?.originalPath) {
    const originalPath = config[projectName].originalPath;
    projectDirectoryCache.set(projectName, originalPath);
    return originalPath;
  }

  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);
  const cwdCounts = new Map();
  let latestTimestamp = 0;
  let latestCwd = null;
  let extractedPath;

  try {
    // Check if the project directory exists
    await fs.access(projectDir);

    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) {
      // Fall back to decoded project name if no sessions, but never to '/'
      const decoded = projectName.replace(/-/g, '/');
      extractedPath = decoded === '/' ? os.homedir() : decoded;
    } else {
      // Process all JSONL files to collect cwd values
      for (const file of jsonlFiles) {
        const jsonlFile = path.join(projectDir, file);
        const fileStream = fsSync.createReadStream(jsonlFile);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });

        for await (const line of rl) {
          if (line.trim()) {
            try {
              const entry = JSON.parse(line);

              if (entry.cwd) {
                // Count occurrences of each cwd
                cwdCounts.set(entry.cwd, (cwdCounts.get(entry.cwd) || 0) + 1);

                // Track the most recent cwd
                const timestamp = new Date(entry.timestamp || 0).getTime();
                if (timestamp > latestTimestamp) {
                  latestTimestamp = timestamp;
                  latestCwd = entry.cwd;
                }
              }
            } catch (parseError) {
              // Skip malformed lines
            }
          }
        }
      }

      // Determine the best cwd to use
      if (cwdCounts.size === 0) {
        // No cwd found, fall back to decoded project name, but never to '/'
        const decoded = projectName.replace(/-/g, '/');
        extractedPath = decoded === '/' ? os.homedir() : decoded;
      } else if (cwdCounts.size === 1) {
        // Only one cwd, use it
        extractedPath = Array.from(cwdCounts.keys())[0];
      } else {
        // Multiple cwd values - prefer the most recent one if it has reasonable usage
        const mostRecentCount = cwdCounts.get(latestCwd) || 0;
        const maxCount = Math.max(...cwdCounts.values());

        // Use most recent if it has at least 25% of the max count
        if (mostRecentCount >= maxCount * 0.25) {
          extractedPath = latestCwd;
        } else {
          // Otherwise use the most frequently used cwd
          for (const [cwd, count] of cwdCounts.entries()) {
            if (count === maxCount) {
              extractedPath = cwd;
              break;
            }
          }
        }

        // Fallback (shouldn't reach here)
        if (!extractedPath) {
          const decoded = projectName.replace(/-/g, '/');
          extractedPath = latestCwd || (decoded === '/' ? os.homedir() : decoded);
        }
      }
    }

    // Cache the result
    projectDirectoryCache.set(projectName, extractedPath);

    return extractedPath;

  } catch (error) {
    // If the directory doesn't exist, just use the decoded project name
    if (error.code === 'ENOENT') {
      const decoded = projectName.replace(/-/g, '/');
      extractedPath = decoded === '/' ? os.homedir() : decoded;
    } else {
      console.error(`Error extracting project directory for ${projectName}:`, error);
      // Fall back to decoded project name for other errors, but never to '/'
      const decoded = projectName.replace(/-/g, '/');
      extractedPath = decoded === '/' ? os.homedir() : decoded;
    }

    // Cache the fallback result too
    projectDirectoryCache.set(projectName, extractedPath);

    return extractedPath;
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function mapIndexedSessionToProjectSession(session, provider) {
  const metadata = session?.metadata && typeof session.metadata === 'object' ? session.metadata : {};
  const mode = extractSessionModeFromMetadata(metadata);
  const lastActivity = session?.last_activity || session?.lastActivity || session?.created_at || session?.createdAt || null;
  const createdAt = session?.created_at || session?.createdAt || lastActivity;
  const messageCount = Number(session?.message_count ?? session?.messageCount ?? 0);
  const baseName = session?.display_name || session?.name || session?.summary || null;
  const tags = Array.isArray(session?.tags) ? session.tags : [];

  if (provider === 'cursor') {
    return {
      id: session.id,
      name: baseName || 'Untitled Session',
      createdAt,
      lastActivity,
      messageCount,
      mode,
      tags,
      __provider: 'cursor',
    };
  }

  if (provider === 'codex') {
    return {
      id: session.id,
      summary: baseName || 'Codex Session',
      name: baseName || 'Codex Session',
      createdAt,
      lastActivity,
      messageCount,
      mode,
      tags,
      __provider: 'codex',
    };
  }

  if (provider === 'gemini') {
    return {
      id: session.id,
      summary: baseName || 'Gemini Session',
      name: baseName || 'Gemini Session',
      createdAt,
      lastActivity,
      messageCount,
      mode,
      tags,
      __provider: 'gemini',
    };
  }

  if (provider === 'openrouter') {
    return {
      id: session.id,
      summary: baseName || 'OpenRouter Session',
      name: baseName || 'OpenRouter Session',
      createdAt,
      lastActivity,
      messageCount,
      mode,
      tags,
      __provider: 'openrouter',
    };
  }

  return {
    id: session.id,
    summary: baseName || 'New Session',
    createdAt,
    lastActivity,
    messageCount,
    mode,
    tags,
    __provider: 'claude',
  };
}

function getSessionPlaceholderName(provider) {
  switch (provider) {
    case 'cursor':
      return 'Untitled Session';
    case 'codex':
      return 'Codex Session';
    case 'gemini':
      return 'Gemini Session';
    case 'openrouter':
      return 'OpenRouter Session';
    default:
      return 'New Session';
  }
}

function isPlaceholderSessionName(provider, displayName) {
  return String(displayName || '').trim() === getSessionPlaceholderName(provider);
}

async function shouldRefreshIndexedSession(provider, indexedSession, parsedSession) {
  if (!parsedSession) {
    return false;
  }

  if (!indexedSession) {
    return true;
  }

  const indexedName = String(indexedSession.display_name || indexedSession.name || indexedSession.summary || '').trim();
  const parsedName = String(parsedSession.summary || parsedSession.name || '').trim();
  if (parsedName && indexedName !== parsedName) {
    return true;
  }

  const indexedCount = Number(indexedSession.message_count ?? indexedSession.messageCount ?? 0);
  const parsedCount = Number(parsedSession.messageCount ?? 0);
  if (parsedCount > indexedCount) {
    return true;
  }

  const { normalizeSessionTimestamp } = await import('./database/db.js');
  const indexedLastActivity = normalizeSessionTimestamp(indexedSession.last_activity || indexedSession.lastActivity);
  const parsedLastActivity = normalizeSessionTimestamp(parsedSession.lastActivity);
  if (parsedLastActivity && parsedLastActivity !== indexedLastActivity) {
    return true;
  }

  const indexedMode = extractSessionModeFromMetadata(indexedSession.metadata);
  const parsedMode = normalizeSessionMode(parsedSession.mode);
  if (indexedMode !== parsedMode) {
    return true;
  }

  return isPlaceholderSessionName(provider, indexedName) && Boolean(parsedName);
}

async function reconcileIndexedSessionFromSource(projectName, provider, parsedSession, indexedSession = null, projectPath = null) {
  const { sessionDb, normalizeSessionTimestamp } = await import('./database/db.js');

  const resolvedProjectPath =
    projectPath ||
    parsedSession.projectPath ||
    parsedSession.cwd ||
    indexedSession?.metadata?.projectPath ||
    await extractProjectDirectory(projectName).catch(() => null);
  const metadata = {
    ...(indexedSession?.metadata && typeof indexedSession.metadata === 'object' ? indexedSession.metadata : {}),
    sessionMode: normalizeSessionMode(parsedSession.mode),
    indexState: 'synced',
  };
  if (resolvedProjectPath) {
    metadata.projectPath = resolvedProjectPath;
  }

  sessionDb.upsertSessionFromSource(parsedSession.id, projectName, provider, {
    displayName: parsedSession.summary || parsedSession.name || null,
    lastActivity: normalizeSessionTimestamp(parsedSession.lastActivity),
    messageCount: Number(parsedSession.messageCount || 0),
    metadata,
    createdAt: parsedSession.createdAt || indexedSession?.created_at || null,
    isStarred: indexedSession?.is_starred ?? 0,
  });
}

async function reconcileClaudeSessionIndex(projectName, targetSessionId = null) {
  if (targetSessionId) {
    const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);
    const sessionFile = path.join(projectDir, `${targetSessionId}.jsonl`);
    const { sessionDb } = await import('./database/db.js');

    try {
      await fs.access(sessionFile);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { sessions: [], hasMore: false, total: 0, session: null };
      }
      throw error;
    }

    const dbSessions = sessionDb.getSessionsByProject(projectName);
    const dbSessionMap = new Map(dbSessions.filter((session) => session.provider === 'claude').map((session) => [session.id, session]));
    const projectPath = await extractProjectDirectory(projectName).catch(() => null);
    const result = await parseJsonlSessions(sessionFile, projectName, dbSessionMap);
    const session = (result.sessions || []).find((item) => item.id === targetSessionId) || null;

    if (session) {
      const indexedSession = dbSessionMap.get(session.id) || null;
      if (await shouldRefreshIndexedSession('claude', indexedSession, session)) {
        await reconcileIndexedSessionFromSource(projectName, 'claude', session, indexedSession, projectPath);
      }
    }

    return {
      sessions: session ? [session] : [],
      hasMore: false,
      total: session ? 1 : 0,
      session,
    };
  }

  return getSessions(projectName, 0, 0);
}

async function reconcileGeminiSessionIndex(projectPath, options = {}) {
  const { limit = 0, sessionId = null, projectName = null } = options;
  return getGeminiSessions(projectPath, {
    limit,
    syncIndex: true,
    sessionId,
    projectName,
  });
}

async function reconcileOpenRouterSessionIndex(projectPath, options = {}) {
  const { sessionId = null, projectName = null } = options;
  if (!sessionId) return;
  const resolvedProjectName = projectName || encodeProjectPath(projectPath);
  const sessionFile = path.join(os.homedir(), '.dr-claw', 'openrouter-sessions', `${sessionId}.jsonl`);
  try {
    const raw = await fs.readFile(sessionFile, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    let displayName = null;
    let messageCount = 0;
    let lastActivity = null;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.role === 'user' && !displayName) {
          const raw = (entry.content || '').replace(/\s*\[Context:[^\]]*\]\s*/gi, '').trim();
          displayName = raw.slice(0, 100) || null;
        }
        if (entry.role === 'user' || entry.role === 'assistant') {
          messageCount++;
        }
        if (entry.ts) lastActivity = entry.ts;
      } catch {}
    }
    const { sessionDb } = await import('./database/db.js');
    sessionDb.upsertSession(
      sessionId,
      resolvedProjectName,
      'openrouter',
      displayName || 'OpenRouter Session',
      lastActivity || new Date().toISOString(),
      messageCount,
      null,
    );
  } catch (err) {
    console.warn(`[OpenRouter] Failed to reconcile session ${sessionId}:`, err.message);
  }
}

async function reconcileLocalGPUSessionIndex(projectPath, options = {}) {
  const { sessionId = null, projectName = null } = options;
  if (!sessionId) return;
  const resolvedProjectName = projectName || encodeProjectPath(projectPath);
  const sessionFile = path.join(os.homedir(), '.dr-claw', 'localgpu-sessions', `${sessionId}.jsonl`);
  try {
    const raw = await fs.readFile(sessionFile, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    let displayName = null;
    let messageCount = 0;
    let lastActivity = null;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.role === 'user' && !displayName) {
          const raw = (entry.content || '').replace(/\s*\[Context:[^\]]*\]\s*/gi, '').trim();
          displayName = raw.slice(0, 100) || null;
        }
        if (entry.role === 'user' || entry.role === 'assistant') {
          messageCount++;
        }
        if (entry.ts) lastActivity = entry.ts;
      } catch {}
    }
    const { sessionDb } = await import('./database/db.js');
    sessionDb.upsertSession(
      sessionId,
      resolvedProjectName,
      'local',
      displayName || 'Local GPU Session',
      lastActivity || new Date().toISOString(),
      messageCount,
      null,
    );
  } catch (err) {
    console.warn(`[LocalGPU] Failed to reconcile session ${sessionId}:`, err.message);
  }
}

async function reconcileCodexSessionIndex(projectPath, options = {}) {
  const { limit = 0, sessionId = null, previousSessionId = null, projectName = null } = options;
  const sessions = await getCodexSessions(projectPath, {
    limit,
    syncIndex: true,
    sessionId,
    projectName,
  });

  if (previousSessionId && sessionId && previousSessionId !== sessionId) {
    const { sessionDb } = await import('./database/db.js');
    sessionDb.migrateSessionId(previousSessionId, sessionId, 'codex', projectName || encodeProjectPath(projectPath));
  }

  return sessions;
}

async function getProjects(userId, progressCallback = null) {
  const { projectDb, sessionDb } = await import('./database/db.js');
  const config = await loadProjectConfig();
  const projects = [];

  await migrateLegacyProjects(config, projectDb);

  const visibleWorkspaceRoots = await getVisibleWorkspaceRoots(config._workspacesRoot || null);
  let totalProjects = 0;
  let processedProjects = 0;

  // Sync from legacy sources so CLI-created projects appear in the web UI.
  // Only re-scan if the last bootstrap was more than 60 seconds ago to avoid
  // O(N) filesystem walks on every getProjects() call. See #86.
  const now = Date.now();
  const userKey = userId || '__anonymous__';
  if (now - (_lastBootstrapByUser.get(userKey) || 0) > BOOTSTRAP_STALENESS_MS) {
    await bootstrapProjectsIndexFromLegacySources(
      config,
      projectDb,
      userId || null,
      visibleWorkspaceRoots,
    );
    _lastBootstrapByUser.set(userKey, now);
  }
  await syncDiscoveredProjectsFromCodexSessions(config, projectDb, userId || null, visibleWorkspaceRoots);
  const dbProjects = projectDb.getAllProjects(userId || null);

  try {
    const visibleProjects = [];
    for (const dbEntry of dbProjects) {
      const projectInfo = config[dbEntry.id];
      if (isProjectTrashed(projectInfo, dbEntry) || isProjectSuppressed(dbEntry.id, config, projectInfo)) {
        continue;
      }

      const projectPath = dbEntry.path || projectInfo?.originalPath || null;
      if (!projectPath) {
        continue;
      }

      const isManuallyAdded = Boolean(dbEntry.metadata?.manuallyAdded || projectInfo?.manuallyAdded);
      if (!isManuallyAdded && !await isPathWithinWorkspaceRoots(projectPath, visibleWorkspaceRoots)) {
        console.log(`[projects] Skipping external DB project: ${dbEntry.id} at ${projectPath}`);
        continue;
      }

      visibleProjects.push({
        entry: { name: dbEntry.id },
        actualProjectDir: projectPath,
        dbEntry,
      });
    }

    const projectNames = visibleProjects.map(({ entry }) => entry.name);
    const indexedSessions = sessionDb.getSessionsByProjects(projectNames);
    const sessionsByProject = new Map();

    for (const session of indexedSessions) {
      if (!sessionsByProject.has(session.project_name)) {
        sessionsByProject.set(session.project_name, []);
      }
      sessionsByProject.get(session.project_name).push(session);
    }

    totalProjects = visibleProjects.length;

    const hydratedProjects = await mapWithConcurrency(visibleProjects, 6, async ({ entry, actualProjectDir, dbEntry }) => {
      processedProjects++;

      if (progressCallback) {
        progressCallback({ phase: 'loading', current: processedProjects, total: totalProjects, currentProject: entry.name });
      }

      const projectInfo = config[entry.name];
      const displayName = dbEntry?.display_name || projectInfo?.displayName || await generateDisplayName(entry.name, actualProjectDir);

      let dirCreatedAt = dbEntry?.created_at;
      if (!dirCreatedAt) {
        try {
          const dirStat = await fs.stat(actualProjectDir);
          dirCreatedAt = dirStat.birthtime.toISOString();
        } catch (_) {}
      }

      const project = {
        name: entry.name,
        path: actualProjectDir,
        displayName,
        fullPath: actualProjectDir,
        isCustomName: !!(dbEntry?.display_name || projectInfo?.displayName),
        createdAt: dirCreatedAt,
        isStarred: !!dbEntry?.is_starred,
        sessions: [],
        sessionMeta: { hasMore: false, total: 0 }
      };

      const projectSessions = sessionsByProject.get(entry.name) || [];
      const claudeSessions = projectSessions.filter((session) => session.provider === 'claude');
      const cursorSessions = projectSessions.filter((session) => session.provider === 'cursor');
      const codexSessions = projectSessions.filter((session) => session.provider === 'codex');
      const geminiSessions = projectSessions.filter((session) => session.provider === 'gemini');
      const openrouterSessions = projectSessions.filter((session) => session.provider === 'openrouter');
      const localSessions = projectSessions.filter((session) => session.provider === 'local');

      project.sessions = claudeSessions.slice(0, 5).map((session) => mapIndexedSessionToProjectSession(session, 'claude'));
      project.sessionMeta = {
        total: claudeSessions.length,
        hasMore: claudeSessions.length > 5,
      };
      project.cursorSessions = cursorSessions.slice(0, 5).map((session) => mapIndexedSessionToProjectSession(session, 'cursor'));
      project.codexSessions = codexSessions.slice(0, 5).map((session) => mapIndexedSessionToProjectSession(session, 'codex'));
      project.geminiSessions = geminiSessions.slice(0, 5).map((session) => mapIndexedSessionToProjectSession(session, 'gemini'));
      project.openrouterSessions = openrouterSessions.slice(0, 5).map((session) => mapIndexedSessionToProjectSession(session, 'openrouter'));
      project.localSessions = localSessions.slice(0, 5).map((session) => mapIndexedSessionToProjectSession(session, 'local'));

      const taskmasterResult = await detectTaskMasterFolder(actualProjectDir).catch(() => null);

      if (taskmasterResult) {
        const tm = taskmasterResult;
        project.taskmaster = {
          hasTaskmaster: tm.hasTaskmaster,
          hasEssentialFiles: tm.hasEssentialFiles,
          metadata: tm.metadata,
          status: tm.hasTaskmaster && tm.hasEssentialFiles ? 'configured' : 'not-configured'
        };
        project.pipeline = project.taskmaster;
      }

      return project;
    });

    projects.push(...hydratedProjects.filter(Boolean));
  } catch (error) {
    console.error('Error reading projects from database:', error);
  }

  return projects;
}

async function getTrashedProjects(userId = null) {
  const { projectDb } = await import('./database/db.js');
  const config = await loadProjectConfig();
  const allDbProjects = projectDb.getAllProjects();
  const dbProjectMap = new Map(allDbProjects.map((entry) => [entry.id, entry]));
  const allProjectNames = new Set([
    ...Object.keys(config).filter((key) => !key.startsWith('_')),
    ...allDbProjects.map((entry) => entry.id),
  ]);

  const trashEntries = [];

  for (const projectName of allProjectNames) {
    const projectInfo = config[projectName];
    const dbEntry = dbProjectMap.get(projectName);

    if (!isProjectTrashed(projectInfo, dbEntry)) {
      continue;
    }

    const ownerUserId = getProjectOwnerUserId(projectInfo, dbEntry);
    if (userId && ownerUserId !== userId) {
      continue;
    }

    const trashEntry = buildTrashEntry(projectName, projectInfo, dbEntry);
    if (trashEntry) {
      trashEntries.push(trashEntry);
    }
  }

  return trashEntries.sort(
    (left, right) => new Date(right.trashedAt).getTime() - new Date(left.trashedAt).getTime(),
  );
}

async function getSessions(projectName, limit = 5, offset = 0, userId = null) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);
  const { sessionDb } = await import('./database/db.js');

  try {
    // Check if the project directory exists before trying to read it
    try {
      await fs.access(projectDir);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // No Claude sessions for this project yet, which is fine for manual projects
        return { sessions: [], hasMore: false, total: 0 };
      }
      throw err;
    }

    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));

    if (jsonlFiles.length === 0) {
      return { sessions: [], hasMore: false, total: 0 };
    }

    // Fetch indexed sessions from database - filter by userId?
    // Usually sessions inherit project ownership, but we store it anyway.
    const dbSessions = sessionDb.getSessionsByProject(projectName);
    const dbSessionMap = new Map(dbSessions.filter(s => s.provider === 'claude').map(s => [s.id, s]));
    const projectPath = await extractProjectDirectory(projectName).catch(() => null);

    // ... (rest of getSessions remains mostly same, but ensures it uses the DB map correctly)


    // Sort files by modification time (newest first)
    const filesWithStats = await Promise.all(
      jsonlFiles.map(async (file) => {
        const filePath = path.join(projectDir, file);
        const stats = await fs.stat(filePath);
        return { file, mtime: stats.mtime };
      })
    );
    filesWithStats.sort((a, b) => b.mtime - a.mtime);

    const allSessions = new Map();
    const allEntries = [];
    const uuidToSessionMap = new Map();

    // Collect all sessions and entries from all files
    for (const { file } of filesWithStats) {
      const jsonlFile = path.join(projectDir, file);
      const result = await parseJsonlSessions(jsonlFile, projectName, dbSessionMap);

      result.sessions.forEach(session => {
        if (!allSessions.has(session.id)) {
          allSessions.set(session.id, session);
        }
      });

      allEntries.push(...result.entries);

      // Early exit optimization for large projects
      if (allSessions.size >= (limit + offset) * 2 && allEntries.length >= Math.min(3, filesWithStats.length)) {
        break;
      }
    }

    // Build UUID-to-session mapping for timeline detection
    allEntries.forEach(entry => {
      if (entry.uuid && entry.sessionId) {
        uuidToSessionMap.set(entry.uuid, entry.sessionId);
      }
    });

    // Group sessions by first user message ID
    const sessionGroups = new Map(); // firstUserMsgId -> { latestSession, allSessions[] }
    const sessionToFirstUserMsgId = new Map(); // sessionId -> firstUserMsgId

    // Find the first user message for each session
    allEntries.forEach(entry => {
      if (entry.sessionId && entry.type === 'user' && entry.parentUuid === null && entry.uuid) {
        // This is a first user message in a session (parentUuid is null)
        const firstUserMsgId = entry.uuid;

        if (!sessionToFirstUserMsgId.has(entry.sessionId)) {
          sessionToFirstUserMsgId.set(entry.sessionId, firstUserMsgId);

          const session = allSessions.get(entry.sessionId);
          if (session) {
            if (!sessionGroups.has(firstUserMsgId)) {
              sessionGroups.set(firstUserMsgId, {
                latestSession: session,
                allSessions: [session]
              });
            } else {
              const group = sessionGroups.get(firstUserMsgId);
              group.allSessions.push(session);

              // Update latest session if this one is more recent
              if (new Date(session.lastActivity) > new Date(group.latestSession.lastActivity)) {
                group.latestSession = session;
              }
            }
          }
        }
      }
    });

    // Collect all sessions that don't belong to any group (standalone sessions)
    const groupedSessionIds = new Set();
    sessionGroups.forEach(group => {
      group.allSessions.forEach(session => groupedSessionIds.add(session.id));
    });

    const standaloneSessionsArray = Array.from(allSessions.values())
      .filter(session => !groupedSessionIds.has(session.id));

    // Combine grouped sessions (only show latest from each group) + standalone sessions
    const latestFromGroups = Array.from(sessionGroups.values()).map(group => {
      const session = { ...group.latestSession };
      // Add metadata about grouping
      if (group.allSessions.length > 1) {
        session.isGrouped = true;
        session.groupSize = group.allSessions.length;
        session.groupSessions = group.allSessions.map(s => s.id);
      }
      return session;
    });
    const visibleSessions = [...latestFromGroups, ...standaloneSessionsArray]
      .filter(session => !session.summary.startsWith('{ "'))
      .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

    await Promise.all(
      visibleSessions.map(async (session) => {
        const indexedSession = dbSessionMap.get(session.id) || null;
        if (!await shouldRefreshIndexedSession('claude', indexedSession, session)) {
          return;
        }

        await reconcileIndexedSessionFromSource(projectName, 'claude', session, indexedSession, projectPath);
      })
    );

    const total = visibleSessions.length;
    const paginatedSessions = limit > 0 ? visibleSessions.slice(offset, offset + limit) : visibleSessions.slice(offset);
    const hasMore = limit > 0 ? offset + limit < total : false;

    return {
      sessions: paginatedSessions,
      hasMore,
      total,
      offset,
      limit
    };
  } catch (error) {
    console.error(`Error reading sessions for project ${projectName}:`, error);
    return { sessions: [], hasMore: false, total: 0 };
  }
}

async function parseJsonlSessions(filePath, projectName = null, dbSessionMap = null) {
  const sessions = new Map();
  const entries = [];
  const pendingSummaries = new Map(); // leafUuid -> summary for entries without sessionId

  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);
          entries.push(entry);

          // Handle summary entries that don't have sessionId yet
          if (entry.type === 'summary' && entry.summary && !entry.sessionId && entry.leafUuid) {
            pendingSummaries.set(entry.leafUuid, entry.summary);
          }

          if (entry.sessionId) {
            if (!sessions.has(entry.sessionId)) {
              // Priority: 1. DB name, 2. Default
              let initialSummary = 'New Session';
              if (dbSessionMap && dbSessionMap.has(entry.sessionId)) {
                initialSummary = dbSessionMap.get(entry.sessionId).display_name;
              }

              sessions.set(entry.sessionId, {
                id: entry.sessionId,
                summary: initialSummary,
                messageCount: 0,
                lastActivity: new Date(),
                cwd: entry.cwd || '',
                lastUserMessage: null,
                lastAssistantMessage: null,
                mode: dbSessionMap && dbSessionMap.has(entry.sessionId)
                  ? (readExplicitSessionModeFromMetadata(dbSessionMap.get(entry.sessionId).metadata) || 'research')
                  : 'research',
                tags: dbSessionMap && dbSessionMap.has(entry.sessionId)
                  ? (Array.isArray(dbSessionMap.get(entry.sessionId).tags) ? dbSessionMap.get(entry.sessionId).tags : [])
                  : []
              });
            }

            const session = sessions.get(entry.sessionId);

            // If we have a DB name, we might skip the logic to overwrite it with "New Session" file logs,
            // but we still want to update it if the file has a LATEST summary entry that might be newer.
            // For now, manual DB renames should take precedence if they are different from 'New Session'

            // Apply pending summary if this entry has a parentUuid that matches a pending summary
            if (session.summary === 'New Session' && entry.parentUuid && pendingSummaries.has(entry.parentUuid)) {
              session.summary = pendingSummaries.get(entry.parentUuid);
            }

            // Update summary from summary entries with sessionId - always take the LATEST in the file
            if (entry.type === 'summary' && entry.summary) {
              session.summary = stripInternalContextPrefix(entry.summary);
            }

            // Track last user and assistant messages (skip system messages)
            if (entry.message?.role === 'user' && entry.message?.content) {
              const content = entry.message.content;

              // Extract text from all text parts if it's an array
              let textContent = '';
              if (Array.isArray(content)) {
                textContent = content
                  .filter(part => part.type === 'text')
                  .map(part => part.text)
                  .join(' ');
              } else if (typeof content === 'string') {
                textContent = content;
              }

              const isSystemMessage = typeof textContent === 'string' && (
                textContent.startsWith('<command-name>') ||
                textContent.startsWith('<command-message>') ||
                textContent.startsWith('<command-args>') ||
                textContent.startsWith('<local-command-stdout>') ||
                textContent.startsWith('<system-reminder>') ||
                textContent.startsWith('Caveat:') ||
                textContent.startsWith('This session is being continued from a previous') ||
                textContent.startsWith('Invalid API key') ||
                textContent.includes('{"subtasks":') || // Filter Task Master prompts
                textContent.includes('CRITICAL: You MUST respond with ONLY a JSON') || // Filter Task Master system prompts
                textContent === 'Warmup' // Explicitly filter out "Warmup"
              );

              const modeFromMessage = typeof textContent === 'string'
                ? extractSessionModeFromText(textContent)
                : null;
              if (modeFromMessage) {
                session.mode = modeFromMessage;
              }

              if (textContent && textContent.length > 0) {
                const cleaned = stripInternalContextPrefix(textContent, false);

                const isSystemMessage = typeof cleaned === 'string' && (
                  cleaned.startsWith('<command-name>') ||
                  cleaned.startsWith('<command-message>') ||
                  cleaned.startsWith('<command-args>') ||
                  cleaned.startsWith('<local-command-stdout>') ||
                  cleaned.startsWith('<system-reminder>') ||
                  cleaned.startsWith('Caveat:') ||
                  cleaned.startsWith('This session is being continued from a previous') ||
                  cleaned.startsWith('Invalid API key') ||
                  cleaned.includes('{"subtasks":') || // Filter Task Master prompts
                  cleaned.includes('CRITICAL: You MUST respond with ONLY a JSON') || // Filter Task Master system prompts
                  cleaned === 'Warmup' // Explicitly filter out "Warmup"
                );

                if (cleaned && !isSystemMessage) {
                  // If this is the very first message (no parent), use it as initial summary
                  if (entry.parentUuid === null && session.summary === 'New Session') {
                    session.summary = cleaned.length > 50 ? cleaned.substring(0, 50) + '...' : cleaned;
                  }
                  session.lastUserMessage = cleaned;
                }
              }
            } else if (entry.message?.role === 'assistant' && entry.message?.content) {
              // Skip API error messages using the isApiErrorMessage flag
              if (entry.isApiErrorMessage === true) {
                // Skip this message entirely
              } else {
                // Track last assistant text message
                let assistantText = null;

                if (Array.isArray(entry.message.content)) {
                  for (const part of entry.message.content) {
                    if (part.type === 'text' && part.text) {
                      assistantText = part.text;
                    }
                  }
                } else if (typeof entry.message.content === 'string') {
                  assistantText = entry.message.content;
                }

                if (assistantText) {
                  const cleaned = stripInternalContextPrefix(assistantText, false);

                  // Additional filter for assistant messages with system content
                  const isSystemAssistantMessage = typeof cleaned === 'string' && (
                    cleaned.startsWith('Invalid API key') ||
                    cleaned.includes('{"subtasks":') ||
                    cleaned.includes('CRITICAL: You MUST respond with ONLY a JSON')
                  );

                  if (cleaned && !isSystemAssistantMessage) {
                    session.lastAssistantMessage = cleaned;
                  }
                }
              }
            }

            session.messageCount++;

            if (entry.timestamp) {
              session.lastActivity = new Date(entry.timestamp);
            }
          }
        } catch (parseError) {
          // Skip malformed lines silently
        }
      }
    }

    // After processing all entries, set final summary based on last message if no summary exists
    for (const session of sessions.values()) {
      if (session.summary === 'New Session') {
        // Prefer last user message, fall back to last assistant message
        const lastMessage = session.lastUserMessage || session.lastAssistantMessage;
        if (lastMessage) {
          session.summary = lastMessage.length > 50 ? lastMessage.substring(0, 50) + '...' : lastMessage;
        }
      }
    }

    // Filter out sessions that contain JSON responses (Task Master errors)
    const allSessions = Array.from(sessions.values());
    const filteredSessions = allSessions.filter(session => {
      const shouldFilter = session.summary.startsWith('{ "');
      if (shouldFilter) {
      }
      // Log a sample of summaries to debug
      if (Math.random() < 0.01) { // Log 1% of sessions
      }
      return !shouldFilter;
    });


    return {
      sessions: filteredSessions,
      entries: entries
    };

  } catch (error) {
    console.error('Error reading JSONL file:', error);
    return { sessions: [], entries: [] };
  }
}

// Parse an agent JSONL file and extract tool uses/results for grouped rendering
async function parseAgentTools(filePath) {
  const tools = [];

  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line);

        if (entry.message?.role === 'assistant' && Array.isArray(entry.message?.content)) {
          for (const part of entry.message.content) {
            if (part.type === 'tool_use') {
              tools.push({
                toolId: part.id,
                toolName: part.name,
                toolInput: part.input,
                timestamp: entry.timestamp
              });
            }
          }
        }

        if (entry.message?.role === 'user' && Array.isArray(entry.message?.content)) {
          for (const part of entry.message.content) {
            if (part.type === 'tool_result') {
              const tool = tools.find(t => t.toolId === part.tool_use_id);
              if (tool) {
                tool.toolResult = {
                  content: typeof part.content === 'string'
                    ? part.content
                    : Array.isArray(part.content)
                      ? part.content.map(c => c.text || '').join('\n')
                      : JSON.stringify(part.content),
                  isError: Boolean(part.is_error)
                };
              }
            }
          }
        }
      } catch (parseError) {
        // Skip malformed lines
      }
    }
  } catch (error) {
    console.warn(`Error parsing agent file ${filePath}:`, error.message);
  }

  return tools;
}

// Get messages for a specific session with pagination support
async function getSessionMessages(projectName, sessionId, limit = null, offset = 0, provider = 'claude', userId = null) {
  console.log(`[DEBUG] getSessionMessages - project: ${projectName}, session: ${sessionId}, provider: ${provider}`);
  if (provider === 'gemini') {
    const geminiSessionFile = path.join(os.homedir(), '.gemini', 'sessions', `${sessionId}.jsonl`);
    console.log(`[DEBUG] Reading Gemini session file: ${geminiSessionFile}`);
    try {
      await fs.access(geminiSessionFile);
      const messages = [];
      const mergeGeminiMessageFragment = (entry) => {
        const role = entry.role || entry.message?.role;
        const content = entry.content || entry.message?.content;
        const isMessageEntry = entry.type === 'message' || (role && content);
        const isStringContent = typeof content === 'string';

        if (!isMessageEntry || !isStringContent || !role) {
          messages.push(entry);
          return;
        }

        const last = messages[messages.length - 1];
        const lastRole = last?.role || last?.message?.role;
        const lastContent = last?.content || last?.message?.content;
        const canMerge =
          last &&
          last.type === 'message' &&
          lastRole === role &&
          typeof lastContent === 'string';

        if (canMerge && role === 'assistant') {
          last.content = `${lastContent}${content}`;
          if (entry.timestamp) {
            last.timestamp = entry.timestamp;
          }
          return;
        }

        if (canMerge && role === 'user' && lastContent === content) {
          if (entry.timestamp) {
            last.timestamp = entry.timestamp;
          }
          return;
        }

        messages.push(entry);
      };
      const fileStream = fsSync.createReadStream(geminiSessionFile);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        if (line.trim()) {
          try {
            const entry = JSON.parse(line);
            // Gemini JSONL files store messages with 'role' or 'type'
            const role = entry.role || entry.message?.role;
            const content = entry.content || entry.message?.content;
            const hasContent = content || (Array.isArray(entry.message?.content) || typeof entry.message?.content === 'string');

            if (entry.type === 'message' || (role && hasContent) || entry.type === 'tool_use' || entry.type === 'tool_result') {
              // Ensure role and content are available at top level for the frontend
              if (!entry.role && role) entry.role = role;
              if (!entry.content && content) entry.content = content;
              mergeGeminiMessageFragment(entry);
            }
          } catch (parseError) {}
        }
      }

      console.log(`[DEBUG] Found ${messages.length} valid messages in Gemini session file`);
      const total = messages.length;
      if (limit === null) return messages;

      const startIndex = Math.max(0, total - offset - limit);
      const endIndex = total - offset;
      const paginatedMessages = messages.slice(startIndex, endIndex);

      return {
        messages: paginatedMessages,
        total,
        hasMore: startIndex > 0,
        offset,
        limit
      };
    } catch (e) {
      console.warn(`Could not read Gemini session ${sessionId}:`, e.message);
      return limit === null ? [] : { messages: [], total: 0, hasMore: false };
    }
  }

  if (provider === 'openrouter') {
    const openrouterSessionFile = path.join(os.homedir(), '.dr-claw', 'openrouter-sessions', `${sessionId}.jsonl`);
    console.log(`[DEBUG] Reading OpenRouter session file: ${openrouterSessionFile}`);
    try {
      await fs.access(openrouterSessionFile);
      const messages = [];
      const raw = await fs.readFile(openrouterSessionFile, 'utf-8');
      for (const line of raw.trim().split('\n').filter(Boolean)) {
        try {
          const entry = JSON.parse(line);
          if (entry.role === 'system') continue;
          if (entry.role === 'user') {
            messages.push({
              type: 'message',
              role: 'user',
              content: entry.content || '',
              timestamp: entry.ts,
            });
          } else if (entry.role === 'assistant') {
            // Emit text content as a message if present
            if (entry.content) {
              messages.push({
                type: 'message',
                role: 'assistant',
                content: entry.content,
                timestamp: entry.ts,
              });
            }
            // Emit tool_use entries for each tool call (matches Codex/Claude history format)
            if (Array.isArray(entry.tool_calls)) {
              for (const tc of entry.tool_calls) {
                let toolInput;
                try { toolInput = tc.function?.arguments || '{}'; } catch { toolInput = '{}'; }
                messages.push({
                  type: 'tool_use',
                  timestamp: entry.ts,
                  toolName: tc.function?.name || 'unknown',
                  toolInput,
                  toolCallId: tc.id,
                });
              }
            }
          } else if (entry.role === 'tool') {
            messages.push({
              type: 'tool_result',
              role: 'tool',
              output: entry.content,
              tool_call_id: entry.tool_call_id,
              toolCallId: entry.tool_call_id,
              timestamp: entry.ts,
            });
          }
        } catch {}
      }

      console.log(`[DEBUG] Found ${messages.length} valid messages in OpenRouter session file`);
      const total = messages.length;
      if (limit === null) return messages;

      const startIndex = Math.max(0, total - offset - limit);
      const endIndex = total - offset;
      return {
        messages: messages.slice(startIndex, endIndex),
        total,
        hasMore: startIndex > 0,
        offset,
        limit,
      };
    } catch (e) {
      console.warn(`Could not read OpenRouter session ${sessionId}:`, e.message);
      return limit === null ? [] : { messages: [], total: 0, hasMore: false };
    }
  }

  if (provider === 'local') {
    const localSessionFile = path.join(os.homedir(), '.dr-claw', 'localgpu-sessions', `${sessionId}.jsonl`);
    console.log(`[DEBUG] Reading Local GPU session file: ${localSessionFile}`);
    try {
      await fs.access(localSessionFile);
      const messages = [];
      const raw = await fs.readFile(localSessionFile, 'utf-8');
      for (const line of raw.trim().split('\n').filter(Boolean)) {
        try {
          const entry = JSON.parse(line);
          if (entry.role === 'system') continue;
          if (entry.role === 'user') {
            messages.push({
              type: 'message',
              role: 'user',
              content: entry.content || '',
              timestamp: entry.ts,
            });
          } else if (entry.role === 'assistant') {
            if (entry.content) {
              messages.push({
                type: 'message',
                role: 'assistant',
                content: entry.content,
                timestamp: entry.ts,
              });
            }
            if (Array.isArray(entry.tool_calls)) {
              for (const tc of entry.tool_calls) {
                let toolInput;
                try { toolInput = tc.function?.arguments || '{}'; } catch { toolInput = '{}'; }
                messages.push({
                  type: 'tool_use',
                  timestamp: entry.ts,
                  toolName: tc.function?.name || 'unknown',
                  toolInput,
                  toolCallId: tc.id,
                });
              }
            }
          } else if (entry.role === 'tool') {
            messages.push({
              type: 'tool_result',
              role: 'tool',
              output: entry.content,
              tool_call_id: entry.tool_call_id,
              toolCallId: entry.tool_call_id,
              timestamp: entry.ts,
            });
          }
        } catch {}
      }

      console.log(`[DEBUG] Found ${messages.length} valid messages in Local GPU session file`);
      const total = messages.length;
      if (limit === null) return messages;

      const startIndex = Math.max(0, total - offset - limit);
      const endIndex = total - offset;
      return {
        messages: messages.slice(startIndex, endIndex),
        total,
        hasMore: startIndex > 0,
        offset,
        limit,
      };
    } catch (e) {
      console.warn(`Could not read Local GPU session ${sessionId}:`, e.message);
      return limit === null ? [] : { messages: [], total: 0, hasMore: false };
    }
  }

  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const files = await fs.readdir(projectDir);
    // agent-*.jsonl files contain subagent tool history, handled separately below
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));
    const agentFiles = files.filter(file => file.endsWith('.jsonl') && file.startsWith('agent-'));

    if (jsonlFiles.length === 0) {
      return { messages: [], total: 0, hasMore: false };
    }

    const messages = [];
    const agentToolsCache = new Map();

    // Process all JSONL files to find messages for this session
    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const fileStream = fsSync.createReadStream(jsonlFile);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        if (line.trim()) {
          try {
            const entry = JSON.parse(line);
            if (entry.sessionId === sessionId) {
              messages.push(entry);
            }
          } catch (parseError) {
            console.warn('Error parsing line:', parseError.message);
          }
        }
      }
    }

    // Collect Task agent IDs and hydrate grouped subagent tool history
    const agentIds = new Set();
    for (const message of messages) {
      if (message.toolUseResult?.agentId) {
        agentIds.add(message.toolUseResult.agentId);
      }
    }

    for (const agentId of agentIds) {
      const agentFileName = `agent-${agentId}.jsonl`;
      if (agentFiles.includes(agentFileName)) {
        const agentFilePath = path.join(projectDir, agentFileName);
        const tools = await parseAgentTools(agentFilePath);
        agentToolsCache.set(agentId, tools);
      }
    }

    for (const message of messages) {
      if (message.toolUseResult?.agentId) {
        const tools = agentToolsCache.get(message.toolUseResult.agentId);
        if (tools && tools.length > 0) {
          message.subagentTools = tools;
        }
      }
    }

    // Sort messages by timestamp
    const sortedMessages = messages.sort((a, b) =>
      new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
    );

    const total = sortedMessages.length;

    // If no limit is specified, return all messages (backward compatibility)
    if (limit === null) {
      return sortedMessages;
    }

    // Apply pagination - for recent messages, we need to slice from the end
    // offset 0 should give us the most recent messages
    const startIndex = Math.max(0, total - offset - limit);
    const endIndex = total - offset;
    const paginatedMessages = sortedMessages.slice(startIndex, endIndex);
    const hasMore = startIndex > 0;

    return {
      messages: paginatedMessages,
      total,
      hasMore,
      offset,
      limit
    };
  } catch (error) {
    console.error(`Error reading messages for session ${sessionId}:`, error);
    return limit === null ? [] : { messages: [], total: 0, hasMore: false };
  }
}

// Rename a project's display name
async function renameProject(projectName, newDisplayName, userId = null) {
  const { projectDb } = await import('./database/db.js');
  const trimmedName = (newDisplayName || '').trim();

  const existing = projectDb.getProjectById(projectName);
  if (existing) {
    if (userId && existing.user_id && existing.user_id !== userId) {
      throw new Error('You do not have permission to rename this project');
    }
    projectDb.updateProjectName(projectName, trimmedName);
  } else {
    const actualPath = await extractProjectDirectory(projectName);
    projectDb.upsertProject(projectName, userId, trimmedName, actualPath);
  }

  await mutateProjectConfig(async (config) => {
    if (!trimmedName) {
      if (config[projectName]) {
        delete config[projectName].displayName;
        if (Object.keys(config[projectName]).length === 0) {
          delete config[projectName];
        }
      }
      return;
    }

    if (!config[projectName]) {
      const actualPath = await extractProjectDirectory(projectName);
      config[projectName] = {
        originalPath: actualPath
      };
    }

    config[projectName].displayName = trimmedName;
  });

  return true;
}

// Delete a session from a project
async function deleteSession(projectName, sessionId, provider = 'claude') {
  const { sessionDb } = await import('./database/db.js');
  const indexedSession = sessionDb.getSessionById(sessionId);

  if (provider === 'gemini') {
    const geminiSessionFile = path.join(os.homedir(), '.gemini', 'sessions', `${sessionId}.jsonl`);
    let deletedFile = false;
    try {
      await fs.unlink(geminiSessionFile);
      deletedFile = true;
    } catch (e) {
      if (e?.code !== 'ENOENT') {
        console.error(`[Gemini] Failed to delete session ${sessionId}:`, e.message);
        throw new Error(`Failed to delete Gemini session: ${e.message}`);
      }
    }

    const deletedIndex = indexedSession?.provider === 'gemini' || deletedFile;
    if (deletedIndex) {
      sessionDb.deleteSession(sessionId);
    }

    if (deletedFile || deletedIndex) {
      console.log(`[Gemini] Deleted session ${sessionId}${deletedFile ? ` file: ${geminiSessionFile}` : ' from index only'}`);
      return true;
    }

    throw new Error(`Gemini session ${sessionId} not found in file system or index`);
  }

  if (provider === 'openrouter') {
    const openrouterSessionFile = path.join(os.homedir(), '.dr-claw', 'openrouter-sessions', `${sessionId}.jsonl`);
    let deletedFile = false;
    try {
      await fs.unlink(openrouterSessionFile);
      deletedFile = true;
    } catch (e) {
      if (e?.code !== 'ENOENT') {
        console.error(`[OpenRouter] Failed to delete session ${sessionId}:`, e.message);
        throw new Error(`Failed to delete OpenRouter session: ${e.message}`);
      }
    }

    const deletedIndex = indexedSession?.provider === 'openrouter' || deletedFile;
    if (deletedIndex) {
      sessionDb.deleteSession(sessionId);
    }

    if (deletedFile || deletedIndex) {
      console.log(`[OpenRouter] Deleted session ${sessionId}${deletedFile ? ` file: ${openrouterSessionFile}` : ' from index only'}`);
      return true;
    }

    throw new Error(`OpenRouter session ${sessionId} not found in file system or index`);
  }

  if (provider === 'local') {
    const localSessionFile = path.join(os.homedir(), '.dr-claw', 'localgpu-sessions', `${sessionId}.jsonl`);
    let deletedFile = false;
    try {
      await fs.unlink(localSessionFile);
      deletedFile = true;
    } catch (e) {
      if (e?.code !== 'ENOENT') {
        console.error(`[LocalGPU] Failed to delete session ${sessionId}:`, e.message);
        throw new Error(`Failed to delete Local GPU session: ${e.message}`);
      }
    }

    const deletedIndex = indexedSession?.provider === 'local' || deletedFile;
    if (deletedIndex) {
      sessionDb.deleteSession(sessionId);
    }

    if (deletedFile || deletedIndex) {
      console.log(`[LocalGPU] Deleted session ${sessionId}${deletedFile ? ` file: ${localSessionFile}` : ' from index only'}`);
      return true;
    }

    throw new Error(`Local GPU session ${sessionId} not found in file system or index`);
  }

  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

    let matchedFiles = 0;
    let removedEntries = 0;

    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const content = await fs.readFile(jsonlFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      let fileRemovedEntries = 0;

      const filteredLines = lines.filter(line => {
        try {
          const data = JSON.parse(line);
          if (data.sessionId === sessionId) {
            fileRemovedEntries += 1;
            return false;
          }
          return true;
        } catch {
          return true; // Keep malformed lines
        }
      });

      if (fileRemovedEntries > 0) {
        matchedFiles += 1;
        removedEntries += fileRemovedEntries;

        if (filteredLines.length > 0) {
          await fs.writeFile(jsonlFile, filteredLines.join('\n') + '\n');
        } else {
          await fs.unlink(jsonlFile);
        }
      }
    }

    const deletedIndex = indexedSession?.provider === 'claude' || matchedFiles > 0;
    if (deletedIndex) {
      sessionDb.deleteSession(sessionId);
    }

    if (matchedFiles > 0 || deletedIndex) {
      console.log(
        `[Claude] Deleted session ${sessionId} from ${matchedFiles} file(s), removed ${removedEntries} entr${removedEntries === 1 ? 'y' : 'ies'}`,
      );
      return true;
    }

    throw new Error(`Session ${sessionId} not found in any files or index`);
  } catch (error) {
    if (error?.code === 'ENOENT' && indexedSession?.provider === 'claude') {
      sessionDb.deleteSession(sessionId);
      console.log(`[Claude] Deleted session ${sessionId} from index only; project directory missing: ${projectDir}`);
      return true;
    }
    console.error(`Error deleting session ${sessionId} from project ${projectName}:`, error);
    throw error;
  }
}

// Check if a project is empty (has no sessions)
async function isProjectEmpty(projectName) {
  try {
    const sessionsResult = await getSessions(projectName, 1, 0);
    return sessionsResult.total === 0;
  } catch (error) {
    console.error(`Error checking if project ${projectName} is empty:`, error);
    return false;
  }
}

// Delete a project (force=true to delete with sessions). This hides the project and records it in trash metadata.
async function deleteProject(projectName, force = false, userId = null) {
  const { projectDb, sessionDb } = await import('./database/db.js');

  try {
    const existing = projectDb.getProjectById(projectName);
    const initialConfig = await loadProjectConfig();
    const initialProjectInfo = initialConfig[projectName];
    const ownerUserId = existing?.user_id ?? getProjectOwnerUserId(initialProjectInfo, existing) ?? userId ?? null;

    if (userId && ownerUserId && ownerUserId !== userId) {
      throw new Error('You do not have permission to delete this project');
    }

    const isEmpty = await isProjectEmpty(projectName);
    if (!isEmpty && !force) {
      throw new Error('Cannot delete project with existing sessions');
    }

    if (isProjectTrashed(initialProjectInfo, existing)) {
      return true;
    }

    const sessionCount = sessionDb.getSessionsByProject(projectName).length;
    let projectPath = initialProjectInfo?.path || initialProjectInfo?.originalPath || existing?.path || null;
    if (!projectPath) {
      projectPath = await extractProjectDirectory(projectName);
    }

    const trashedAt = new Date().toISOString();
    const filesExist = await pathExists(projectPath);
    const instanceId = await readProjectInstanceId(projectPath);
    const displayName = existing?.display_name || initialProjectInfo?.displayName || path.basename(projectPath || projectName);

    const mutationResult = await mutateProjectConfig((config) => {
      const currentConfig = config[projectName] || {};
      if (isProjectTrashed(currentConfig, existing)) {
        return {
          alreadyTrashed: true,
          currentConfig,
          trashMetadata: currentConfig.trash || existing?.metadata?.trash || null,
        };
      }

      clearDeletedProjectMetadata(config, projectName);
      const trashMetadata = {
        ...(currentConfig.trash || {}),
        trashedAt,
        originalPath: projectPath,
        trashPath: '',
        claudeTrashPath: '',
        sessionCount,
        displayName,
        filesExist,
        ownerUserId,
        instanceId,
      };

      config[projectName] = {
        ...currentConfig,
        originalPath: currentConfig.originalPath || projectPath,
        ownerUserId,
        trash: trashMetadata,
      };
      delete config[projectName].deleted;

      return {
        alreadyTrashed: false,
        currentConfig: config[projectName],
        trashMetadata,
      };
    });

    if (mutationResult.alreadyTrashed) {
      return true;
    }

    const metadata = {
      ...(existing?.metadata || {}),
      trash: mutationResult.trashMetadata,
    };

    if (mutationResult.currentConfig?.manuallyAdded || existing?.metadata?.manuallyAdded) {
      metadata.manuallyAdded = true;
    } else {
      delete metadata.manuallyAdded;
    }

    projectDb.upsertProject(
      projectName,
      ownerUserId,
      existing?.display_name || initialProjectInfo?.displayName || null,
      projectPath,
      existing?.is_starred || 0,
      existing?.last_accessed || null,
      Object.keys(metadata).length > 0 ? metadata : null,
    );
    projectDirectoryCache.delete(projectName);

    return true;
  } catch (error) {
    console.error(`Error deleting project ${projectName}:`, error);
    throw error;
  }
}

async function restoreProject(projectName, userId = null) {
  const { projectDb } = await import('./database/db.js');
  const config = await loadProjectConfig();
  const existing = projectDb.getProjectById(projectName);
  const projectInfo = config[projectName];
  const ownerUserId = existing?.user_id ?? getProjectOwnerUserId(projectInfo, existing) ?? userId ?? null;

  if (userId && ownerUserId && ownerUserId !== userId) {
    throw new Error('You do not have permission to restore this project');
  }

  const trashMeta = existing?.metadata?.trash || projectInfo?.trash;
  if (!trashMeta?.trashedAt) {
    throw new Error('Project is not in trash');
  }

  const originalPath = trashMeta.originalPath;
  if (!originalPath) {
    throw new Error('Original project path is missing');
  }

  if (!await pathExists(originalPath)) {
    throw new Error('Project files are missing from the original path and cannot be restored');
  }

  const nextMetadata = { ...(existing?.metadata || {}) };
  delete nextMetadata.trash;

  projectDb.upsertProject(
    projectName,
    ownerUserId,
    existing?.display_name || projectInfo?.displayName || trashMeta.displayName || null,
    originalPath,
    existing?.is_starred || 0,
    existing?.last_accessed || null,
    Object.keys(nextMetadata).length > 0 ? nextMetadata : null,
  );

  await mutateProjectConfig((nextConfig) => {
    const nextProjectInfo = {
      ...(nextConfig[projectName] || {}),
      originalPath,
      ownerUserId,
    };
    delete nextProjectInfo.trash;
    delete nextProjectInfo.deleted;
    clearDeletedProjectMetadata(nextConfig, projectName);
    nextConfig[projectName] = nextProjectInfo;
  });

  await ensureProjectSkillLinks(originalPath);
  projectDirectoryCache.delete(projectName);
  return true;
}

async function deleteTrashedProject(projectName, mode = 'logical', userId = null) {
  const { projectDb, sessionDb } = await import('./database/db.js');
  const config = await loadProjectConfig();
  const existing = projectDb.getProjectById(projectName);
  const projectInfo = config[projectName];
  const ownerUserId = existing?.user_id ?? getProjectOwnerUserId(projectInfo, existing) ?? userId ?? null;

  if (userId && ownerUserId && ownerUserId !== userId) {
    throw new Error('You do not have permission to delete this trashed project');
  }

  const trashMeta = existing?.metadata?.trash || projectInfo?.trash;
  if (!trashMeta?.trashedAt) {
    throw new Error('Project is not in trash');
  }

  if (mode === 'physical') {
    if (trashMeta.originalPath && await pathExists(trashMeta.originalPath)) {
      const storedInstanceId = trashMeta.instanceId || projectInfo?.trash?.instanceId || null;
      if (!storedInstanceId) {
        throw new Error('Cannot safely delete project files because this trash entry has no recorded instance identity. Use logical delete instead.');
      }

      const currentInstanceId = await readProjectInstanceId(trashMeta.originalPath);
      if (!currentInstanceId || currentInstanceId !== storedInstanceId) {
        throw new Error('Project files at the original path no longer match this trash entry. Refusing physical delete.');
      }

      await fs.rm(trashMeta.originalPath, { recursive: true, force: true });

      try {
        const codexSessions = await getCodexSessions(trashMeta.originalPath, { limit: 0 });
        for (const session of codexSessions) {
          try {
            await deleteCodexSession(session.id);
          } catch (err) {
            console.warn(`Failed to delete Codex session ${session.id}:`, err.message);
          }
        }
      } catch (err) {
        console.warn('Failed to delete Codex sessions:', err.message);
      }

      try {
        const hash = crypto.createHash('md5').update(trashMeta.originalPath).digest('hex');
        const cursorProjectDir = path.join(os.homedir(), '.cursor', 'chats', hash);
        await fs.rm(cursorProjectDir, { recursive: true, force: true });
      } catch (_) {
        // Ignore missing Cursor artifacts
      }
    }

    try {
      const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);
      await fs.rm(projectDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`Failed to delete Claude project dir for ${projectName}:`, err.message);
    }

    await mutateProjectConfig((nextConfig) => {
      delete nextConfig[projectName];
      clearDeletedProjectMetadata(nextConfig, projectName);
    });
    projectDb.deleteProject(projectName);
    sessionDb.deleteSessionsByProject(projectName);
    projectDirectoryCache.delete(projectName);
    return true;
  }

  const deletedAt = new Date().toISOString();
  await mutateProjectConfig((nextConfig) => {
    const deletedProjects = getDeletedProjectsStore(nextConfig);
    deletedProjects[projectName] = {
      deletedAt,
      ownerUserId,
      originalPath: trashMeta.originalPath || projectInfo?.originalPath || existing?.path || '',
      displayName: existing?.display_name || projectInfo?.displayName || trashMeta.displayName || projectName,
    };
    delete nextConfig[projectName];
  });

  projectDb.deleteProject(projectName);
  sessionDb.deleteSessionsByProject(projectName);
  projectDirectoryCache.delete(projectName);
  return true;
}

/**
 * Create .claude, .agents, .cursor and their skills subdirs in the project,
 * and symlink each Dr. Claw skill directory into those skills subdirs.
 * Also creates pipeline folders: Survey, Ideation, Experiment, Publication, Promotion.
 * Failures are logged but do not throw (project add still succeeds).
 */
async function collectSkillDirs(baseDir) {
  const results = []; // { name, absolutePath }

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const hasSkillMd = entries.some(e => e.isFile() && e.name === 'SKILL.md');
    if (hasSkillMd) {
      results.push({ name: path.basename(dir), absolutePath: dir });
      return; // Don't recurse deeper into a skill directory
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

/**
 * Load the set of core (platform-native) skill names from skill-tag-mapping.json.
 * Returns a Set of skill directory names that are considered "core pipeline" skills.
 */
function getCoreSkillNames() {
  try {
    const mappingPath = path.join(DRCLAW_SKILLS_DIR, 'skill-tag-mapping.json');
    const raw = fsSync.readFileSync(mappingPath, 'utf8');
    const mapping = JSON.parse(raw);
    const names = new Set(mapping.platformNativeSkills || []);
    // inno-pipeline-planner is always core but not in platformNativeSkills
    names.add('inno-pipeline-planner');
    // bioinformatics-init-analysis resolves to dir name 'init-analysis' via collectSkillDirs
    names.add('init-analysis');
    return names;
  } catch {
    return new Set();
  }
}

/**
 * Generate a compact skills-index.md for the .agents/skills/ directory.
 * Reads YAML frontmatter (name, description) from each SKILL.md and produces
 * a markdown table grouped by Core Pipeline Skills vs Library Skills.
 *
 * @param {Array<{name: string, absolutePath: string}>} skillDirs
 * @returns {string} Markdown content for skills-index.md
 */
async function generateSkillsIndex(skillDirs) {
  const matter = (await import('gray-matter')).default;
  const coreNames = getCoreSkillNames();

  const coreSkills = [];
  const librarySkills = [];

  for (const { name, absolutePath } of skillDirs) {
    const skillMdPath = path.join(absolutePath, 'SKILL.md');
    let skillName = name;
    let description = '';
    try {
      const content = await fs.readFile(skillMdPath, 'utf8');
      const { data } = matter(content);
      if (data.name) skillName = data.name;
      if (data.description) {
        // Collapse newlines (YAML block scalars) and escape pipe chars for markdown tables
        const cleaned = data.description.replace(/[\r\n]+/g, ' ').replace(/\|/g, '/').trim();
        description = cleaned.length > 120
          ? cleaned.slice(0, 117) + '...'
          : cleaned;
      }
    } catch {
      // Skip skills with unreadable SKILL.md
      continue;
    }

    const entry = { dirName: name, skillName, description };
    if (coreNames.has(name)) {
      coreSkills.push(entry);
    } else {
      librarySkills.push(entry);
    }
  }

  coreSkills.sort((a, b) => a.dirName.localeCompare(b.dirName));
  librarySkills.sort((a, b) => a.dirName.localeCompare(b.dirName));

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
  for (const s of coreSkills) {
    lines.push(`| ${s.skillName} | \`.agents/skills/${s.dirName}/SKILL.md\` | ${s.description} |`);
  }

  lines.push('', '## Library Skills', '');
  lines.push('| Skill | Path | Description |');
  lines.push('|-------|------|-------------|');
  for (const s of librarySkills) {
    lines.push(`| ${s.skillName} | \`.agents/skills/library/${s.dirName}/SKILL.md\` | ${s.description} |`);
  }

  lines.push('');
  return lines.join('\n');
}

async function ensureProjectSkillLinks(projectPath) {
  try {
    for (const dir of PROJECT_PIPELINE_FOLDERS) {
      await fs.mkdir(path.join(projectPath, dir), { recursive: true });
    }
    // Create preset research subdirs so the workspace structure is ready to use.
    const presetSubdirs = [
      'Survey/references',
      'Survey/reports',
      'Ideation/ideas',
      'Ideation/references',
      'Experiment/code_references',
      'Experiment/datasets',
      'Experiment/core_code',
      'Experiment/analysis',
      'Publication/paper',
      'Promotion/homepage',
      'Promotion/slides',
      'Promotion/audio',
      'Promotion/video'
    ];
    for (const rel of presetSubdirs) {
      await fs.mkdir(path.join(projectPath, rel), { recursive: true });
    }
  } catch (err) {
    console.error('[projects] Failed to create pipeline folders or preset subdirs:', err.message);
  }

  // Keep creating instance.json for new projects.
  const instancePath = path.join(projectPath, 'instance.json');
  try {
    const projectBasename = path.basename(projectPath);
    const createdAt = new Date().toISOString();
    const instanceId = `${projectBasename}_${createdAt.replace(/[:.]/g, '-')}`;
    const instanceTemplate = {
      instance_id: instanceId,
      idea_maturity: '',
      created_at: createdAt,
      instance: instancePath,
      category: '',
      Survey: {
        references: path.join(projectPath, 'Survey', 'references'),
        reports: path.join(projectPath, 'Survey', 'reports')
      },
      Ideation: {
        ideas: path.join(projectPath, 'Ideation', 'ideas'),
        references: path.join(projectPath, 'Ideation', 'references')
      },
      Experiment: {
        code_references: path.join(projectPath, 'Experiment', 'code_references'),
        datasets: path.join(projectPath, 'Experiment', 'datasets'),
        core_code: path.join(projectPath, 'Experiment', 'core_code'),
        analysis: path.join(projectPath, 'Experiment', 'analysis')
      },
      Publication: {
        paper: path.join(projectPath, 'Publication', 'paper')
      },
      Promotion: {
        homepage: path.join(projectPath, 'Promotion', 'homepage'),
        slides: path.join(projectPath, 'Promotion', 'slides'),
        audio: path.join(projectPath, 'Promotion', 'audio'),
        video: path.join(projectPath, 'Promotion', 'video')
      }
    };
    const hasInstance = await fs.access(instancePath).then(() => true).catch(() => false);
    if (!hasInstance) {
      await fs.writeFile(instancePath, JSON.stringify(instanceTemplate, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('[projects] Failed to create instance.json:', err.message);
  }

  // Generate agent instruction templates (CLAUDE.md, .cursor/rules/project.md, AGENTS.md)
  try {
    const { writeProjectTemplates } = await import('./templates/index.js');
    await writeProjectTemplates(projectPath);
  } catch (err) {
    console.error('[projects] Failed to write agent templates:', err.message);
  }

  try {
    await fs.access(DRCLAW_SKILLS_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('[projects] Dr. Claw skills dir not found, skipping skill symlinks:', DRCLAW_SKILLS_DIR);
      return;
    }
    console.error('[projects] Cannot access Dr. Claw skills dir:', err.message);
    return;
  }

  try {
    const skillDirs = await collectSkillDirs(DRCLAW_SKILLS_DIR);
    if (skillDirs.length === 0) return;

    // Warn about name collisions
    const seen = new Map();
    for (const skill of skillDirs) {
      if (seen.has(skill.name)) {
        console.warn(`[projects] Skill name collision: "${skill.name}" found at both ${seen.get(skill.name)} and ${skill.absolutePath}`);
      } else {
        seen.set(skill.name, skill.absolutePath);
      }
    }

    const coreNames = getCoreSkillNames();

    for (const dir of PROJECT_SKILL_FOLDERS) {
      const skillsSubdir = path.join(projectPath, dir, 'skills');
      const isAgents = dir === '.agents';
      try {
        await fs.mkdir(skillsSubdir, { recursive: true });
        if (isAgents) {
          await fs.mkdir(path.join(skillsSubdir, 'library'), { recursive: true });
        }
      } catch (err) {
        console.error(`[projects] Failed to create ${dir}/skills:`, err.message);
        continue;
      }

      for (const { name, absolutePath } of skillDirs) {
        // For .agents/: core skills at top level, library skills under library/
        const linkPath = isAgents && !coreNames.has(name)
          ? path.join(skillsSubdir, 'library', name)
          : path.join(skillsSubdir, name);
        try {
          try {
            await fs.unlink(linkPath);
          } catch (_) {
            // ignore if not exists or not a symlink
          }
          // Clean up stale top-level symlink when migrating library skills into library/
          if (isAgents && !coreNames.has(name)) {
            try { await fs.unlink(path.join(skillsSubdir, name)); } catch (_) {}
          }
          await fs.symlink(absolutePath, linkPath, 'dir');
        } catch (err) {
          console.error(`[projects] Failed to symlink ${name} in ${dir}/skills:`, err.message);
        }
      }

      // Write the skills index for .agents/ so Codex can discover skills lazily
      if (isAgents) {
        try {
          const indexContent = await generateSkillsIndex(skillDirs);
          await fs.writeFile(path.join(skillsSubdir, 'skills-index.md'), indexContent, 'utf8');
        } catch (err) {
          console.error('[projects] Failed to write skills-index.md:', err.message);
        }
      }

      // Symlink JSON config files from Dr. Claw root into each project skills folder
      for (const jsonFile of ['skill-tag-mapping.json', 'stage-skill-map.json']) {
        const srcJson = path.join(DRCLAW_SKILLS_DIR, jsonFile);
        const destJson = path.join(skillsSubdir, jsonFile);
        try {
          await fs.access(srcJson);
          try { await fs.unlink(destJson); } catch (_) {}
          await fs.symlink(srcJson, destJson, 'file');
        } catch (err) {
          if (err.code !== 'ENOENT') {
            console.error(`[projects] Failed to symlink ${jsonFile} in ${dir}/skills:`, err.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('[projects] ensureProjectSkillLinks failed:', err.message);
  }
}

// Add a project manually to the config (without creating folders)
async function addProjectManually(projectPath, displayName = null, userId = null) {
  const { projectDb } = await import('./database/db.js');
  const absolutePath = path.resolve(projectPath);

  try {
    await fs.access(absolutePath);
  } catch (error) {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }

  const projectName = encodeProjectPath(absolutePath);

  // Check for existing project with the same path (any user or matching user).
  // A single lookup handles both same-user exact match and cross-user dedup.
  const existing = projectDb.getProjectByPath(absolutePath, userId);

  if (existing) {
    // Migrate legacy encoded IDs if needed
    if (existing.id !== projectName) {
      projectDb.migrateProjectIdentity(existing.id, projectName, absolutePath);
    }

    // If the existing record already belongs to this user, mark as manually
    // added and return without creating a duplicate.
    if (existing.user_id === userId || existing.user_id == null) {
      // Preserve existing values while marking as manually added
      const mergedMetadata = { ...(existing.metadata || {}), manuallyAdded: true };
      projectDb.upsertProject(
        projectName, userId,
        displayName || existing.display_name,
        absolutePath,
        existing.is_starred || 0,
        existing.last_accessed || new Date().toISOString(),
        mergedMetadata,
      );

      return {
        name: projectName,
        path: absolutePath,
        fullPath: absolutePath,
        displayName: displayName || existing.display_name || await generateDisplayName(projectName, absolutePath),
        isManuallyAdded: true,
        createdAt: existing.created_at,
        sessions: [],
        cursorSessions: [],
        alreadyExists: true,
      };
    }
  }

  const effectiveId = existing ? existing.id : projectName;

  // Preserve existing values so the upsert doesn't silently clear them
  const preservedStarred = existing?.is_starred || 0;
  const mergedMetadata = { ...(existing?.metadata || {}), manuallyAdded: true };
  const preservedLastAccessed = existing?.last_accessed || new Date().toISOString();

  projectDb.upsertProject(effectiveId, userId, displayName, absolutePath, preservedStarred, preservedLastAccessed, mergedMetadata);

  await mutateProjectConfig((config) => {
    config[effectiveId] = {
      ...(config[effectiveId] || {}),
      manuallyAdded: true,
      originalPath: absolutePath,
      ownerUserId: config[effectiveId]?.ownerUserId ?? userId ?? null,
    };

    if (displayName) {
      config[effectiveId].displayName = displayName;
    }
  });

  await ensureProjectSkillLinks(absolutePath);

  let dirCreatedAt = null;
  try {
    const dirStat = await fs.stat(absolutePath);
    dirCreatedAt = dirStat.birthtime.toISOString();
  } catch (_) {}

  return {
    name: effectiveId,
    path: absolutePath,
    fullPath: absolutePath,
    displayName: displayName || await generateDisplayName(effectiveId, absolutePath),
    isManuallyAdded: true,
    createdAt: dirCreatedAt,
    sessions: [],
    cursorSessions: []
  };
}

// Fetch Cursor sessions for a given project path
async function getCursorSessions(projectPath, options = {}) {
  try {
    const { sessionDb } = await import('./database/db.js');
    const { limit = 5, projectName = encodeProjectPath(projectPath) } = options;
    const candidatePaths = [projectPath];
    const legacyProjectPath = remapCurrentProjectPathToLegacy(projectPath);
    const legacyProjectName = legacyProjectPath ? encodeProjectPath(legacyProjectPath) : null;
    if (legacyProjectPath && legacyProjectPath !== projectPath) {
      candidatePaths.push(legacyProjectPath);
    }

    const sessions = [];
    const seenSessionIds = new Set();
    const dbSessions = [
      ...sessionDb.getSessionsByProject(projectName),
      ...(legacyProjectName && legacyProjectName !== projectName
        ? sessionDb.getSessionsByProject(legacyProjectName)
        : []),
    ];
    const dbSessionMap = new Map(dbSessions.filter((session) => session.provider === 'cursor').map((session) => [session.id, session]));

    for (const candidatePath of candidatePaths) {
      const cwdId = crypto.createHash('md5').update(candidatePath).digest('hex');
      const cursorChatsPath = path.join(os.homedir(), '.cursor', 'chats', cwdId);

      try {
        await fs.access(cursorChatsPath);
      } catch (_) {
        continue;
      }

      const sessionDirs = await fs.readdir(cursorChatsPath);

      for (const sessionId of sessionDirs) {
        if (seenSessionIds.has(sessionId)) {
          continue;
        }

        const sessionPath = path.join(cursorChatsPath, sessionId);
        const storeDbPath = path.join(sessionPath, 'store.db');

        try {
          await fs.access(storeDbPath);

          let dbStatMtimeMs = null;
          try {
            const stat = await fs.stat(storeDbPath);
            dbStatMtimeMs = stat.mtimeMs;
          } catch (_) {}

          const db = await open({
            filename: storeDbPath,
            driver: sqlite3.Database,
            mode: sqlite3.OPEN_READONLY
          });

          const metaRows = await db.all(`
            SELECT key, value FROM meta
          `);

          const metadata = {};
          for (const row of metaRows) {
            if (!row.value) continue;

            try {
              const hexMatch = row.value.toString().match(/^[0-9a-fA-F]+$/);
              if (hexMatch) {
                const jsonStr = Buffer.from(row.value, 'hex').toString('utf8');
                metadata[row.key] = JSON.parse(jsonStr);
              } else {
                metadata[row.key] = row.value.toString();
              }
            } catch (_) {
              metadata[row.key] = row.value.toString();
            }
          }

          const messageCountResult = await db.get(`
            SELECT COUNT(*) as count FROM blobs
          `);

          await db.close();

          const sessionName = metadata.title || metadata.sessionTitle || 'Untitled Session';
          let createdAt = null;
          if (metadata.createdAt) {
            createdAt = new Date(metadata.createdAt).toISOString();
          } else if (dbStatMtimeMs) {
            createdAt = new Date(dbStatMtimeMs).toISOString();
          } else {
            createdAt = new Date().toISOString();
          }

          sessions.push({
            id: sessionId,
            name: sessionName,
            createdAt,
            lastActivity: createdAt,
            messageCount: messageCountResult.count || 0,
            mode: dbSessionMap.has(sessionId)
              ? (readExplicitSessionModeFromMetadata(dbSessionMap.get(sessionId).metadata) || 'research')
              : 'research',
            projectPath,
            tags: dbSessionMap.has(sessionId)
              ? (Array.isArray(dbSessionMap.get(sessionId).tags) ? dbSessionMap.get(sessionId).tags : [])
              : [],
          });
          seenSessionIds.add(sessionId);
        } catch (error) {
          console.warn(`Could not read Cursor session ${sessionId}:`, error.message);
        }
      }
    }

    sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sessions.slice(0, limit);
  } catch (error) {
    console.error('Error fetching Cursor sessions:', error);
    return [];
  }
}


// Fetch Gemini sessions for a given project path
async function getGeminiSessions(projectPath, optionsOrUserId = null) {
  const options = optionsOrUserId && typeof optionsOrUserId === 'object' && !Array.isArray(optionsOrUserId)
    ? optionsOrUserId
    : {};
  const { limit = 5, indexRef = null, syncIndex = false, sessionId: targetSessionId = null, projectName: providedProjectName = null } = options;
  const projectName = providedProjectName || encodeProjectPath(projectPath);
  try {
    const { sessionDb } = await import('./database/db.js');
    const normalizedProjectPath = await normalizeComparablePath(projectPath);
    const legacyProjectPath = remapCurrentProjectPathToLegacy(projectPath);
    const normalizedLegacyProjectPath = await normalizeComparablePath(legacyProjectPath);
    const legacyProjectName = legacyProjectPath ? encodeProjectPath(legacyProjectPath) : null;
    if (!normalizedProjectPath) {
      return [];
    }

    if (indexRef && !indexRef.sessionsByProject) {
      indexRef.sessionsByProject = await buildGeminiSessionsIndex();
    }

    const sessionsByProject = indexRef?.sessionsByProject || await buildGeminiSessionsIndex();
    const sessions = [...(sessionsByProject.get(normalizedProjectPath) || [])];

    if (normalizedLegacyProjectPath && normalizedLegacyProjectPath !== normalizedProjectPath) {
      sessions.push(...(sessionsByProject.get(normalizedLegacyProjectPath) || []));
    }

    const dbSessions = [
      ...sessionDb.getSessionsByProject(projectName),
      ...(legacyProjectName && legacyProjectName !== projectName
        ? sessionDb.getSessionsByProject(legacyProjectName)
        : []),
    ];
    const dbSessionMap = new Map(dbSessions.filter((session) => session.provider === 'gemini').map((session) => [session.id, session]));

    const dedupedSessions = Array.from(new Map(sessions.map((session) => [session.id, session])).values())
      .map((session) => ({
        ...session,
        mode: dbSessionMap.has(session.id)
          ? (readExplicitSessionModeFromMetadata(dbSessionMap.get(session.id).metadata) || normalizeSessionMode(session.mode))
          : normalizeSessionMode(session.mode),
        projectPath,
        tags: dbSessionMap.has(session.id)
          ? (Array.isArray(dbSessionMap.get(session.id).tags) ? dbSessionMap.get(session.id).tags : [])
          : (Array.isArray(session.tags) ? session.tags : []),
      }));
    const filteredSessions = targetSessionId
      ? dedupedSessions.filter((session) => session.id === targetSessionId)
      : dedupedSessions;

    if (syncIndex) {
      const { sessionDb } = await import('./database/db.js');
      const projectName = providedProjectName || encodeProjectPath(projectPath);
      await Promise.allSettled(
        filteredSessions.map(async (session) => {
          const indexedSession = sessionDb.getSessionById(session.id);
          await reconcileIndexedSessionFromSource(projectName, 'gemini', {
            ...session,
            summary: session.summary || session.name,
          }, indexedSession, projectPath);
        })
      );
    }

    return limit > 0 ? filteredSessions.slice(0, limit) : filteredSessions;
  } catch (error) {
    console.error('Error fetching Gemini sessions:', error);
    return [];
  }
}

async function buildGeminiSessionsIndex() {
  const { sessionDb } = await import('./database/db.js');
  const geminiSessionsDir = path.join(os.homedir(), '.gemini', 'sessions');
  const sessionsByProject = new Map();

  try {
    await fs.access(geminiSessionsDir);
  } catch (error) {
    return sessionsByProject;
  }

  const files = await fs.readdir(geminiSessionsDir);

  for (const file of files) {
    if (!file.endsWith('.jsonl')) {
      continue;
    }

    const sessionId = path.basename(file, '.jsonl');
    const filePath = path.join(geminiSessionsDir, file);

    try {
      const stats = await fs.stat(filePath);
      const indexedSession = sessionDb.getSessionById(sessionId);
      const indexedMessageCount = Number(indexedSession?.message_count ?? indexedSession?.messageCount ?? 0);
      const matchedProjectPaths = new Set();

      let explicitTitle = indexedSession?.display_name || null;
      let firstMessageText = null;
      let messageCount = 0;
      // Recovery order: DB metadata -> JSONL metadata -> context marker -> high-confidence heuristic -> default.
      let detectedSessionMode = readExplicitSessionModeFromMetadata(indexedSession?.metadata);

      const fileStream = fsSync.createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      let lineCount = 0;

      for await (const line of rl) {
        lineCount++;
        if (lineCount > 2000) {
          break;
        }

        if (!line.trim()) {
          continue;
        }

        try {
          const entry = JSON.parse(line);
          const metadataMode = readExplicitSessionModeFromMetadata(entry.payload || entry);
          if (metadataMode) {
            detectedSessionMode = metadataMode;
          }

          const sessionCwd = entry.cwd || entry.payload?.cwd;
          if (sessionCwd) {
            const normalizedSessionCwd = await normalizeComparablePath(sessionCwd);
            if (normalizedSessionCwd) {
              matchedProjectPaths.add(normalizedSessionCwd);
            }
          }

          const title = entry.summary || entry.title || entry.payload?.title || entry.payload?.summary;
          if (
            title &&
            typeof title === 'string' &&
            title.trim() &&
            !title.includes('Gemini Session') &&
            !title.includes('New Session')
          ) {
            explicitTitle = stripInternalContextPrefix(title.trim());
          }

          if (!firstMessageText && (entry.role === 'user' || (entry.type === 'message' && entry.role === 'user'))) {
            const content = entry.content || entry.message?.content || entry.payload?.message?.content;
            const textContent = typeof content === 'string'
              ? content
              : Array.isArray(content)
                ? content.map((part) => part.text || (typeof part === 'string' ? part : '')).join(' ')
                : '';

            if (textContent.trim()) {
              const modeFromContext = extractSessionModeFromText(textContent);
              if (modeFromContext) {
                detectedSessionMode = modeFromContext;
              }

              const cleaned = stripInternalContextPrefix(textContent.trim(), false);
              if (cleaned && !cleaned.includes('Base directory for this skill:') && !cleaned.startsWith('<command-name>')) {
                if (!detectedSessionMode) {
                  detectedSessionMode = inferSessionModeFromUserMessage(cleaned);
                }
                const helpMatch = cleaned.match(/Please help me with ["'](.*?)["']/);
                firstMessageText = helpMatch ? helpMatch[1] : cleaned.split('\n')[0].replace(/#+\s*/, '').trim();
              }
            }
          }

          const isUserMessage = entry.role === 'user' || (entry.type === 'message' && entry.role === 'user');
          const isAssistantMessage = entry.role === 'assistant'
            || entry.message?.role === 'assistant'
            || (entry.type === 'message' && entry.role === 'assistant');

          if (isUserMessage || isAssistantMessage) {
            messageCount++;
          }
        } catch (error) {}
      }

      if (matchedProjectPaths.size === 0) {
        continue;
      }

      let finalName = explicitTitle || firstMessageText;
      if (finalName) {
        finalName = finalName.replace(/[\*\_\`]/g, '');
        if (finalName.length > 50) {
          finalName = `${finalName.substring(0, 47)}...`;
        }
      } else {
        finalName = 'Untitled Session';
      }

      const sessionMode = detectedSessionMode || 'research';
      const resolvedMessageCount = Math.max(indexedMessageCount, messageCount);
      const session = {
        id: sessionId,
        name: finalName,
        createdAt: stats.birthtime.toISOString(),
        lastActivity: stats.mtime.toISOString(),
        messageCount: resolvedMessageCount,
        mode: sessionMode,
        filePath,
        __provider: 'gemini',
      };

      for (const normalizedProjectPath of matchedProjectPaths) {
        if (!sessionsByProject.has(normalizedProjectPath)) {
          sessionsByProject.set(normalizedProjectPath, []);
        }
        sessionsByProject.get(normalizedProjectPath).push(session);
      }
    } catch (error) {}
  }

  for (const sessions of sessionsByProject.values()) {
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  }

  return sessionsByProject;
}

async function normalizeComparablePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return '';
  }

  const withoutLongPathPrefix = inputPath.startsWith('\\\\?\\')
    ? inputPath.slice(4)
    : inputPath;
  const normalized = path.normalize(withoutLongPathPrefix.trim());

  if (!normalized) {
    return '';
  }

  const resolved = path.resolve(normalized);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function findCodexJsonlFiles(dir) {
  const files = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await findCodexJsonlFiles(fullPath));
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Skip directories we can't read
  }

  return files;
}

async function buildCodexSessionsIndex() {
  const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');
  const sessionsByProject = new Map();

  try {
    await fs.access(codexSessionsDir);
  } catch (error) {
    return sessionsByProject;
  }

  const jsonlFiles = await findCodexJsonlFiles(codexSessionsDir);

  for (const filePath of jsonlFiles) {
    try {
      const sessionData = await parseCodexSessionFile(filePath);
      if (!sessionData || !sessionData.id) {
        continue;
      }

      const normalizedProjectPath = await normalizeComparablePath(sessionData.cwd);
      if (!normalizedProjectPath) {
        continue;
      }

      const session = {
        id: sessionData.id,
        summary: sessionData.summary || 'Codex Session',
        messageCount: sessionData.messageCount || 0,
        lastActivity: sessionData.timestamp ? new Date(sessionData.timestamp) : new Date(),
        cwd: sessionData.cwd,
        model: sessionData.model,
        mode: normalizeSessionMode(sessionData.mode),
        filePath,
        provider: 'codex',
      };

      if (!sessionsByProject.has(normalizedProjectPath)) {
        sessionsByProject.set(normalizedProjectPath, []);
      }

      sessionsByProject.get(normalizedProjectPath).push(session);
    } catch (error) {
      console.warn(`Could not parse Codex session file ${filePath}:`, error.message);
    }
  }

  for (const sessions of sessionsByProject.values()) {
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  }

  return sessionsByProject;
}

// Fetch Codex sessions for a given project path
async function getCodexSessions(projectPath, options = {}) {
  const { limit = 5, indexRef = null, syncIndex = false, sessionId: targetSessionId = null, projectName: providedProjectName = null } = options;
  const projectName = providedProjectName || encodeProjectPath(projectPath);
  try {
    const { sessionDb } = await import('./database/db.js');
    const normalizedProjectPath = await normalizeComparablePath(projectPath);
    const normalizedLegacyProjectPath = await normalizeComparablePath(remapCurrentProjectPathToLegacy(projectPath));
    const legacyProjectPath = remapCurrentProjectPathToLegacy(projectPath);
    const legacyProjectName = legacyProjectPath ? encodeProjectPath(legacyProjectPath) : null;
    if (!normalizedProjectPath) {
      return [];
    }

    if (indexRef && !indexRef.sessionsByProject) {
      indexRef.sessionsByProject = await buildCodexSessionsIndex();
    }

    const sessionsByProject = indexRef?.sessionsByProject || await buildCodexSessionsIndex();
    const sessions = [...(sessionsByProject.get(normalizedProjectPath) || [])];

    if (normalizedLegacyProjectPath && normalizedLegacyProjectPath !== normalizedProjectPath) {
      sessions.push(...(sessionsByProject.get(normalizedLegacyProjectPath) || []));
    }

    // Return limited sessions for performance (0 = unlimited for deletion)
    const dbSessions = [
      ...sessionDb.getSessionsByProject(projectName),
      ...(legacyProjectName && legacyProjectName !== projectName
        ? sessionDb.getSessionsByProject(legacyProjectName)
        : []),
    ];
    const dbSessionMap = new Map(dbSessions.filter((session) => session.provider === 'codex').map((session) => [session.id, session]));
    const dedupedSessions = Array.from(new Map(sessions.map((session) => [session.id, session])).values()).map((session) => ({
      ...session,
      mode: dbSessionMap.has(session.id)
        ? (readExplicitSessionModeFromMetadata(dbSessionMap.get(session.id).metadata) || normalizeSessionMode(session.mode))
        : normalizeSessionMode(session.mode),
      tags: dbSessionMap.has(session.id)
        ? (Array.isArray(dbSessionMap.get(session.id).tags) ? dbSessionMap.get(session.id).tags : [])
        : (Array.isArray(session.tags) ? session.tags : []),
    }));
    const filteredSessions = targetSessionId
      ? dedupedSessions.filter((session) => session.id === targetSessionId)
      : dedupedSessions;

    if (syncIndex) {
      await Promise.allSettled(
        filteredSessions.map(async (session) => {
          const indexedSession = sessionDb.getSessionById(session.id);
          await reconcileIndexedSessionFromSource(projectName, 'codex', {
            ...session,
            summary: session.summary || session.name,
            createdAt: session.createdAt || session.lastActivity,
          }, indexedSession, projectPath);
        })
      );
    }

    return limit > 0 ? filteredSessions.slice(0, limit) : filteredSessions;

  } catch (error) {
    console.error('Error fetching Codex sessions:', error);
    return [];
  }
}

// Parse a Codex session JSONL file to extract metadata
async function parseCodexSessionFile(filePath) {
  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let sessionMeta = null;
    let lastTimestamp = null;
    let lastUserMessage = null;
    let messageCount = 0;
    let detectedSessionMode = null;

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);

          // Track timestamp
          if (entry.timestamp) {
            lastTimestamp = entry.timestamp;
          }

          // Extract session metadata
          if (entry.type === 'session_meta' && entry.payload) {
            sessionMeta = {
              id: entry.payload.id,
              cwd: entry.payload.cwd,
              model: entry.payload.model || entry.payload.model_provider,
              timestamp: entry.timestamp,
              git: entry.payload.git
            };
          }

          // Count messages and extract user messages for summary
          if (entry.type === 'event_msg' && entry.payload?.type === 'user_message') {
            messageCount++;
            if (entry.payload.message) {
              const modeFromMessage = extractSessionModeFromText(entry.payload.message);
              if (modeFromMessage) {
                detectedSessionMode = modeFromMessage;
              }

              const cleanedUserMessage = stripInternalContextPrefix(entry.payload.message, false);
              if (cleanedUserMessage && !isCodexSystemPromptContent(cleanedUserMessage)) {
                if (!detectedSessionMode) {
                  detectedSessionMode = inferSessionModeFromUserMessage(cleanedUserMessage);
                }
                lastUserMessage = cleanedUserMessage;
              }
            }
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'message' && entry.payload.role === 'assistant') {
            messageCount++;
          }

        } catch (parseError) {
          // Skip malformed lines
        }
      }
    }

    if (sessionMeta) {
      return {
        ...sessionMeta,
        timestamp: lastTimestamp || sessionMeta.timestamp,
        mode: detectedSessionMode || 'research',
        summary: lastUserMessage ?
          (lastUserMessage.length > 50 ? lastUserMessage.substring(0, 50) + '...' : lastUserMessage) :
          'Codex Session',
        messageCount
      };
    }

    return null;

  } catch (error) {
    console.error('Error parsing Codex session file:', error);
    return null;
  }
}

/**
 * Detect system prompt / instruction content in Codex messages
 * (AGENTS.md, skill listings, instruction blocks)
 */
function isCodexSystemPromptContent(text) {
  if (!text || text.length < 200) return false;
  if (/^#\s+(AGENTS|SKILL|INSTRUCTIONS)/m.test(text)) return true;
  if (text.includes('<INSTRUCTIONS>') || text.includes('</INSTRUCTIONS>')) return true;
  if (/^#+\s+.*instructions\s+for\s+\//im.test(text)) return true;
  if (text.includes('Base directory for this skill:') && text.length > 500) return true;
  if (text.length > 2000 && /^\d+\)\s/m.test(text) && /\bskill\b/i.test(text)) return true;
  const skillPathCount = (text.match(/SKILL\.md\)/g) || []).length;
  if (skillPathCount >= 3) return true;
  if (text.includes('### How to use skills') || text.includes('## How to use skills')) return true;
  if (text.includes('Trigger rules:') && text.includes('skill') && text.length > 500) return true;
  return false;
}

// Get messages for a specific Codex session
async function getCodexSessionMessages(sessionId, limit = null, offset = 0) {
  try {
    const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');

    const findSessionFileByMetadata = async () => {
      const jsonlFiles = await findCodexJsonlFiles(codexSessionsDir);

      let filenameMatch = null;
      for (const filePath of jsonlFiles) {
        if (path.basename(filePath).includes(sessionId)) {
          filenameMatch = filePath;
          break;
        }
      }

      if (filenameMatch) {
        return filenameMatch;
      }

      for (const filePath of jsonlFiles) {
        const sessionData = await parseCodexSessionFile(filePath);
        if (sessionData?.id === sessionId) {
          return filePath;
        }
      }

      return null;
    };

    const sessionFilePath = await findSessionFileByMetadata();

    if (!sessionFilePath) {
      console.warn(`Codex session file not found for session ${sessionId}`);
      return { messages: [], total: 0, hasMore: false };
    }

    const messages = [];
    let tokenUsage = null;
    const fileStream = fsSync.createReadStream(sessionFilePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    // Helper to extract text from Codex content array
    const extractText = (content) => {
      if (!Array.isArray(content)) return content;
      return content
        .map(item => {
          if (item.type === 'input_text' || item.type === 'output_text') {
            return item.text;
          }
          if (item.type === 'text') {
            return item.text;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    };

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);

          // Extract token usage from token_count events (keep latest)
          if (entry.type === 'event_msg' && entry.payload?.type === 'token_count' && entry.payload?.info) {
            const info = entry.payload.info;
            if (info.total_token_usage) {
              tokenUsage = {
                used: info.total_token_usage.total_tokens || 0,
                total: info.model_context_window || 200000
              };
            }
          }

          // Extract messages from response_item
          if (entry.type === 'response_item' && entry.payload?.type === 'message') {
            const content = entry.payload.content;
            const role = entry.payload.role || 'assistant';
            const textContent = extractText(content);

            // Skip system context messages (environment_context)
            if (textContent?.includes('<environment_context>')) {
              continue;
            }

            // Skip system prompt / instruction content (AGENTS.md, skills listing, etc.)
            if (textContent && isCodexSystemPromptContent(textContent)) {
              continue;
            }

            // Only add if there's actual content
            if (textContent?.trim()) {
              messages.push({
                type: role === 'user' ? 'user' : 'assistant',
                timestamp: entry.timestamp,
                message: {
                  role: role,
                  content: textContent
                }
              });
            }
          }

          // Skip Codex reasoning items - they are brief status notes, not useful to display

          if (entry.type === 'response_item' && entry.payload?.type === 'function_call') {
            let toolName = entry.payload.name;
            let toolInput = entry.payload.arguments;

            // Map Codex tool names to Claude equivalents
            if (toolName === 'shell_command') {
              toolName = 'Bash';
              try {
                const args = JSON.parse(entry.payload.arguments);
                toolInput = JSON.stringify({ command: args.command });
              } catch (e) {
                // Keep original if parsing fails
              }
            }

            messages.push({
              type: 'tool_use',
              timestamp: entry.timestamp,
              toolName: toolName,
              toolInput: toolInput,
              toolCallId: entry.payload.call_id
            });
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'function_call_output') {
            messages.push({
              type: 'tool_result',
              timestamp: entry.timestamp,
              toolCallId: entry.payload.call_id,
              output: entry.payload.output
            });
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call') {
            const toolName = entry.payload.name || 'custom_tool';
            const input = entry.payload.input || '';

            if (toolName === 'apply_patch') {
              // Parse Codex patch format and convert to Claude Edit format
              const fileMatch = input.match(/\*\*\* Update File: (.+)/);
              const filePath = fileMatch ? fileMatch[1].trim() : 'unknown';

              // Extract old and new content from patch
              const lines = input.split('\n');
              const oldLines = [];
              const newLines = [];

              for (const line of lines) {
                if (line.startsWith('-') && !line.startsWith('---')) {
                  oldLines.push(line.substring(1));
                } else if (line.startsWith('+') && !line.startsWith('+++')) {
                  newLines.push(line.substring(1));
                }
              }

              messages.push({
                type: 'tool_use',
                timestamp: entry.timestamp,
                toolName: 'Edit',
                toolInput: JSON.stringify({
                  file_path: filePath,
                  old_string: oldLines.join('\n'),
                  new_string: newLines.join('\n')
                }),
                toolCallId: entry.payload.call_id
              });
            } else {
              messages.push({
                type: 'tool_use',
                timestamp: entry.timestamp,
                toolName: toolName,
                toolInput: input,
                toolCallId: entry.payload.call_id
              });
            }
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call_output') {
            messages.push({
              type: 'tool_result',
              timestamp: entry.timestamp,
              toolCallId: entry.payload.call_id,
              output: entry.payload.output || ''
            });
          }

        } catch (parseError) {
          // Skip malformed lines
        }
      }
    }

    // Sort by timestamp
    messages.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

    const total = messages.length;

    // Apply pagination if limit is specified
    if (limit !== null) {
      const startIndex = Math.max(0, total - offset - limit);
      const endIndex = total - offset;
      const paginatedMessages = messages.slice(startIndex, endIndex);
      const hasMore = startIndex > 0;

      return {
        messages: paginatedMessages,
        total,
        hasMore,
        offset,
        limit,
        tokenUsage
      };
    }

    return { messages, tokenUsage };

  } catch (error) {
    console.error(`Error reading Codex session messages for ${sessionId}:`, error);
    return { messages: [], total: 0, hasMore: false };
  }
}

async function deleteCodexSession(sessionId) {
  try {
    const { sessionDb } = await import('./database/db.js');
    const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');
    const indexedSession = sessionDb.getSessionById(sessionId);

    const findJsonlFiles = async (dir) => {
      const files = [];
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            files.push(...await findJsonlFiles(fullPath));
          } else if (entry.name.endsWith('.jsonl')) {
            files.push(fullPath);
          }
        }
      } catch (error) {}
      return files;
    };

    const jsonlFiles = await findJsonlFiles(codexSessionsDir);
    let deletedFile = false;

    for (const filePath of jsonlFiles) {
      const sessionData = await parseCodexSessionFile(filePath);
      if (sessionData && sessionData.id === sessionId) {
        await fs.unlink(filePath);
        deletedFile = true;
        break;
      }
    }

    const deletedIndex =
      indexedSession?.provider === 'codex' || deletedFile;

    if (deletedIndex) {
      sessionDb.deleteSession(sessionId);
    }

    if (deletedFile || deletedIndex) {
      return true;
    }

    throw new Error(`Codex session file not found for session ${sessionId}`);
  } catch (error) {
    console.error(`Error deleting Codex session ${sessionId}:`, error);
    throw error;
  }
}

// Get workspace root from project config
async function getWorkspaceRootFromConfig() {
  const config = await loadProjectConfig();
  const resolvedRoot = await resolveConfiguredWorkspacesRoot(config._workspacesRoot || null);

  if (resolvedRoot && config._workspacesRoot !== resolvedRoot) {
    await mutateProjectConfig((nextConfig) => {
      nextConfig._workspacesRoot = resolvedRoot;
    });
  }

  return resolvedRoot || null;
}

// Save workspace root to project config
async function setWorkspaceRootInConfig(workspacesRoot) {
  await mutateProjectConfig((config) => {
    if (workspacesRoot) {
      config._workspacesRoot = workspacesRoot;
    } else {
      delete config._workspacesRoot;
    }
  });
}

// Rename a session (Claude, Gemini, or Cursor)
async function renameSession(projectName, sessionId, newSummary, provider = 'claude', userId = null) {
  if (!newSummary || newSummary.trim() === '') {
    throw new Error('New session name cannot be empty');
  }

  const trimmedSummary = newSummary.trim();
  const { sessionDb, projectDb } = await import('./database/db.js');

  // Basic security: if project is in DB, check if it belongs to this user
  const project = projectDb.getProjectById(projectName);
  if (project && userId && project.user_id && project.user_id !== userId) {
    throw new Error('You do not have permission to modify sessions in this project');
  }

  // 1. Handle Gemini sessions
  if (provider === 'gemini') {
    const geminiSessionFile = path.join(os.homedir(), '.gemini', 'sessions', `${sessionId}.jsonl`);
    try {
      await fs.access(geminiSessionFile);
      // For Gemini, we append a title/summary entry to the end of the JSONL file (compatibility)
      const summaryEntry = {
        type: 'summary',
        summary: trimmedSummary,
        title: trimmedSummary,
        timestamp: new Date().toISOString()
      };
      await fs.appendFile(geminiSessionFile, JSON.stringify(summaryEntry) + '\n');

      // Also update Dr. Claw's own index (source of truth)
      sessionDb.updateSessionName(sessionId, trimmedSummary);

      console.log(`[Gemini] Renamed session ${sessionId} to "${trimmedSummary}"`);
      return true;
    } catch (e) {
      console.error(`[Gemini] Failed to rename session ${sessionId}:`, e.message);
      throw new Error(`Failed to rename Gemini session: ${e.message}`);
    }
  }
  // 2. Handle Cursor sessions (SQLite)
  else if (provider === 'cursor') {
    const config = await loadProjectConfig();
    const projectPath = config[projectName]?.path || config[projectName]?.originalPath || await extractProjectDirectory(projectName);

    if (!projectPath) {
      throw new Error(`Could not determine project path for ${projectName}`);
    }

    const cwdId = crypto.createHash('md5').update(projectPath).digest('hex');
    const storeDbPath = path.join(os.homedir(), '.cursor', 'chats', cwdId, sessionId, 'store.db');

    try {
      await fs.access(storeDbPath);
      const db = await open({
        filename: storeDbPath,
        driver: sqlite3.Database
      });

      // Update both title and sessionTitle keys in the meta table
      await db.run("UPDATE meta SET value = ? WHERE key = 'title' OR key = 'sessionTitle'", [trimmedSummary]);
      await db.close();

      // Update Dr. Claw's own index
      sessionDb.updateSessionName(sessionId, trimmedSummary);

      console.log(`[Cursor] Renamed session ${sessionId} to "${trimmedSummary}"`);
      return true;
    } catch (e) {
      console.error(`[Cursor] Failed to rename session ${sessionId}:`, e.message);
      throw new Error(`Failed to rename Cursor session: ${e.message}`);
    }
  }
  // 3. Handle Claude sessions (JSONL)
  else {
    const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

    try {
      // Check if project directory exists first
      try {
        await fs.access(projectDir);
      } catch (e) {
        console.error(`[Claude] Project directory not found: ${projectDir}`);
        throw new Error(`Claude project directory not found: ${projectName}`);
      }

      const files = await fs.readdir(projectDir);
      const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));

      if (jsonlFiles.length === 0) {
        throw new Error('No session files found for this project');
      }

      // Check all JSONL files to find which one contains the session
      for (const file of jsonlFiles) {
        const jsonlFile = path.join(projectDir, file);
        const content = await fs.readFile(jsonlFile, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());

        const hasSession = lines.some(line => {
          try {
            const data = JSON.parse(line);
            return data.sessionId === sessionId;
          } catch {
            return false;
          }
        });

        if (hasSession) {
          // Append a new summary record for this sessionId
          const summaryEntry = {
            type: 'summary',
            sessionId: sessionId,
            summary: trimmedSummary,
            timestamp: new Date().toISOString()
          };
          await fs.appendFile(jsonlFile, JSON.stringify(summaryEntry) + '\n');

          // Update Dr. Claw's own index
          sessionDb.updateSessionName(sessionId, trimmedSummary);

          console.log(`[Claude] Renamed session ${sessionId} to "${trimmedSummary}"`);
          return true;
        }
      }

      throw new Error(`Session ${sessionId} not found in any files`);
    } catch (error) {
      console.error(`Error renaming session ${sessionId} in project ${projectName}:`, error);
      throw error;
    }
  }
}

export {
  getProjects,
  getTrashedProjects,
  getSessions,
  getSessionMessages,
  collectCodexProjectCandidates,
  parseJsonlSessions,
  renameProject,
  renameSession,
  deleteSession,
  isProjectEmpty,
  deleteProject,
  restoreProject,
  deleteTrashedProject,
  addProjectManually,
  loadProjectConfig,
  saveProjectConfig,
  extractProjectDirectory,
  clearProjectDirectoryCache,
  getCodexSessions,
  getGeminiSessions,
  getCodexSessionMessages,
  deleteCodexSession,
  reconcileClaudeSessionIndex,
  reconcileCodexSessionIndex,
  reconcileGeminiSessionIndex,
  reconcileOpenRouterSessionIndex,
  reconcileLocalGPUSessionIndex,
  ensureProjectSkillLinks,
  getWorkspaceRootFromConfig,
  setWorkspaceRootInConfig
};
