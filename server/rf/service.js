const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ResearchFlow service layer: business orchestration, ownership checks,
// transactions (state mutation + activity log in one transaction), and API
// serialization. Routes stay thin and delegate here.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logActivity } from './activity.js';
import { RfNotFoundError, RfConflictError, RfValidationError } from './errors.js';
import { isStageCompleted, stageProgress, overallProgress } from './progress.js';
import { nextCriticalAction, projectHealth, parseDateLocal } from './insights.js';
import { summarizeExperiment } from './experiment-summary.js';
import { claimEvidenceHealth, projectEvidenceSummary } from './evidence-health.js';
import { manuscriptCompleteness } from './manuscript.js';
import { freezeReadiness, buildFreezeSnapshot, freezeStaleness } from './freeze.js';
import { reviewSummary } from './review.js';
import { submissionReadiness } from './submission.js';
import { DEFAULT_LIFECYCLE } from './lifecycle.js';
import { TASK_RELATION_TYPES, TASK_PRIORITIES } from './validation.js';
import {
  createBackup as rfCreateBackup,
  listBackups as rfListBackups,
  restoreBackup as rfRestoreBackup,
  backupsDirFor,
  dataDirFromDbPath,
  collectSchemaVersion,
} from './backup.js';
import { exportProject as rfExportProject, exportFileName } from './export.js';
import {
  validateWorkspaceFields,
  createWorkspaceAdapter,
  validateProjectWorkspace,
  workspacePathFor,
} from './workspace.js';
import {
  EXPERIMENT_TYPES,
  EXPERIMENT_STATUSES,
  RUN_STATUSES,
  FAILURE_CLASSIFICATIONS,
  CLAIM_IMPORTANCES,
  CLAIM_STATUSES,
  EVIDENCE_TYPES,
  EVIDENCE_STRENGTHS,
  LITERATURE_RELATIONS,
  LITERATURE_READ_STATUSES,
  FIGURE_TABLE_TYPES,
  FIGURE_TABLE_STATUSES,
  MANUSCRIPT_SECTION_STATUSES,
  REVIEW_SEVERITIES,
  REVIEW_STATUSES,
  REVIEW_SOURCES,
  SUBMISSION_ITEM_STATUSES,
  SUBMISSION_CATEGORIES,
  MANUSCRIPT_DEFAULT_SECTIONS,
  SUBMISSION_DEFAULT_ITEMS,
} from './validation.js';

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

  // --- Phase 5: app version + data paths ------------------------------------

  const APP_VERSION = (() => {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
      );
      return pkg.version || '0.0.0';
    } catch {
      return '0.0.0';
    }
  })();

  const dbPath = db.name && db.name !== ':memory:' ? db.name : null;
  const dataDir = dataDirFromDbPath(dbPath);
  const backupsDir = backupsDirFor(dataDir);
  const exportsDir = dataDir ? path.join(dataDir, 'exports') : null;

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

  // --- Phase 3 ownership helpers -------------------------------------------

  const getExperimentOrThrow = (userId, id) => {
    const row = repo.getExperiment(id);
    if (!row || row.archived_at) throw new RfNotFoundError('Experiment not found');
    getProjectOrThrow(userId, row.project_id);
    return row;
  };

  const getRunOrThrow = (userId, id) => {
    const row = repo.getRun(id);
    if (!row || row.archived_at) throw new RfNotFoundError('Experiment run not found');
    getProjectOrThrow(userId, row.project_id);
    return row;
  };

  const getClaimOrThrow = (userId, id) => {
    const row = repo.getClaim(id);
    if (!row || row.archived_at) throw new RfNotFoundError('Claim not found');
    getProjectOrThrow(userId, row.project_id);
    return row;
  };

  const getEvidenceOrThrow = (userId, id) => {
    const row = repo.getEvidence(id);
    if (!row || row.archived_at) throw new RfNotFoundError('Evidence not found');
    getProjectOrThrow(userId, row.project_id);
    return row;
  };

  const getDecisionOrThrow = (userId, id) => {
    const row = repo.getDecision(id);
    if (!row || row.archived_at) throw new RfNotFoundError('Decision not found');
    getProjectOrThrow(userId, row.project_id);
    return row;
  };

  const getLiteratureOrThrow = (userId, id) => {
    const row = repo.getLiterature(id);
    if (!row || row.archived_at) throw new RfNotFoundError('Literature not found');
    getProjectOrThrow(userId, row.project_id);
    return row;
  };

  const getFigureTableOrThrow = (userId, id) => {
    const row = repo.getFigureTable(id);
    if (!row || row.archived_at) throw new RfNotFoundError('Figure/table not found');
    getProjectOrThrow(userId, row.project_id);
    return row;
  };

  const getManuscriptSectionOrThrow = (userId, id) => {
    const row = repo.getManuscriptSection(id);
    if (!row || row.archived_at) throw new RfNotFoundError('Manuscript section not found');
    getProjectOrThrow(userId, row.project_id);
    return row;
  };

  const getReviewCommentOrThrow = (userId, id) => {
    const row = repo.getReviewComment(id);
    if (!row || row.archived_at) throw new RfNotFoundError('Review comment not found');
    getProjectOrThrow(userId, row.project_id);
    return row;
  };

  const getSubmissionProfileOrThrow = (userId, id) => {
    const row = repo.getSubmissionProfile(id);
    if (!row || row.archived_at) throw new RfNotFoundError('Submission profile not found');
    getProjectOrThrow(userId, row.project_id);
    return row;
  };

  const getSubmissionItemOrThrow = (userId, id) => {
    const row = repo.getSubmissionItem(id);
    if (!row || row.archived_at) throw new RfNotFoundError('Submission item not found');
    getProjectOrThrow(userId, row.project_id);
    return row;
  };

  /** All gates of a project (Phase 1 repo groups gates by stage id). */
  const listProjectGates = (projectId) =>
    Object.values(repo.listGatesByStages(repo.listStages(projectId).map((stage) => stage.id))).flat();

  /** Resolve the owning project of a typed entity (null when unknown). */
  const getEntityProjectId = (type, id) => {
    switch (type) {
      case 'experiment': return repo.getExperiment(id)?.project_id || null;
      case 'experiment_run': return repo.getRun(id)?.project_id || null;
      case 'claim': return repo.getClaim(id)?.project_id || null;
      case 'evidence': return repo.getEvidence(id)?.project_id || null;
      case 'decision': return repo.getDecision(id)?.project_id || null;
      case 'task': return repo.getTask(id)?.project_id || null;
      case 'figure':
      case 'table':
      case 'figure_table': return repo.getFigureTable(id)?.project_id || null;
      case 'literature': return repo.getLiterature(id)?.project_id || null;
      case 'manuscript_section': return repo.getManuscriptSection(id)?.project_id || null;
      case 'review_comment': return repo.getReviewComment(id)?.project_id || null;
      case 'submission_item': return repo.getSubmissionItem(id)?.project_id || null;
      default: return null;
    }
  };

  const getEntityProjectIdOrThrow = (userId, type, id) => {
    const projectId = getEntityProjectId(type, id);
    if (!projectId) throw new RfNotFoundError(`${type} not found`);
    getProjectOrThrow(userId, projectId);
    return projectId;
  };

  /** Validate an enum field when present (service layer never trusts callers). */
  const assertIn = (value, allowed, field) => {
    if (value === undefined || value === null) return value;
    if (!allowed.includes(value)) {
      throw new RfValidationError(`Field "${field}" must be one of: ${allowed.join(', ')}`);
    }
    return value;
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
      // Portfolio consumes the same domain results as the Dashboard: each list
      // entry carries lifecycle/insight aggregation computed here, not in React.
      // All lookups are batched (constant number of queries, no N+1).
      const projects = repo.listProjects(userId, { includeArchived });
      const projectIds = projects.map((project) => project.id);
      const stagesByProject = repo.listStagesByProjects(projectIds);
      const tasksByProject = repo.listTasksByProjects(projectIds);
      const allStages = Object.values(stagesByProject).flat();
      const gatesByStage = repo.listGatesByStages(allStages.map((stage) => stage.id));

      return projects.map((project) => {
        const stages = stagesByProject[project.id] || [];
        const tasks = tasksByProject[project.id] || [];
        const currentStage = stages.find((stage) => stage.status === 'current') || null;
        const currentGates = currentStage ? gatesByStage[currentStage.id] || [] : [];
        const insightTasks = tasks.map((task) => ({
          id: task.id,
          title: task.title,
          stage_id: task.stage_id,
          status: task.status,
          priority: task.priority,
          due_date: task.due_date,
          is_blocker: task.is_blocker,
        }));
        const openTasks = tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled');
        const blockerTasks = openTasks.filter((task) => task.is_blocker === 1 || task.status === 'blocked');
        const overall = overallProgress(
          stages.map((stage) => ({
            weight: stage.weight,
            status: stage.status,
            progress: stageProgress(gatesByStage[stage.id] || [], tasks.filter((task) => task.stage_id === stage.id)),
          }))
        );

        return {
          ...serializeProject(project),
          currentStage: currentStage ? { id: currentStage.id, name: currentStage.name, status: currentStage.status } : null,
          overallProgress: Number(overall.toFixed(4)),
          blockerCount: blockerTasks.length,
          daysRemaining: project.deadline ? daysRemaining(project.deadline) : null,
          nextCriticalAction: nextCriticalAction({
            currentStage: currentStage ? { id: currentStage.id, name: currentStage.name } : null,
            gates: currentGates,
            tasks: insightTasks,
          }),
          health: projectHealth({ deadline: project.deadline, tasks: insightTasks, gates: currentGates }),
        };
      });
    },

    getProject(userId, projectId) {
      return buildProjectDetail(userId, projectId);
    },

    getProjectDashboard(userId, projectId) {
      const detail = buildProjectDetail(userId, projectId);
      const project = repo.getProject(projectId);
      const tasks = repo.listTasks(projectId);
      const currentStage = detail.stages.find((stage) => stage.status === 'current') || null;
      const currentGates = currentStage ? repo.listGatesByStage(currentStage.id) : [];
      const today = new Date();

      const insightTasks = tasks.map((task) => ({
        id: task.id,
        title: task.title,
        stage_id: task.stage_id,
        status: task.status,
        priority: task.priority,
        due_date: task.due_date,
        is_blocker: task.is_blocker,
      }));

      const openTasks = tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled');
      const blockerTasks = openTasks.filter((task) => task.is_blocker === 1 || task.status === 'blocked');
      const overdueTasks = openTasks
        .filter((task) => task.due_date && daysRemaining(task.due_date) < 0)
        .map(serializeTask);

      const requiredGates = currentGates.filter((gate) => gate.is_required);
      const passedRequired = requiredGates.filter((gate) => gate.is_passed).length;

      // Phase 3 integration: real experiment/evidence summaries + research health.
      const experiments = repo.listExperiments(projectId);
      const runs = Object.values(repo.listRunsByExperiments(experiments.map((experiment) => experiment.id))).flat();
      const claims = repo.listClaims(projectId);
      const claimEvidenceRows = repo.listClaimEvidenceByProject(projectId).map((row) => ({
        ...row,
        strength: row.evidence_strength,
      }));
      const evidenceSummary = projectEvidenceSummary(claims, claimEvidenceRows);
      const experimentSummary = summarizeExperiment(runs);

      // Phase 4 integration: manuscript / freeze / review / submission summaries.
      const sections = repo.listManuscriptSections(projectId);
      const figuresTables = repo.listFiguresTables(projectId);
      const sectionLinks = repo.listEntityLinksByProject(projectId)
        .filter((link) => link.source_type === 'manuscript_section')
        .map(serializeEntityLink);
      const completeness = manuscriptCompleteness({ sections, claims, figuresTables, links: sectionLinks });
      const freezeStatus = this.buildFreezeStatus(userId, projectId);
      const reviewSummaryData = reviewSummary(repo.listReviewComments(projectId));
      const submissionProfiles = repo.listSubmissionProfiles(projectId);
      const latestSubmission = submissionProfiles[0] || null;
      const submissionItems = latestSubmission ? repo.listSubmissionItemsByProfile(latestSubmission.id) : [];
      const submissionReadinessData = latestSubmission
        ? this.computeSubmissionReadiness(userId, latestSubmission.id, latestSubmission)
        : null;

      const health = projectHealth({
        deadline: project.deadline,
        tasks: insightTasks,
        gates: currentGates,
        today,
      });
      const healthReasons = [...health.reasons];
      let healthState = health.state;
      if (evidenceSummary.coreClaimsMissingEvidence > 0) {
        healthReasons.push({ code: 'core_claim_missing_evidence' });
        if (healthState === 'healthy') healthState = 'at_risk';
      }
      const blockedMain = experiments.filter((experiment) => {
        if (experiment.type !== 'main') return false;
        const expRuns = runs.filter((run) => run.experiment_id === experiment.id);
        return expRuns.length > 0 && expRuns.some((run) => run.status === 'failed')
          && !expRuns.some((run) => run.status === 'completed');
      });
      if (blockedMain.length > 0) {
        healthReasons.push({ code: 'critical_experiment_blocked', experimentCode: blockedMain[0].experiment_code });
        healthState = 'critical';
      }

      return {
        ...detail,
        currentStage: currentStage
          ? {
              ...currentStage,
              // currentStage already carries progress/completed/gates from buildProjectDetail
            }
          : null,
        daysRemaining: project.deadline ? daysRemaining(project.deadline) : null,
        blockerCount: blockerTasks.length,
        overdueTasks,
        nextCriticalAction: nextCriticalAction({
          currentStage: currentStage ? { id: currentStage.id, name: currentStage.name } : null,
          gates: currentGates,
          tasks: insightTasks,
          today,
        }),
        health: { state: healthState, reasons: healthReasons },
        taskSummary: {
          total: tasks.length,
          done: tasks.filter((task) => task.status === 'done').length,
          inProgress: tasks.filter((task) => task.status === 'in_progress').length,
          todo: tasks.filter((task) => task.status === 'todo').length,
          blocked: tasks.filter((task) => task.status === 'blocked').length,
        },
        gateSummary: {
          requiredTotal: requiredGates.length,
          passedRequired,
          pendingRequired: requiredGates.length - passedRequired,
        },
        experimentSummary: {
          total: experiments.length,
          runs: experimentSummary,
        },
        evidenceSummary,
        manuscriptSummary: {
          requiredSectionsComplete: completeness.requiredSectionsComplete,
          totalRequiredSections: completeness.totalRequiredSections,
          sectionsFinal: completeness.sectionsFinal,
          sectionsDraftOrBetter: completeness.sectionsDraftOrBetter,
        },
        resultsSummary: {
          hasFreeze: freezeStatus.hasFreeze,
          freezeState: freezeStatus.staleness.state,
          freezeNumber: freezeStatus.latestFreeze?.freezeNumber || null,
          overrideReason: freezeStatus.latestFreeze?.overrideReason || null,
        },
        reviewSummary: {
          openCritical: reviewSummaryData.openCritical,
          openMajor: reviewSummaryData.openMajor,
          openMinor: reviewSummaryData.openMinor,
          resolvedComments: reviewSummaryData.resolvedComments,
        },
        submissionSummary: latestSubmission
          ? {
              venue: latestSubmission.venue,
              status: latestSubmission.status,
              ready: submissionReadinessData.ready,
              requiredChecks: submissionItems.filter((item) => item.required).length,
              doneChecks: submissionItems.filter((item) => item.status === 'done' || item.status === 'waived').length,
              blockerCount: submissionReadinessData.blockers.length,
            }
          : null,
      };
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

    // --- Phase 5: diagnostics / data safety ---------------------------------

    getAppInfo() {
      return {
        appVersion: APP_VERSION,
        platform: process.platform,
        databasePath: dbPath,
        dataDir,
        backupsDir,
        exportsDir,
        schemaVersion: collectSchemaVersion(db),
        workspaceTypes: ['none', 'windows', 'wsl'],
      };
    },

    getBackups() {
      return rfListBackups(backupsDir);
    },

    async createBackup() {
      if (!dbPath) {
        throw new RfValidationError('Backup requires a filesystem database (not :memory:)');
      }
      return rfCreateBackup({
        db,
        backupsDir,
        appVersion: APP_VERSION,
        schemaVersion: collectSchemaVersion(db),
      });
    },

    async restoreBackup({ backupFile }) {
      if (!backupFile || typeof backupFile !== 'string') {
        throw new RfValidationError('backupFile is required');
      }
      if (!dbPath) {
        throw new RfValidationError('Restore requires a filesystem database (not :memory:)');
      }
      if (!backupsDir) {
        throw new RfValidationError('Backups directory is not available');
      }
      // Only allow files inside the backups directory (never arbitrary paths).
      const resolved = path.isAbsolute(backupFile)
        ? path.resolve(backupFile)
        : path.resolve(backupsDir, path.basename(backupFile));
      const root = path.resolve(backupsDir);
      if (!resolved.startsWith(root + path.sep)) {
        throw new RfValidationError('Backup file must be inside the backups directory');
      }
      if (!fs.existsSync(resolved)) {
        throw new RfValidationError(`Backup file not found: ${path.basename(resolved)}`);
      }
      return rfRestoreBackup({
        backupPath: resolved,
        db,
        dataDir,
        appVersion: APP_VERSION,
      });
    },

    exportProject(userId, projectId) {
      const project = getProjectOrThrow(userId, projectId);
      if (!exportsDir) {
        throw new RfValidationError('Export requires a filesystem database (not :memory:)');
      }
      const result = rfExportProject({
        db,
        projectId,
        destDir: exportsDir,
        appVersion: APP_VERSION,
        schemaVersion: collectSchemaVersion(db),
      });
      return { ...result, projectName: project.name };
    },

    // --- Phase 5: workspace / WSL -------------------------------------------

    updateProjectWorkspace(userId, projectId, fields) {
      const project = getProjectOrThrow(userId, projectId);
      const workspaceType = fields.workspaceType ?? project.workspace_type ?? 'none';
      const validation = validateWorkspaceFields({
        workspaceType,
        windowsPath: fields.windowsPath ?? project.windows_path ?? null,
        wslDistro: fields.wslDistro ?? project.wsl_distro ?? null,
        wslPath: fields.wslPath ?? project.wsl_path ?? null,
      });
      if (!validation.ok) {
        throw new RfValidationError(validation.errors.join('; '));
      }
      return tx(() => {
        repo.updateProject(projectId, {
          workspaceType,
          windowsPath: fields.windowsPath ?? null,
          wslDistro: fields.wslDistro ?? null,
          wslPath: fields.wslPath ?? null,
        });
        return buildProjectDetail(userId, projectId);
      })();
    },

    async validateWorkspace(userId, projectId) {
      const project = getProjectOrThrow(userId, projectId);
      return validateProjectWorkspace(project);
    },

    async openWorkspaceTerminal(userId, projectId) {
      const project = getProjectOrThrow(userId, projectId);
      const adapter = createWorkspaceAdapter(project);
      if (!adapter || !adapter.openTerminal) {
        throw new RfValidationError('No terminal-capable workspace configured');
      }
      const target = project.workspace_type === 'windows'
        ? { windowsPath: project.windows_path }
        : { wslPath: project.wsl_path };
      return adapter.openTerminal(target);
    },

    getWorkspaceInfo(userId, projectId) {
      const project = getProjectOrThrow(userId, projectId);
      return {
        workspaceType: project.workspace_type || 'none',
        windowsPath: project.windows_path || null,
        wslDistro: project.wsl_distro || null,
        wslPath: project.wsl_path || null,
        path: workspacePathFor(project),
      };
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

    // --- Phase 3: Experiments -----------------------------------------------

    createExperiment(userId, projectId, input) {
      return tx(() => {
        getProjectOrThrow(userId, projectId);
        if (input.stageId) {
          const stage = repo.getStage(input.stageId);
          if (!stage || stage.archived_at) throw new RfValidationError('stageId does not reference a valid stage');
          assertStageBelongsToProject(stage, projectId);
        }
        const id = randomUUID();
        repo.createExperiment({
          id, projectId,
          experimentCode: repo.nextExperimentCode(projectId),
          ...input,
          type: assertIn(input.type, EXPERIMENT_TYPES, 'type') || 'prototype',
          status: assertIn(input.status, EXPERIMENT_STATUSES, 'status') || 'planned',
          priority: assertIn(input.priority, TASK_PRIORITIES, 'priority') || 'medium',
          requiredSeeds: input.requiredSeeds ?? 1,
        });
        logActivity(db, {
          projectId, action: 'experiment_created', entityType: 'experiment', entityId: id,
          message: `Experiment "${input.title}" created`,
        });
        const row = repo.getExperiment(id);
        this.recalculateProjectSubmissions(userId, projectId);
        return { ...serializeExperiment(row) };
      })();
    },

    getExperiment(userId, experimentId) {
      const experiment = getExperimentOrThrow(userId, experimentId);
      const runs = repo.listRunsByExperiment(experimentId).map(serializeRun);
      const stage = experiment.stage_id ? repo.getStage(experiment.stage_id) : null;
      const links = repo.listEntityLinksForEntity('experiment', experimentId).map(serializeEntityLink);
      return {
        ...serializeExperiment(experiment),
        stage: stage ? { id: stage.id, name: stage.name } : null,
        runs,
        summary: summarizeExperiment(repo.listRunsByExperiment(experimentId)),
        relations: links,
      };
    },

    listExperiments(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      const experiments = repo.listExperiments(projectId);
      const runsByExperiment = repo.listRunsByExperiments(experiments.map((experiment) => experiment.id));
      const stages = repo.listStages(projectId);
      const stageName = new Map(stages.map((stage) => [stage.id, stage.name]));
      return experiments.map((experiment) => ({
        ...serializeExperiment(experiment),
        stageName: experiment.stage_id ? stageName.get(experiment.stage_id) || null : null,
        runSummary: summarizeExperiment(runsByExperiment[experiment.id] || []),
      }));
    },

    updateExperiment(userId, experimentId, fields) {
      return tx(() => {
        const experiment = getExperimentOrThrow(userId, experimentId);
        if (fields.stageId !== undefined && fields.stageId !== null) {
          const stage = repo.getStage(fields.stageId);
          if (!stage || stage.archived_at) throw new RfValidationError('stageId does not reference a valid stage');
          assertStageBelongsToProject(stage, experiment.project_id);
        }
        const prevStatus = experiment.status;
        repo.updateExperiment(experimentId, {
          ...fields,
          type: assertIn(fields.type, EXPERIMENT_TYPES, 'type'),
          status: assertIn(fields.status, EXPERIMENT_STATUSES, 'status'),
          priority: assertIn(fields.priority, TASK_PRIORITIES, 'priority'),
        });
        const updated = repo.getExperiment(experimentId);
        if (fields.status !== undefined && fields.status !== prevStatus) {
          logActivity(db, {
            projectId: updated.project_id, action: 'experiment_status_changed', entityType: 'experiment',
            entityId: experimentId, message: `Experiment "${updated.title}" status: ${prevStatus} -> ${updated.status}`,
            metadata: { from: prevStatus, to: updated.status },
          });
        }
        this.recalculateProjectSubmissions(userId, updated.project_id);
        return { ...serializeExperiment(updated) };
      })();
    },

    deleteExperiment(userId, experimentId) {
      return tx(() => {
        const experiment = getExperimentOrThrow(userId, experimentId);
        repo.softDeleteExperiment(experimentId);
        logActivity(db, {
          projectId: experiment.project_id, action: 'experiment_archived', entityType: 'experiment',
          entityId: experimentId, message: `Experiment "${experiment.title}" archived`,
        });
        this.recalculateProjectSubmissions(userId, experiment.project_id);
        return { id: experimentId, archived: true };
      })();
    },

    createRun(userId, experimentId, input) {
      return tx(() => {
        const experiment = getExperimentOrThrow(userId, experimentId);
        const id = randomUUID();
        repo.createRun({
          id, projectId: experiment.project_id, experimentId,
          runCode: repo.nextRunCode(experimentId),
          ...input,
          status: assertIn(input.status, RUN_STATUSES, 'status') || 'planned',
          failureClassification: assertIn(input.failureClassification, FAILURE_CLASSIFICATIONS, 'failureClassification'),
        });
        const row = repo.getRun(id);
        logActivity(db, {
          projectId: experiment.project_id, action: 'experiment_run_created', entityType: 'experiment_run',
          entityId: id, message: `Run ${row.run_code} created for ${experiment.experiment_code}`,
        });
        logRunTransitions(db, experiment.project_id, row, { from: 'planned' });
        this.recalculateProjectSubmissions(userId, experiment.project_id);
        return { ...serializeRun(row) };
      })();
    },

    updateRun(userId, runId, fields) {
      return tx(() => {
        const run = getRunOrThrow(userId, runId);
        const prevStatus = run.status;
        repo.updateRun(runId, {
          ...fields,
          status: assertIn(fields.status, RUN_STATUSES, 'status'),
          failureClassification: assertIn(fields.failureClassification, FAILURE_CLASSIFICATIONS, 'failureClassification'),
        });
        const updated = repo.getRun(runId);
        if (fields.status !== undefined && fields.status !== prevStatus) {
          logRunTransitions(db, run.project_id, updated, { from: prevStatus });
        }
        this.recalculateProjectSubmissions(userId, run.project_id);
        return { ...serializeRun(updated) };
      })();
    },

    getRun(userId, runId) {
      const run = getRunOrThrow(userId, runId);
      return { ...serializeRun(run) };
    },

    deleteRun(userId, runId) {
      return tx(() => {
        const run = getRunOrThrow(userId, runId);
        repo.softDeleteRun(runId);
        logActivity(db, {
          projectId: run.project_id, action: 'experiment_run_archived', entityType: 'experiment_run',
          entityId: runId, message: `Run ${run.run_code} archived`,
        });
        this.recalculateProjectSubmissions(userId, run.project_id);
        return { id: runId, archived: true };
      })();
    },

    // --- Phase 3: Claims / Evidence -----------------------------------------

    createClaim(userId, projectId, input) {
      return tx(() => {
        getProjectOrThrow(userId, projectId);
        const id = randomUUID();
        repo.createClaim({
          id, projectId, claimCode: repo.nextClaimCode(projectId),
          ...input,
          importance: assertIn(input.importance, CLAIM_IMPORTANCES, 'importance') || 'supporting',
          status: assertIn(input.status, CLAIM_STATUSES, 'status') || 'unverified',
        });
        logActivity(db, {
          projectId, action: 'claim_created', entityType: 'claim', entityId: id,
          message: `Claim "${input.statement.slice(0, 80)}" created`,
        });
        this.recalculateProjectSubmissions(userId, projectId);
        return { ...serializeClaim(repo.getClaim(id)) };
      })();
    },

    getClaim(userId, claimId) {
      const claim = getClaimOrThrow(userId, claimId);
      return { ...serializeClaim(claim) };
    },

    listClaims(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      return repo.listClaims(projectId).map(serializeClaim);
    },

    updateClaim(userId, claimId, fields) {
      return tx(() => {
        const claim = getClaimOrThrow(userId, claimId);
        const prevStatus = claim.status;
        repo.updateClaim(claimId, {
          ...fields,
          importance: assertIn(fields.importance, CLAIM_IMPORTANCES, 'importance'),
          status: assertIn(fields.status, CLAIM_STATUSES, 'status'),
        });
        const updated = repo.getClaim(claimId);
        if (fields.status !== undefined && fields.status !== prevStatus) {
          logActivity(db, {
            projectId: updated.project_id, action: 'claim_status_changed', entityType: 'claim',
            entityId: claimId, message: `Claim ${updated.claim_code} status: ${prevStatus} -> ${updated.status}`,
            metadata: { from: prevStatus, to: updated.status },
          });
        }
        this.recalculateProjectSubmissions(userId, updated.project_id);
        return { ...serializeClaim(updated) };
      })();
    },

    deleteClaim(userId, claimId) {
      return tx(() => {
        const claim = getClaimOrThrow(userId, claimId);
        repo.softDeleteClaim(claimId);
        logActivity(db, {
          projectId: claim.project_id, action: 'claim_archived', entityType: 'claim',
          entityId: claimId, message: `Claim ${claim.claim_code} archived`,
        });
        this.recalculateProjectSubmissions(userId, claim.project_id);
        return { id: claimId, archived: true };
      })();
    },

    createEvidence(userId, projectId, input) {
      return tx(() => {
        getProjectOrThrow(userId, projectId);
        if (input.sourceId && input.evidenceType !== 'analysis_note' && input.evidenceType !== 'artifact') {
          // sourceId must reference an entity of the same project when it is a
          // typed source (experiment/run/figure/table/literature).
          const sourceProject = getEntityProjectId(input.evidenceType, input.sourceId);
          if (sourceProject !== projectId) {
            throw new RfValidationError('sourceId must reference an entity in the same project');
          }
        }
        const id = randomUUID();
        repo.createEvidence({
          id, projectId, ...input,
          evidenceType: assertIn(input.evidenceType, EVIDENCE_TYPES, 'evidenceType'),
          strength: assertIn(input.strength, EVIDENCE_STRENGTHS, 'strength') || 'weak',
        });
        logActivity(db, {
          projectId, action: 'evidence_created', entityType: 'evidence', entityId: id,
          message: `Evidence "${input.title}" created`,
        });
        return { ...serializeEvidence(repo.getEvidence(id)) };
      })();
    },

    getEvidence(userId, evidenceId) {
      const evidence = getEvidenceOrThrow(userId, evidenceId);
      return { ...serializeEvidence(evidence) };
    },

    listEvidence(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      return repo.listEvidence(projectId).map(serializeEvidence);
    },

    updateEvidence(userId, evidenceId, fields) {
      return tx(() => {
        const evidence = getEvidenceOrThrow(userId, evidenceId);
        if (fields.sourceId !== undefined && fields.sourceId) {
          const sourceProject = getEntityProjectId(fields.evidenceType || evidence.evidence_type, fields.sourceId);
          if (sourceProject !== evidence.project_id) {
            throw new RfValidationError('sourceId must reference an entity in the same project');
          }
        }
        repo.updateEvidence(evidenceId, {
          ...fields,
          evidenceType: assertIn(fields.evidenceType, EVIDENCE_TYPES, 'evidenceType'),
          strength: assertIn(fields.strength, EVIDENCE_STRENGTHS, 'strength'),
        });
        return { ...serializeEvidence(repo.getEvidence(evidenceId)) };
      })();
    },

    deleteEvidence(userId, evidenceId) {
      return tx(() => {
        const evidence = getEvidenceOrThrow(userId, evidenceId);
        repo.softDeleteEvidence(evidenceId);
        logActivity(db, {
          projectId: evidence.project_id, action: 'evidence_archived', entityType: 'evidence',
          entityId: evidenceId, message: `Evidence "${evidence.title}" archived`,
        });
        return { id: evidenceId, archived: true };
      })();
    },

    linkClaimEvidence(userId, { claimId, evidenceId, relationType, notes }) {
      return tx(() => {
        const claim = getClaimOrThrow(userId, claimId);
        const evidence = getEvidenceOrThrow(userId, evidenceId);
        if (claim.project_id !== evidence.project_id) {
          throw new RfValidationError('Claim and evidence must belong to the same project');
        }
        const existing = repo.hasClaimEvidence(claimId, evidenceId, relationType);
        if (existing) {
          return { ...serializeClaimEvidence(repo.getClaimEvidence(existing)) }; // idempotent
        }
        const id = randomUUID();
        repo.createClaimEvidence({ id, projectId: claim.project_id, claimId, evidenceId, relationType, notes });
        logActivity(db, {
          projectId: claim.project_id, action: 'claim_evidence_linked', entityType: 'claim',
          entityId: claimId, message: `Claim ${claim.claim_code} ${relationType} evidence "${evidence.title}"`,
          metadata: { evidenceId, relationType },
        });
        this.recalculateProjectSubmissions(userId, claim.project_id);
        return { ...serializeClaimEvidence(repo.getClaimEvidence(id)) };
      })();
    },

    unlinkClaimEvidence(userId, linkId) {
      return tx(() => {
        const link = repo.getClaimEvidence(linkId);
        if (!link) throw new RfNotFoundError('Claim-evidence link not found');
        const claim = repo.getClaim(link.claim_id);
        if (!claim || claim.archived_at) throw new RfNotFoundError('Claim-evidence link not found');
        getProjectOrThrow(userId, claim.project_id);
        repo.deleteClaimEvidence(linkId);
        logActivity(db, {
          projectId: claim.project_id, action: 'claim_evidence_unlinked', entityType: 'claim',
          entityId: link.claim_id, message: `Evidence unlinked from ${claim.claim_code}`,
        });
        this.recalculateProjectSubmissions(userId, claim.project_id);
        return { id: linkId, unlinked: true };
      })();
    },

    getEvidenceHealth(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      const claims = repo.listClaims(projectId);
      const claimEvidenceRows = repo.listClaimEvidenceByProject(projectId).map((row) => ({
        ...row,
        strength: row.evidence_strength,
      }));
      const byClaim = new Map();
      for (const row of claimEvidenceRows) {
        if (!byClaim.has(row.claim_id)) byClaim.set(row.claim_id, []);
        byClaim.get(row.claim_id).push(row);
      }
      const claimsWithHealth = claims.map((claim) => ({
        ...serializeClaim(claim),
        evidenceHealth: claimEvidenceHealth(claim, byClaim.get(claim.id) || []),
        relations: (byClaim.get(claim.id) || []).map((row) => ({
          id: row.id,
          evidenceId: row.evidence_id,
          relationType: row.relation_type,
          evidenceStrength: row.evidence_strength,
        })),
      }));
      const summary = projectEvidenceSummary(claims, claimEvidenceRows);
      return { claims: claimsWithHealth, summary };
    },

    // --- Phase 3: Decisions --------------------------------------------------

    createDecision(userId, projectId, input) {
      return tx(() => {
        getProjectOrThrow(userId, projectId);
        const id = randomUUID();
        repo.createDecision({ id, projectId, decisionCode: repo.nextDecisionCode(projectId), ...input });
        logActivity(db, {
          projectId, action: 'decision_created', entityType: 'decision', entityId: id,
          message: `Decision "${input.title}" created`,
        });
        return { ...serializeDecision(repo.getDecision(id)) };
      })();
    },

    listDecisions(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      return repo.listDecisions(projectId).map(serializeDecision);
    },

    getDecision(userId, decisionId) {
      const decision = getDecisionOrThrow(userId, decisionId);
      return {
        ...serializeDecision(decision),
        relations: repo.listEntityLinksForEntity('decision', decisionId).map(serializeEntityLink),
      };
    },

    updateDecision(userId, decisionId, fields) {
      return tx(() => {
        getDecisionOrThrow(userId, decisionId);
        repo.updateDecision(decisionId, fields);
        return { ...serializeDecision(repo.getDecision(decisionId)) };
      })();
    },

    deleteDecision(userId, decisionId) {
      return tx(() => {
        const decision = getDecisionOrThrow(userId, decisionId);
        repo.softDeleteDecision(decisionId);
        logActivity(db, {
          projectId: decision.project_id, action: 'decision_archived', entityType: 'decision',
          entityId: decisionId, message: `Decision "${decision.title}" archived`,
        });
        return { id: decisionId, archived: true };
      })();
    },

    // --- Phase 3: Literature -------------------------------------------------

    createLiterature(userId, projectId, input) {
      return tx(() => {
        getProjectOrThrow(userId, projectId);
        const id = randomUUID();
        repo.createLiterature({
          id, projectId, ...input,
          relation: assertIn(input.relation, LITERATURE_RELATIONS, 'relation'),
          readStatus: assertIn(input.readStatus, LITERATURE_READ_STATUSES, 'readStatus') || 'inbox',
          priority: assertIn(input.priority, TASK_PRIORITIES, 'priority') || 'medium',
        });
        logActivity(db, {
          projectId, action: 'literature_added', entityType: 'literature', entityId: id,
          message: `Literature "${input.title}" added`,
        });
        return { ...serializeLiterature(repo.getLiterature(id)) };
      })();
    },

    listLiterature(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      return repo.listLiterature(projectId).map(serializeLiterature);
    },

    getLiterature(userId, literatureId) {
      const literature = getLiteratureOrThrow(userId, literatureId);
      return { ...serializeLiterature(literature) };
    },

    updateLiterature(userId, literatureId, fields) {
      return tx(() => {
        getLiteratureOrThrow(userId, literatureId);
        repo.updateLiterature(literatureId, {
          ...fields,
          relation: assertIn(fields.relation, LITERATURE_RELATIONS, 'relation'),
          readStatus: assertIn(fields.readStatus, LITERATURE_READ_STATUSES, 'readStatus'),
          priority: assertIn(fields.priority, TASK_PRIORITIES, 'priority'),
        });
        return { ...serializeLiterature(repo.getLiterature(literatureId)) };
      })();
    },

    deleteLiterature(userId, literatureId) {
      return tx(() => {
        const literature = getLiteratureOrThrow(userId, literatureId);
        repo.softDeleteLiterature(literatureId);
        logActivity(db, {
          projectId: literature.project_id, action: 'literature_archived', entityType: 'literature',
          entityId: literatureId, message: `Literature "${literature.title}" archived`,
        });
        return { id: literatureId, archived: true };
      })();
    },

    // --- Phase 3: Figures / Tables -------------------------------------------

    createFigureTable(userId, projectId, input) {
      return tx(() => {
        getProjectOrThrow(userId, projectId);
        const id = randomUUID();
        repo.createFigureTable({
          id, projectId, artifactCode: repo.nextArtifactCode(projectId, input.type), ...input,
          type: assertIn(input.type, FIGURE_TABLE_TYPES, 'type') || 'figure',
          status: assertIn(input.status, FIGURE_TABLE_STATUSES, 'status') || 'planned',
        });
        logActivity(db, {
          projectId, action: 'figure_table_created', entityType: 'figure_table', entityId: id,
          message: `${input.type} "${input.workingTitle}" created`,
        });
        return { ...serializeFigureTable(repo.getFigureTable(id)) };
      })();
    },

    listFiguresTables(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      return repo.listFiguresTables(projectId).map(serializeFigureTable);
    },

    getFigureTable(userId, figureTableId) {
      const figureTable = getFigureTableOrThrow(userId, figureTableId);
      return {
        ...serializeFigureTable(figureTable),
        relations: repo.listEntityLinksForEntity('figure_table', figureTableId).map(serializeEntityLink),
      };
    },

    updateFigureTable(userId, figureTableId, fields) {
      return tx(() => {
        const figureTable = getFigureTableOrThrow(userId, figureTableId);
        const prevStatus = figureTable.status;
        repo.updateFigureTable(figureTableId, {
          ...fields,
          type: assertIn(fields.type, FIGURE_TABLE_TYPES, 'type'),
          status: assertIn(fields.status, FIGURE_TABLE_STATUSES, 'status'),
        });
        const updated = repo.getFigureTable(figureTableId);
        if (fields.status !== undefined && fields.status !== prevStatus) {
          logActivity(db, {
            projectId: updated.project_id, action: 'figure_table_status_changed', entityType: 'figure_table',
            entityId: figureTableId, message: `${updated.type} ${updated.artifact_code} status: ${prevStatus} -> ${updated.status}`,
            metadata: { from: prevStatus, to: updated.status },
          });
        }
        return { ...serializeFigureTable(updated) };
      })();
    },

    deleteFigureTable(userId, figureTableId) {
      return tx(() => {
        const figureTable = getFigureTableOrThrow(userId, figureTableId);
        repo.softDeleteFigureTable(figureTableId);
        logActivity(db, {
          projectId: figureTable.project_id, action: 'figure_table_archived', entityType: 'figure_table',
          entityId: figureTableId, message: `${figureTable.type} ${figureTable.artifact_code} archived`,
        });
        return { id: figureTableId, archived: true };
      })();
    },

    // --- Phase 3: Entity links (provenance) ----------------------------------

    createEntityLink(userId, { sourceType, sourceId, targetType, targetId, relationType, metadata }) {
      return tx(() => {
        const sourceProject = getEntityProjectIdOrThrow(userId, sourceType, sourceId);
        const targetProject = getEntityProjectIdOrThrow(userId, targetType, targetId);
        if (sourceProject !== targetProject) {
          throw new RfValidationError('Cannot link entities from different projects');
        }
        const existing = repo.hasEntityLink(sourceType, sourceId, targetType, targetId, relationType);
        if (existing) {
          return { ...serializeEntityLink(repo.getEntityLink(existing)) }; // idempotent
        }
        const id = randomUUID();
        repo.createEntityLink({ id, projectId: sourceProject, sourceType, sourceId, targetType, targetId, relationType, metadata });
        return { ...serializeEntityLink(repo.getEntityLink(id)) };
      })();
    },

    deleteEntityLink(userId, linkId) {
      return tx(() => {
        const link = repo.getEntityLink(linkId);
        if (!link) throw new RfNotFoundError('Entity link not found');
        getProjectOrThrow(userId, link.project_id);
        repo.deleteEntityLink(linkId);
        return { id: linkId, deleted: true };
      })();
    },

    listEntityLinks(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      return repo.listEntityLinksByProject(projectId).map(serializeEntityLink);
    },

    listEntityLinksForEntity(userId, type, entityId) {
      getEntityProjectIdOrThrow(userId, type, entityId);
      return repo.listEntityLinksForEntity(type, entityId).map(serializeEntityLink);
    },

    // --- Phase 4: Manuscript ------------------------------------------------

    initializeManuscript(userId, projectId) {
      return tx(() => {
        getProjectOrThrow(userId, projectId);
        const existing = repo.listManuscriptSections(projectId);
        if (existing.length > 0) {
          return existing.map(serializeManuscriptSection); // idempotent
        }
        const created = MANUSCRIPT_DEFAULT_SECTIONS.map((template, index) => {
          const id = randomUUID();
          repo.createManuscriptSection({
            id, projectId, sectionKey: template.key, title: template.title,
            sortOrder: index, status: 'not_started', isOptional: template.optional,
          });
          return repo.getManuscriptSection(id);
        });
        logActivity(db, {
          projectId, action: 'manuscript_initialized', entityType: 'manuscript',
          message: `Manuscript initialized with ${created.length} default sections`,
        });
        return created.map(serializeManuscriptSection);
      })();
    },

    getManuscript(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      const sections = repo.listManuscriptSections(projectId);
      const claims = repo.listClaims(projectId);
      const figuresTables = repo.listFiguresTables(projectId);
      const links = repo.listEntityLinksByProject(projectId)
        .filter((link) => link.source_type === 'manuscript_section')
        .map(serializeEntityLink);
      const reviewComments = repo.listReviewComments(projectId);
      const completeness = manuscriptCompleteness({
        sections,
        claims,
        figuresTables,
        links,
      });
      const bySection = new Map();
      for (const link of links) {
        if (!bySection.has(link.sourceId)) bySection.set(link.sourceId, []);
        bySection.get(link.sourceId).push(link);
      }
      return {
        sections: sections.map((section) => ({
          ...serializeManuscriptSection(section),
          relations: bySection.get(section.id) || [],
          reviewComments: reviewComments
            .filter((comment) => comment.manuscript_section_id === section.id)
            .map(serializeReviewComment),
        })),
        completeness,
        reviewSummary: reviewSummary(reviewComments),
      };
    },

    updateManuscriptSection(userId, sectionId, fields) {
      return tx(() => {
        const section = getManuscriptSectionOrThrow(userId, sectionId);
        const prevStatus = section.status;
        repo.updateManuscriptSection(sectionId, {
          ...fields,
          status: assertIn(fields.status, MANUSCRIPT_SECTION_STATUSES, 'status'),
        });
        const updated = repo.getManuscriptSection(sectionId);
        if (fields.status !== undefined && fields.status !== prevStatus) {
          const action = fields.status === 'final' ? 'manuscript_section_finalized' : 'manuscript_section_status_changed';
          logActivity(db, {
            projectId: updated.project_id, action, entityType: 'manuscript_section',
            entityId: sectionId, message: `Section "${updated.title}" status: ${prevStatus} -> ${updated.status}`,
            metadata: { from: prevStatus, to: updated.status },
          });
        }
        this.recalculateProjectSubmissions(userId, updated.project_id);
        return { ...serializeManuscriptSection(updated) };
      })();
    },

    deleteManuscriptSection(userId, sectionId) {
      return tx(() => {
        const section = getManuscriptSectionOrThrow(userId, sectionId);
        repo.softDeleteManuscriptSection(sectionId);
        this.recalculateProjectSubmissions(userId, section.project_id);
        return { id: sectionId, archived: true };
      })();
    },

    // --- Phase 4: Results Freeze --------------------------------------------

    getFreezeReadiness(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      const claims = repo.listClaims(projectId);
      const claimEvidenceRows = repo.listClaimEvidenceByProject(projectId);
      const experiments = repo.listExperiments(projectId);
      const runs = Object.values(repo.listRunsByExperiments(experiments.map((experiment) => experiment.id))).flat();
      const stages = repo.listStages(projectId);
      const gates = listProjectGates(projectId);
      return freezeReadiness({ claims, claimEvidenceRows, experiments, runs, stages, gates });
    },

    createResultsFreeze(userId, projectId, input) {
      return tx(() => {
        getProjectOrThrow(userId, projectId);
        const claims = repo.listClaims(projectId);
        const claimEvidenceRows = repo.listClaimEvidenceByProject(projectId);
        const experiments = repo.listExperiments(projectId);
        const experimentIds = experiments.map((experiment) => experiment.id);
        const runs = Object.values(repo.listRunsByExperiments(experimentIds)).flat();
        const stages = repo.listStages(projectId);
        const gates = listProjectGates(projectId);
        const figuresTables = repo.listFiguresTables(projectId);

        const readiness = freezeReadiness({ claims, claimEvidenceRows, experiments, runs, stages, gates });
        if (!readiness.ready && !input.overrideReason) {
          throw new RfConflictError(`Results Freeze blocked: ${readiness.blockers.map((b) => b.message).join('; ')}`);
        }
        const overridden = !readiness.ready && Boolean(input.overrideReason);

        const id = randomUUID();
        repo.createResultFreeze({
          id, projectId,
          freezeNumber: repo.nextFreezeNumber(projectId),
          ...input,
          overrideReason: overridden ? input.overrideReason : null,
          snapshot: buildFreezeSnapshot({ claims, claimEvidenceRows, figuresTables, experiments, runs }),
        });
        logActivity(db, {
          projectId,
          action: overridden ? 'results_freeze_overridden' : 'results_freeze_created',
          entityType: 'result_freeze',
          entityId: id,
          message: overridden
            ? `Results Freeze #${repo.getResultFreeze(id).freeze_number} created with override: ${input.overrideReason}`
            : `Results Freeze #${repo.getResultFreeze(id).freeze_number} created`,
          metadata: overridden ? { overrideReason: input.overrideReason } : undefined,
        });
        this.recalculateProjectSubmissions(userId, projectId);
        return { ...serializeResultFreeze(repo.getResultFreeze(id)), readiness };
      })();
    },

    listResultFreezes(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      const freezes = repo.listResultFreezes(projectId);
      const current = this.buildFreezeStatus(userId, projectId);
      return freezes.map((freeze) => ({
        ...serializeResultFreeze(freeze),
        staleness: freeze.id === current.latestFreeze?.id ? current.staleness : undefined,
      }));
    },

    buildFreezeStatus(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      const latest = repo.getLatestResultFreeze(projectId);
      if (!latest) return { hasFreeze: false, latestFreeze: null, staleness: { state: 'none', reasons: [] } };
      const claims = repo.listClaims(projectId);
      const claimEvidenceRows = repo.listClaimEvidenceByProject(projectId);
      const experiments = repo.listExperiments(projectId);
      const runs = Object.values(repo.listRunsByExperiments(experiments.map((experiment) => experiment.id))).flat();
      const figuresTables = repo.listFiguresTables(projectId);
      const staleness = freezeStaleness(
        serializeResultFreeze(latest),
        { claims, claimEvidenceRows, figuresTables, experiments, runs },
      );
      return {
        hasFreeze: true,
        latestFreeze: { ...serializeResultFreeze(latest), staleness },
        staleness,
      };
    },

    // --- Phase 4: Internal Review -------------------------------------------

    createReviewComment(userId, projectId, input) {
      return tx(() => {
        getProjectOrThrow(userId, projectId);
        if (input.manuscriptSectionId) {
          const section = repo.getManuscriptSection(input.manuscriptSectionId);
          if (!section || section.archived_at) throw new RfValidationError('manuscriptSectionId does not reference a valid section');
          assertStageBelongsToProject({ project_id: section.project_id }, projectId);
        }
        const id = randomUUID();
        repo.createReviewComment({
          id, projectId, commentCode: repo.nextReviewCommentCode(projectId), ...input,
          severity: assertIn(input.severity, REVIEW_SEVERITIES, 'severity') || 'minor',
          status: assertIn(input.status, REVIEW_STATUSES, 'status') || 'open',
          source: assertIn(input.source, REVIEW_SOURCES, 'source') || 'self_review',
        });
        logActivity(db, {
          projectId, action: 'review_comment_created', entityType: 'review_comment', entityId: id,
          message: `Review comment "${input.title}" created`,
        });
        this.recalculateProjectSubmissions(userId, projectId);
        return { ...serializeReviewComment(repo.getReviewComment(id)) };
      })();
    },

    listReviewComments(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      const comments = repo.listReviewComments(projectId);
      const sections = new Map(repo.listManuscriptSections(projectId).map((section) => [section.id, section.title]));
      return {
        comments: comments.map((comment) => ({
          ...serializeReviewComment(comment),
          sectionTitle: comment.manuscript_section_id ? sections.get(comment.manuscript_section_id) || null : null,
        })),
        summary: reviewSummary(comments),
      };
    },

    updateReviewComment(userId, commentId, fields) {
      return tx(() => {
        const comment = getReviewCommentOrThrow(userId, commentId);
        const prevStatus = comment.status;
        const now = datetimeNow();
        const patch = {
          ...fields,
          severity: assertIn(fields.severity, REVIEW_SEVERITIES, 'severity'),
          status: assertIn(fields.status, REVIEW_STATUSES, 'status'),
        };
        if (fields.status === 'resolved' && prevStatus !== 'resolved') patch.resolvedAt = now;
        if (fields.status !== undefined && fields.status !== 'resolved' && prevStatus === 'resolved') patch.resolvedAt = null;
        repo.updateReviewComment(commentId, patch);
        const updated = repo.getReviewComment(commentId);
        if (fields.status !== undefined && fields.status !== prevStatus) {
          const action = fields.status === 'resolved' ? 'review_comment_resolved' : 'review_comment_reopened';
          logActivity(db, {
            projectId: updated.project_id, action, entityType: 'review_comment',
            entityId: commentId, message: `Review comment ${updated.comment_code}: ${prevStatus} -> ${updated.status}`,
            metadata: { from: prevStatus, to: updated.status },
          });
        }
        this.recalculateProjectSubmissions(userId, updated.project_id);
        return { ...serializeReviewComment(updated) };
      })();
    },

    deleteReviewComment(userId, commentId) {
      return tx(() => {
        const comment = getReviewCommentOrThrow(userId, commentId);
        repo.softDeleteReviewComment(commentId);
        this.recalculateProjectSubmissions(userId, comment.project_id);
        return { id: commentId, archived: true };
      })();
    },

    // --- Phase 4: Submission ------------------------------------------------

    createSubmissionProfile(userId, projectId, input) {
      return tx(() => {
        getProjectOrThrow(userId, projectId);
        const id = randomUUID();
        repo.createSubmissionProfile({ id, projectId, ...input });
        for (const [index, template] of SUBMISSION_DEFAULT_ITEMS.entries()) {
          repo.createSubmissionItem({
            id: randomUUID(), projectId, submissionProfileId: id,
            category: template.category, title: template.title,
            required: template.required, status: 'todo', sortOrder: index,
          });
        }
        logActivity(db, {
          projectId, action: 'submission_profile_created', entityType: 'submission_profile',
          entityId: id, message: `Submission profile for "${input.venue}" created`,
        });
        return this.getSubmissionProfile(userId, id);
      })();
    },

    listSubmissionProfiles(userId, projectId) {
      getProjectOrThrow(userId, projectId);
      return repo.listSubmissionProfiles(projectId).map((profile) => this.decorateSubmissionProfile(userId, profile));
    },

    getSubmissionProfile(userId, profileId) {
      const profile = getSubmissionProfileOrThrow(userId, profileId);
      return this.decorateSubmissionProfile(userId, profile);
    },

    decorateSubmissionProfile(userId, profile) {
      const items = repo.listSubmissionItemsByProfile(profile.id);
      const readiness = this.computeSubmissionReadiness(userId, profile.id, profile);
      return {
        ...serializeSubmissionProfile(profile),
        items: items.map(serializeSubmissionItem),
        readiness,
      };
    },

    updateSubmissionProfile(userId, profileId, fields) {
      return tx(() => {
        const profile = getSubmissionProfileOrThrow(userId, profileId);
        if (profile.status === 'submitted') {
          throw new RfConflictError('Cannot edit a submitted submission profile');
        }
        repo.updateSubmissionProfile(profileId, fields);
        return this.decorateSubmissionProfile(userId, repo.getSubmissionProfile(profileId));
      })();
    },

    updateSubmissionItem(userId, itemId, fields) {
      return tx(() => {
        const item = getSubmissionItemOrThrow(userId, itemId);
        const profile = repo.getSubmissionProfile(item.submission_profile_id);
        if (!profile || profile.archived_at) throw new RfNotFoundError('Submission profile not found');
        if (profile.status === 'submitted') {
          throw new RfConflictError('Cannot modify checklist of a submitted submission');
        }
        const prevStatus = item.status;
        repo.updateSubmissionItem(itemId, {
          ...fields,
          category: assertIn(fields.category, SUBMISSION_CATEGORIES, 'category'),
          status: assertIn(fields.status, SUBMISSION_ITEM_STATUSES, 'status'),
        });
        const updated = repo.getSubmissionItem(itemId);
        if (fields.status !== undefined && fields.status !== prevStatus) {
          const action = fields.status === 'done' ? 'submission_item_completed' : 'submission_item_reopened';
          logActivity(db, {
            projectId: updated.project_id, action, entityType: 'submission_item',
            entityId: itemId, message: `Checklist "${updated.title}": ${prevStatus} -> ${updated.status}`,
            metadata: { from: prevStatus, to: updated.status },
          });
        }
        this.recalculateSubmissionStatus(userId, profile);
        return { ...serializeSubmissionItem(updated) };
      })();
    },

    getSubmissionReadiness(userId, profileId) {
      const profile = getSubmissionProfileOrThrow(userId, profileId);
      const readiness = this.computeSubmissionReadiness(userId, profileId, profile);
      // Keep the derived status in sync without touching a submitted record.
      if (profile.status !== 'submitted') {
        const desired = readiness.ready ? 'submission_ready' : 'preparing';
        if (profile.status !== desired) {
          tx(() => this.recalculateSubmissionStatus(userId, profile))();
        }
      }
      return readiness;
    },

    computeSubmissionReadiness(userId, profileId, profileRow) {
      const projectId = profileRow.project_id;
      const items = repo.listSubmissionItemsByProfile(profileId);
      const freezeStatus = this.buildFreezeStatus(userId, projectId);
      const freezeState = !freezeStatus.hasFreeze ? 'none'
        : freezeStatus.staleness.state === 'stale' ? 'stale' : 'current';

      const sections = repo.listManuscriptSections(projectId);
      const claims = repo.listClaims(projectId);
      const figuresTables = repo.listFiguresTables(projectId);
      const sectionLinks = repo.listEntityLinksByProject(projectId)
        .filter((link) => link.source_type === 'manuscript_section')
        .map(serializeEntityLink);
      const completeness = manuscriptCompleteness({ sections, claims, figuresTables, links: sectionLinks });

      const claimEvidenceRows = repo.listClaimEvidenceByProject(projectId).map((row) => ({ ...row, strength: row.evidence_strength }));
      const evidenceSummary = projectEvidenceSummary(claims, claimEvidenceRows);

      const reviewComments = repo.listReviewComments(projectId);
      const summary = reviewSummary(reviewComments);

      const stages = repo.listStages(projectId);
      const gates = listProjectGates(projectId);
      const submissionStage = stages.find((stage) => stage.key === 'submission' && !stage.archived_at);
      const submissionStageGates = submissionStage
        ? (() => {
            const stageGates = gates.filter((gate) => gate.stage_id === submissionStage.id);
            const required = stageGates.filter((gate) => gate.is_required);
            return { required: required.length, passed: required.filter((gate) => gate.is_passed).length };
          })()
        : null;

      return submissionReadiness({
        items,
        freezeState,
        requiredSectionsComplete: completeness.requiredSectionsComplete,
        coreClaimsMissingEvidence: evidenceSummary.coreClaimsMissingEvidence,
        hasOpenCriticalReview: summary.hasOpenCritical,
        submissionStageGates,
      });
    },

    recalculateSubmissionStatus(userId, profileRow) {
      if (profileRow.status === 'submitted') return; // Submitted is irreversible.
      const readiness = this.computeSubmissionReadiness(userId, profileRow.id, profileRow);
      const desired = readiness.ready ? 'submission_ready' : 'preparing';
      if (profileRow.status !== desired) {
        repo.updateSubmissionProfile(profileRow.id, { status: desired });
        logActivity(db, {
          projectId: profileRow.project_id,
          action: readiness.ready ? 'submission_ready_achieved' : 'submission_ready_lost',
          entityType: 'submission_profile',
          entityId: profileRow.id,
          message: `Submission profile "${profileRow.venue}" ${desired}`,
          metadata: { blockers: readiness.blockers },
        });
      }
    },

    /** Recompute readiness for every non-submitted profile of a project.
     *  Must be called inside the same transaction as the triggering mutation. */
    recalculateProjectSubmissions(userId, projectId) {
      for (const profile of repo.listSubmissionProfiles(projectId)) {
        this.recalculateSubmissionStatus(userId, profile);
      }
    },

    markSubmitted(userId, profileId, input) {
      return tx(() => {
        const profile = getSubmissionProfileOrThrow(userId, profileId);
        if (input.confirmation !== true) {
          throw new RfValidationError('Field "confirmation" must be true to mark a paper as submitted');
        }
        if (profile.status === 'submitted') {
          return { ...serializeSubmissionProfile(profile) }; // idempotent
        }
        repo.updateSubmissionProfile(profileId, {
          status: 'submitted',
          submittedAt: datetimeNow(),
          finalPaperPath: input.finalPaperPath || null,
          externalSubmissionId: input.externalSubmissionId || null,
        });
        logActivity(db, {
          projectId: profile.project_id, action: 'paper_marked_submitted', entityType: 'submission_profile',
          entityId: profileId, message: `Paper for "${profile.venue}" marked as submitted`,
          metadata: { finalPaperPath: input.finalPaperPath || null, externalSubmissionId: input.externalSubmissionId || null },
        });
        return this.decorateSubmissionProfile(userId, repo.getSubmissionProfile(profileId));
      })();
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

/** Whole days from today until the given date; negative when past. */
const daysRemaining = (dateString) => {
  if (!dateString) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = parseDateLocal(dateString);
  due.setHours(0, 0, 0, 0);
  return Math.round((due - now) / 86400000);
};

// --- Phase 3 serializers ----------------------------------------------------

const serializeExperiment = (row) => row && ({
  id: row.id,
  projectId: row.project_id,
  stageId: row.stage_id,
  code: row.experiment_code,
  title: row.title,
  researchQuestion: row.research_question,
  hypothesis: row.hypothesis,
  type: row.type,
  status: row.status,
  priority: row.priority,
  methodVariant: row.method_variant,
  datasetsEnvironment: row.datasets_environment,
  metricsDefinition: row.metrics_definition,
  requiredSeeds: row.required_seeds,
  successCriteria: row.success_criteria,
  failureCriteria: row.failure_criteria,
  notes: row.notes,
  sortOrder: row.sort_order,
  metadata: parseJson(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

const serializeRun = (row) => row && ({
  id: row.id,
  projectId: row.project_id,
  experimentId: row.experiment_id,
  runCode: row.run_code,
  seed: row.seed,
  status: row.status,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  gitCommit: row.git_commit,
  gitBranch: row.git_branch,
  configPath: row.config_path,
  checkpointPath: row.checkpoint_path,
  resultPath: row.result_path,
  datasetVersion: row.dataset_version,
  environmentName: row.environment_name,
  device: row.device,
  runtimeSeconds: row.runtime_seconds,
  metrics: parseJson(row.metrics_json),
  notes: row.notes,
  failureReason: row.failure_reason,
  failureClassification: row.failure_classification,
  metadata: parseJson(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

const serializeClaim = (row) => row && ({
  id: row.id,
  projectId: row.project_id,
  code: row.claim_code,
  statement: row.statement,
  importance: row.importance,
  status: row.status,
  notes: row.notes,
  sortOrder: row.sort_order,
  metadata: parseJson(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

const serializeEvidence = (row) => row && ({
  id: row.id,
  projectId: row.project_id,
  evidenceType: row.evidence_type,
  sourceId: row.source_id,
  title: row.title,
  summary: row.summary,
  strength: row.strength,
  pathOrReference: row.path_or_reference,
  sortOrder: row.sort_order,
  metadata: parseJson(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

const serializeClaimEvidence = (row) => row && ({
  id: row.id,
  projectId: row.project_id,
  claimId: row.claim_id,
  evidenceId: row.evidence_id,
  relationType: row.relation_type,
  notes: row.notes,
  createdAt: row.created_at,
  evidenceStrength: row.evidence_strength,
});

const serializeDecision = (row) => row && ({
  id: row.id,
  projectId: row.project_id,
  code: row.decision_code,
  date: row.date,
  title: row.title,
  context: row.context,
  decision: row.decision,
  reason: row.reason,
  alternatives: row.alternatives,
  impact: row.impact,
  sortOrder: row.sort_order,
  metadata: parseJson(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

const serializeLiterature = (row) => row && ({
  id: row.id,
  projectId: row.project_id,
  title: row.title,
  authors: row.authors,
  year: row.year,
  venue: row.venue,
  url: row.url,
  doi: row.doi,
  arxivId: row.arxiv_id,
  citationKey: row.citation_key,
  relation: row.relation,
  readStatus: row.read_status,
  priority: row.priority,
  keyFinding: row.key_finding,
  methodSummary: row.method_summary,
  differenceToOurs: row.difference_to_ours,
  usedInSection: row.used_in_section,
  notes: row.notes,
  sortOrder: row.sort_order,
  metadata: parseJson(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

const serializeFigureTable = (row) => row && ({
  id: row.id,
  projectId: row.project_id,
  code: row.artifact_code,
  type: row.type,
  number: row.number,
  workingTitle: row.working_title,
  status: row.status,
  filePath: row.file_path,
  manuscriptSection: row.manuscript_section,
  frozen: Boolean(row.frozen),
  notes: row.notes,
  sortOrder: row.sort_order,
  metadata: parseJson(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

const serializeEntityLink = (row) => row && ({
  id: row.id,
  projectId: row.project_id,
  sourceType: row.source_type,
  sourceId: row.source_id,
  targetType: row.target_type,
  targetId: row.target_id,
  relationType: row.relation_type,
  metadata: parseJson(row.metadata_json),
  createdAt: row.created_at,
});

/**
 * Record run status transitions in the activity log (Phase 3 §15).
 * Must be called inside an active transaction.
 */
const logRunTransitions = (db, projectId, run, { from }) => {
  if (run.status === from) return;
  let action = 'experiment_run_status_changed';
  if (run.status === 'running') action = 'experiment_run_started';
  else if (run.status === 'completed') action = 'experiment_run_completed';
  else if (run.status === 'failed') action = 'experiment_run_failed';
  logActivity(db, {
    projectId,
    action,
    entityType: 'experiment_run',
    entityId: run.id,
    message: `Run ${run.run_code}: ${from} -> ${run.status}`,
    metadata: { from, to: run.status },
  });
};

// --- Phase 4 serializers ----------------------------------------------------

const serializeManuscriptSection = (row) => row && ({
  id: row.id,
  projectId: row.project_id,
  sectionKey: row.section_key,
  title: row.title,
  sortOrder: row.sort_order,
  status: row.status,
  progress: row.progress,
  isOptional: Boolean(row.is_optional),
  filePath: row.file_path,
  notes: row.notes,
  metadata: parseJson(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

const serializeResultFreeze = (row) => row && ({
  id: row.id,
  projectId: row.project_id,
  freezeNumber: row.freeze_number,
  gitCommit: row.git_commit,
  gitBranch: row.git_branch,
  resultVersion: row.result_version,
  datasetVersion: row.dataset_version,
  configVersion: row.config_version,
  snapshot: parseJson(row.snapshot_json),
  notes: row.notes,
  overrideReason: row.override_reason,
  createdAt: row.created_at,
});

const serializeReviewComment = (row) => row && ({
  id: row.id,
  projectId: row.project_id,
  manuscriptSectionId: row.manuscript_section_id,
  code: row.comment_code,
  title: row.title,
  body: row.body,
  severity: row.severity,
  status: row.status,
  source: row.source,
  authorName: row.author_name,
  dueDate: row.due_date,
  resolvedAt: row.resolved_at,
  metadata: parseJson(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

const serializeSubmissionProfile = (row) => row && ({
  id: row.id,
  projectId: row.project_id,
  venue: row.venue,
  track: row.track,
  deadline: row.deadline,
  deadlineTimezone: row.deadline_timezone,
  pageLimit: row.page_limit,
  anonymous: Boolean(row.anonymous),
  submissionUrl: row.submission_url,
  status: row.status,
  submittedAt: row.submitted_at,
  finalPaperPath: row.final_paper_path,
  externalSubmissionId: row.external_submission_id,
  notes: row.notes,
  metadata: parseJson(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

const serializeSubmissionItem = (row) => row && ({
  id: row.id,
  projectId: row.project_id,
  submissionProfileId: row.submission_profile_id,
  category: row.category,
  title: row.title,
  required: Boolean(row.required),
  status: row.status,
  dueDate: row.due_date,
  notes: row.notes,
  artifactPath: row.artifact_path,
  sortOrder: row.sort_order,
  metadata: parseJson(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

const datetimeNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
