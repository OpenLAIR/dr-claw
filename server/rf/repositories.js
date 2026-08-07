// ResearchFlow data-access layer. Every method is a single SQL operation; the
// service layer composes them inside transactions. Rows are returned in raw
// snake_case form — serialization to API shape happens in service.js.

import { randomUUID } from 'node:crypto';

const parseJson = (value, fallback = null) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const touch = (db, table, id) => {
  db.prepare(`UPDATE ${table} SET updated_at = datetime('now') WHERE id = ?`).run(id);
};

export const createResearchFlowRepository = (db) => {
  if (!db) {
    throw new Error('createResearchFlowRepository: db instance is required');
  }

  const repo = {
    // --- Projects -----------------------------------------------------------
    createProject(row) {
      const result = db.prepare(`
        INSERT INTO rf_projects (
          id, user_id, name, status, target_venue, deadline, source_project_id,
          workspace_type, windows_path, wsl_distro, wsl_path, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.id,
        row.userId,
        row.name,
        row.status || 'active',
        row.targetVenue || null,
        row.deadline || null,
        row.sourceProjectId || null,
        row.workspaceType || null,
        row.windowsPath || null,
        row.wslDistro || null,
        row.wslPath || null,
        row.metadata ? JSON.stringify(row.metadata) : null
      );
      return result.lastInsertRowid;
    },

    getProject(id) {
      return db.prepare('SELECT * FROM rf_projects WHERE id = ?').get(id) || null;
    },

    listProjects(userId, { includeArchived = false } = {}) {
      const rows = includeArchived
        ? db.prepare('SELECT * FROM rf_projects WHERE user_id = ? ORDER BY created_at DESC').all(userId)
        : db.prepare('SELECT * FROM rf_projects WHERE user_id = ? AND archived_at IS NULL ORDER BY created_at DESC').all(userId);
      return rows;
    },

    updateProject(id, fields) {
      const assignments = [];
      const values = [];
      const columnMap = {
        name: 'name',
        status: 'status',
        targetVenue: 'target_venue',
        deadline: 'deadline',
        workspaceType: 'workspace_type',
        windowsPath: 'windows_path',
        wslDistro: 'wsl_distro',
        wslPath: 'wsl_path',
      };
      for (const [field, column] of Object.entries(columnMap)) {
        if (fields[field] !== undefined) {
          assignments.push(`${column} = ?`);
          values.push(fields[field]);
        }
      }
      if (fields.metadata !== undefined) {
        assignments.push('metadata_json = ?');
        values.push(JSON.stringify(fields.metadata));
      }
      if (assignments.length === 0) return;
      values.push(id);
      db.prepare(`UPDATE rf_projects SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
      touch(db, 'rf_projects', id);
    },

    softDeleteProject(id) {
      db.prepare("UPDATE rf_projects SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
    },

    // --- Stages -------------------------------------------------------------
    createStage({ id, projectId, name, key, sortOrder, weight }) {
      db.prepare(`
        INSERT INTO rf_stages (id, project_id, name, key, sort_order, weight, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `).run(id, projectId, name, key, sortOrder, weight);
    },

    getStage(id) {
      return db.prepare('SELECT * FROM rf_stages WHERE id = ?').get(id) || null;
    },

    listStages(projectId) {
      return db.prepare('SELECT * FROM rf_stages WHERE project_id = ? AND archived_at IS NULL ORDER BY sort_order ASC').all(projectId);
    },

    listStagesByProjects(projectIds) {
      if (projectIds.length === 0) return {};
      const placeholders = projectIds.map(() => '?').join(', ');
      const rows = db.prepare(
        `SELECT * FROM rf_stages WHERE project_id IN (${placeholders}) AND archived_at IS NULL ORDER BY sort_order ASC`
      ).all(...projectIds);
      const grouped = {};
      for (const row of rows) {
        (grouped[row.project_id] ||= []).push(row);
      }
      return grouped;
    },

    updateStage(id, fields) {
      const assignments = [];
      const values = [];
      if (fields.notes !== undefined) {
        assignments.push('notes = ?');
        values.push(fields.notes);
      }
      if (fields.metadata !== undefined) {
        assignments.push('metadata_json = ?');
        values.push(JSON.stringify(fields.metadata));
      }
      if (fields.sortOrder !== undefined) {
        assignments.push('sort_order = ?');
        values.push(fields.sortOrder);
      }
      if (assignments.length === 0) return;
      values.push(id);
      db.prepare(`UPDATE rf_stages SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
      touch(db, 'rf_stages', id);
    },

    setStageStatus(id, status) {
      db.prepare("UPDATE rf_stages SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
    },

    setStageCurrent(stageId, projectId) {
      // Exactly one stage is 'current' per project: demote all others in THIS
      // project first (never touch other projects' stages).
      db.prepare("UPDATE rf_stages SET status = 'pending', updated_at = datetime('now') WHERE project_id = ? AND status = 'current'").run(projectId);
      db.prepare("UPDATE rf_stages SET status = 'current', updated_at = datetime('now') WHERE id = ? AND project_id = ?").run(stageId, projectId);
    },

    // --- Gates --------------------------------------------------------------
    createGates(projectId, stageId, titles) {
      const insert = db.prepare(`
        INSERT INTO rf_stage_gates (id, project_id, stage_id, title, is_required, sort_order)
        VALUES (?, ?, ?, ?, 1, ?)
      `);
      titles.forEach((title, index) => {
        insert.run(randomUUID(), projectId, stageId, title, index);
      });
    },

    getGate(id) {
      return db.prepare('SELECT * FROM rf_stage_gates WHERE id = ?').get(id) || null;
    },

    listGatesByStage(stageId) {
      return db.prepare('SELECT * FROM rf_stage_gates WHERE stage_id = ? ORDER BY sort_order ASC').all(stageId);
    },

    listGatesByStages(stageIds) {
      if (stageIds.length === 0) return {};
      const placeholders = stageIds.map(() => '?').join(', ');
      const rows = db.prepare(
        `SELECT * FROM rf_stage_gates WHERE stage_id IN (${placeholders}) ORDER BY sort_order ASC`
      ).all(...stageIds);
      const grouped = {};
      for (const row of rows) {
        (grouped[row.stage_id] ||= []).push(row);
      }
      return grouped;
    },

    updateGate(id, fields) {
      const assignments = [];
      const values = [];
      if (fields.isPassed !== undefined) {
        assignments.push('is_passed = ?');
        assignments.push('passed_at = ?');
        values.push(fields.isPassed ? 1 : 0, fields.isPassed ? datetimeNow() : null);
      }
      if (fields.title !== undefined) {
        assignments.push('title = ?');
        values.push(fields.title);
      }
      if (fields.description !== undefined) {
        assignments.push('description = ?');
        values.push(fields.description);
      }
      if (fields.sortOrder !== undefined) {
        assignments.push('sort_order = ?');
        values.push(fields.sortOrder);
      }
      if (assignments.length === 0) return;
      values.push(id);
      db.prepare(`UPDATE rf_stage_gates SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
      touch(db, 'rf_stage_gates', id);
    },

    // --- Tasks --------------------------------------------------------------
    createTask(row) {
      db.prepare(`
        INSERT INTO rf_tasks (
          id, project_id, stage_id, title, description, status, priority,
          due_date, is_blocker, sort_order, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.id,
        row.projectId,
        row.stageId || null,
        row.title,
        row.description || null,
        row.status,
        row.priority,
        row.dueDate || null,
        row.isBlocker ? 1 : 0,
        row.sortOrder || 0,
        row.metadata ? JSON.stringify(row.metadata) : null
      );
    },

    getTask(id) {
      return db.prepare('SELECT * FROM rf_tasks WHERE id = ?').get(id) || null;
    },

    listTasks(projectId, { includeArchived = false } = {}) {
      return includeArchived
        ? db.prepare('SELECT * FROM rf_tasks WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC').all(projectId)
        : db.prepare('SELECT * FROM rf_tasks WHERE project_id = ? AND archived_at IS NULL ORDER BY sort_order ASC, created_at ASC').all(projectId);
    },

    listTasksByProjects(projectIds) {
      if (projectIds.length === 0) return {};
      const placeholders = projectIds.map(() => '?').join(', ');
      const rows = db.prepare(
        `SELECT * FROM rf_tasks WHERE project_id IN (${placeholders}) AND archived_at IS NULL ORDER BY sort_order ASC, created_at ASC`
      ).all(...projectIds);
      const grouped = {};
      for (const row of rows) {
        (grouped[row.project_id] ||= []).push(row);
      }
      return grouped;
    },

    updateTask(id, fields) {
      const assignments = [];
      const values = [];
      const columnMap = {
        title: 'title',
        description: 'description',
        status: 'status',
        priority: 'priority',
        dueDate: 'due_date',
        stageId: 'stage_id',
      };
      for (const [field, column] of Object.entries(columnMap)) {
        if (fields[field] !== undefined) {
          assignments.push(`${column} = ?`);
          values.push(fields[field]);
        }
      }
      if (fields.isBlocker !== undefined) {
        assignments.push('is_blocker = ?');
        values.push(fields.isBlocker ? 1 : 0);
      }
      if (fields.metadata !== undefined) {
        assignments.push('metadata_json = ?');
        values.push(JSON.stringify(fields.metadata));
      }
      if (assignments.length === 0) return;
      values.push(id);
      db.prepare(`UPDATE rf_tasks SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
      touch(db, 'rf_tasks', id);
    },

    softDeleteTask(id) {
      db.prepare("UPDATE rf_tasks SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
    },

    // --- Task dependencies --------------------------------------------------
    createDependency({ id, projectId, taskId, dependsOnTaskId }) {
      db.prepare(`
        INSERT INTO rf_task_dependencies (id, project_id, task_id, depends_on_task_id)
        VALUES (?, ?, ?, ?)
      `).run(id, projectId, taskId, dependsOnTaskId);
    },

    getDependency(id) {
      return db.prepare('SELECT * FROM rf_task_dependencies WHERE id = ?').get(id) || null;
    },

    deleteDependency(id) {
      db.prepare('DELETE FROM rf_task_dependencies WHERE id = ?').run(id);
    },

    listDependencies(projectId) {
      return db.prepare('SELECT * FROM rf_task_dependencies WHERE project_id = ? ORDER BY created_at ASC').all(projectId);
    },

    listDependenciesByTask(taskIds) {
      if (taskIds.length === 0) return [];
      const placeholders = taskIds.map(() => '?').join(', ');
      return db.prepare(
        `SELECT * FROM rf_task_dependencies WHERE task_id IN (${placeholders})`
      ).all(...taskIds);
    },

    hasDependency(taskId, dependsOnTaskId) {
      const row = db.prepare(
        'SELECT id FROM rf_task_dependencies WHERE task_id = ? AND depends_on_task_id = ?'
      ).get(taskId, dependsOnTaskId);
      return row ? row.id : null;
    },

    // --- Task links (polymorphic) -------------------------------------------
    createTaskLink({ id, taskId, relationType, relationId }) {
      db.prepare(`
        INSERT INTO rf_task_links (id, task_id, relation_type, relation_id)
        VALUES (?, ?, ?, ?)
      `).run(id, taskId, relationType, relationId);
    },

    getTaskLink(id) {
      return db.prepare('SELECT * FROM rf_task_links WHERE id = ?').get(id) || null;
    },

    deleteTaskLink(id) {
      db.prepare('DELETE FROM rf_task_links WHERE id = ?').run(id);
    },

    listTaskLinks(projectId) {
      return db.prepare(`
        SELECT l.id, l.task_id, l.relation_type, l.relation_id, l.created_at
        FROM rf_task_links l
        JOIN rf_tasks t ON t.id = l.task_id
        WHERE t.project_id = ?
        ORDER BY l.created_at ASC
      `).all(projectId);
    },

    // --- Activity -----------------------------------------------------------
    listActivity(projectId, { limit = 50, offset = 0 } = {}) {
      return db.prepare(
        'SELECT * FROM rf_activity_log WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?'
      ).all(projectId, limit, offset);
    },

    // --- Misc ---------------------------------------------------------------
    parseJson,
  };

  // -------------------------------------------------------------------------
  // Phase 3 — Experiments / Evidence
  // -------------------------------------------------------------------------

  repo.createExperiment = (row) => {
    db.prepare(`
      INSERT INTO rf_experiments (
        id, project_id, stage_id, experiment_code, title, research_question, hypothesis,
        type, status, priority, method_variant, datasets_environment, metrics_definition,
        required_seeds, success_criteria, failure_criteria, notes, sort_order, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id, row.projectId, row.stageId || null, row.experimentCode, row.title,
      row.researchQuestion || null, row.hypothesis || null, row.type, row.status,
      row.priority, row.methodVariant || null, row.datasetsEnvironment || null,
      row.metricsDefinition || null, row.requiredSeeds ?? 1, row.successCriteria || null,
      row.failureCriteria || null, row.notes || null, row.sortOrder || 0,
      row.metadata ? JSON.stringify(row.metadata) : null
    );
  };

  repo.getExperiment = (id) => db.prepare('SELECT * FROM rf_experiments WHERE id = ?').get(id) || null;

  repo.getExperimentByCode = (projectId, code) =>
    db.prepare('SELECT * FROM rf_experiments WHERE project_id = ? AND experiment_code = ?').get(projectId, code) || null;

  repo.listExperiments = (projectId) =>
    db.prepare('SELECT * FROM rf_experiments WHERE project_id = ? AND archived_at IS NULL ORDER BY sort_order ASC, created_at ASC').all(projectId);

  repo.nextExperimentCode = (projectId) => {
    const row = db.prepare(
      'SELECT MAX(CAST(substr(experiment_code, 5) AS INTEGER)) AS max FROM rf_experiments WHERE project_id = ?'
    ).get(projectId);
    const next = (row?.max || 0) + 1;
    return `EXP-${String(next).padStart(3, '0')}`;
  };

  repo.updateExperiment = (id, fields) => {
    const assignments = [];
    const values = [];
    const columnMap = {
      title: 'title', researchQuestion: 'research_question', hypothesis: 'hypothesis',
      type: 'type', status: 'status', priority: 'priority', methodVariant: 'method_variant',
      datasetsEnvironment: 'datasets_environment', metricsDefinition: 'metrics_definition',
      requiredSeeds: 'required_seeds', successCriteria: 'success_criteria',
      failureCriteria: 'failure_criteria', notes: 'notes', stageId: 'stage_id',
      sortOrder: 'sort_order',
    };
    for (const [field, column] of Object.entries(columnMap)) {
      if (fields[field] !== undefined) {
        assignments.push(`${column} = ?`);
        values.push(fields[field]);
      }
    }
    if (fields.metadata !== undefined) {
      assignments.push('metadata_json = ?');
      values.push(JSON.stringify(fields.metadata));
    }
    if (assignments.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE rf_experiments SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    touch(db, 'rf_experiments', id);
  };

  repo.softDeleteExperiment = (id) =>
    db.prepare("UPDATE rf_experiments SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);

  repo.createRun = (row) => {
    db.prepare(`
      INSERT INTO rf_experiment_runs (
        id, project_id, experiment_id, run_code, seed, status, started_at, finished_at,
        git_commit, git_branch, config_path, checkpoint_path, result_path, dataset_version,
        environment_name, device, runtime_seconds, metrics_json, notes, failure_reason,
        failure_classification, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id, row.projectId, row.experimentId, row.runCode, row.seed || null, row.status,
      row.startedAt || null, row.finishedAt || null, row.gitCommit || null, row.gitBranch || null,
      row.configPath || null, row.checkpointPath || null, row.resultPath || null,
      row.datasetVersion || null, row.environmentName || null, row.device || null,
      row.runtimeSeconds ?? null, row.metrics ? JSON.stringify(row.metrics) : null,
      row.notes || null, row.failureReason || null, row.failureClassification || null,
      row.metadata ? JSON.stringify(row.metadata) : null
    );
  };

  repo.getRun = (id) => db.prepare('SELECT * FROM rf_experiment_runs WHERE id = ?').get(id) || null;

  repo.listRunsByExperiment = (experimentId) =>
    db.prepare('SELECT * FROM rf_experiment_runs WHERE experiment_id = ? AND archived_at IS NULL ORDER BY created_at ASC').all(experimentId);

  repo.listRunsByExperiments = (experimentIds) => {
    if (experimentIds.length === 0) return {};
    const placeholders = experimentIds.map(() => '?').join(', ');
    const rows = db.prepare(
      `SELECT * FROM rf_experiment_runs WHERE experiment_id IN (${placeholders}) AND archived_at IS NULL ORDER BY created_at ASC`
    ).all(...experimentIds);
    const grouped = {};
    for (const row of rows) (grouped[row.experiment_id] ||= []).push(row);
    return grouped;
  };

  repo.nextRunCode = (experimentId) => {
    const row = db.prepare(
      'SELECT MAX(CAST(substr(run_code, 5) AS INTEGER)) AS max FROM rf_experiment_runs WHERE experiment_id = ?'
    ).get(experimentId);
    const next = (row?.max || 0) + 1;
    return `RUN-${String(next).padStart(3, '0')}`;
  };

  repo.updateRun = (id, fields) => {
    const assignments = [];
    const values = [];
    const columnMap = {
      seed: 'seed', status: 'status', startedAt: 'started_at', finishedAt: 'finished_at',
      gitCommit: 'git_commit', gitBranch: 'git_branch', configPath: 'config_path',
      checkpointPath: 'checkpoint_path', resultPath: 'result_path', datasetVersion: 'dataset_version',
      environmentName: 'environment_name', device: 'device', runtimeSeconds: 'runtime_seconds',
      notes: 'notes', failureReason: 'failure_reason', failureClassification: 'failure_classification',
    };
    for (const [field, column] of Object.entries(columnMap)) {
      if (fields[field] !== undefined) {
        assignments.push(`${column} = ?`);
        values.push(fields[field]);
      }
    }
    if (fields.metrics !== undefined) {
      assignments.push('metrics_json = ?');
      values.push(JSON.stringify(fields.metrics));
    }
    if (fields.metadata !== undefined) {
      assignments.push('metadata_json = ?');
      values.push(JSON.stringify(fields.metadata));
    }
    if (assignments.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE rf_experiment_runs SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    touch(db, 'rf_experiment_runs', id);
  };

  repo.softDeleteRun = (id) =>
    db.prepare("UPDATE rf_experiment_runs SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);

  repo.createClaim = (row) => {
    db.prepare(`
      INSERT INTO rf_claims (id, project_id, claim_code, statement, importance, status, notes, sort_order, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.projectId, row.claimCode, row.statement, row.importance, row.status,
      row.notes || null, row.sortOrder || 0, row.metadata ? JSON.stringify(row.metadata) : null);
  };

  repo.getClaim = (id) => db.prepare('SELECT * FROM rf_claims WHERE id = ?').get(id) || null;

  repo.listClaims = (projectId) =>
    db.prepare('SELECT * FROM rf_claims WHERE project_id = ? AND archived_at IS NULL ORDER BY sort_order ASC, created_at ASC').all(projectId);

  repo.nextClaimCode = (projectId) => {
    const row = db.prepare(
      'SELECT MAX(CAST(substr(claim_code, 3) AS INTEGER)) AS max FROM rf_claims WHERE project_id = ?'
    ).get(projectId);
    const next = (row?.max || 0) + 1;
    return `C-${String(next).padStart(2, '0')}`;
  };

  repo.updateClaim = (id, fields) => {
    const assignments = [];
    const values = [];
    const columnMap = { statement: 'statement', importance: 'importance', status: 'status', notes: 'notes', sortOrder: 'sort_order' };
    for (const [field, column] of Object.entries(columnMap)) {
      if (fields[field] !== undefined) {
        assignments.push(`${column} = ?`);
        values.push(fields[field]);
      }
    }
    if (fields.metadata !== undefined) {
      assignments.push('metadata_json = ?');
      values.push(JSON.stringify(fields.metadata));
    }
    if (assignments.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE rf_claims SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    touch(db, 'rf_claims', id);
  };

  repo.softDeleteClaim = (id) =>
    db.prepare("UPDATE rf_claims SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);

  repo.createEvidence = (row) => {
    db.prepare(`
      INSERT INTO rf_evidence (id, project_id, evidence_type, source_id, title, summary, strength, path_or_reference, sort_order, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.projectId, row.evidenceType, row.sourceId || null, row.title, row.summary || null,
      row.strength, row.pathOrReference || null, row.sortOrder || 0,
      row.metadata ? JSON.stringify(row.metadata) : null);
  };

  repo.getEvidence = (id) => db.prepare('SELECT * FROM rf_evidence WHERE id = ?').get(id) || null;

  repo.listEvidence = (projectId) =>
    db.prepare('SELECT * FROM rf_evidence WHERE project_id = ? AND archived_at IS NULL ORDER BY created_at ASC').all(projectId);

  repo.updateEvidence = (id, fields) => {
    const assignments = [];
    const values = [];
    const columnMap = {
      evidenceType: 'evidence_type', sourceId: 'source_id', title: 'title', summary: 'summary',
      strength: 'strength', pathOrReference: 'path_or_reference', sortOrder: 'sort_order',
    };
    for (const [field, column] of Object.entries(columnMap)) {
      if (fields[field] !== undefined) {
        assignments.push(`${column} = ?`);
        values.push(fields[field]);
      }
    }
    if (fields.metadata !== undefined) {
      assignments.push('metadata_json = ?');
      values.push(JSON.stringify(fields.metadata));
    }
    if (assignments.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE rf_evidence SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    touch(db, 'rf_evidence', id);
  };

  repo.softDeleteEvidence = (id) =>
    db.prepare("UPDATE rf_evidence SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);

  repo.createClaimEvidence = (row) => {
    db.prepare(`
      INSERT INTO rf_claim_evidence (id, project_id, claim_id, evidence_id, relation_type, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(row.id, row.projectId, row.claimId, row.evidenceId, row.relationType, row.notes || null);
  };

  repo.getClaimEvidence = (id) => db.prepare('SELECT * FROM rf_claim_evidence WHERE id = ?').get(id) || null;

  repo.deleteClaimEvidence = (id) => db.prepare('DELETE FROM rf_claim_evidence WHERE id = ?').run(id);

  repo.hasClaimEvidence = (claimId, evidenceId, relationType) => {
    const row = db.prepare(
      'SELECT id FROM rf_claim_evidence WHERE claim_id = ? AND evidence_id = ? AND relation_type = ?'
    ).get(claimId, evidenceId, relationType);
    return row ? row.id : null;
  };

  // Join evidence strength so health calculations need no second query pass.
  repo.listClaimEvidenceByProject = (projectId) =>
    db.prepare(`
      SELECT ce.id, ce.project_id, ce.claim_id, ce.evidence_id, ce.relation_type, ce.notes, ce.created_at,
             e.strength AS evidence_strength
      FROM rf_claim_evidence ce
      JOIN rf_evidence e ON e.id = ce.evidence_id
      WHERE ce.project_id = ?
      ORDER BY ce.created_at ASC
    `).all(projectId);

  repo.createDecision = (row) => {
    db.prepare(`
      INSERT INTO rf_decisions (id, project_id, decision_code, date, title, context, decision, reason, alternatives, impact, sort_order, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.projectId, row.decisionCode, row.date || null, row.title, row.context || null,
      row.decision || null, row.reason || null, row.alternatives || null, row.impact || null,
      row.sortOrder || 0, row.metadata ? JSON.stringify(row.metadata) : null);
  };

  repo.getDecision = (id) => db.prepare('SELECT * FROM rf_decisions WHERE id = ?').get(id) || null;

  repo.listDecisions = (projectId) =>
    db.prepare('SELECT * FROM rf_decisions WHERE project_id = ? AND archived_at IS NULL ORDER BY created_at DESC').all(projectId);

  repo.nextDecisionCode = (projectId) => {
    const row = db.prepare(
      'SELECT MAX(CAST(substr(decision_code, 5) AS INTEGER)) AS max FROM rf_decisions WHERE project_id = ?'
    ).get(projectId);
    const next = (row?.max || 0) + 1;
    return `DEC-${String(next).padStart(3, '0')}`;
  };

  repo.updateDecision = (id, fields) => {
    const assignments = [];
    const values = [];
    const columnMap = {
      date: 'date', title: 'title', context: 'context', decision: 'decision', reason: 'reason',
      alternatives: 'alternatives', impact: 'impact', sortOrder: 'sort_order',
    };
    for (const [field, column] of Object.entries(columnMap)) {
      if (fields[field] !== undefined) {
        assignments.push(`${column} = ?`);
        values.push(fields[field]);
      }
    }
    if (fields.metadata !== undefined) {
      assignments.push('metadata_json = ?');
      values.push(JSON.stringify(fields.metadata));
    }
    if (assignments.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE rf_decisions SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    touch(db, 'rf_decisions', id);
  };

  repo.softDeleteDecision = (id) =>
    db.prepare("UPDATE rf_decisions SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);

  repo.createLiterature = (row) => {
    db.prepare(`
      INSERT INTO rf_literature (
        id, project_id, title, authors, year, venue, url, doi, arxiv_id, citation_key,
        relation, read_status, priority, key_finding, method_summary, difference_to_ours,
        used_in_section, notes, sort_order, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id, row.projectId, row.title, row.authors || null, row.year ?? null, row.venue || null,
      row.url || null, row.doi || null, row.arxivId || null, row.citationKey || null,
      row.relation || null, row.readStatus, row.priority, row.keyFinding || null,
      row.methodSummary || null, row.differenceToOurs || null, row.usedInSection || null,
      row.notes || null, row.sortOrder || 0, row.metadata ? JSON.stringify(row.metadata) : null
    );
  };

  repo.getLiterature = (id) => db.prepare('SELECT * FROM rf_literature WHERE id = ?').get(id) || null;

  repo.listLiterature = (projectId) =>
    db.prepare('SELECT * FROM rf_literature WHERE project_id = ? AND archived_at IS NULL ORDER BY created_at DESC').all(projectId);

  repo.updateLiterature = (id, fields) => {
    const assignments = [];
    const values = [];
    const columnMap = {
      title: 'title', authors: 'authors', year: 'year', venue: 'venue', url: 'url', doi: 'doi',
      arxivId: 'arxiv_id', citationKey: 'citation_key', relation: 'relation',
      readStatus: 'read_status', priority: 'priority', keyFinding: 'key_finding',
      methodSummary: 'method_summary', differenceToOurs: 'difference_to_ours',
      usedInSection: 'used_in_section', notes: 'notes', sortOrder: 'sort_order',
    };
    for (const [field, column] of Object.entries(columnMap)) {
      if (fields[field] !== undefined) {
        assignments.push(`${column} = ?`);
        values.push(fields[field]);
      }
    }
    if (fields.metadata !== undefined) {
      assignments.push('metadata_json = ?');
      values.push(JSON.stringify(fields.metadata));
    }
    if (assignments.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE rf_literature SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    touch(db, 'rf_literature', id);
  };

  repo.softDeleteLiterature = (id) =>
    db.prepare("UPDATE rf_literature SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);

  repo.createFigureTable = (row) => {
    db.prepare(`
      INSERT INTO rf_figures_tables (
        id, project_id, artifact_code, type, number, working_title, status, file_path,
        manuscript_section, frozen, notes, sort_order, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id, row.projectId, row.artifactCode, row.type, row.number ?? null, row.workingTitle,
      row.status, row.filePath || null, row.manuscriptSection || null, row.frozen ? 1 : 0,
      row.notes || null, row.sortOrder || 0, row.metadata ? JSON.stringify(row.metadata) : null
    );
  };

  repo.getFigureTable = (id) => db.prepare('SELECT * FROM rf_figures_tables WHERE id = ?').get(id) || null;

  repo.listFiguresTables = (projectId) =>
    db.prepare('SELECT * FROM rf_figures_tables WHERE project_id = ? AND archived_at IS NULL ORDER BY sort_order ASC, created_at ASC').all(projectId);

  repo.nextArtifactCode = (projectId, type) => {
    const prefix = type === 'table' ? 'TBL-' : 'FIG-';
    const row = db.prepare(
      'SELECT MAX(CAST(substr(artifact_code, ?) AS INTEGER)) AS max FROM rf_figures_tables WHERE project_id = ? AND type = ?'
    ).get(prefix.length + 1, projectId, type);
    const next = (row?.max || 0) + 1;
    return `${prefix}${String(next).padStart(2, '0')}`;
  };

  repo.updateFigureTable = (id, fields) => {
    const assignments = [];
    const values = [];
    const columnMap = {
      type: 'type', number: 'number', workingTitle: 'working_title', status: 'status',
      filePath: 'file_path', manuscriptSection: 'manuscript_section', notes: 'notes',
      sortOrder: 'sort_order',
    };
    for (const [field, column] of Object.entries(columnMap)) {
      if (fields[field] !== undefined) {
        assignments.push(`${column} = ?`);
        values.push(fields[field]);
      }
    }
    if (fields.frozen !== undefined) {
      assignments.push('frozen = ?');
      values.push(fields.frozen ? 1 : 0);
    }
    if (fields.metadata !== undefined) {
      assignments.push('metadata_json = ?');
      values.push(JSON.stringify(fields.metadata));
    }
    if (assignments.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE rf_figures_tables SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    touch(db, 'rf_figures_tables', id);
  };

  repo.softDeleteFigureTable = (id) =>
    db.prepare("UPDATE rf_figures_tables SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);

  repo.createEntityLink = (row) => {
    db.prepare(`
      INSERT INTO rf_entity_links (id, project_id, source_type, source_id, target_type, target_id, relation_type, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.projectId, row.sourceType, row.sourceId, row.targetType, row.targetId,
      row.relationType, row.metadata ? JSON.stringify(row.metadata) : null);
  };

  repo.getEntityLink = (id) => db.prepare('SELECT * FROM rf_entity_links WHERE id = ?').get(id) || null;

  repo.deleteEntityLink = (id) => db.prepare('DELETE FROM rf_entity_links WHERE id = ?').run(id);

  repo.hasEntityLink = (sourceType, sourceId, targetType, targetId, relationType) => {
    const row = db.prepare(
      'SELECT id FROM rf_entity_links WHERE source_type = ? AND source_id = ? AND target_type = ? AND target_id = ? AND relation_type = ?'
    ).get(sourceType, sourceId, targetType, targetId, relationType);
    return row ? row.id : null;
  };

  repo.listEntityLinksByProject = (projectId) =>
    db.prepare('SELECT * FROM rf_entity_links WHERE project_id = ? ORDER BY created_at ASC').all(projectId);

  // Provenance: all links touching an entity (either direction).
  repo.listEntityLinksForEntity = (type, id) =>
    db.prepare(
      'SELECT * FROM rf_entity_links WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?) ORDER BY created_at ASC'
    ).all(type, id, type, id);

  // -------------------------------------------------------------------------
  // Phase 4 — Manuscript / Freeze / Review / Submission
  // -------------------------------------------------------------------------

  repo.createManuscriptSection = (row) => {
    db.prepare(`
      INSERT INTO rf_manuscript_sections (id, project_id, section_key, title, sort_order, status, progress, is_optional, file_path, notes, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.projectId, row.sectionKey, row.title, row.sortOrder || 0, row.status,
      row.progress ?? 0, row.isOptional ? 1 : 0, row.filePath || null, row.notes || null,
      row.metadata ? JSON.stringify(row.metadata) : null);
  };

  repo.getManuscriptSection = (id) => db.prepare('SELECT * FROM rf_manuscript_sections WHERE id = ?').get(id) || null;

  repo.getManuscriptSectionByKey = (projectId, sectionKey) =>
    db.prepare('SELECT * FROM rf_manuscript_sections WHERE project_id = ? AND section_key = ?').get(projectId, sectionKey) || null;

  repo.listManuscriptSections = (projectId) =>
    db.prepare('SELECT * FROM rf_manuscript_sections WHERE project_id = ? AND archived_at IS NULL ORDER BY sort_order ASC, created_at ASC').all(projectId);

  repo.updateManuscriptSection = (id, fields) => {
    const assignments = [];
    const values = [];
    const columnMap = {
      title: 'title', status: 'status', progress: 'progress', isOptional: 'is_optional',
      filePath: 'file_path', notes: 'notes', sortOrder: 'sort_order',
    };
    for (const [field, column] of Object.entries(columnMap)) {
      if (fields[field] !== undefined) {
        assignments.push(`${column} = ?`);
        values.push(fields[field]);
      }
    }
    if (fields.metadata !== undefined) {
      assignments.push('metadata_json = ?');
      values.push(JSON.stringify(fields.metadata));
    }
    if (assignments.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE rf_manuscript_sections SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    touch(db, 'rf_manuscript_sections', id);
  };

  repo.softDeleteManuscriptSection = (id) =>
    db.prepare("UPDATE rf_manuscript_sections SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);

  repo.createResultFreeze = (row) => {
    db.prepare(`
      INSERT INTO rf_result_freezes (id, project_id, freeze_number, git_commit, git_branch, result_version, dataset_version, config_version, snapshot_json, notes, override_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.projectId, row.freezeNumber, row.gitCommit || null, row.gitBranch || null,
      row.resultVersion || null, row.datasetVersion || null, row.configVersion || null,
      JSON.stringify(row.snapshot || {}), row.notes || null, row.overrideReason || null);
  };

  repo.getResultFreeze = (id) => db.prepare('SELECT * FROM rf_result_freezes WHERE id = ?').get(id) || null;

  repo.listResultFreezes = (projectId) =>
    db.prepare('SELECT * FROM rf_result_freezes WHERE project_id = ? ORDER BY freeze_number DESC').all(projectId);

  repo.getLatestResultFreeze = (projectId) =>
    db.prepare('SELECT * FROM rf_result_freezes WHERE project_id = ? ORDER BY freeze_number DESC LIMIT 1').get(projectId) || null;

  repo.nextFreezeNumber = (projectId) => {
    const row = db.prepare('SELECT MAX(freeze_number) AS max FROM rf_result_freezes WHERE project_id = ?').get(projectId);
    return (row?.max || 0) + 1;
  };

  repo.createReviewComment = (row) => {
    db.prepare(`
      INSERT INTO rf_review_comments (id, project_id, manuscript_section_id, comment_code, title, body, severity, status, source, author_name, due_date, resolved_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.projectId, row.manuscriptSectionId || null, row.commentCode, row.title,
      row.body || null, row.severity, row.status, row.source, row.authorName || null,
      row.dueDate || null, row.resolvedAt || null, row.metadata ? JSON.stringify(row.metadata) : null);
  };

  repo.getReviewComment = (id) => db.prepare('SELECT * FROM rf_review_comments WHERE id = ?').get(id) || null;

  repo.listReviewComments = (projectId) =>
    db.prepare('SELECT * FROM rf_review_comments WHERE project_id = ? AND archived_at IS NULL ORDER BY created_at DESC').all(projectId);

  repo.nextReviewCommentCode = (projectId) => {
    const row = db.prepare(
      'SELECT MAX(CAST(substr(comment_code, 4) AS INTEGER)) AS max FROM rf_review_comments WHERE project_id = ?'
    ).get(projectId);
    const next = (row?.max || 0) + 1;
    return `RC-${String(next).padStart(3, '0')}`;
  };

  repo.updateReviewComment = (id, fields) => {
    const assignments = [];
    const values = [];
    const columnMap = {
      title: 'title', body: 'body', severity: 'severity', status: 'status', source: 'source',
      authorName: 'author_name', dueDate: 'due_date', manuscriptSectionId: 'manuscript_section_id',
      resolvedAt: 'resolved_at',
    };
    for (const [field, column] of Object.entries(columnMap)) {
      if (fields[field] !== undefined) {
        assignments.push(`${column} = ?`);
        values.push(fields[field]);
      }
    }
    if (fields.metadata !== undefined) {
      assignments.push('metadata_json = ?');
      values.push(JSON.stringify(fields.metadata));
    }
    if (assignments.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE rf_review_comments SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    touch(db, 'rf_review_comments', id);
  };

  repo.softDeleteReviewComment = (id) =>
    db.prepare("UPDATE rf_review_comments SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);

  repo.createSubmissionProfile = (row) => {
    db.prepare(`
      INSERT INTO rf_submission_profiles (id, project_id, venue, track, deadline, deadline_timezone, page_limit, anonymous, submission_url, status, notes, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.projectId, row.venue, row.track || null, row.deadline || null,
      row.deadlineTimezone || null, row.pageLimit ?? null, row.anonymous ? 1 : 0,
      row.submissionUrl || null, row.status || 'preparing', row.notes || null,
      row.metadata ? JSON.stringify(row.metadata) : null);
  };

  repo.getSubmissionProfile = (id) => db.prepare('SELECT * FROM rf_submission_profiles WHERE id = ?').get(id) || null;

  repo.listSubmissionProfiles = (projectId) =>
    db.prepare('SELECT * FROM rf_submission_profiles WHERE project_id = ? AND archived_at IS NULL ORDER BY created_at DESC').all(projectId);

  repo.updateSubmissionProfile = (id, fields) => {
    const assignments = [];
    const values = [];
    const columnMap = {
      venue: 'venue', track: 'track', deadline: 'deadline', deadlineTimezone: 'deadline_timezone',
      pageLimit: 'page_limit', anonymous: 'anonymous', submissionUrl: 'submission_url',
      status: 'status', notes: 'notes', submittedAt: 'submitted_at',
      finalPaperPath: 'final_paper_path', externalSubmissionId: 'external_submission_id',
    };
    for (const [field, column] of Object.entries(columnMap)) {
      if (fields[field] !== undefined) {
        assignments.push(`${column} = ?`);
        values.push(fields[field]);
      }
    }
    if (fields.metadata !== undefined) {
      assignments.push('metadata_json = ?');
      values.push(JSON.stringify(fields.metadata));
    }
    if (assignments.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE rf_submission_profiles SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    touch(db, 'rf_submission_profiles', id);
  };

  repo.softDeleteSubmissionProfile = (id) =>
    db.prepare("UPDATE rf_submission_profiles SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);

  repo.createSubmissionItem = (row) => {
    db.prepare(`
      INSERT INTO rf_submission_items (id, project_id, submission_profile_id, category, title, required, status, due_date, notes, artifact_path, sort_order, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.projectId, row.submissionProfileId, row.category, row.title,
      row.required ? 1 : 0, row.status, row.dueDate || null, row.notes || null,
      row.artifactPath || null, row.sortOrder || 0, row.metadata ? JSON.stringify(row.metadata) : null);
  };

  repo.getSubmissionItem = (id) => db.prepare('SELECT * FROM rf_submission_items WHERE id = ?').get(id) || null;

  repo.listSubmissionItemsByProfile = (profileId) =>
    db.prepare('SELECT * FROM rf_submission_items WHERE submission_profile_id = ? AND archived_at IS NULL ORDER BY sort_order ASC, created_at ASC').all(profileId);

  repo.listSubmissionItemsByProject = (projectId) =>
    db.prepare('SELECT * FROM rf_submission_items WHERE project_id = ? AND archived_at IS NULL ORDER BY created_at ASC').all(projectId);

  repo.updateSubmissionItem = (id, fields) => {
    const assignments = [];
    const values = [];
    const columnMap = {
      title: 'title', category: 'category', required: 'required', status: 'status',
      dueDate: 'due_date', notes: 'notes', artifactPath: 'artifact_path', sortOrder: 'sort_order',
    };
    for (const [field, column] of Object.entries(columnMap)) {
      if (fields[field] !== undefined) {
        assignments.push(`${column} = ?`);
        values.push(fields[field]);
      }
    }
    if (fields.metadata !== undefined) {
      assignments.push('metadata_json = ?');
      values.push(JSON.stringify(fields.metadata));
    }
    if (assignments.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE rf_submission_items SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    touch(db, 'rf_submission_items', id);
  };

  repo.softDeleteSubmissionItem = (id) =>
    db.prepare("UPDATE rf_submission_items SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);

  return repo;
};

const datetimeNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
