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
    metadata: row.metadata ? JSON.parse(row.metadata) : null
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
      return rows.map(parseSessionRow);
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

      return allRows.map(parseSessionRow);
    } catch (err) {
      console.error('Error getting sessions for projects:', err.message);
      return [];
    }
  },

  // Get metadata for a specific session
  getSessionById: (id) => {
    try {
      return parseSessionRow(db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(id));
    } catch (err) {
      console.error('Error getting session metadata:', err.message);
      return null;
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
  projectDb,
  normalizeSessionTimestamp
};
