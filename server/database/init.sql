-- Initialize authentication database
PRAGMA foreign_keys = ON;

-- Users table (single user system)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    notification_email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_active BOOLEAN DEFAULT 1,
    git_name TEXT,
    git_email TEXT,
    has_completed_onboarding BOOLEAN DEFAULT 0
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- API Keys table for external API access
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key_name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used DATETIME,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

-- User credentials table for storing various tokens/credentials (GitHub, GitLab, etc.)
CREATE TABLE IF NOT EXISTS user_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credential_name TEXT NOT NULL,
    credential_type TEXT NOT NULL, -- 'github_token', 'gitlab_token', 'bitbucket_token', etc.
    credential_value TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_credentials_user_id ON user_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_user_credentials_type ON user_credentials(credential_type);
CREATE INDEX IF NOT EXISTS idx_user_credentials_active ON user_credentials(is_active);

-- Session metadata index table for fast lookup and renaming
CREATE TABLE IF NOT EXISTS session_metadata (
    id TEXT PRIMARY KEY,
    project_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    display_name TEXT,
    last_activity DATETIME,
    message_count INTEGER DEFAULT 0,
    is_starred BOOLEAN DEFAULT 0,
    metadata TEXT, -- JSON storage for extra provider-specific data
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_session_metadata_project ON session_metadata(project_name);
CREATE INDEX IF NOT EXISTS idx_session_metadata_provider ON session_metadata(provider);

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

-- Projects table for unified management across all providers
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    display_name TEXT,
    path TEXT NOT NULL,
    is_starred BOOLEAN DEFAULT 0,
    last_accessed DATETIME,
    metadata TEXT, -- JSON for provider-specific info
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);

CREATE TABLE IF NOT EXISTS auto_research_runs (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    project_name TEXT NOT NULL,
    project_path TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'claude',
    status TEXT NOT NULL,
    session_id TEXT,
    current_task_id TEXT,
    completed_tasks INTEGER DEFAULT 0,
    total_tasks INTEGER DEFAULT 0,
    error TEXT,
    metadata TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    email_sent_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auto_research_runs_user ON auto_research_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_research_runs_project ON auto_research_runs(project_name);
CREATE INDEX IF NOT EXISTS idx_auto_research_runs_status ON auto_research_runs(status);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- References (literature) cache table
CREATE TABLE IF NOT EXISTS references_library (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    authors TEXT,
    year INTEGER,
    abstract TEXT,
    doi TEXT,
    url TEXT,
    journal TEXT,
    item_type TEXT DEFAULT 'article',
    source TEXT DEFAULT 'zotero',
    source_id TEXT,
    keywords TEXT,
    citation_key TEXT,
    pdf_cached INTEGER DEFAULT 0,
    raw_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_references_user ON references_library(user_id);
CREATE INDEX IF NOT EXISTS idx_references_source_id ON references_library(source_id);
CREATE INDEX IF NOT EXISTS idx_references_doi ON references_library(doi);

-- Reference ↔ Project many-to-many
CREATE TABLE IF NOT EXISTS project_references (
    project_id TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, reference_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_references_project ON project_references(project_id);

-- Reference tags
CREATE TABLE IF NOT EXISTS reference_tags (
    reference_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    UNIQUE(reference_id, tag),
    FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reference_tags_ref ON reference_tags(reference_id);

-- User memories table (for remembering user preferences, habits, context)
CREATE TABLE IF NOT EXISTS user_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    category TEXT DEFAULT 'general',  -- general | preference | context | workflow
    is_enabled BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_memories_user ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_user_memories_enabled ON user_memories(is_enabled);
