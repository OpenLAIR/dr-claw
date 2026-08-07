// ResearchFlow service layer: business orchestration, ownership checks,
// transactions (state mutation + activity log in one transaction), and API
// serialization. Routes stay thin and delegate here.

import { randomUUID } from 'node:crypto';
import { logActivity } from './activity.js';
import { RfNotFoundError, RfConflictError, RfValidationError } from './errors.js';
import { isStageCompleted, stageProgress, overallProgress } from './progress.js';
import { DEFAULT_LIFECYCLE } from './lifecycle.js';
import { TASK_RELATION_TYPES } from './validation.js';

const parseJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

// --- Serializers (DB snake_case row -> API camelCase) -----------------------

const serializeProject = (row) => row && ({
  id: row.id,
  name: row.name,
  status: row.status,
  targetVenue: row.target_venue,
  deadline: row.deadline,
  sourceProjectId: row.source_project_id,
  workspaceType: row.workspace_type,
  windowsPath: row.windows_path,
  wslDistro: row.wsl_distro,
  wslPath: row.wsl_path,
  metadata: parseJson(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

const serializeStage = (row) => row && ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  key: row.key,
  sortOrder: row.sort_order,
  weight: row.weight,
  status: row.status,
  notes: row.notes,
  metadata: parseJson(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const serializeGate = (row) => row && ({
  id: row.id,
  stageId: row.stage_id,
  title: row.title,
  description: row.description,
  isRequired: Boolean(row.is_required),
  isPassed: Boolean(row.is_passed),
  passedAt: row.passed_at,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const serializeTask = (row) => row && ({
  id: row.id,
  projectId: row.project_id,
  stageId: row.stage_id,
  title: row.title,
  description: row.description,
  status: row.status,
  priority: row.priority,
  dueDate: row.due_date,
  isBlocker: Boolean(row.is_blocker),
  sortOrder: row.sort_order,
  metadata: parseJson(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

const serializeDependency = (row) => row && ({
  id: row.id,
  taskId: row.task_id,
  dependsOnTaskId: row.depends_on_task_id,
  createdAt: row.created_at,
});

const serializeTaskLink = (row) => row && ({
  id: row.id,
  taskId: row.task_id,
  relationType: row.relation_type,
  relationId: row.relation_id,
  createdAt: row.created_at,
});

const serializeActivity = (row) => row && ({
  id: row.id,
  projectId: row.project_id,
  action: row.action,
  entityType: row.entity_type,
  entityId: row.entity_id,
  message: row.message,
  metadata: parseJson(row.metadata_json),
  createdAt: row.created_at,
});

// --- Service ----------------------------------------------------------------

export const createResearchFlowService = ({ db, repo }) => {
  if (!db || !repo) {
    throw new Error('createResearchFlowService: db and repo are required');
  }

  const tx = (fn) => db.transaction(fn);

  // --- Ownership helpers ----------------------------------------------------

  const getProjectOrThrow = (userId, projectId) => {
    const project = repo.getProject(projectId);
    if (!project || project.archived_at || project.user_id !== userId) {
      throw new RfNotFoundError('ResearchFlow project not found');
    }
    return project;
  };

  const getStageOrThrow = (userId, stageId) => {
    const stage = repo.getStage(stageId);
    if (!stage || stage.archived_at) {
      throw new RfNotFoundError('Stage not found');
    }
    getProjectOrThrow(userId, stage.project_id);
    return stage;
  };

  const getGateOrThrow = (userId, gateId) => {
    const gate = repo.getGate(gateId);
    if (!gate) {
      throw new RfNotFoundError('Gate not found');
    }
    getStageOrThrow(userId, gate.stage_id);
    return gate;
  };

  const getTaskOrThrow = (userId, taskId) => {
    const task = repo.getTask(taskId);
    if (!task || task.archived_at) {
      throw new RfNotFoundError('Task not found');
    }
    getProjectOrThrow(userId, task.project_id);
    return task;
  };

  const assertTaskBelongsToProject = (task, projectId) => {
    if (task.project_id !== projectId) {
      throw new RfValidationError('Task does not belong to this project');
    }
  };

  const assertStageBelongsToProject = (stage, projectId) => {
    if (stage.project_id !== projectId) {
      throw new RfValidationError('Stage does not belong to this project');
    }
  };

  // --- Project detail assembly ---------------------------------------------

  const buildProjectDetail = (userId, projectId) => {
    const project = getProjectOrThrow(userId, projectId);
    const stages = repo.listStages(projectId);
    const gatesByStage = repo.listGatesByStages(stages.map((stage) => stage.id));
    const tasks = repo.listTasks(projectId);

    const stagesWithGates = stages.map((stage) => {
      const gates = gatesByStage[stage.id] || [];
      const tasksForStage = tasks.filter((task) => task.stage_id === stage.id);
      const progress = stageProgress(gates, tasksForStage);
      return {
        ...serializeStage(stage),
        gates: gates.map(serializeGate),
        progress: Number(progress.toFixed(4)),
        completed: isStageCompleted(gates),
      };
    });

    const overall = overallProgress(stagesWithGates.map((stage) => ({
      weight: stage.weight,
      status: stage.status,
      progress: stage.progress,
    })));

    return {
      project: serializeProject(project),
      stages: stagesWithGates,
      overallProgress: Number(overall.toFixed(4)),
      currentStageId: stagesWithGates.find((stage) => stage.status === 'current')?.id || null,
    };
  };

  // --- Public API -----------------------------------------------------------

  const service = {
    createProject(userId, input) {
      return tx(() => {
        const projectId = randomUUID();
        repo.createProject({ id: projectId, userId, ...input });
        // Idempotent lifecycle initialization for a brand-new project.
        DEFAULT_LIFECYCLE.forEach((template, index) => {
          const stageId = randomUUID();
          repo.createStage({
            id: stageId,
            projectId,
            name: template.name,
            key: template.key,
            sortOrder: index,
            weight: template.weight,
          });
          repo.createGates(projectId, stageId, template.gates);
          if (index === 0) {
            repo.setStageStatus(stageId, 'current');
          }
        });
        logActivity(db, {
          projectId,
          action: 'project_created',
          entityType: 'project',
          entityId: projectId,
          message: `ResearchFlow project "${input.name}" created`,
        });
        return buildProjectDetail(userId, projectId);
      })();
    },

    listProjects(userId, { includeArchived = false } = {}) {
      return repo.listProjects(userId, { includeArchived }).map(serializeProject);
    },

    getProject(userId, projectId) {
      return buildProjectDetail(userId, projectId);
    },

    updateProject(userId, projectId, fields) {
      return tx(() => {
        getProjectOrThrow(userId, projectId);
        repo.updateProject(projectId, fields);
        return buildProjectDetail(userId, projectId);
      })();
    },

    archiveProject(userId, projectId) {
      return tx(() => {
        getProjectOrThrow(userId, projectId);
        repo.softDeleteProject(projectId);
        logActivity(db, {
          projectId,
          action: 'project_archived',
          entityType: 'project',
          entityId: projectId,
          message: 'Project archived',
        });
        return { id: projectId, archived: true };
      })();
    },

    listStages(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      return repo.listStages(projectId).map(serializeStage);
    },

    updateStage(userId, stageId, fields) {
      return tx(() => {
        getStageOrThrow(userId, stageId);
        repo.updateStage(stageId, fields);
        const stage = repo.getStage(stageId);
        return { ...serializeStage(stage) };
      })();
    },

    completeStage(userId, stageId) {
      return tx(() => {
        const stage = getStageOrThrow(userId, stageId);
        const gates = repo.listGatesByStage(stageId);
        if (!isStageCompleted(gates)) {
          throw new RfConflictError('Stage cannot be completed: not all required gates are passed');
        }
        if (stage.status === 'completed') {
          return { ...serializeStage(stage) };
        }
        if (stage.status !== 'current') {
          throw new RfConflictError('Stage is not the current stage and cannot be completed out of order');
        }
        repo.setStageStatus(stageId, 'completed');
        logActivity(db, {
          projectId: stage.project_id,
          action: 'stage_changed',
          entityType: 'stage',
          entityId: stageId,
          message: `Stage "${stage.name}" completed`,
          metadata: { from: 'current', to: 'completed' },
        });
        // Activate the next pending stage so the lifecycle keeps advancing.
        const nextStage = repo.listStages(stage.project_id).find((item) => item.status === 'pending');
        if (nextStage) {
          repo.setStageCurrent(nextStage.id, stage.project_id);
          logActivity(db, {
            projectId: stage.project_id,
            action: 'stage_changed',
            entityType: 'stage',
            entityId: nextStage.id,
            message: `Stage "${nextStage.name}" is now current`,
            metadata: { from: 'pending', to: 'current' },
          });
        }
        return { ...serializeStage({ ...stage, status: 'completed' }) };
      })();
    },

    advanceStage(userId, projectId) {
      return tx(() => {
        getProjectOrThrow(userId, projectId);
        const stages = repo.listStages(projectId);
        const currentStage = stages.find((stage) => stage.status === 'current');
        const nextStage = stages.find((stage) => stage.status === 'pending');

        if (!currentStage) {
          throw new RfConflictError('No current stage to advance');
        }

        const currentGates = repo.listGatesByStage(currentStage.id);
        if (!isStageCompleted(currentGates)) {
          throw new RfConflictError(
            `Stage "${currentStage.name}" cannot be advanced: not all required gates are passed`
          );
        }

        repo.setStageStatus(currentStage.id, 'completed');
        logActivity(db, {
          projectId,
          action: 'stage_changed',
          entityType: 'stage',
          entityId: currentStage.id,
          message: `Stage "${currentStage.name}" completed`,
          metadata: { from: 'current', to: 'completed' },
        });

        if (nextStage) {
          repo.setStageCurrent(nextStage.id, projectId);
          logActivity(db, {
            projectId,
            action: 'stage_changed',
            entityType: 'stage',
            entityId: nextStage.id,
            message: `Stage "${nextStage.name}" is now current`,
            metadata: { from: 'pending', to: 'current' },
          });
        }

        return buildProjectDetail(userId, projectId);
      })();
    },

    listGates(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      const stages = repo.listStages(projectId);
      const gatesByStage = repo.listGatesByStages(stages.map((stage) => stage.id));
      return Object.values(gatesByStage).flat().map(serializeGate);
    },

    patchGate(userId, gateId, fields) {
      return tx(() => {
        const gate = getGateOrThrow(userId, gateId);
        const stage = repo.getStage(gate.stage_id);
        const projectId = gate.project_id;

        if (fields.isPassed !== undefined && fields.isPassed !== Boolean(gate.is_passed)) {
          const action = fields.isPassed ? 'gate_passed' : 'gate_unpassed';
          const verb = fields.isPassed ? 'passed' : 'unpassed';
          logActivity(db, {
            projectId,
            action,
            entityType: 'gate',
            entityId: gateId,
            message: `Gate "${gate.title}" ${verb} (${stage.name})`,
          });
          // Invariant: a completed stage must keep ALL required gates passed.
          // Un-passing a gate rolls the stage back to 'current' so the project
          // returns to that stage instead of claiming completion it no longer
          // satisfies.
          if (!fields.isPassed && stage.status === 'completed') {
            repo.setStageCurrent(stage.id, projectId);
            logActivity(db, {
              projectId,
              action: 'stage_changed',
              entityType: 'stage',
              entityId: stage.id,
              message: `Stage "${stage.name}" reopened (required gate "${gate.title}" unpassed)`,
              metadata: { from: 'completed', to: 'current' },
            });
          }
        }
        repo.updateGate(gateId, fields);
        const updated = repo.getGate(gateId);
        return { ...serializeGate(updated) };
      })();
    },

    createTask(userId, projectId, input) {
      return tx(() => {
        getProjectOrThrow(userId, projectId);
        if (input.stageId) {
          const stage = repo.getStage(input.stageId);
          if (!stage || stage.archived_at) {
            throw new RfValidationError('stageId does not reference a valid stage');
          }
          assertStageBelongsToProject(stage, projectId);
        }
        const taskId = randomUUID();
        const taskInput = { ...input };
        if (taskInput.status === undefined) taskInput.status = 'todo';
        if (taskInput.priority === undefined) taskInput.priority = 'medium';
        repo.createTask({ id: taskId, projectId, ...taskInput });
        logActivity(db, {
          projectId,
          action: 'task_created',
          entityType: 'task',
          entityId: taskId,
          message: `Task "${input.title}" created`,
        });
        const task = repo.getTask(taskId);
        return { ...serializeTask(task) };
      })();
    },

    updateTask(userId, taskId, fields) {
      return tx(() => {
        const task = getTaskOrThrow(userId, taskId);
        if (fields.stageId !== undefined && fields.stageId !== null) {
          const stage = repo.getStage(fields.stageId);
          if (!stage || stage.archived_at) {
            throw new RfValidationError('stageId does not reference a valid stage');
          }
          assertStageBelongsToProject(stage, task.project_id);
        }
        const prevStatus = task.status;
        repo.updateTask(taskId, fields);
        const updated = repo.getTask(taskId);

        if (fields.status !== undefined && fields.status !== prevStatus) {
          let action = 'task_status_changed';
          let message = `Task "${updated.title}" changed ${prevStatus} -> ${updated.status}`;
          if (updated.status === 'done') {
            action = 'task_completed';
            message = `Task "${updated.title}" completed`;
          } else if (updated.status === 'blocked') {
            action = 'task_blocked';
            message = `Task "${updated.title}" blocked`;
          }
          logActivity(db, {
            projectId: updated.project_id,
            action,
            entityType: 'task',
            entityId: taskId,
            message,
            metadata: { from: prevStatus, to: updated.status },
          });
        }
        return { ...serializeTask(updated) };
      })();
    },

    deleteTask(userId, taskId) {
      return tx(() => {
        const task = getTaskOrThrow(userId, taskId);
        repo.softDeleteTask(taskId);
        logActivity(db, {
          projectId: task.project_id,
          action: 'task_deleted',
          entityType: 'task',
          entityId: taskId,
          message: `Task "${task.title}" deleted`,
        });
        return { id: taskId, deleted: true };
      })();
    },

    getTask(userId, taskId) {
      const task = getTaskOrThrow(userId, taskId);
      return { ...serializeTask(task) };
    },

    listTasks(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      const tasks = repo.listTasks(projectId);
      const dependencies = repo.listDependenciesByTask(tasks.map((task) => task.id));
      return {
        tasks: tasks.map(serializeTask),
        dependencies: dependencies.map(serializeDependency),
      };
    },

    createDependency(userId, taskId, { dependsOnTaskId }) {
      return tx(() => {
        const task = getTaskOrThrow(userId, taskId);
        const dependencyTask = getTaskOrThrow(userId, dependsOnTaskId);
        assertTaskBelongsToProject(dependencyTask, task.project_id);

        if (taskId === dependsOnTaskId) {
          throw new RfValidationError('A task cannot depend on itself');
        }
        if (repo.hasDependency(taskId, dependsOnTaskId)) {
          throw new RfConflictError('Dependency already exists');
        }
        if (wouldCreateCycle(repo, taskId, dependsOnTaskId)) {
          throw new RfConflictError('Dependency would create a cycle');
        }

        const dependencyId = randomUUID();
        repo.createDependency({ id: dependencyId, projectId: task.project_id, taskId, dependsOnTaskId });
        logActivity(db, {
          projectId: task.project_id,
          action: 'task_dependency_added',
          entityType: 'task',
          entityId: taskId,
          message: `Task "${task.title}" now depends on "${dependencyTask.title}"`,
        });
        const row = repo.getDependency(dependencyId);
        return { ...serializeDependency(row) };
      })();
    },

    deleteDependency(userId, dependencyId) {
      return tx(() => {
        const dependency = repo.getDependency(dependencyId);
        if (!dependency) {
          throw new RfNotFoundError('Dependency not found');
        }
        getProjectOrThrow(userId, dependency.project_id);
        repo.deleteDependency(dependencyId);
        return { id: dependencyId, deleted: true };
      })();
    },

    listDependencies(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      return repo.listDependencies(projectId).map(serializeDependency);
    },

    createTaskLink(userId, taskId, { relationType, relationId }) {
      if (!TASK_RELATION_TYPES.includes(relationType)) {
        throw new RfValidationError(
          `Field "relationType" must be one of: ${TASK_RELATION_TYPES.join(', ')}`
        );
      }
      if (typeof relationId !== 'string' || relationId.trim().length === 0) {
        throw new RfValidationError('Field "relationId" must be a non-empty string');
      }
      return tx(() => {
        const task = getTaskOrThrow(userId, taskId);
        let linkId;
        try {
          linkId = randomUUID();
          repo.createTaskLink({ id: linkId, taskId, relationType, relationId });
        } catch (error) {
          if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            throw new RfConflictError('Task link already exists');
          }
          throw error;
        }
        logActivity(db, {
          projectId: task.project_id,
          action: 'task_link_added',
          entityType: 'task',
          entityId: taskId,
          message: `Task "${task.title}" linked to ${relationType}:${relationId}`,
          metadata: { relationType, relationId },
        });
        const row = repo.getTaskLink(linkId);
        return { ...serializeTaskLink(row) };
      })();
    },

    deleteTaskLink(userId, linkId) {
      return tx(() => {
        const link = repo.getTaskLink(linkId);
        if (!link) {
          throw new RfNotFoundError('Task link not found');
        }
        const task = repo.getTask(link.task_id);
        if (!task || task.archived_at) {
          throw new RfNotFoundError('Task link not found');
        }
        getProjectOrThrow(userId, task.project_id);
        repo.deleteTaskLink(linkId);
        return { id: linkId, deleted: true };
      })();
    },

    listTaskLinks(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      return repo.listTaskLinks(projectId).map(serializeTaskLink);
    },

    listActivity(userId, projectId, { limit, offset } = {}) {
      getProjectOrThrow(userId, projectId);
      return repo.listActivity(projectId, { limit, offset }).map(serializeActivity);
    },
  };

  return service;
};

/**
 * Would adding the edge taskId -> dependsOnTaskId create a cycle?
 * Follows the "depends on" chain from the dependency target; if it reaches
 * taskId again, the edge closes a loop.
 */
const wouldCreateCycle = (repo, taskId, dependsOnTaskId) => {
  const visited = new Set();
  const stack = [dependsOnTaskId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const deps = repo.listDependenciesByTask([current]);
    for (const dep of deps) {
      stack.push(dep.depends_on_task_id);
    }
  }
  return false;
};
