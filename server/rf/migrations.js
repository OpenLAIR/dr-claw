// ResearchFlow schema migrations.
//
// ResearchFlow has its own lightweight, ordered, idempotent migration runner backed by
// the `rf_schema_migrations` table. The legacy Dr. Claw init.sql / runMigrations()
// pipeline is intentionally left untouched — see ARCHITECTURE_BASELINE.md §1.4.
//
// Rules:
// - Every migration is a versioned entry in MIGRATIONS (ordered by version).
// - Each migration runs inside a single transaction: statements + version insert are
//   atomic, so a crash mid-migration leaves no partial application (restart-safe).
// - Re-running the runner is a no-op for already-applied versions (idempotent).
// - No ORM: plain better-sqlite3.

const MIGRATIONS = [
  {
    version: 1,
    name: 'create-rf-core-tables',
    statements: [
      // ---------------------------------------------------------------------
      // ResearchFlow projects. Identity is a stable UUID — independent from the
      // filesystem-oriented Dr. Claw `projects.id` (see PRODUCT_SPEC §19 + Phase 1
      // architecture correction). source_project_id optionally links back to it.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_projects (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        target_venue TEXT,
        deadline TEXT,
        source_project_id TEXT,
        workspace_type TEXT,
        windows_path TEXT,
        wsl_distro TEXT,
        wsl_path TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_projects_user ON rf_projects(user_id);
      CREATE INDEX IF NOT EXISTS idx_rf_projects_status ON rf_projects(status);
      `,
      // ---------------------------------------------------------------------
      // Lifecycle stages. `key` is a stable machine name (e.g. 'idea_locked');
      // `name` is the human label. weight matches PRODUCT_SPEC §14.1.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_stages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        key TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        weight INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        notes TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_stages_project ON rf_stages(project_id);
      CREATE INDEX IF NOT EXISTS idx_rf_stages_project_sort ON rf_stages(project_id, sort_order);
      `,
      // ---------------------------------------------------------------------
      // Stage gates. Stage completion is derived from required gates
      // (is_required = 1 AND is_passed = 1) — see progress.js.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_stage_gates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        stage_id TEXT NOT NULL REFERENCES rf_stages(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        is_required INTEGER NOT NULL DEFAULT 1,
        is_passed INTEGER NOT NULL DEFAULT 0,
        passed_at TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_stage_gates_stage ON rf_stage_gates(stage_id);
      CREATE INDEX IF NOT EXISTS idx_rf_stage_gates_project ON rf_stage_gates(project_id);
      `,
      // ---------------------------------------------------------------------
      // Tasks. stage_id optionally binds a task to a stage (soft link);
      // polymorphic links to future Phase 3/4 objects go through rf_task_links.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        stage_id TEXT REFERENCES rf_stages(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'medium',
        due_date TEXT,
        is_blocker INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_tasks_project ON rf_tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_rf_tasks_stage ON rf_tasks(stage_id);
      CREATE INDEX IF NOT EXISTS idx_rf_tasks_status ON rf_tasks(project_id, status);
      `,
      // ---------------------------------------------------------------------
      // Task dependencies: a task can require other tasks. Cycle detection is
      // enforced at the service layer; UNIQUE(task_id, depends_on_task_id)
      // prevents duplicate edges.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_task_dependencies (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES rf_tasks(id) ON DELETE CASCADE,
        depends_on_task_id TEXT NOT NULL REFERENCES rf_tasks(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(task_id, depends_on_task_id)
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_task_dependencies_task ON rf_task_dependencies(task_id);
      CREATE INDEX IF NOT EXISTS idx_rf_task_dependencies_project ON rf_task_dependencies(project_id);
      `,
      // ---------------------------------------------------------------------
      // Polymorphic task links (PRODUCT_SPEC §6.4): relation_type is a controlled
      // enum (validation.js). Phase 3/4 tables do not exist yet, so no hard FK.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_task_links (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES rf_tasks(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL,
        relation_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(task_id, relation_type, relation_id)
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_task_links_task ON rf_task_links(task_id);
      CREATE INDEX IF NOT EXISTS idx_rf_task_links_relation ON rf_task_links(relation_type, relation_id);
      `,
      // ---------------------------------------------------------------------
      // Activity log — audit trail for every meaningful state mutation. Writes
      // happen in the same transaction as the mutation they describe (service.js).
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_activity_log (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        message TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_activity_project ON rf_activity_log(project_id, created_at);
      `,
    ],
  },
];

/**
 * Apply all pending ResearchFlow migrations.
 * @param {import('better-sqlite3').Database} db
 * @returns {number} number of migrations applied this run
 */
export const runResearchFlowMigrations = (db) => {
  if (!db) {
    throw new Error('runResearchFlowMigrations: db instance is required');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS rf_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const appliedRows = db.prepare('SELECT version FROM rf_schema_migrations').all();
  const applied = new Set(appliedRows.map((row) => row.version));

  let appliedCount = 0;
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;

    const applyMigration = db.transaction(() => {
      for (const sql of migration.statements) {
        db.exec(sql);
      }
      db.prepare('INSERT INTO rf_schema_migrations (version, name) VALUES (?, ?)')
        .run(migration.version, migration.name);
    });
    applyMigration();
    appliedCount += 1;
  }
  return appliedCount;
};

/**
 * @returns {Array<{version: number, name: string}>} registered migrations
 */
export const getRegisteredMigrations = () => MIGRATIONS.map(({ version, name }) => ({ version, name }));
