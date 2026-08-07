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

  return repo;
};

const datetimeNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
