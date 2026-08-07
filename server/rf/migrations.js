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
  {
    version: 2,
    name: 'create-rf-research-evidence-tables',
    statements: [
      // ---------------------------------------------------------------------
      // Experiments: a research experiment DESIGN (not a single run).
      // experiment_code is a human-readable, project-scoped identifier
      // (EXP-001); the stable identity is the UUID id.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_experiments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        stage_id TEXT REFERENCES rf_stages(id) ON DELETE SET NULL,
        experiment_code TEXT NOT NULL,
        title TEXT NOT NULL,
        research_question TEXT,
        hypothesis TEXT,
        type TEXT NOT NULL DEFAULT 'prototype',
        status TEXT NOT NULL DEFAULT 'planned',
        priority TEXT NOT NULL DEFAULT 'medium',
        method_variant TEXT,
        datasets_environment TEXT,
        metrics_definition TEXT,
        required_seeds INTEGER NOT NULL DEFAULT 1,
        success_criteria TEXT,
        failure_criteria TEXT,
        notes TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT,
        UNIQUE(project_id, experiment_code)
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_experiments_project ON rf_experiments(project_id);
      CREATE INDEX IF NOT EXISTS idx_rf_experiments_project_sort ON rf_experiments(project_id, sort_order);
      `,
      // ---------------------------------------------------------------------
      // Experiment runs: one concrete execution. 1 experiment -> N runs.
      // Failed runs are first-class research records — never deleted, and
      // distinct from archiving (archived_at).
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_experiment_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        experiment_id TEXT NOT NULL REFERENCES rf_experiments(id) ON DELETE CASCADE,
        run_code TEXT NOT NULL,
        seed TEXT,
        status TEXT NOT NULL DEFAULT 'planned',
        started_at TEXT,
        finished_at TEXT,
        git_commit TEXT,
        git_branch TEXT,
        config_path TEXT,
        checkpoint_path TEXT,
        result_path TEXT,
        dataset_version TEXT,
        environment_name TEXT,
        device TEXT,
        runtime_seconds REAL,
        metrics_json TEXT,
        notes TEXT,
        failure_reason TEXT,
        failure_classification TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT,
        UNIQUE(experiment_id, run_code)
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_experiment_runs_experiment ON rf_experiment_runs(experiment_id);
      CREATE INDEX IF NOT EXISTS idx_rf_experiment_runs_project ON rf_experiment_runs(project_id);
      `,
      // ---------------------------------------------------------------------
      // Claims: research statements. claim_code is project-scoped (C-01).
      // Status is a HUMAN research judgment — evidence health never promotes
      // a claim automatically (see evidence-health.js).
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_claims (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        claim_code TEXT NOT NULL,
        statement TEXT NOT NULL,
        importance TEXT NOT NULL DEFAULT 'supporting',
        status TEXT NOT NULL DEFAULT 'unverified',
        notes TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT,
        UNIQUE(project_id, claim_code)
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_claims_project ON rf_claims(project_id);
      `,
      // ---------------------------------------------------------------------
      // Evidence: something that can support or contradict a claim. source_id
      // is polymorphic (experiment / experiment_run / figure / table /
      // literature / analysis_note / artifact) and validated in the service.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_evidence (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        evidence_type TEXT NOT NULL,
        source_id TEXT,
        title TEXT NOT NULL,
        summary TEXT,
        strength TEXT NOT NULL DEFAULT 'weak',
        path_or_reference TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_evidence_project ON rf_evidence(project_id);
      `,
      // ---------------------------------------------------------------------
      // Claim-Evidence relation: supports / contradicts / contextualized_by.
      // Same-project enforced at service layer; UNIQUE prevents duplicates.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_claim_evidence (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        claim_id TEXT NOT NULL REFERENCES rf_claims(id) ON DELETE CASCADE,
        evidence_id TEXT NOT NULL REFERENCES rf_evidence(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL DEFAULT 'supports',
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(claim_id, evidence_id, relation_type)
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_claim_evidence_claim ON rf_claim_evidence(claim_id);
      CREATE INDEX IF NOT EXISTS idx_rf_claim_evidence_evidence ON rf_claim_evidence(evidence_id);
      CREATE INDEX IF NOT EXISTS idx_rf_claim_evidence_project ON rf_claim_evidence(project_id);
      `,
      // ---------------------------------------------------------------------
      // Research Decision Log. decision_code is project-scoped (DEC-001).
      // Links to experiments/claims/evidence/tasks go through rf_entity_links.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_decisions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        decision_code TEXT NOT NULL,
        date TEXT,
        title TEXT NOT NULL,
        context TEXT,
        decision TEXT,
        reason TEXT,
        alternatives TEXT,
        impact TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT,
        UNIQUE(project_id, decision_code)
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_decisions_project ON rf_decisions(project_id);
      `,
      // ---------------------------------------------------------------------
      // Literature: minimal project-scoped references (NOT a Zotero
      // replacement). enum fields validated in validation.js.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_literature (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        authors TEXT,
        year INTEGER,
        venue TEXT,
        url TEXT,
        doi TEXT,
        arxiv_id TEXT,
        citation_key TEXT,
        relation TEXT,
        read_status TEXT NOT NULL DEFAULT 'inbox',
        priority TEXT NOT NULL DEFAULT 'medium',
        key_finding TEXT,
        method_summary TEXT,
        difference_to_ours TEXT,
        used_in_section TEXT,
        notes TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_literature_project ON rf_literature(project_id);
      `,
      // ---------------------------------------------------------------------
      // Figure/Table registry with provenance. manuscript_section is an
      // optional string placeholder until Phase 4 introduces manuscript
      // tables. file_path is a reference only — artifacts are never copied
      // into SQLite.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_figures_tables (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        artifact_code TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'figure',
        number INTEGER,
        working_title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'planned',
        file_path TEXT,
        manuscript_section TEXT,
        frozen INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT,
        UNIQUE(project_id, artifact_code)
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_figures_tables_project ON rf_figures_tables(project_id);
      `,
      // ---------------------------------------------------------------------
      // Controlled polymorphic provenance links (Phase 3 §13): decisions and
      // figures/tables reference experiments/runs/claims/evidence/tasks.
      // All source/target types and relation types are validated in the
      // service layer; same-project enforced; UNIQUE prevents duplicates.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_entity_links (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(source_type, source_id, target_type, target_id, relation_type)
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_entity_links_source ON rf_entity_links(source_type, source_id);
      CREATE INDEX IF NOT EXISTS idx_rf_entity_links_target ON rf_entity_links(target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_rf_entity_links_project ON rf_entity_links(project_id);
      `,
    ],
  },
  {
    version: 3,
    name: 'create-rf-paper-submission-tables',
    statements: [
      // ---------------------------------------------------------------------
      // Manuscript sections. is_optional marks e.g. discussion/appendix that
      // are not required for manuscript completeness. Status is an explicit
      // workflow state — never auto-finalized from progress.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_manuscript_sections (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        section_key TEXT NOT NULL,
        title TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'not_started',
        progress REAL NOT NULL DEFAULT 0,
        is_optional INTEGER NOT NULL DEFAULT 0,
        file_path TEXT,
        notes TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT,
        UNIQUE(project_id, section_key)
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_manuscript_sections_project ON rf_manuscript_sections(project_id);
      `,
      // ---------------------------------------------------------------------
      // Results Freeze events — immutable research history. snapshot_json holds
      // a lightweight metadata snapshot (claim statuses/health, figure statuses,
      // experiment run summaries). override_reason is set when a freeze was
      // created despite unmet readiness conditions.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_result_freezes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        freeze_number INTEGER NOT NULL,
        git_commit TEXT,
        git_branch TEXT,
        result_version TEXT,
        dataset_version TEXT,
        config_version TEXT,
        snapshot_json TEXT NOT NULL,
        notes TEXT,
        override_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, freeze_number)
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_result_freezes_project ON rf_result_freezes(project_id, freeze_number DESC);
      `,
      // ---------------------------------------------------------------------
      // Internal review comments (pre-submission only). manuscript_section_id
      // is a soft link (SET NULL). resolve/reopen is an explicit action.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_review_comments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        manuscript_section_id TEXT REFERENCES rf_manuscript_sections(id) ON DELETE SET NULL,
        comment_code TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        severity TEXT NOT NULL DEFAULT 'minor',
        status TEXT NOT NULL DEFAULT 'open',
        source TEXT NOT NULL DEFAULT 'self_review',
        author_name TEXT,
        due_date TEXT,
        resolved_at TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT,
        UNIQUE(project_id, comment_code)
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_review_comments_project ON rf_review_comments(project_id);
      CREATE INDEX IF NOT EXISTS idx_rf_review_comments_section ON rf_review_comments(manuscript_section_id);
      `,
      // ---------------------------------------------------------------------
      // Submission profiles — one project may have multiple submission
      // attempts. submitted_at/final_paper_path/external_submission_id are
      // set by the explicit mark-submitted action and never auto-reverted.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_submission_profiles (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        venue TEXT NOT NULL,
        track TEXT,
        deadline TEXT,
        deadline_timezone TEXT,
        page_limit INTEGER,
        anonymous INTEGER NOT NULL DEFAULT 0,
        submission_url TEXT,
        status TEXT NOT NULL DEFAULT 'preparing',
        submitted_at TEXT,
        final_paper_path TEXT,
        external_submission_id TEXT,
        notes TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_submission_profiles_project ON rf_submission_profiles(project_id);
      `,
      // ---------------------------------------------------------------------
      // Submission checklist items, grouped by category
      // (paper/experiments/artifacts/portal). Waiving is explicit per item.
      // ---------------------------------------------------------------------
      `
      CREATE TABLE IF NOT EXISTS rf_submission_items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES rf_projects(id) ON DELETE CASCADE,
        submission_profile_id TEXT NOT NULL REFERENCES rf_submission_profiles(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        required INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'todo',
        due_date TEXT,
        notes TEXT,
        artifact_path TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT,
        UNIQUE(submission_profile_id, category, title)
      );
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_rf_submission_items_profile ON rf_submission_items(submission_profile_id);
      CREATE INDEX IF NOT EXISTS idx_rf_submission_items_project ON rf_submission_items(project_id);
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
