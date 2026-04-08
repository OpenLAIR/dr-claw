import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { stripInternalContextPrefix } from '../utils/sessionFormatting.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
};

const c = {
    info: (text) => `${colors.cyan}${text}${colors.reset}`,
    bright: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

const DEFAULT_STAGE_TAGS = [
  { tagKey: 'survey', label: 'Survey', color: 'sky', sortOrder: 10 },
  { tagKey: 'ideation', label: 'Ideation', color: 'amber', sortOrder: 20 },
  { tagKey: 'experiment', label: 'Experiment', color: 'cyan', sortOrder: 30 },
  { tagKey: 'publication', label: 'Publication', color: 'purple', sortOrder: 40 },
  { tagKey: 'promotion', label: 'Promotion', color: 'pink', sortOrder: 50 },
];
const STAGE_TAG_DECISIONS_KEY = 'stageTagDecisions';

// Use DATABASE_PATH environment variable if set, otherwise use default location
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'auth.db');
const INIT_SQL_PATH = path.join(__dirname, 'init.sql');

// Ensure database directory exists if custom path is provided
if (process.env.DATABASE_PATH) {
  const dbDir = path.dirname(DB_PATH);
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log(`Created database directory: ${dbDir}`);
    }
  } catch (error) {
    console.error(`Failed to create database directory ${dbDir}:`, error.message);
    throw error;
  }
}

// Migrate legacy local DB (repo install path) into the configured DB path.
const LEGACY_DB_PATH = path.join(__dirname, 'auth.db');
if (DB_PATH !== LEGACY_DB_PATH && !fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
  try {
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
    console.log(`[MIGRATION] Copied database from ${LEGACY_DB_PATH} to ${DB_PATH}`);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(LEGACY_DB_PATH + suffix)) {
        fs.copyFileSync(LEGACY_DB_PATH + suffix, DB_PATH + suffix);
      }
    }
  } catch (err) {
    console.warn(`[MIGRATION] Could not copy legacy database: ${err.message}`);
  }
}

// Create database connection
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

// Show app installation path prominently
const appInstallPath = path.join(__dirname, '../..');
console.log('');
console.log(c.dim('═'.repeat(60)));
console.log(`${c.info('[INFO]')} App Installation: ${c.bright(appInstallPath)}`);
console.log(`${c.info('[INFO]')} Database: ${c.dim(path.relative(appInstallPath, DB_PATH))}`);
if (process.env.DATABASE_PATH) {
  console.log(`       ${c.dim('(Using custom DATABASE_PATH from environment)')}`);
}
console.log(c.dim('═'.repeat(60)));
console.log('');

const runMigrations = () => {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(users)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('git_name')) {
      console.log('Running migration: Adding git_name column');
      db.exec('ALTER TABLE users ADD COLUMN git_name TEXT');
    }

    if (!columnNames.includes('git_email')) {
      console.log('Running migration: Adding git_email column');
      db.exec('ALTER TABLE users ADD COLUMN git_email TEXT');
    }

    if (!columnNames.includes('has_completed_onboarding')) {
      console.log('Running migration: Adding has_completed_onboarding column');
      db.exec('ALTER TABLE users ADD COLUMN has_completed_onboarding BOOLEAN DEFAULT 0');
    }

    if (!columnNames.includes('notification_email')) {
      console.log('Running migration: Adding notification_email column');
      db.exec('ALTER TABLE users ADD COLUMN notification_email TEXT');
    }

    // Migration: add FK from project_references.project_id → projects(id)
    const prInfo = db.prepare("PRAGMA table_info(project_references)").all();
    if (prInfo.length > 0) {
      const fkList = db.prepare("PRAGMA foreign_key_list(project_references)").all();
      const hasProjectFk = fkList.some(fk => fk.table === 'projects');
      if (!hasProjectFk) {
        console.log('Running migration: Recreating project_references with FK to projects');
        db.exec(`
          CREATE TABLE IF NOT EXISTS project_references_new (
            project_id TEXT NOT NULL,
            reference_id TEXT NOT NULL,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, reference_id),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE CASCADE
          );
          INSERT OR IGNORE INTO project_references_new (project_id, reference_id, added_at)
            SELECT project_id, reference_id, added_at FROM project_references;
          DROP TABLE project_references;
          ALTER TABLE project_references_new RENAME TO project_references;
          CREATE INDEX IF NOT EXISTS idx_project_references_project ON project_references(project_id);
        `);
      }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS project_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        tag_key TEXT NOT NULL,
        tag_type TEXT NOT NULL,
        label TEXT NOT NULL,
        color TEXT,
        sort_order INTEGER DEFAULT 0,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_name, tag_type, tag_key)
      );
      CREATE INDEX IF NOT EXISTS idx_project_tags_project ON project_tags(project_name);
      CREATE INDEX IF NOT EXISTS idx_project_tags_type ON project_tags(tag_type);
      CREATE TABLE IF NOT EXISTS session_tag_links (
        session_id TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        linked_by TEXT,
        source TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, tag_id),
        FOREIGN KEY (session_id) REFERENCES session_metadata(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES project_tags(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_session_tag_links_session ON session_tag_links(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_tag_links_tag ON session_tag_links(tag_id);
    `);

    // Migration: user_memories table
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        is_enabled BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_user_memories_user ON user_memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_memories_enabled ON user_memories(is_enabled);
    `);

    console.log('Database migrations completed successfully');
  } catch (error) {
    console.error('Error running migrations:', error.message);
    throw error;
  }
};

// Initialize database with schema
const initializeDatabase = async () => {
  try {
    const initSQL = fs.readFileSync(INIT_SQL_PATH, 'utf8');
    db.exec(initSQL);
    console.log('Database initialized successfully');
    runMigrations();
  } catch (error) {
    console.error('Error initializing database:', error.message);
    throw error;
  }
};

// User database operations
const userDb = {
  // Check if any users exist
  hasUsers: () => {
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM users').get();
      return row.count > 0;
    } catch (err) {
      throw err;
    }
  },

  // Create a new user
  createUser: (username, passwordHash, notificationEmail = null) => {
    try {
      const stmt = db.prepare('INSERT INTO users (username, password_hash, notification_email) VALUES (?, ?, ?)');
      const result = stmt.run(username, passwordHash, notificationEmail);
      return { id: result.lastInsertRowid, username, notification_email: notificationEmail };
    } catch (err) {
      throw err;
    }
  },

  // Get user by username
  getUserByUsername: (username) => {
    try {
      const row = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
      return row;
    } catch (err) {
      throw err;
    }
  },

  resetSingleUser: () => {
    try {
      db.prepare('DELETE FROM users').run();
    } catch (err) {
      throw err;
    }
  },

  // Update last login time (non-fatal)
  updateLastLogin: (userId) => {
    try {
      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
    } catch (err) {
      console.warn('Failed to update last login:', err.message);
    }
  },

  // Get user by ID
  getUserById: (userId) => {
    try {
      const row = db.prepare('SELECT id, username, notification_email, created_at, last_login FROM users WHERE id = ? AND is_active = 1').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  getFirstUser: () => {
    try {
      const row = db.prepare('SELECT id, username, notification_email, created_at, last_login FROM users WHERE is_active = 1 LIMIT 1').get();
      return row;
    } catch (err) {
      throw err;
    }
  },

  updateGitConfig: (userId, gitName, gitEmail) => {
    try {
      const stmt = db.prepare('UPDATE users SET git_name = ?, git_email = ? WHERE id = ?');
      stmt.run(gitName, gitEmail, userId);
    } catch (err) {
      throw err;
    }
  },

  getGitConfig: (userId) => {
    try {
      const row = db.prepare('SELECT git_name, git_email FROM users WHERE id = ?').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  completeOnboarding: (userId) => {
    try {
      const stmt = db.prepare('UPDATE users SET has_completed_onboarding = 1 WHERE id = ?');
      stmt.run(userId);
    } catch (err) {
      throw err;
    }
  },

  hasCompletedOnboarding: (userId) => {
    try {
      const row = db.prepare('SELECT has_completed_onboarding FROM users WHERE id = ?').get(userId);
      return row?.has_completed_onboarding === 1;
    } catch (err) {
      throw err;
    }
  },

  getProfile: (userId) => {
    try {
      return db.prepare('SELECT id, username, notification_email FROM users WHERE id = ? AND is_active = 1').get(userId);
    } catch (err) {
      throw err;
    }
  },

  updateProfile: (userId, notificationEmail) => {
    try {
      db.prepare('UPDATE users SET notification_email = ? WHERE id = ?').run(notificationEmail, userId);
      return userDb.getProfile(userId);
    } catch (err) {
      throw err;
    }
  }
};

const autoResearchDb = {
  createRun: (input) => {
    try {
      db.prepare(`
        INSERT INTO auto_research_runs (
          id, user_id, project_name, project_path, provider, status, session_id,
          current_task_id, completed_tasks, total_tasks, error, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.userId,
        input.projectName,
        input.projectPath,
        input.provider || 'claude',
        input.status || 'queued',
        input.sessionId || null,
        input.currentTaskId || null,
        input.completedTasks || 0,
        input.totalTasks || 0,
        input.error || null,
        input.metadata ? JSON.stringify(input.metadata) : null
      );
      return autoResearchDb.getRunById(input.id);
    } catch (err) {
      throw err;
    }
  },

  getRunById: (runId) => {
    try {
      const row = db.prepare('SELECT * FROM auto_research_runs WHERE id = ?').get(runId);
      return row ? {
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      } : null;
    } catch (err) {
      throw err;
    }
  },

  getLatestRunForProject: (userId, projectName) => {
    try {
      const row = db.prepare(`
        SELECT * FROM auto_research_runs
        WHERE user_id = ? AND project_name = ?
        ORDER BY started_at DESC
        LIMIT 1
      `).get(userId, projectName);
      return row ? {
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      } : null;
    } catch (err) {
      throw err;
    }
  },

  getActiveRunForProject: (userId, projectName) => {
    try {
      const row = db.prepare(`
        SELECT * FROM auto_research_runs
        WHERE user_id = ? AND project_name = ? AND status IN ('queued', 'running', 'cancelling')
        ORDER BY started_at DESC
        LIMIT 1
      `).get(userId, projectName);
      return row ? {
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      } : null;
    } catch (err) {
      throw err;
    }
  },

  updateRun: (runId, updates = {}) => {
    try {
      const existing = autoResearchDb.getRunById(runId);
      if (!existing) {
        return null;
      }

      const mergedMetadata = Object.prototype.hasOwnProperty.call(updates, 'metadata')
        ? updates.metadata
        : existing.metadata;

      db.prepare(`
        UPDATE auto_research_runs
        SET
          status = ?,
          session_id = ?,
          current_task_id = ?,
          completed_tasks = ?,
          total_tasks = ?,
          error = ?,
          metadata = ?,
          finished_at = ?,
          email_sent_at = ?
        WHERE id = ?
      `).run(
        updates.status ?? existing.status,
        updates.sessionId ?? existing.session_id,
        updates.currentTaskId ?? existing.current_task_id,
        updates.completedTasks ?? existing.completed_tasks,
        updates.totalTasks ?? existing.total_tasks,
        updates.error ?? existing.error,
        mergedMetadata ? JSON.stringify(mergedMetadata) : null,
        updates.finishedAt ?? existing.finished_at,
        updates.emailSentAt ?? existing.email_sent_at,
        runId
      );

      return autoResearchDb.getRunById(runId);
    } catch (err) {
      throw err;
    }
  },
};

const appSettingsDb = {
  get: (key) => {
    try {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
      return row ? row.value : null;
    } catch (err) {
      throw err;
    }
  },

  set: (key, value) => {
    try {
      db.prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(key, value);
      return appSettingsDb.get(key);
    } catch (err) {
      throw err;
    }
  },
};

// API Keys database operations
const apiKeysDb = {
  // Generate a new API key
  generateApiKey: () => {
    return 'ck_' + crypto.randomBytes(32).toString('hex');
  },

  // Create a new API key
  createApiKey: (userId, keyName) => {
    try {
      const apiKey = apiKeysDb.generateApiKey();
      const stmt = db.prepare('INSERT INTO api_keys (user_id, key_name, api_key) VALUES (?, ?, ?)');
      const result = stmt.run(userId, keyName, apiKey);
      return { id: result.lastInsertRowid, keyName, apiKey };
    } catch (err) {
      throw err;
    }
  },

  // Get all API keys for a user
  getApiKeys: (userId) => {
    try {
      const rows = db.prepare('SELECT id, key_name, api_key, created_at, last_used, is_active FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Validate API key and get user
  validateApiKey: (apiKey) => {
    try {
      const row = db.prepare(`
        SELECT u.id, u.username, ak.id as api_key_id
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.api_key = ? AND ak.is_active = 1 AND u.is_active = 1
      `).get(apiKey);

      if (row) {
        // Update last_used timestamp
        db.prepare('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(row.api_key_id);
      }

      return row;
    } catch (err) {
      throw err;
    }
  },

  // Delete an API key
  deleteApiKey: (userId, apiKeyId) => {
    try {
      const stmt = db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?');
      const result = stmt.run(apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle API key active status
  toggleApiKey: (userId, apiKeyId, isActive) => {
    try {
      const stmt = db.prepare('UPDATE api_keys SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

// User credentials database operations (for GitHub tokens, GitLab tokens, etc.)
const credentialsDb = {
  // Create a new credential
  createCredential: (userId, credentialName, credentialType, credentialValue, description = null) => {
    try {
      const stmt = db.prepare('INSERT INTO user_credentials (user_id, credential_name, credential_type, credential_value, description) VALUES (?, ?, ?, ?, ?)');
      const result = stmt.run(userId, credentialName, credentialType, credentialValue, description);
      return { id: result.lastInsertRowid, credentialName, credentialType };
    } catch (err) {
      throw err;
    }
  },

  // Get all credentials for a user, optionally filtered by type
  getCredentials: (userId, credentialType = null) => {
    try {
      let query = 'SELECT id, credential_name, credential_type, description, created_at, is_active FROM user_credentials WHERE user_id = ?';
      const params = [userId];

      if (credentialType) {
        query += ' AND credential_type = ?';
        params.push(credentialType);
      }

      query += ' ORDER BY created_at DESC';

      const rows = db.prepare(query).all(...params);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Get active credential value for a user by type (returns most recent active)
  getActiveCredential: (userId, credentialType) => {
    try {
      const row = db.prepare('SELECT credential_value FROM user_credentials WHERE user_id = ? AND credential_type = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1').get(userId, credentialType);
      return row?.credential_value || null;
    } catch (err) {
      throw err;
    }
  },

  // Delete a credential
  deleteCredential: (userId, credentialId) => {
    try {
      const stmt = db.prepare('DELETE FROM user_credentials WHERE id = ? AND user_id = ?');
      const result = stmt.run(credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle credential active status
  toggleCredential: (userId, credentialId, isActive) => {
    try {
      const stmt = db.prepare('UPDATE user_credentials SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

// Backward compatibility - keep old names pointing to new system
const githubTokensDb = {
  createGithubToken: (userId, tokenName, githubToken, description = null) => {
    return credentialsDb.createCredential(userId, tokenName, 'github_token', githubToken, description);
  },
  getGithubTokens: (userId) => {
    return credentialsDb.getCredentials(userId, 'github_token');
  },
  getActiveGithubToken: (userId) => {
    return credentialsDb.getActiveCredential(userId, 'github_token');
  },
  deleteGithubToken: (userId, tokenId) => {
    return credentialsDb.deleteCredential(userId, tokenId);
  },
  toggleGithubToken: (userId, tokenId, isActive) => {
    return credentialsDb.toggleCredential(userId, tokenId, isActive);
  }
};

// Session metadata index operations
function parseSessionRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    tags: Array.isArray(row.tags) ? row.tags : [],
  };
}

function parseTagRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    projectName: row.project_name,
    tagKey: row.tag_key,
    tagType: row.tag_type,
    label: row.label,
    color: row.color ?? null,
    sortOrder: row.sort_order,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.created_at,
    source: row.source ?? null,
    linkedBy: row.linked_by ?? null,
    linkedAt: row.linked_at ?? null,
    linkMetadata: row.link_metadata ? JSON.parse(row.link_metadata) : null,
  };
}

function normalizeSessionDisplayName(displayName) {
  if (displayName === null || displayName === undefined) {
    return null;
  }

  return stripInternalContextPrefix(displayName);
}

function normalizeSessionTimestamp(timestamp) {
  if (!timestamp) {
    return null;
  }

  const value = timestamp instanceof Date ? timestamp.toISOString() : String(timestamp).trim();
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

// Returns "YYYY-MM-DD HH:MM:SS" format for SQLite created_at column convention
function normalizeSessionCreatedAt(timestamp) {
  if (!timestamp) {
    return null;
  }

  const value = timestamp instanceof Date ? timestamp.toISOString() : String(timestamp).trim();
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().replace('T', ' ').slice(0, 19);
  }

  return value;
}

function mergeSessionMetadata(existingMetadata, incomingMetadata) {
  const base = existingMetadata && typeof existingMetadata === 'object' ? existingMetadata : {};
  const incoming = incomingMetadata && typeof incomingMetadata === 'object' ? incomingMetadata : {};
  return {
    ...base,
    ...incoming,
  };
}

function resolveLatestActivity(existingActivity, incomingActivity) {
  const normalizedExisting = normalizeSessionTimestamp(existingActivity);
  const normalizedIncoming = normalizeSessionTimestamp(incomingActivity);
  if (!normalizedExisting) {
    return normalizedIncoming;
  }
  if (!normalizedIncoming) {
    return normalizedExisting;
  }

  const existingTime = new Date(normalizedExisting).getTime();
  const incomingTime = new Date(normalizedIncoming).getTime();
  if (Number.isNaN(existingTime)) {
    return normalizedIncoming;
  }
  if (Number.isNaN(incomingTime)) {
    return normalizedExisting;
  }

  return incomingTime >= existingTime ? normalizedIncoming : normalizedExisting;
}

function resolveMessageCount(existingCount, incomingCount) {
  const normalizedExisting = Number(existingCount || 0);
  const normalizedIncoming = Number(incomingCount || 0);
  return Math.max(normalizedExisting, normalizedIncoming);
}

function normalizeMetadataObject(metadata) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...metadata }
    : {};
}

function serializeMetadata(metadata) {
  const normalized = normalizeMetadataObject(metadata);
  return Object.keys(normalized).length > 0 ? JSON.stringify(normalized) : null;
}

function getStageTagDecisions(metadata) {
  const metadataObject = normalizeMetadataObject(metadata);
  const decisions = metadataObject[STAGE_TAG_DECISIONS_KEY];
  return decisions && typeof decisions === 'object' && !Array.isArray(decisions)
    ? { ...decisions }
    : {};
}

function applyManualStageTagDecisions(existingMetadata, projectStageTags = [], selectedTags = []) {
  const metadataObject = normalizeMetadataObject(existingMetadata);
  const decisions = getStageTagDecisions(metadataObject);
  const selectedStageKeys = new Set(
    (Array.isArray(selectedTags) ? selectedTags : [])
      .filter((tag) => tag?.tagType === 'stage')
      .map((tag) => tag.tagKey)
      .filter(Boolean)
  );
  const timestamp = new Date().toISOString();

  (Array.isArray(projectStageTags) ? projectStageTags : []).forEach((tag) => {
    const tagKey = tag?.tagKey || tag?.tag_key;
    if (!tagKey) {
      return;
    }

    decisions[tagKey] = {
      decision: selectedStageKeys.has(tagKey) ? 'selected' : 'excluded',
      source: 'manual',
      updatedAt: timestamp,
    };
  });

  metadataObject[STAGE_TAG_DECISIONS_KEY] = decisions;
  return metadataObject;
}

function isAutomaticStageTagBlocked(metadata, tagType, tagKey, source) {
  if (tagType !== 'stage' || !tagKey || source === 'manual') {
    return false;
  }

  const decisions = getStageTagDecisions(metadata);
  const decision = decisions[tagKey];
  return decision?.decision === 'excluded' && decision?.source === 'manual';
}

function hydrateSessionRowsWithTags(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const sessionIds = Array.from(new Set(rows.map((row) => row?.id).filter(Boolean)));
  if (sessionIds.length === 0) {
    return rows.map(parseSessionRow).filter(Boolean);
  }

  // SQLite default SQLITE_MAX_VARIABLE_NUMBER is 999; use 900 to leave headroom.
  const chunkSize = 900;
  const tagsBySessionId = new Map();

  for (let index = 0; index < sessionIds.length; index += chunkSize) {
    const chunk = sessionIds.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => '?').join(', ');
    const tagRows = db.prepare(`
      SELECT
        stl.session_id,
        pt.id,
        pt.project_name,
        pt.tag_key,
        pt.tag_type,
        pt.label,
        pt.color,
        pt.sort_order,
        pt.metadata,
        pt.created_at,
        stl.linked_by,
        stl.source,
        stl.metadata AS link_metadata,
        stl.created_at AS linked_at
      FROM session_tag_links stl
      JOIN project_tags pt ON pt.id = stl.tag_id
      WHERE stl.session_id IN (${placeholders})
      ORDER BY pt.sort_order ASC, pt.label COLLATE NOCASE ASC, pt.id ASC
    `).all(...chunk);

    tagRows.forEach((tagRow) => {
      const parsed = parseTagRow(tagRow);
      if (!parsed) {
        return;
      }

      const existing = tagsBySessionId.get(tagRow.session_id) || [];
      existing.push(parsed);
      tagsBySessionId.set(tagRow.session_id, existing);
    });
  }

  return rows.map((row) => parseSessionRow({
    ...row,
    tags: tagsBySessionId.get(row.id) || [],
  })).filter(Boolean);
}

const sessionDb = {
  // Upsert session metadata (insert if not exists, update if exists)
  upsertSession: (id, projectName, provider, displayName, lastActivity, messageCount = 0, metadata = null) => {
    try {
      sessionDb.upsertSessionFromSource(id, projectName, provider, {
        displayName,
        lastActivity,
        messageCount,
        metadata,
      });
    } catch (err) {
      console.error('Error upserting session metadata:', err.message);
    }
  },

  upsertSessionPlaceholder: (id, projectName, provider, displayName = null, lastActivity = null, metadata = null) => {
    try {
      const existing = parseSessionRow(db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(id));
      const cleanedDisplayName = normalizeSessionDisplayName(displayName);
      const mergedMetadata = mergeSessionMetadata(existing?.metadata, metadata);
      const normalizedLastActivity = resolveLatestActivity(existing?.last_activity, lastActivity);

      if (!existing) {
        db.prepare(`
          INSERT INTO session_metadata (id, project_name, provider, display_name, last_activity, message_count, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          projectName,
          provider,
          cleanedDisplayName,
          normalizedLastActivity,
          0,
          Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null,
          normalizeSessionCreatedAt(lastActivity) || normalizeSessionCreatedAt(new Date())
        );
        return;
      }

      db.prepare(`
        UPDATE session_metadata
        SET project_name = ?,
            provider = ?,
            last_activity = ?,
            metadata = ?,
            display_name = CASE
              WHEN display_name IS NULL OR trim(display_name) = '' THEN ?
              ELSE display_name
            END
        WHERE id = ?
      `).run(
        projectName,
        provider,
        normalizedLastActivity,
        Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null,
        cleanedDisplayName,
        id
      );
    } catch (err) {
      console.error('Error upserting placeholder session metadata:', err.message);
    }
  },

  upsertSessionFromSource: (id, projectName, provider, payload = {}) => {
    try {
      const existing = parseSessionRow(db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(id));
      const incomingDisplayName = normalizeSessionDisplayName(payload.displayName);
      const mergedMetadata = mergeSessionMetadata(existing?.metadata, payload.metadata);
      const normalizedLastActivity = resolveLatestActivity(existing?.last_activity, payload.lastActivity);
      const resolvedMessageCount = resolveMessageCount(existing?.message_count, payload.messageCount);
      const createdAt =
        existing?.created_at ||
        normalizeSessionCreatedAt(payload.createdAt) ||
        normalizeSessionCreatedAt(payload.lastActivity) ||
        normalizeSessionCreatedAt(new Date());
      const resolvedStarred = Number(payload.isStarred ?? existing?.is_starred ?? 0);

      if (!existing) {
        db.prepare(`
          INSERT INTO session_metadata (id, project_name, provider, display_name, last_activity, message_count, is_starred, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          projectName,
          provider,
          incomingDisplayName,
          normalizedLastActivity,
          resolvedMessageCount,
          resolvedStarred,
          Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null,
          createdAt
        );
        return;
      }

      db.prepare(`
        UPDATE session_metadata
        SET project_name = ?,
            provider = ?,
            display_name = ?,
            last_activity = ?,
            message_count = ?,
            is_starred = ?,
            metadata = ?
        WHERE id = ?
      `).run(
        projectName || existing.project_name,
        provider || existing.provider,
        incomingDisplayName || existing.display_name,
        normalizedLastActivity,
        resolvedMessageCount,
        resolvedStarred,
        Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null,
        id
      );
    } catch (err) {
      console.error('Error upserting session metadata from source:', err.message);
    }
  },

  // Update session name ONLY (priority for manual rename)
  updateSessionName: (id, displayName) => {
    try {
      const cleanedDisplayName = normalizeSessionDisplayName(displayName);
      const stmt = db.prepare('UPDATE session_metadata SET display_name = ? WHERE id = ?');
      stmt.run(cleanedDisplayName, id);
    } catch (err) {
      console.error('Error updating session name:', err.message);
    }
  },

  migrateSessionId: (oldId, newId, provider = null, projectName = null) => {
    try {
      if (!oldId || !newId || oldId === newId) {
        return;
      }

      const oldRow = parseSessionRow(db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(oldId));
      if (!oldRow) {
        return;
      }

      const newRow = parseSessionRow(db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(newId));
      const mergedMetadata = mergeSessionMetadata(oldRow.metadata, newRow?.metadata);
      const mergedLastActivity = resolveLatestActivity(oldRow.last_activity, newRow?.last_activity);
      const mergedMessageCount = resolveMessageCount(oldRow.message_count, newRow?.message_count);
      const mergedDisplayName =
        normalizeSessionDisplayName(newRow?.display_name) ||
        normalizeSessionDisplayName(oldRow.display_name);
      const mergedCreatedAt = newRow?.created_at || oldRow.created_at || normalizeSessionCreatedAt(mergedLastActivity) || normalizeSessionCreatedAt(new Date());
      const mergedStarred = Number(newRow?.is_starred || oldRow.is_starred || 0);

      const migrate = db.transaction(() => {
        if (!newRow) {
          db.prepare(`
            INSERT INTO session_metadata (id, project_name, provider, display_name, last_activity, message_count, is_starred, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            newId,
            projectName || oldRow.project_name,
            provider || oldRow.provider,
            mergedDisplayName,
            mergedLastActivity,
            mergedMessageCount,
            mergedStarred,
            Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null,
            mergedCreatedAt
          );
        } else {
          db.prepare(`
            UPDATE session_metadata
            SET project_name = ?,
                provider = ?,
                display_name = ?,
                last_activity = ?,
                message_count = ?,
                is_starred = ?,
                metadata = ?,
                created_at = ?
            WHERE id = ?
          `).run(
            projectName || newRow.project_name || oldRow.project_name,
            provider || newRow.provider || oldRow.provider,
            mergedDisplayName,
            mergedLastActivity,
            mergedMessageCount,
            mergedStarred,
            Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null,
            mergedCreatedAt,
            newId
          );
        }

        db.prepare('DELETE FROM session_metadata WHERE id = ?').run(oldId);
      });

      migrate();
    } catch (err) {
      console.error('Error migrating session metadata ID:', err.message);
    }
  },

  // Get all metadata for sessions in a project
  getSessionsByProject: (projectName) => {
    try {
      const rows = db.prepare('SELECT * FROM session_metadata WHERE project_name = ?').all(projectName);
      return hydrateSessionRowsWithTags(rows);
    } catch (err) {
      console.error('Error getting project sessions:', err.message);
      return [];
    }
  },

  getSessionsByProjects: (projectNames = []) => {
    try {
      if (!Array.isArray(projectNames) || projectNames.length === 0) {
        return [];
      }

      // SQLite default SQLITE_MAX_VARIABLE_NUMBER is 999; use 900 to leave headroom.
  const chunkSize = 900;
      const allRows = [];

      for (let index = 0; index < projectNames.length; index += chunkSize) {
        const chunk = projectNames.slice(index, index + chunkSize);
        const placeholders = chunk.map(() => '?').join(', ');
        const rows = db.prepare(
          `SELECT * FROM session_metadata WHERE project_name IN (${placeholders}) ORDER BY datetime(last_activity) DESC, datetime(created_at) DESC`
        ).all(...chunk);
        allRows.push(...rows);
      }

      return hydrateSessionRowsWithTags(allRows);
    } catch (err) {
      console.error('Error getting sessions for projects:', err.message);
      return [];
    }
  },

  // Get metadata for a specific session
  getSessionById: (id) => {
    try {
      return hydrateSessionRowsWithTags([
        db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(id)
      ])[0] || null;
    } catch (err) {
      console.error('Error getting session metadata:', err.message);
      return null;
    }
  },

  updateSessionMetadata: (id, updater) => {
    try {
      const row = db.prepare('SELECT metadata FROM session_metadata WHERE id = ?').get(id);
      if (!row) {
        return null;
      }

      const currentMetadata = row.metadata ? JSON.parse(row.metadata) : null;
      const nextMetadata = typeof updater === 'function'
        ? updater(normalizeMetadataObject(currentMetadata))
        : mergeSessionMetadata(currentMetadata, updater);

      db.prepare('UPDATE session_metadata SET metadata = ? WHERE id = ?').run(
        serializeMetadata(nextMetadata),
        id
      );

      return sessionDb.getSessionById(id);
    } catch (err) {
      console.error('Error updating session metadata:', err.message);
      return null;
    }
  },

  getSessionContextReview: (id) => {
    try {
      const session = sessionDb.getSessionById(id);
      const files = session?.metadata?.contextReview?.files;
      return files && typeof files === 'object' ? files : {};
    } catch (err) {
      console.error('Error getting session context review state:', err.message);
      return {};
    }
  },

  updateSessionContextReview: (id, reviews = {}) => {
    try {
      const existingReviews = sessionDb.getSessionContextReview(id);
      const sanitizedReviews = Object.entries(reviews || {}).reduce((acc, [filePath, value]) => {
        if (!filePath || typeof filePath !== 'string') {
          return acc;
        }

        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return acc;
        }

        const reviewedAt = typeof value.reviewedAt === 'string' ? value.reviewedAt : null;
        const lastSeenAt = typeof value.lastSeenAt === 'string' ? value.lastSeenAt : null;
        const lastReviewedSeenAt = typeof value.lastReviewedSeenAt === 'string' ? value.lastReviewedSeenAt : null;

        acc[filePath] = {
          reviewedAt,
          lastSeenAt,
          lastReviewedSeenAt,
        };
        return acc;
      }, {});

      const nextFiles = {
        ...existingReviews,
        ...sanitizedReviews,
      };

      sessionDb.updateSessionMetadata(id, {
        contextReview: {
          files: nextFiles,
          updatedAt: new Date().toISOString(),
        },
      });

      return nextFiles;
    } catch (err) {
      console.error('Error updating session context review state:', err.message);
      return {};
    }
  },

  deleteSession: (id) => {
    try {
      db.prepare('DELETE FROM session_metadata WHERE id = ?').run(id);
    } catch (err) {
      console.error('Error deleting session metadata:', err.message);
    }
  },

  deleteSessionsByProject: (projectName) => {
    try {
      db.prepare('DELETE FROM session_metadata WHERE project_name = ?').run(projectName);
    } catch (err) {
      console.error('Error deleting project session metadata:', err.message);
    }
  }
};

const tagDb = {
  ensureDefaultStageTags: (projectName) => {
    if (!projectName) {
      return [];
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO project_tags (
        project_name, tag_key, tag_type, label, color, sort_order, metadata
      ) VALUES (?, ?, 'stage', ?, ?, ?, ?)
    `);

    const run = db.transaction(() => {
      DEFAULT_STAGE_TAGS.forEach((tag) => {
        insert.run(
          projectName,
          tag.tagKey,
          tag.label,
          tag.color,
          tag.sortOrder,
          null
        );
      });
    });

    try {
      run();
    } catch (err) {
      console.error('Error ensuring default stage tags:', err.message);
    }

    return tagDb.listProjectTags(projectName, 'stage');
  },

  listProjectTags: (projectName, tagType = null) => {
    try {
      const rows = tagType
        ? db.prepare(`
            SELECT * FROM project_tags
            WHERE project_name = ? AND tag_type = ?
            ORDER BY sort_order ASC, label COLLATE NOCASE ASC, id ASC
          `).all(projectName, tagType)
        : db.prepare(`
            SELECT * FROM project_tags
            WHERE project_name = ?
            ORDER BY tag_type COLLATE NOCASE ASC, sort_order ASC, label COLLATE NOCASE ASC, id ASC
          `).all(projectName);
      return rows.map(parseTagRow).filter(Boolean);
    } catch (err) {
      console.error('Error listing project tags:', err.message);
      return [];
    }
  },

  getTagByProjectAndKey: (projectName, tagType, tagKey) => {
    try {
      return parseTagRow(db.prepare(`
        SELECT * FROM project_tags
        WHERE project_name = ? AND tag_type = ? AND tag_key = ?
      `).get(projectName, tagType, tagKey));
    } catch (err) {
      console.error('Error getting project tag:', err.message);
      return null;
    }
  },

  getTagsByIds: (projectName, tagIds = []) => {
    try {
      if (!Array.isArray(tagIds) || tagIds.length === 0) {
        return [];
      }

      const normalizedIds = Array.from(new Set(
        tagIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      ));

      if (normalizedIds.length === 0) {
        return [];
      }

      const placeholders = normalizedIds.map(() => '?').join(', ');
      const rows = db.prepare(`
        SELECT * FROM project_tags
        WHERE project_name = ? AND id IN (${placeholders})
        ORDER BY sort_order ASC, label COLLATE NOCASE ASC, id ASC
      `).all(projectName, ...normalizedIds);
      return rows.map(parseTagRow).filter(Boolean);
    } catch (err) {
      console.error('Error getting project tags by ids:', err.message);
      return [];
    }
  },

  listTagsForSession: (sessionId) => {
    try {
      const rows = db.prepare(`
        SELECT
          pt.id,
          pt.project_name,
          pt.tag_key,
          pt.tag_type,
          pt.label,
          pt.color,
          pt.sort_order,
          pt.metadata,
          pt.created_at,
          stl.linked_by,
          stl.source,
          stl.metadata AS link_metadata,
          stl.created_at AS linked_at
        FROM session_tag_links stl
        JOIN project_tags pt ON pt.id = stl.tag_id
        WHERE stl.session_id = ?
        ORDER BY pt.sort_order ASC, pt.label COLLATE NOCASE ASC, pt.id ASC
      `).all(sessionId);
      return rows.map(parseTagRow).filter(Boolean);
    } catch (err) {
      console.error('Error listing session tags:', err.message);
      return [];
    }
  },

  listSessionIdsForTag: (projectName, tagType, tagKey) => {
    try {
      const rows = db.prepare(`
        SELECT stl.session_id
        FROM session_tag_links stl
        JOIN project_tags pt ON pt.id = stl.tag_id
        WHERE pt.project_name = ? AND pt.tag_type = ? AND pt.tag_key = ?
        ORDER BY datetime(stl.created_at) DESC
      `).all(projectName, tagType, tagKey);
      return rows.map((row) => row.session_id).filter(Boolean);
    } catch (err) {
      console.error('Error listing session ids for tag:', err.message);
      return [];
    }
  },

  replaceSessionTags: (sessionId, projectName, tagIds = [], options = {}) => {
    try {
      const selectedTags = tagDb.getTagsByIds(projectName, tagIds);
      const projectStageTags = tagDb.listProjectTags(projectName, 'stage');
      const normalizedTagIds = selectedTags.map((tag) => tag.id);
      const linkedBy = options.linkedBy || null;
      const source = options.source || null;
      const metadata = options.metadata && typeof options.metadata === 'object'
        ? JSON.stringify(options.metadata)
        : null;

      const replace = db.transaction(() => {
        db.prepare(`
          DELETE FROM session_tag_links
          WHERE session_id = ?
            AND tag_id IN (SELECT id FROM project_tags WHERE project_name = ?)
        `).run(sessionId, projectName);

        const insert = db.prepare(`
          INSERT OR IGNORE INTO session_tag_links (
            session_id, tag_id, linked_by, source, metadata
          ) VALUES (?, ?, ?, ?, ?)
        `);

        normalizedTagIds.forEach((tagId) => {
          insert.run(sessionId, tagId, linkedBy, source, metadata);
        });

        if (source === 'manual') {
          const session = parseSessionRow(db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(sessionId));
          if (session) {
            const nextMetadata = applyManualStageTagDecisions(session.metadata, projectStageTags, selectedTags);
            db.prepare('UPDATE session_metadata SET metadata = ? WHERE id = ?').run(
              serializeMetadata(nextMetadata),
              sessionId
            );
          }
        }
      });

      replace();
      return tagDb.listTagsForSession(sessionId);
    } catch (err) {
      console.error('Error replacing session tags:', err.message);
      return [];
    }
  },

  appendSessionTagsByKeys: (sessionId, projectName, tagType, tagKeys = [], options = {}) => {
    try {
      const normalizedKeys = Array.from(new Set(
        (Array.isArray(tagKeys) ? tagKeys : [])
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      ));

      if (normalizedKeys.length === 0) {
        return tagDb.listTagsForSession(sessionId);
      }

      const session = parseSessionRow(db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(sessionId));
      const linkedBy = options.linkedBy || null;
      const source = options.source || null;
      const metadata = options.metadata && typeof options.metadata === 'object'
        ? JSON.stringify(options.metadata)
        : null;
      const insert = db.prepare(`
        INSERT OR IGNORE INTO session_tag_links (
          session_id, tag_id, linked_by, source, metadata
        ) VALUES (?, ?, ?, ?, ?)
      `);

      const append = db.transaction(() => {
        normalizedKeys.forEach((tagKey) => {
          if (isAutomaticStageTagBlocked(session?.metadata, tagType, tagKey, source)) {
            return;
          }

          const tag = tagDb.getTagByProjectAndKey(projectName, tagType, tagKey);
          if (tag) {
            insert.run(sessionId, tag.id, linkedBy, source, metadata);
          }
        });
      });

      append();
      return tagDb.listTagsForSession(sessionId);
    } catch (err) {
      console.error('Error appending session tags:', err.message);
      return [];
    }
  },
};

// Project index operations
const projectDb = {
  // Upsert project (insert if not exists, update if exists)
  upsertProject: (id, userId, displayName, path, isStarred = 0, lastAccessed = null, metadata = null) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO projects (id, user_id, display_name, path, is_starred, last_accessed, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = COALESCE(excluded.display_name, projects.display_name),
          path = COALESCE(excluded.path, projects.path),
          user_id = CASE WHEN projects.user_id IS NULL THEN excluded.user_id ELSE projects.user_id END,
          is_starred = COALESCE(excluded.is_starred, projects.is_starred),
          last_accessed = COALESCE(excluded.last_accessed, projects.last_accessed),
          metadata = COALESCE(excluded.metadata, projects.metadata)
      `);
      stmt.run(id, userId, displayName, path, isStarred, lastAccessed, metadata ? JSON.stringify(metadata) : null);
    } catch (err) {
      console.error('Error upserting project metadata:', err.message);
    }
  },

  // Update project name ONLY
  updateProjectName: (id, displayName) => {
    try {
      db.prepare('UPDATE projects SET display_name = ? WHERE id = ?').run(displayName, id);
    } catch (err) {
      console.error('Error updating project name:', err.message);
    }
  },

  // Get all projects (can filter by userId later)
  getAllProjects: (userId = null) => {
    try {
      const query = userId ? 'SELECT * FROM projects WHERE user_id = ?' : 'SELECT * FROM projects';
      const rows = userId ? db.prepare(query).all(userId) : db.prepare(query).all();
      return rows.map(row => ({
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null
      }));
    } catch (err) {
      console.error('Error getting projects:', err.message);
      return [];
    }
  },

  // Get project by its encoded ID
  getProjectById: (id) => {
    try {
      const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      if (row && row.metadata) {
        row.metadata = JSON.parse(row.metadata);
      }
      return row;
    } catch (err) {
      console.error('Error getting project metadata:', err.message);
      return null;
    }
  },

  // Get project by its file-system path (uses idx_projects_path index)
  getProjectByPath: (projectPath, userId = null) => {
    try {
      const row = userId
        ? db.prepare(`
            SELECT *
            FROM projects
            WHERE path = ?
              AND (user_id = ? OR user_id IS NULL)
            ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END
            LIMIT 1
          `).get(projectPath, userId, userId)
        : db.prepare('SELECT * FROM projects WHERE path = ?').get(projectPath);
      if (row && row.metadata) {
        row.metadata = JSON.parse(row.metadata);
      }
      return row || null;
    } catch (err) {
      console.error('Error getting project by path:', err.message);
      return null;
    }
  },

  toggleStar: (id, isStarred) => {
    try {
      db.prepare('UPDATE projects SET is_starred = ? WHERE id = ?').run(isStarred ? 1 : 0, id);
    } catch (err) {
      console.error('Error toggling project star:', err.message);
    }
  },

  deleteProject: (id) => {
    try {
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    } catch (err) {
      console.error('Error deleting project metadata:', err.message);
    }
  },

  updateProjectPath: (id, projectPath) => {
    try {
      db.prepare('UPDATE projects SET path = ? WHERE id = ?').run(projectPath, id);
    } catch (err) {
      console.error('Error updating project path:', err.message);
    }
  },

  migrateProjectIdentity: (oldId, newId, projectPath) => {
    const migrate = db.transaction(() => {
      db.prepare('UPDATE projects SET id = ?, path = ? WHERE id = ?').run(newId, projectPath, oldId);
      db.prepare('UPDATE session_metadata SET project_name = ? WHERE project_name = ?').run(newId, oldId);
    });

    try {
      migrate();
    } catch (err) {
      console.error('Error migrating project identity:', err.message);
      throw err;
    }
  }
};

// References (literature library) database operations
const referencesDb = {
  /**
   * Batch upsert references from Zotero or other sources.
   * Deduplicates by source_id for the given user.
   */
  syncFromZotero: (userId, items) => {
    const upsert = db.prepare(`
      INSERT INTO references_library (id, user_id, title, authors, year, abstract, doi, url, journal, item_type, source, source_id, keywords, citation_key, raw_data, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'zotero', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        authors = excluded.authors,
        year = excluded.year,
        abstract = excluded.abstract,
        doi = excluded.doi,
        url = excluded.url,
        journal = excluded.journal,
        item_type = excluded.item_type,
        keywords = excluded.keywords,
        citation_key = excluded.citation_key,
        raw_data = excluded.raw_data,
        updated_at = CURRENT_TIMESTAMP
    `);

    const insertTag = db.prepare(`
      INSERT OR IGNORE INTO reference_tags (reference_id, tag) VALUES (?, ?)
    `);

    const deleteTags = db.prepare(`DELETE FROM reference_tags WHERE reference_id = ?`);

    const tx = db.transaction((rows) => {
      const ids = [];
      for (const item of rows) {
        // Deterministic id: user + source_id
        const id = `zotero_${userId}_${item.sourceId}`;
        upsert.run(
          id,
          userId,
          item.title,
          JSON.stringify(item.authors || []),
          item.year,
          item.abstract,
          item.doi,
          item.url,
          item.journal,
          item.itemType || 'article',
          item.sourceId,
          JSON.stringify(item.keywords || []),
          item.citationKey,
          item.rawData ? JSON.stringify(item.rawData) : null,
        );
        // Clean stale tags, then re-insert
        deleteTags.run(id);
        for (const tag of item.keywords || []) {
          insertTag.run(id, tag);
        }
        ids.push(id);
      }
      return ids;
    });

    try {
      return tx(items);
    } catch (err) {
      throw err;
    }
  },

  /**
   * Import references from BibTeX (or other non-Zotero sources).
   */
  importReferences: (userId, items, source = 'bibtex') => {
    const upsert = db.prepare(`
      INSERT INTO references_library (id, user_id, title, authors, year, abstract, doi, url, journal, item_type, source, source_id, keywords, citation_key, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        authors = excluded.authors,
        year = excluded.year,
        abstract = excluded.abstract,
        doi = excluded.doi,
        url = excluded.url,
        journal = excluded.journal,
        item_type = excluded.item_type,
        keywords = excluded.keywords,
        citation_key = excluded.citation_key,
        updated_at = CURRENT_TIMESTAMP
    `);

    const insertTag = db.prepare(`
      INSERT OR IGNORE INTO reference_tags (reference_id, tag) VALUES (?, ?)
    `);

    const deleteTags = db.prepare(`DELETE FROM reference_tags WHERE reference_id = ?`);

    const tx = db.transaction((rows) => {
      const ids = [];
      for (const item of rows) {
        // When no citationKey, generate deterministic ID from content
        let key = item.citationKey;
        if (!key) {
          const hash = crypto.createHash('sha256')
            .update(`${item.title || ''}|${JSON.stringify(item.authors || [])}|${item.year || ''}`)
            .digest('hex')
            .slice(0, 16);
          key = hash;
        }
        const id = `${source}_${userId}_${key}`;
        upsert.run(
          id,
          userId,
          item.title,
          JSON.stringify(item.authors || []),
          item.year,
          item.abstract,
          item.doi,
          item.url,
          item.journal,
          item.itemType || 'article',
          source,
          item.citationKey || null,
          JSON.stringify(item.keywords || []),
          item.citationKey || null,
        );
        // Clean stale tags, then re-insert
        deleteTags.run(id);
        for (const tag of item.keywords || []) {
          insertTag.run(id, tag);
        }
        ids.push(id);
      }
      return ids;
    });

    try {
      return tx(items);
    } catch (err) {
      throw err;
    }
  },

  /** List user references with optional search and pagination. */
  getUserReferences: (userId, { search, tags, limit = 50, offset = 0 } = {}) => {
    try {
      let query = 'SELECT * FROM references_library WHERE user_id = ?';
      const params = [userId];

      if (search) {
        query += ' AND (title LIKE ? OR authors LIKE ? OR journal LIKE ? OR abstract LIKE ?)';
        const term = `%${search}%`;
        params.push(term, term, term, term);
      }

      if (tags && tags.length > 0) {
        query += ` AND id IN (SELECT reference_id FROM reference_tags WHERE tag IN (${tags.map(() => '?').join(',')}))`;
        params.push(...tags);
      }

      query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const rows = db.prepare(query).all(...params);
      return rows.map((r) => ({
        ...r,
        authors: r.authors ? JSON.parse(r.authors) : [],
        keywords: r.keywords ? JSON.parse(r.keywords) : [],
        raw_data: undefined, // Don't send raw_data in list
      }));
    } catch (err) {
      throw err;
    }
  },

  /** Single reference detail. */
  getReference: (id, userId) => {
    try {
      const row = db.prepare('SELECT * FROM references_library WHERE id = ? AND user_id = ?').get(id, userId);
      if (!row) return null;
      return {
        ...row,
        authors: row.authors ? JSON.parse(row.authors) : [],
        keywords: row.keywords ? JSON.parse(row.keywords) : [],
        raw_data: row.raw_data ? JSON.parse(row.raw_data) : null,
      };
    } catch (err) {
      throw err;
    }
  },

  /** Get references linked to a project. */
  getProjectReferences: (projectId, userId) => {
    try {
      const rows = db.prepare(`
        SELECT r.*, pr.added_at AS linked_at
        FROM references_library r
        JOIN project_references pr ON pr.reference_id = r.id
        WHERE pr.project_id = ? AND r.user_id = ?
        ORDER BY pr.added_at DESC
      `).all(projectId, userId);
      return rows.map((r) => ({
        ...r,
        authors: r.authors ? JSON.parse(r.authors) : [],
        keywords: r.keywords ? JSON.parse(r.keywords) : [],
        raw_data: undefined,
      }));
    } catch (err) {
      throw err;
    }
  },

  /** Link a reference to a project (verifies ownership). */
  linkToProject: (projectId, referenceId, userId) => {
    try {
      const ref = db.prepare('SELECT id FROM references_library WHERE id = ? AND user_id = ?').get(referenceId, userId);
      if (!ref) return false;
      db.prepare('INSERT OR IGNORE INTO project_references (project_id, reference_id) VALUES (?, ?)').run(projectId, referenceId);
      return true;
    } catch (err) {
      throw err;
    }
  },

  /** Unlink a reference from a project (verifies ownership). */
  unlinkFromProject: (projectId, referenceId, userId) => {
    try {
      const ref = db.prepare('SELECT id FROM references_library WHERE id = ? AND user_id = ?').get(referenceId, userId);
      if (!ref) return false;
      const result = db.prepare('DELETE FROM project_references WHERE project_id = ? AND reference_id = ?').run(projectId, referenceId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  /** Bulk-link an array of reference IDs to a project. */
  bulkLinkIds: (projectId, referenceIds) => {
    const insert = db.prepare('INSERT OR IGNORE INTO project_references (project_id, reference_id) VALUES (?, ?)');
    const tx = db.transaction((ids) => {
      let count = 0;
      for (const id of ids) {
        count += insert.run(projectId, id).changes;
      }
      return count;
    });
    return tx(referenceIds);
  },

  /** Get all unique tags for a user. */
  getTags: (userId) => {
    try {
      const rows = db.prepare(`
        SELECT DISTINCT rt.tag, COUNT(*) as count
        FROM reference_tags rt
        JOIN references_library r ON r.id = rt.reference_id
        WHERE r.user_id = ?
        GROUP BY rt.tag
        ORDER BY count DESC
      `).all(userId);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  /** Mark a reference as having its PDF cached. */
  setPdfCached: (id, cached = true) => {
    try {
      db.prepare('UPDATE references_library SET pdf_cached = ? WHERE id = ?').run(cached ? 1 : 0, id);
    } catch (err) {
      throw err;
    }
  },

  /** Delete a reference. */
  deleteReference: (userId, referenceId) => {
    try {
      const result = db.prepare('DELETE FROM references_library WHERE id = ? AND user_id = ?').run(referenceId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  /** Bulk-delete references by id list. Returns number of deleted rows. */
  bulkDeleteReferences: (userId, referenceIds) => {
    if (!referenceIds || referenceIds.length === 0) return 0;
    // Chunk to avoid SQLite parameter limit
    const CHUNK_SIZE = 500;
    let total = 0;
    const tx = db.transaction(() => {
      for (let i = 0; i < referenceIds.length; i += CHUNK_SIZE) {
        const chunk = referenceIds.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');
        const result = db.prepare(
          `DELETE FROM references_library WHERE user_id = ? AND id IN (${placeholders})`
        ).run(userId, ...chunk);
        total += result.changes;
      }
    });
    tx();
    return total;
  },
};

// User memories database operations
const memoryDb = {
  create: (userId, content, category = 'general') => {
    try {
      const stmt = db.prepare('INSERT INTO user_memories (user_id, content, category) VALUES (?, ?, ?)');
      const result = stmt.run(userId, content, category);
      return db.prepare('SELECT * FROM user_memories WHERE id = ?').get(result.lastInsertRowid);
    } catch (err) {
      throw err;
    }
  },

  getAll: (userId) => {
    try {
      return db.prepare('SELECT * FROM user_memories WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    } catch (err) {
      throw err;
    }
  },

  getEnabled: (userId) => {
    try {
      return db.prepare('SELECT * FROM user_memories WHERE user_id = ? AND is_enabled = 1 ORDER BY created_at DESC').all(userId);
    } catch (err) {
      throw err;
    }
  },

  getById: (userId, memoryId) => {
    try {
      return db.prepare('SELECT * FROM user_memories WHERE id = ? AND user_id = ?').get(memoryId, userId);
    } catch (err) {
      throw err;
    }
  },

  update: (userId, memoryId, { content, category }) => {
    try {
      const fields = [];
      const params = [];
      if (content !== undefined) { fields.push('content = ?'); params.push(content); }
      if (category !== undefined) { fields.push('category = ?'); params.push(category); }
      if (fields.length === 0) return null;
      fields.push('updated_at = CURRENT_TIMESTAMP');
      params.push(memoryId, userId);
      db.prepare(`UPDATE user_memories SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
      return db.prepare('SELECT * FROM user_memories WHERE id = ? AND user_id = ?').get(memoryId, userId);
    } catch (err) {
      throw err;
    }
  },

  toggle: (userId, memoryId) => {
    try {
      db.prepare('UPDATE user_memories SET is_enabled = NOT is_enabled, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(memoryId, userId);
      return db.prepare('SELECT * FROM user_memories WHERE id = ? AND user_id = ?').get(memoryId, userId);
    } catch (err) {
      throw err;
    }
  },

  delete: (userId, memoryId) => {
    try {
      const result = db.prepare('DELETE FROM user_memories WHERE id = ? AND user_id = ?').run(memoryId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },
};

export {
  db,
  initializeDatabase,
  userDb,
  autoResearchDb,
  appSettingsDb,
  apiKeysDb,
  credentialsDb,
  githubTokensDb, // Backward compatibility
  sessionDb,
  tagDb,
  projectDb,
  referencesDb,
  memoryDb,
  normalizeSessionTimestamp
};
