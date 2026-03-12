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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIBELAB_SKILLS_DIR = path.join(__dirname, '..', 'skills');
const PROJECT_SKILL_FOLDERS = ['.claude', '.agents', '.cursor', '.gemini'];
const PROJECT_PIPELINE_FOLDERS = ['Survey', 'Ideation', 'Experiment', 'Publication', 'Promotion'];

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

function encodeProjectPath(projectPath) {
  return path.resolve(projectPath).replace(/[\\/:\s~_]/g, '-');
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

async function getProjects(userId, progressCallback = null) {
  const { projectDb } = await import('./database/db.js');
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const config = await loadProjectConfig();
  const projects = [];
  const existingProjects = new Set();

  // Resolve workspace root for filtering (only for NEW discovery or manual adds)
  const DEFAULT_WORKSPACES_ROOT = path.join(os.homedir(), 'vibelab');
  const workspacesRoot = config._workspacesRoot || process.env.WORKSPACES_ROOT || DEFAULT_WORKSPACES_ROOT;
  const codexSessionsIndexRef = { sessionsByProject: null };
  let totalProjects = 0;
  let processedProjects = 0;
  let configDirty = false;

  // 1. Fetch projects belonging to THIS user
  const userProjects = projectDb.getAllProjects(userId);
  const userProjectMap = new Map(userProjects.map(p => [p.id, p]));

  // 2. Fetch ALL projects from DB to see what's already claimed by OTHERS
  const allDbProjects = projectDb.getAllProjects(); // userId=null gets all
  const globalProjectMap = new Map(allDbProjects.map(p => [p.id, p]));

  try {
    // Check if the .claude/projects directory exists
    await fs.access(claudeDir);

    // Get ALL existing Claude project folders
    const entries = await fs.readdir(claudeDir, { withFileTypes: true });
    const directories = entries.filter(e => e.isDirectory());

    const discoveredDirectories = [];
    for (const entry of directories) {
      const actualDir = await extractProjectDirectory(entry.name);
      if (!actualDir) continue;

      const dbEntry = globalProjectMap.get(entry.name);
      
      // LOGIC FOR VISIBILITY:
      // A. If it's already in DB and belongs to THIS user -> Visible
      // B. If it's NOT in DB but is within the VibeLab workspace root -> Visible & Auto-claim
      // C. If it's NOT in DB and OUTSIDE the root -> IGNORE (avoid cluttering with external Claude projects)
      // D. If it's in DB but belongs to someone else -> HIDDEN
      
      if (dbEntry) {
        if (dbEntry.user_id === userId) {
          discoveredDirectories.push({ entry, actualProjectDir: actualDir, dbEntry });
        }
      } else {
        // Unclaimed project discovered in filesystem.
        // Check if it belongs to VibeLab workspace root.
        const normalizedActual = await normalizeComparablePath(actualDir);
        const normalizedRoot = await normalizeComparablePath(workspacesRoot);
        
        if (normalizedActual.startsWith(normalizedRoot)) {
          // It's a VibeLab-local project, safe to auto-claim
          discoveredDirectories.push({ entry, actualProjectDir: actualDir, dbEntry: null });
        } else {
          // It's an external Claude project (e.g. from global CLI usage)
          // Do not auto-claim and do not show by default to avoid confusion.
          console.log(`[projects] Skipping external Claude project: ${entry.name} at ${actualDir}`);
        }
      }
      existingProjects.add(entry.name);
    }

    // Process unclaimed projects from Claude config too
    for (const [projectName, projectConfig] of Object.entries(config)) {
      if (!projectConfig?.originalPath) continue;
      
      const dbEntry = globalProjectMap.get(projectName);
      if (!dbEntry || !dbEntry.user_id) {
        // This project exists in config but not assigned in DB yet
        // Only add if not already added from filesystem scan
        if (!discoveredDirectories.some(d => d.entry.name === projectName)) {
          discoveredDirectories.push({ 
            entry: { name: projectName }, 
            actualProjectDir: projectConfig.originalPath, 
            dbEntry: null 
          });
        }
      }
    }

    // 3. Add projects ALREADY in DB that weren't discovered yet
    for (const dbEntry of allDbProjects) {
      // If we're filtering by userId, only include projects that belong to them.
      // If userId is null (timer/broadcast), include everything.
      const isVisible = !userId || dbEntry.user_id === userId;
      
      if (isVisible) {
        if (!discoveredDirectories.some(d => d.entry.name === dbEntry.id)) {
          discoveredDirectories.push({
            entry: { name: dbEntry.id },
            actualProjectDir: dbEntry.path,
            dbEntry: dbEntry
          });
        }
      }
    }

    totalProjects = discoveredDirectories.length;

    for (const { entry, actualProjectDir, dbEntry } of discoveredDirectories) {
        processedProjects++;

        if (progressCallback) {
          progressCallback({ phase: 'loading', current: processedProjects, total: totalProjects, currentProject: entry.name });
        }

        // Get info
        const displayName = dbEntry?.display_name || config[entry.name]?.displayName || await generateDisplayName(entry.name, actualProjectDir);

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
          displayName: displayName,
          fullPath: actualProjectDir,
          isCustomName: !!(dbEntry?.display_name || config[entry.name]?.displayName),
          createdAt: dirCreatedAt,
          isStarred: !!dbEntry?.is_starred,
          sessions: [],
          sessionMeta: { hasMore: false, total: 0 }
        };

        // CLAIM LOGIC: If not assigned, assign to current user now
        if (!dbEntry || !dbEntry.user_id) {
          projectDb.upsertProject(
            entry.name, 
            userId, 
            displayName, 
            actualProjectDir, 
            project.isStarred ? 1 : 0, 
            null,
            config[entry.name]?.manuallyAdded ? { manuallyAdded: true } : null
          );
        }

        // Try to get sessions
        try {
          const sessionResult = await getSessions(entry.name, 5, 0, userId);
          project.sessions = sessionResult.sessions || [];
          project.sessionMeta = { hasMore: sessionResult.hasMore, total: sessionResult.total };
        } catch (e) {
          project.sessionMeta = { hasMore: false, total: 0 };
        }

        // Fetch other sessions
        try { project.cursorSessions = await getCursorSessions(actualProjectDir); } catch (e) {}
        try { project.codexSessions = await getCodexSessions(actualProjectDir, { indexRef: codexSessionsIndexRef }); } catch (e) {}
        try { project.geminiSessions = await getGeminiSessions(actualProjectDir, userId); } catch (e) {}

        // TaskMaster detection
        try {
          const tm = await detectTaskMasterFolder(actualProjectDir);
          project.taskmaster = {
            hasTaskmaster: tm.hasTaskmaster,
            hasEssentialFiles: tm.hasEssentialFiles,
            metadata: tm.metadata,
            status: tm.hasTaskmaster && tm.hasEssentialFiles ? 'configured' : 'not-configured'
          };
          project.pipeline = project.taskmaster;
        } catch (e) {}

      projects.push(project);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Error reading projects directory:', error);
  }

  return projects;
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
          
          // Upsert new sessions discovered from files to DB for caching
          if (!dbSessionMap.has(session.id)) {
            const lastActivity = session.lastActivity instanceof Date ? session.lastActivity.toISOString() : session.lastActivity;
            sessionDb.upsertSession(session.id, projectName, 'claude', session.summary, lastActivity, session.messageCount);
          }
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
      .map(s => ({
        ...s,
        name: s.summary,
        __provider: 'claude'
      }))
      .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

    const total = visibleSessions.length;
    const paginatedSessions = visibleSessions.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

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
                lastAssistantMessage: null
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
              session.summary = entry.summary;
            }

            // Track last user and assistant messages (skip system messages)
            if (entry.message?.role === 'user' && entry.message?.content) {
              const content = entry.message.content;

              // Extract text from array format if needed
              let textContent = content;
              if (Array.isArray(content) && content.length > 0 && content[0].type === 'text') {
                textContent = content[0].text;
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

              if (typeof textContent === 'string' && textContent.length > 0 && !isSystemMessage) {
                session.lastUserMessage = textContent;
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

                // Additional filter for assistant messages with system content
                const isSystemAssistantMessage = typeof assistantText === 'string' && (
                  assistantText.startsWith('Invalid API key') ||
                  assistantText.includes('{"subtasks":') ||
                  assistantText.includes('CRITICAL: You MUST respond with ONLY a JSON')
                );

                if (assistantText && !isSystemAssistantMessage) {
                  session.lastAssistantMessage = assistantText;
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
  const config = await loadProjectConfig();
  const trimmedName = (newDisplayName || '').trim();

  // 1. Update VibeLab Database (Source of Truth)
  const existing = projectDb.getProjectById(projectName);
  if (existing) {
    // Basic security: if project exists but belongs to someone else, don't allow rename
    if (userId && existing.user_id && existing.user_id !== userId) {
      throw new Error('You do not have permission to rename this project');
    }
    projectDb.updateProjectName(projectName, trimmedName);
  } else {
    // If not in DB yet, find its path and upsert for this user
    const actualPath = await extractProjectDirectory(projectName);
    projectDb.upsertProject(projectName, userId, trimmedName, actualPath);
  }

  // 2. Sync back to Claude config (for CLI compatibility)
  if (!trimmedName) {
    // Remove custom name if empty, will fall back to auto-generated
    if (config[projectName]) {
      delete config[projectName].displayName;
      // Only remove the entire entry if no other properties remain
      if (Object.keys(config[projectName]).length === 0) {
        delete config[projectName];
      }
    }
  } else {
    if (!config[projectName]) {
      // If project doesn't exist in config yet, create a skeleton entry
      const actualPath = await extractProjectDirectory(projectName);
      config[projectName] = {
        originalPath: actualPath
      };
    }

    config[projectName].displayName = trimmedName;
  }

  await saveProjectConfig(config);
  return true;
}

// Delete a session from a project
async function deleteSession(projectName, sessionId, provider = 'claude') {
  if (provider === 'gemini') {
    const geminiSessionFile = path.join(os.homedir(), '.gemini', 'sessions', `${sessionId}.jsonl`);
    try {
      await fs.access(geminiSessionFile);
      await fs.unlink(geminiSessionFile);
      console.log(`[Gemini] Deleted session file: ${geminiSessionFile}`);
      return true;
    } catch (e) {
      console.error(`[Gemini] Failed to delete session ${sessionId}:`, e.message);
      throw new Error(`Failed to delete Gemini session: ${e.message}`);
    }
  }

  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) {
      throw new Error('No session files found for this project');
    }

    // Check all JSONL files to find which one contains the session
    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const content = await fs.readFile(jsonlFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());

      // Check if this file contains the session
      const hasSession = lines.some(line => {
        try {
          const data = JSON.parse(line);
          return data.sessionId === sessionId;
        } catch {
          return false;
        }
      });

      if (hasSession) {
        // Filter out all entries for this session
        const filteredLines = lines.filter(line => {
          try {
            const data = JSON.parse(line);
            return data.sessionId !== sessionId;
          } catch {
            return true; // Keep malformed lines
          }
        });

        // Write back the filtered content
        await fs.writeFile(jsonlFile, filteredLines.join('\n') + (filteredLines.length > 0 ? '\n' : ''));
        return true;
      }
    }

    throw new Error(`Session ${sessionId} not found in any files`);
  } catch (error) {
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

// Delete a project (force=true to delete even with sessions)
async function deleteProject(projectName, force = false) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const isEmpty = await isProjectEmpty(projectName);
    if (!isEmpty && !force) {
      throw new Error('Cannot delete project with existing sessions');
    }

    const config = await loadProjectConfig();
    let projectPath = config[projectName]?.path || config[projectName]?.originalPath;

    // Fallback to extractProjectDirectory if projectPath is not in config
    if (!projectPath) {
      projectPath = await extractProjectDirectory(projectName);
    }

    // Remove the project directory (includes all Claude sessions)
    await fs.rm(projectDir, { recursive: true, force: true });

    // Delete the actual project folder from disk
    if (projectPath) {
      try {
        await fs.rm(projectPath, { recursive: true, force: true });
      } catch (err) {
        console.warn(`Failed to delete project folder ${projectPath}:`, err.message);
      }
    }

    // Delete all Codex sessions associated with this project
    if (projectPath) {
      try {
        const codexSessions = await getCodexSessions(projectPath, { limit: 0 });
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

      // Delete Cursor sessions directory if it exists
      try {
        const hash = crypto.createHash('md5').update(projectPath).digest('hex');
        const cursorProjectDir = path.join(os.homedir(), '.cursor', 'chats', hash);
        await fs.rm(cursorProjectDir, { recursive: true, force: true });
      } catch (err) {
        // Cursor dir may not exist, ignore
      }
    }

    // Remove from project config
    delete config[projectName];
    await saveProjectConfig(config);

    return true;
  } catch (error) {
    console.error(`Error deleting project ${projectName}:`, error);
    throw error;
  }
}

/**
 * Create .claude, .agents, .cursor and their skills subdirs in the project,
 * and symlink each VibeLab skill directory into those skills subdirs.
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
    const mappingPath = path.join(VIBELAB_SKILLS_DIR, 'skill-tag-mapping.json');
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
    await fs.access(VIBELAB_SKILLS_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('[projects] VibeLab skills dir not found, skipping skill symlinks:', VIBELAB_SKILLS_DIR);
      return;
    }
    console.error('[projects] Cannot access VibeLab skills dir:', err.message);
    return;
  }

  try {
    const skillDirs = await collectSkillDirs(VIBELAB_SKILLS_DIR);
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

      // Symlink JSON config files from VibeLab root into each project skills folder
      for (const jsonFile of ['skill-tag-mapping.json', 'stage-skill-map.json']) {
        const srcJson = path.join(VIBELAB_SKILLS_DIR, jsonFile);
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
    // Check if the path exists
    await fs.access(absolutePath);
  } catch (error) {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }

  // Generate project name (encode path for use as directory name)
  const projectName = absolutePath.replace(/[\\/:\s~_]/g, '-');

  // Check if project already exists in config
  const config = await loadProjectConfig();

  // 1. Sync to Database (Source of Truth)
  projectDb.upsertProject(projectName, userId, displayName, absolutePath, 0, new Date().toISOString(), { manuallyAdded: true });

  // 2. Sync to Claude Config (compatibility)
  config[projectName] = {
    manuallyAdded: true,
    originalPath: absolutePath
  };

  if (displayName) {
    config[projectName].displayName = displayName;
  }

  await saveProjectConfig(config);

  await ensureProjectSkillLinks(absolutePath);

  let dirCreatedAt = null;
  try {
    const dirStat = await fs.stat(absolutePath);
    dirCreatedAt = dirStat.birthtime.toISOString();
  } catch (_) {}

  return {
    name: projectName,
    path: absolutePath,
    fullPath: absolutePath,
    displayName: displayName || await generateDisplayName(projectName, absolutePath),
    isManuallyAdded: true,
    createdAt: dirCreatedAt,
    sessions: [],
    cursorSessions: []
  };
}

// Fetch Cursor sessions for a given project path
async function getCursorSessions(projectPath) {
  try {
    // Calculate cwdID hash for the project path (Cursor uses MD5 hash)
    const cwdId = crypto.createHash('md5').update(projectPath).digest('hex');
    const cursorChatsPath = path.join(os.homedir(), '.cursor', 'chats', cwdId);

    // Check if the directory exists
    try {
      await fs.access(cursorChatsPath);
    } catch (error) {
      // No sessions for this project
      return [];
    }

    // List all session directories
    const sessionDirs = await fs.readdir(cursorChatsPath);
    const sessions = [];

    for (const sessionId of sessionDirs) {
      const sessionPath = path.join(cursorChatsPath, sessionId);
      const storeDbPath = path.join(sessionPath, 'store.db');

      try {
        // Check if store.db exists
        await fs.access(storeDbPath);

        // Capture store.db mtime as a reliable fallback timestamp
        let dbStatMtimeMs = null;
        try {
          const stat = await fs.stat(storeDbPath);
          dbStatMtimeMs = stat.mtimeMs;
        } catch (_) {}

        // Open SQLite database
        const db = await open({
          filename: storeDbPath,
          driver: sqlite3.Database,
          mode: sqlite3.OPEN_READONLY
        });

        // Get metadata from meta table
        const metaRows = await db.all(`
          SELECT key, value FROM meta
        `);

        // Parse metadata
        let metadata = {};
        for (const row of metaRows) {
          if (row.value) {
            try {
              // Try to decode as hex-encoded JSON
              const hexMatch = row.value.toString().match(/^[0-9a-fA-F]+$/);
              if (hexMatch) {
                const jsonStr = Buffer.from(row.value, 'hex').toString('utf8');
                metadata[row.key] = JSON.parse(jsonStr);
              } else {
                metadata[row.key] = row.value.toString();
              }
            } catch (e) {
              metadata[row.key] = row.value.toString();
            }
          }
        }

        // Get message count
        const messageCountResult = await db.get(`
          SELECT COUNT(*) as count FROM blobs
        `);

        await db.close();

        // Extract session info
        const sessionName = metadata.title || metadata.sessionTitle || 'Untitled Session';

        // Determine timestamp - prefer createdAt from metadata, fall back to db file mtime
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
          createdAt: createdAt,
          lastActivity: createdAt, // For compatibility with Claude sessions
          messageCount: messageCountResult.count || 0,
          projectPath: projectPath
        });

      } catch (error) {
        console.warn(`Could not read Cursor session ${sessionId}:`, error.message);
      }
    }

    // Sort sessions by creation time (newest first)
    sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Return only the first 5 sessions for performance
    return sessions.slice(0, 5);

  } catch (error) {
    console.error('Error fetching Cursor sessions:', error);
    return [];
  }
}


// Fetch Gemini sessions for a given project path
async function getGeminiSessions(projectPath, userId = null) {
  try {
    const { sessionDb } = await import('./database/db.js');
    const normalizedProjectPath = await normalizeComparablePath(projectPath);
    const geminiSessionsDir = path.join(os.homedir(), '.gemini', 'sessions');
    const projectName = encodeProjectPath(projectPath);

    try {
      await fs.access(geminiSessionsDir);
    } catch (error) {
      return [];
    }

    const files = await fs.readdir(geminiSessionsDir);
    const sessions = [];
    
    // Fetch indexed sessions from database for quick lookup
    const dbSessions = sessionDb.getSessionsByProject(projectName);
    const dbSessionMap = new Map(dbSessions.map(s => [s.id, s]));

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const sessionId = path.basename(file, '.jsonl');

      const filePath = path.join(geminiSessionsDir, file);
      try {
        const stats = await fs.stat(filePath);
        
        // If we already have this in DB and it was manually renamed, 
        // we might still need to check if it belongs to this project 
        // if it's not already in the dbSessionMap.
        
        let foundMatchingCwd = false;
        let explicitTitle = null;
        let firstMessageText = null;
        let sessionMessageCount = 0;

        // If we have it in DB, we know it belongs to this project
        if (dbSessionMap.has(sessionId)) {
          foundMatchingCwd = true;
          explicitTitle = dbSessionMap.get(sessionId).display_name;
          sessionMessageCount = dbSessionMap.get(sessionId).message_count || 0;
        }

        // Even if in DB, we might want to scan for message count if it's 0
        if (!foundMatchingCwd || sessionMessageCount === 0) {
          // Read just the first few lines for metadata to index it
          const fileStream = fsSync.createReadStream(filePath);
          const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
          });

          let lineCount = 0;
          let currentSessionMessageCount = 0;

          for await (const line of rl) {
            lineCount++;
            if (line.trim()) {
              try {
                const entry = JSON.parse(line);
                
                // Track message count (user/assistant only)
                if (entry.role === 'user' || entry.role === 'assistant' || 
                    (entry.type === 'message' && (entry.role === 'user' || entry.role === 'assistant'))) {
                  currentSessionMessageCount++;
                }

                // 1. CWD Match
                if (!foundMatchingCwd) {
                  const sessionCwd = entry.cwd || entry.payload?.cwd;
                  if (sessionCwd) {
                    const normalizedSessionCwd = await normalizeComparablePath(sessionCwd);
                    if (normalizedSessionCwd === normalizedProjectPath) {
                      foundMatchingCwd = true;
                    }
                  }
                }

                // 2. Explicit Title
                if (lineCount <= 2000) {
                  const title = entry.summary || entry.title || entry.payload?.title || entry.payload?.summary;
                  if (title && typeof title === 'string' && title.trim() && 
                      !title.includes('Gemini Session') && !title.includes('New Session')) {
                    explicitTitle = title.trim();
                  }

                  // 3. User Message Extraction
                  if (!firstMessageText && (entry.role === 'user' || (entry.type === 'message' && entry.role === 'user'))) {
                    let content = entry.content || entry.message?.content || entry.payload?.message?.content;
                    if (content) {
                      let textContent = typeof content === 'string' ? content : 
                        Array.isArray(content) ? content.map(part => part.text || (typeof part === 'string' ? part : '')).join(' ') : '';

                      if (textContent.trim()) {
                        let cleaned = textContent.trim();
                        if (!cleaned.includes('Base directory for this skill:') && !cleaned.startsWith('<command-name>')) {
                          const helpMatch = cleaned.match(/Please help me with ["'](.*?)["']/);
                          firstMessageText = helpMatch ? helpMatch[1] : cleaned.split('\n')[0].replace(/#+\s*/, '').trim();
                        }
                      }
                    }
                  }
                }
              } catch (e) {}
            }
          }
          sessionMessageCount = currentSessionMessageCount;
          rl.close();
        }

        if (foundMatchingCwd) {
          let finalName = explicitTitle || firstMessageText;
          if (finalName) {
            finalName = finalName.replace(/[\*\_\`]/g, '');
            if (finalName.length > 50) finalName = finalName.substring(0, 47) + '...';
          } else {
            finalName = 'Untitled Session';
          }

          // Upsert to database so next time is faster
          sessionDb.upsertSession(sessionId, projectName, 'gemini', finalName, stats.mtime.toISOString(), sessionMessageCount);

          sessions.push({
            id: sessionId,
            name: finalName,
            createdAt: stats.birthtime.toISOString(),
            lastActivity: stats.mtime.toISOString(),
            messageCount: sessionMessageCount,
            projectPath: projectPath,
            __provider: 'gemini'
          });
        }
      } catch (err) {}
    }

    if (sessions.length > 0) {
      console.log(`[Gemini] Found ${sessions.length} sessions for project ${projectPath}`);
    }
    return sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity)).slice(0, 5);
  } catch (error) {
    console.error('Error fetching Gemini sessions:', error);
    return [];
  }
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
        name: sessionData.summary || 'Codex Session',
        messageCount: sessionData.messageCount || 0,
        lastActivity: sessionData.timestamp ? new Date(sessionData.timestamp) : new Date(),
        cwd: sessionData.cwd,
        model: sessionData.model,
        filePath,
        provider: 'codex',
        __provider: 'codex'
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
  const { limit = 5, indexRef = null } = options;
  try {
    const normalizedProjectPath = await normalizeComparablePath(projectPath);
    if (!normalizedProjectPath) {
      return [];
    }

    if (indexRef && !indexRef.sessionsByProject) {
      indexRef.sessionsByProject = await buildCodexSessionsIndex();
    }

    const sessionsByProject = indexRef?.sessionsByProject || await buildCodexSessionsIndex();
    const sessions = sessionsByProject.get(normalizedProjectPath) || [];

    // Return limited sessions for performance (0 = unlimited for deletion)
    return limit > 0 ? sessions.slice(0, limit) : [...sessions];

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
              lastUserMessage = entry.payload.message;
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

    // Find the session file by searching for the session ID
    const findSessionFile = async (dir) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const found = await findSessionFile(fullPath);
            if (found) return found;
          } else if (entry.name.includes(sessionId) && entry.name.endsWith('.jsonl')) {
            return fullPath;
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
      return null;
    };

    const sessionFilePath = await findSessionFile(codexSessionsDir);

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
    const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');

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

    for (const filePath of jsonlFiles) {
      const sessionData = await parseCodexSessionFile(filePath);
      if (sessionData && sessionData.id === sessionId) {
        await fs.unlink(filePath);
        return true;
      }
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
  return config._workspacesRoot || null;
}

// Save workspace root to project config
async function setWorkspaceRootInConfig(workspacesRoot) {
  const config = await loadProjectConfig();
  if (workspacesRoot) {
    config._workspacesRoot = workspacesRoot;
  } else {
    delete config._workspacesRoot;
  }
  await saveProjectConfig(config);
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
      
      // Also update VibeLab's own index (source of truth)
      sessionDb.upsertSession(sessionId, projectName, provider, trimmedSummary, new Date().toISOString());
      
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

      // Update VibeLab's own index
      sessionDb.upsertSession(sessionId, projectName, provider, trimmedSummary, new Date().toISOString());

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

          // Update VibeLab's own index
          sessionDb.upsertSession(sessionId, projectName, provider, trimmedSummary, new Date().toISOString());

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
  getSessions,
  getSessionMessages,
  parseJsonlSessions,
  renameProject,
  renameSession,
  deleteSession,
  isProjectEmpty,
  deleteProject,
  addProjectManually,
  loadProjectConfig,
  saveProjectConfig,
  extractProjectDirectory,
  clearProjectDirectoryCache,
  getCodexSessions,
  getGeminiSessions,
  getCodexSessionMessages,
  deleteCodexSession,
  ensureProjectSkillLinks,
  getWorkspaceRootFromConfig,
  setWorkspaceRootInConfig
};
