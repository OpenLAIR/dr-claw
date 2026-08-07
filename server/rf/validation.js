// ResearchFlow input validation.
// Controlled enums live here so the API, service and repositories share one source of truth.
import { RfValidationError } from './errors.js';

// --- Controlled enums -------------------------------------------------------

export const PROJECT_STATUSES = ['active', 'paused', 'submitted', 'archived'];

export const STAGE_STATUSES = ['pending', 'current', 'completed', 'skipped'];

export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'blocked', 'done', 'cancelled'];

export const TASK_PRIORITIES = ['critical', 'high', 'medium', 'low'];

// Polymorphic task link target types. Phase 3/4 tables do not exist yet, so only the
// enum value is validated here; referential validation is added in later phases.
export const TASK_RELATION_TYPES = [
  'stage',
  'experiment',
  'claim',
  'manuscript_section',
  'submission_item',
  'review_comment',
  'decision',
  'evidence',
  'figure_table',
  'artifact',
  'literature',
];

// Task dependency relation (rf_task_dependencies) is a plain task->task edge, not
// polymorphic; it is excluded from TASK_RELATION_TYPES.

// --- Helpers ----------------------------------------------------------------

const isString = (value) => typeof value === 'string';
const isNonEmptyString = (value) => isString(value) && value.trim().length > 0;
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const assertNonEmptyString = (value, field) => {
  if (!isNonEmptyString(value)) {
    throw new RfValidationError(`Field "${field}" must be a non-empty string`);
  }
  return value.trim();
};

const assertOptionalString = (value, field) => {
  if (value === undefined || value === null || value === '') return null;
  if (!isString(value)) {
    throw new RfValidationError(`Field "${field}" must be a string`);
  }
  return value.trim();
};

const assertEnum = (value, allowed, field) => {
  if (value === undefined || value === null) return null;
  if (!allowed.includes(value)) {
    throw new RfValidationError(`Field "${field}" must be one of: ${allowed.join(', ')}`);
  }
  return value;
};

const assertOptionalObject = (value, field) => {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    throw new RfValidationError(`Field "${field}" must be an object`);
  }
  return value;
};

const assertOptionalDate = (value, field) => {
  if (value === undefined || value === null || value === '') return null;
  if (!isString(value) || Number.isNaN(Date.parse(value))) {
    throw new RfValidationError(`Field "${field}" must be a valid date string`);
  }
  return value;
};

// --- Project ----------------------------------------------------------------

export const validateCreateProject = (body) => {
  if (!isPlainObject(body)) {
    throw new RfValidationError('Request body must be an object');
  }
  const data = {};
  data.name = assertNonEmptyString(body.name, 'name');
  data.targetVenue = assertOptionalString(body.targetVenue, 'targetVenue');
  data.deadline = assertOptionalDate(body.deadline, 'deadline');
  data.sourceProjectId = assertOptionalString(body.sourceProjectId, 'sourceProjectId');
  data.workspaceType = assertOptionalString(body.workspaceType, 'workspaceType');
  data.windowsPath = assertOptionalString(body.windowsPath, 'windowsPath');
  data.wslDistro = assertOptionalString(body.wslDistro, 'wslDistro');
  data.wslPath = assertOptionalString(body.wslPath, 'wslPath');
  data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateUpdateProject = (body) => {
  if (!isPlainObject(body)) {
    throw new RfValidationError('Request body must be an object');
  }
  const data = {};
  if (body.name !== undefined) data.name = assertNonEmptyString(body.name, 'name');
  if (body.targetVenue !== undefined) data.targetVenue = assertOptionalString(body.targetVenue, 'targetVenue');
  if (body.deadline !== undefined) data.deadline = assertOptionalDate(body.deadline, 'deadline');
  if (body.status !== undefined) data.status = assertEnum(body.status, PROJECT_STATUSES, 'status');
  if (body.workspaceType !== undefined) data.workspaceType = assertOptionalString(body.workspaceType, 'workspaceType');
  if (body.windowsPath !== undefined) data.windowsPath = assertOptionalString(body.windowsPath, 'windowsPath');
  if (body.wslDistro !== undefined) data.wslDistro = assertOptionalString(body.wslDistro, 'wslDistro');
  if (body.wslPath !== undefined) data.wslPath = assertOptionalString(body.wslPath, 'wslPath');
  if (body.metadata !== undefined) data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

// Phase 5: workspace metadata update (semantic validation lives in service
// layer via server/rf/workspace.js validateWorkspaceFields).
export const validateWorkspaceUpdate = (body) => {
  if (!isPlainObject(body)) {
    throw new RfValidationError('Request body must be an object');
  }
  const data = {};
  if (body.workspaceType !== undefined) {
    data.workspaceType = assertOptionalString(body.workspaceType, 'workspaceType');
  }
  if (body.windowsPath !== undefined) {
    data.windowsPath = assertOptionalString(body.windowsPath, 'windowsPath');
  }
  if (body.wslDistro !== undefined) {
    data.wslDistro = assertOptionalString(body.wslDistro, 'wslDistro');
  }
  if (body.wslPath !== undefined) {
    data.wslPath = assertOptionalString(body.wslPath, 'wslPath');
  }
  return data;
};

// --- Stage ------------------------------------------------------------------

export const validateStagePatch = (body) => {
  if (!isPlainObject(body)) {
    throw new RfValidationError('Request body must be an object');
  }
  const data = {};
  if (body.notes !== undefined) data.notes = assertOptionalString(body.notes, 'notes');
  if (body.metadata !== undefined) data.metadata = assertOptionalObject(body.metadata, 'metadata');
  if (body.sortOrder !== undefined) {
    if (!Number.isInteger(body.sortOrder)) {
      throw new RfValidationError('Field "sortOrder" must be an integer');
    }
    data.sortOrder = body.sortOrder;
  }
  return data;
};

// --- Gate -------------------------------------------------------------------

export const validateGatePatch = (body) => {
  if (!isPlainObject(body)) {
    throw new RfValidationError('Request body must be an object');
  }
  const data = {};
  if (body.isPassed !== undefined) {
    if (typeof body.isPassed !== 'boolean') {
      throw new RfValidationError('Field "isPassed" must be a boolean');
    }
    data.isPassed = body.isPassed;
  }
  if (body.title !== undefined) data.title = assertNonEmptyString(body.title, 'title');
  if (body.description !== undefined) data.description = assertOptionalString(body.description, 'description');
  if (body.sortOrder !== undefined) {
    if (!Number.isInteger(body.sortOrder)) {
      throw new RfValidationError('Field "sortOrder" must be an integer');
    }
    data.sortOrder = body.sortOrder;
  }
  return data;
};

// --- Task -------------------------------------------------------------------

export const validateCreateTask = (body) => {
  if (!isPlainObject(body)) {
    throw new RfValidationError('Request body must be an object');
  }
  const data = {};
  data.title = assertNonEmptyString(body.title, 'title');
  data.description = assertOptionalString(body.description, 'description');
  data.status = assertEnum(body.status, TASK_STATUSES, 'status') || 'todo';
  data.priority = assertEnum(body.priority, TASK_PRIORITIES, 'priority') || 'medium';
  data.dueDate = assertOptionalDate(body.dueDate, 'dueDate');
  data.isBlocker = body.isBlocker === undefined ? false : Boolean(body.isBlocker);
  data.stageId = assertOptionalString(body.stageId, 'stageId');
  data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateUpdateTask = (body) => {
  if (!isPlainObject(body)) {
    throw new RfValidationError('Request body must be an object');
  }
  const data = {};
  if (body.title !== undefined) data.title = assertNonEmptyString(body.title, 'title');
  if (body.description !== undefined) data.description = assertOptionalString(body.description, 'description');
  if (body.status !== undefined) data.status = assertEnum(body.status, TASK_STATUSES, 'status');
  if (body.priority !== undefined) data.priority = assertEnum(body.priority, TASK_PRIORITIES, 'priority');
  if (body.dueDate !== undefined) data.dueDate = assertOptionalDate(body.dueDate, 'dueDate');
  if (body.isBlocker !== undefined) data.isBlocker = Boolean(body.isBlocker);
  if (body.stageId !== undefined) data.stageId = assertOptionalString(body.stageId, 'stageId');
  if (body.metadata !== undefined) data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

// --- Task dependencies ------------------------------------------------------

export const validateCreateDependency = (body) => {
  if (!isPlainObject(body)) {
    throw new RfValidationError('Request body must be an object');
  }
  const dependsOnTaskId = assertNonEmptyString(body.dependsOnTaskId, 'dependsOnTaskId');
  return { dependsOnTaskId };
};

// --- Task links (polymorphic) ----------------------------------------------

export const validateCreateTaskLink = (body) => {
  if (!isPlainObject(body)) {
    throw new RfValidationError('Request body must be an object');
  }
  const relationType = assertEnum(body.relationType, TASK_RELATION_TYPES, 'relationType');
  if (!relationType) {
    throw new RfValidationError(`Field "relationType" must be one of: ${TASK_RELATION_TYPES.join(', ')}`);
  }
  const relationId = assertNonEmptyString(body.relationId, 'relationId');
  return { relationType, relationId };
};

// --- Misc -------------------------------------------------------------------

export const validateActivityQuery = (query) => {
  const data = { limit: 50, offset: 0 };
  if (query.limit !== undefined) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new RfValidationError('Field "limit" must be an integer between 1 and 200');
    }
    data.limit = limit;
  }
  if (query.offset !== undefined) {
    const offset = Number(query.offset);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new RfValidationError('Field "offset" must be a non-negative integer');
    }
    data.offset = offset;
  }
  return data;
};

// --- Phase 3 enums ----------------------------------------------------------

export const EXPERIMENT_TYPES = [
  'prototype', 'main', 'baseline', 'ablation', 'sensitivity', 'robustness',
  'failure_analysis', 'reproduction', 'post_freeze',
];

export const EXPERIMENT_STATUSES = [
  'planned', 'ready', 'running', 'completed', 'failed', 'inconclusive', 'cancelled',
];

export const RUN_STATUSES = ['planned', 'running', 'completed', 'failed', 'cancelled'];

export const FAILURE_CLASSIFICATIONS = [
  'implementation_bug', 'training_instability', 'hypothesis_rejected', 'resource_limit',
  'invalid_design', 'data_issue', 'external_dependency', 'unknown',
];

export const CLAIM_IMPORTANCES = ['core', 'major', 'supporting'];

export const CLAIM_STATUSES = [
  'unverified', 'partial', 'supported', 'strong', 'contradicted', 'dropped',
];

export const EVIDENCE_TYPES = [
  'experiment', 'experiment_run', 'figure', 'table', 'literature', 'analysis_note', 'artifact',
];

export const EVIDENCE_STRENGTHS = ['weak', 'moderate', 'strong'];

export const CLAIM_EVIDENCE_RELATIONS = ['supports', 'contradicts', 'contextualized_by'];

export const LITERATURE_RELATIONS = [
  'closest_work', 'baseline', 'background', 'method_inspiration', 'evaluation',
  'dataset', 'contradictory_evidence',
];

export const LITERATURE_READ_STATUSES = ['inbox', 'skimmed', 'read', 'deep_read', 'cited'];

export const FIGURE_TABLE_TYPES = ['figure', 'table'];

export const FIGURE_TABLE_STATUSES = ['planned', 'draft', 'ready', 'frozen', 'deprecated'];

// Controlled polymorphic provenance types for rf_entity_links.
export const ENTITY_TYPES = [
  'experiment', 'experiment_run', 'claim', 'evidence', 'decision', 'task', 'figure_table',
  'manuscript_section', 'review_comment', 'submission_item',
];

export const ENTITY_LINK_RELATIONS = ['references', 'produces', 'supports', 'contradicts', 'relates_to'];

// --- Phase 3 validation helpers --------------------------------------------

const assertOptionalInt = (value, field) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new RfValidationError(`Field "${field}" must be an integer`);
  }
  return n;
};

export const validateCreateExperiment = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  data.title = assertNonEmptyString(body.title, 'title');
  data.researchQuestion = assertOptionalString(body.researchQuestion, 'researchQuestion');
  data.hypothesis = assertOptionalString(body.hypothesis, 'hypothesis');
  data.type = assertEnum(body.type, EXPERIMENT_TYPES, 'type') || 'prototype';
  data.status = assertEnum(body.status, EXPERIMENT_STATUSES, 'status') || 'planned';
  data.priority = assertEnum(body.priority, TASK_PRIORITIES, 'priority') || 'medium';
  data.methodVariant = assertOptionalString(body.methodVariant, 'methodVariant');
  data.datasetsEnvironment = assertOptionalString(body.datasetsEnvironment, 'datasetsEnvironment');
  data.metricsDefinition = assertOptionalString(body.metricsDefinition, 'metricsDefinition');
  data.requiredSeeds = assertOptionalInt(body.requiredSeeds, 'requiredSeeds');
  data.successCriteria = assertOptionalString(body.successCriteria, 'successCriteria');
  data.failureCriteria = assertOptionalString(body.failureCriteria, 'failureCriteria');
  data.notes = assertOptionalString(body.notes, 'notes');
  data.stageId = assertOptionalString(body.stageId, 'stageId');
  data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateUpdateExperiment = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  if (body.title !== undefined) data.title = assertNonEmptyString(body.title, 'title');
  if (body.researchQuestion !== undefined) data.researchQuestion = assertOptionalString(body.researchQuestion, 'researchQuestion');
  if (body.hypothesis !== undefined) data.hypothesis = assertOptionalString(body.hypothesis, 'hypothesis');
  if (body.type !== undefined) data.type = assertEnum(body.type, EXPERIMENT_TYPES, 'type');
  if (body.status !== undefined) data.status = assertEnum(body.status, EXPERIMENT_STATUSES, 'status');
  if (body.priority !== undefined) data.priority = assertEnum(body.priority, TASK_PRIORITIES, 'priority');
  if (body.methodVariant !== undefined) data.methodVariant = assertOptionalString(body.methodVariant, 'methodVariant');
  if (body.datasetsEnvironment !== undefined) data.datasetsEnvironment = assertOptionalString(body.datasetsEnvironment, 'datasetsEnvironment');
  if (body.metricsDefinition !== undefined) data.metricsDefinition = assertOptionalString(body.metricsDefinition, 'metricsDefinition');
  if (body.requiredSeeds !== undefined) data.requiredSeeds = assertOptionalInt(body.requiredSeeds, 'requiredSeeds');
  if (body.successCriteria !== undefined) data.successCriteria = assertOptionalString(body.successCriteria, 'successCriteria');
  if (body.failureCriteria !== undefined) data.failureCriteria = assertOptionalString(body.failureCriteria, 'failureCriteria');
  if (body.notes !== undefined) data.notes = assertOptionalString(body.notes, 'notes');
  if (body.stageId !== undefined) data.stageId = assertOptionalString(body.stageId, 'stageId');
  if (body.metadata !== undefined) data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateCreateRun = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  data.seed = assertOptionalString(body.seed, 'seed');
  data.status = assertEnum(body.status, RUN_STATUSES, 'status') || 'planned';
  data.startedAt = assertOptionalString(body.startedAt, 'startedAt');
  data.finishedAt = assertOptionalString(body.finishedAt, 'finishedAt');
  data.gitCommit = assertOptionalString(body.gitCommit, 'gitCommit');
  data.gitBranch = assertOptionalString(body.gitBranch, 'gitBranch');
  data.configPath = assertOptionalString(body.configPath, 'configPath');
  data.checkpointPath = assertOptionalString(body.checkpointPath, 'checkpointPath');
  data.resultPath = assertOptionalString(body.resultPath, 'resultPath');
  data.datasetVersion = assertOptionalString(body.datasetVersion, 'datasetVersion');
  data.environmentName = assertOptionalString(body.environmentName, 'environmentName');
  data.device = assertOptionalString(body.device, 'device');
  data.runtimeSeconds = body.runtimeSeconds === undefined || body.runtimeSeconds === null ? null : Number(body.runtimeSeconds);
  if (data.runtimeSeconds !== null && !Number.isFinite(data.runtimeSeconds)) {
    throw new RfValidationError('Field "runtimeSeconds" must be a number');
  }
  data.metrics = assertOptionalObject(body.metrics, 'metrics');
  data.notes = assertOptionalString(body.notes, 'notes');
  data.failureReason = assertOptionalString(body.failureReason, 'failureReason');
  data.failureClassification = assertEnum(body.failureClassification, FAILURE_CLASSIFICATIONS, 'failureClassification');
  data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateUpdateRun = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  if (body.seed !== undefined) data.seed = assertOptionalString(body.seed, 'seed');
  if (body.status !== undefined) data.status = assertEnum(body.status, RUN_STATUSES, 'status');
  if (body.startedAt !== undefined) data.startedAt = assertOptionalString(body.startedAt, 'startedAt');
  if (body.finishedAt !== undefined) data.finishedAt = assertOptionalString(body.finishedAt, 'finishedAt');
  if (body.gitCommit !== undefined) data.gitCommit = assertOptionalString(body.gitCommit, 'gitCommit');
  if (body.gitBranch !== undefined) data.gitBranch = assertOptionalString(body.gitBranch, 'gitBranch');
  if (body.configPath !== undefined) data.configPath = assertOptionalString(body.configPath, 'configPath');
  if (body.checkpointPath !== undefined) data.checkpointPath = assertOptionalString(body.checkpointPath, 'checkpointPath');
  if (body.resultPath !== undefined) data.resultPath = assertOptionalString(body.resultPath, 'resultPath');
  if (body.datasetVersion !== undefined) data.datasetVersion = assertOptionalString(body.datasetVersion, 'datasetVersion');
  if (body.environmentName !== undefined) data.environmentName = assertOptionalString(body.environmentName, 'environmentName');
  if (body.device !== undefined) data.device = assertOptionalString(body.device, 'device');
  if (body.runtimeSeconds !== undefined) {
    data.runtimeSeconds = body.runtimeSeconds === null ? null : Number(body.runtimeSeconds);
    if (data.runtimeSeconds !== null && !Number.isFinite(data.runtimeSeconds)) {
      throw new RfValidationError('Field "runtimeSeconds" must be a number');
    }
  }
  if (body.metrics !== undefined) data.metrics = assertOptionalObject(body.metrics, 'metrics');
  if (body.notes !== undefined) data.notes = assertOptionalString(body.notes, 'notes');
  if (body.failureReason !== undefined) data.failureReason = assertOptionalString(body.failureReason, 'failureReason');
  if (body.failureClassification !== undefined) data.failureClassification = assertEnum(body.failureClassification, FAILURE_CLASSIFICATIONS, 'failureClassification');
  if (body.metadata !== undefined) data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateCreateClaim = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  data.statement = assertNonEmptyString(body.statement, 'statement');
  data.importance = assertEnum(body.importance, CLAIM_IMPORTANCES, 'importance') || 'supporting';
  data.status = assertEnum(body.status, CLAIM_STATUSES, 'status') || 'unverified';
  data.notes = assertOptionalString(body.notes, 'notes');
  data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateUpdateClaim = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  if (body.statement !== undefined) data.statement = assertNonEmptyString(body.statement, 'statement');
  if (body.importance !== undefined) data.importance = assertEnum(body.importance, CLAIM_IMPORTANCES, 'importance');
  if (body.status !== undefined) data.status = assertEnum(body.status, CLAIM_STATUSES, 'status');
  if (body.notes !== undefined) data.notes = assertOptionalString(body.notes, 'notes');
  if (body.metadata !== undefined) data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateCreateEvidence = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  data.evidenceType = assertEnum(body.evidenceType, EVIDENCE_TYPES, 'evidenceType');
  if (!data.evidenceType) {
    throw new RfValidationError(`Field "evidenceType" must be one of: ${EVIDENCE_TYPES.join(', ')}`);
  }
  data.sourceId = assertOptionalString(body.sourceId, 'sourceId');
  data.title = assertNonEmptyString(body.title, 'title');
  data.summary = assertOptionalString(body.summary, 'summary');
  data.strength = assertEnum(body.strength, EVIDENCE_STRENGTHS, 'strength') || 'weak';
  data.pathOrReference = assertOptionalString(body.pathOrReference, 'pathOrReference');
  data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateUpdateEvidence = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  if (body.evidenceType !== undefined) data.evidenceType = assertEnum(body.evidenceType, EVIDENCE_TYPES, 'evidenceType');
  if (body.sourceId !== undefined) data.sourceId = assertOptionalString(body.sourceId, 'sourceId');
  if (body.title !== undefined) data.title = assertNonEmptyString(body.title, 'title');
  if (body.summary !== undefined) data.summary = assertOptionalString(body.summary, 'summary');
  if (body.strength !== undefined) data.strength = assertEnum(body.strength, EVIDENCE_STRENGTHS, 'strength');
  if (body.pathOrReference !== undefined) data.pathOrReference = assertOptionalString(body.pathOrReference, 'pathOrReference');
  if (body.metadata !== undefined) data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateClaimEvidence = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  data.claimId = assertNonEmptyString(body.claimId, 'claimId');
  data.evidenceId = assertNonEmptyString(body.evidenceId, 'evidenceId');
  data.relationType = assertEnum(body.relationType, CLAIM_EVIDENCE_RELATIONS, 'relationType') || 'supports';
  data.notes = assertOptionalString(body.notes, 'notes');
  return data;
};

export const validateCreateDecision = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  data.title = assertNonEmptyString(body.title, 'title');
  data.date = assertOptionalDate(body.date, 'date');
  data.context = assertOptionalString(body.context, 'context');
  data.decision = assertOptionalString(body.decision, 'decision');
  data.reason = assertOptionalString(body.reason, 'reason');
  data.alternatives = assertOptionalString(body.alternatives, 'alternatives');
  data.impact = assertOptionalString(body.impact, 'impact');
  data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateUpdateDecision = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  if (body.title !== undefined) data.title = assertNonEmptyString(body.title, 'title');
  if (body.date !== undefined) data.date = assertOptionalDate(body.date, 'date');
  if (body.context !== undefined) data.context = assertOptionalString(body.context, 'context');
  if (body.decision !== undefined) data.decision = assertOptionalString(body.decision, 'decision');
  if (body.reason !== undefined) data.reason = assertOptionalString(body.reason, 'reason');
  if (body.alternatives !== undefined) data.alternatives = assertOptionalString(body.alternatives, 'alternatives');
  if (body.impact !== undefined) data.impact = assertOptionalString(body.impact, 'impact');
  if (body.metadata !== undefined) data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateCreateLiterature = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  data.title = assertNonEmptyString(body.title, 'title');
  data.authors = assertOptionalString(body.authors, 'authors');
  data.year = assertOptionalInt(body.year, 'year');
  data.venue = assertOptionalString(body.venue, 'venue');
  data.url = assertOptionalString(body.url, 'url');
  data.doi = assertOptionalString(body.doi, 'doi');
  data.arxivId = assertOptionalString(body.arxivId, 'arxivId');
  data.citationKey = assertOptionalString(body.citationKey, 'citationKey');
  data.relation = assertEnum(body.relation, LITERATURE_RELATIONS, 'relation');
  data.readStatus = assertEnum(body.readStatus, LITERATURE_READ_STATUSES, 'readStatus') || 'inbox';
  data.priority = assertEnum(body.priority, TASK_PRIORITIES, 'priority') || 'medium';
  data.keyFinding = assertOptionalString(body.keyFinding, 'keyFinding');
  data.methodSummary = assertOptionalString(body.methodSummary, 'methodSummary');
  data.differenceToOurs = assertOptionalString(body.differenceToOurs, 'differenceToOurs');
  data.usedInSection = assertOptionalString(body.usedInSection, 'usedInSection');
  data.notes = assertOptionalString(body.notes, 'notes');
  data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateUpdateLiterature = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  if (body.title !== undefined) data.title = assertNonEmptyString(body.title, 'title');
  if (body.authors !== undefined) data.authors = assertOptionalString(body.authors, 'authors');
  if (body.year !== undefined) data.year = assertOptionalInt(body.year, 'year');
  if (body.venue !== undefined) data.venue = assertOptionalString(body.venue, 'venue');
  if (body.url !== undefined) data.url = assertOptionalString(body.url, 'url');
  if (body.doi !== undefined) data.doi = assertOptionalString(body.doi, 'doi');
  if (body.arxivId !== undefined) data.arxivId = assertOptionalString(body.arxivId, 'arxivId');
  if (body.citationKey !== undefined) data.citationKey = assertOptionalString(body.citationKey, 'citationKey');
  if (body.relation !== undefined) data.relation = assertEnum(body.relation, LITERATURE_RELATIONS, 'relation');
  if (body.readStatus !== undefined) data.readStatus = assertEnum(body.readStatus, LITERATURE_READ_STATUSES, 'readStatus');
  if (body.priority !== undefined) data.priority = assertEnum(body.priority, TASK_PRIORITIES, 'priority');
  if (body.keyFinding !== undefined) data.keyFinding = assertOptionalString(body.keyFinding, 'keyFinding');
  if (body.methodSummary !== undefined) data.methodSummary = assertOptionalString(body.methodSummary, 'methodSummary');
  if (body.differenceToOurs !== undefined) data.differenceToOurs = assertOptionalString(body.differenceToOurs, 'differenceToOurs');
  if (body.usedInSection !== undefined) data.usedInSection = assertOptionalString(body.usedInSection, 'usedInSection');
  if (body.notes !== undefined) data.notes = assertOptionalString(body.notes, 'notes');
  if (body.metadata !== undefined) data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateCreateFigureTable = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  data.type = assertEnum(body.type, FIGURE_TABLE_TYPES, 'type') || 'figure';
  data.number = assertOptionalInt(body.number, 'number');
  data.workingTitle = assertNonEmptyString(body.workingTitle, 'workingTitle');
  data.status = assertEnum(body.status, FIGURE_TABLE_STATUSES, 'status') || 'planned';
  data.filePath = assertOptionalString(body.filePath, 'filePath');
  data.manuscriptSection = assertOptionalString(body.manuscriptSection, 'manuscriptSection');
  data.frozen = body.frozen === undefined ? false : Boolean(body.frozen);
  data.notes = assertOptionalString(body.notes, 'notes');
  data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateUpdateFigureTable = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  if (body.type !== undefined) data.type = assertEnum(body.type, FIGURE_TABLE_TYPES, 'type');
  if (body.number !== undefined) data.number = assertOptionalInt(body.number, 'number');
  if (body.workingTitle !== undefined) data.workingTitle = assertNonEmptyString(body.workingTitle, 'workingTitle');
  if (body.status !== undefined) data.status = assertEnum(body.status, FIGURE_TABLE_STATUSES, 'status');
  if (body.filePath !== undefined) data.filePath = assertOptionalString(body.filePath, 'filePath');
  if (body.manuscriptSection !== undefined) data.manuscriptSection = assertOptionalString(body.manuscriptSection, 'manuscriptSection');
  if (body.frozen !== undefined) data.frozen = Boolean(body.frozen);
  if (body.notes !== undefined) data.notes = assertOptionalString(body.notes, 'notes');
  if (body.metadata !== undefined) data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateEntityLink = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  data.sourceType = assertEnum(body.sourceType, ENTITY_TYPES, 'sourceType');
  data.sourceId = assertNonEmptyString(body.sourceId, 'sourceId');
  data.targetType = assertEnum(body.targetType, ENTITY_TYPES, 'targetType');
  data.targetId = assertNonEmptyString(body.targetId, 'targetId');
  data.relationType = assertEnum(body.relationType, ENTITY_LINK_RELATIONS, 'relationType');
  if (!data.sourceType || !data.targetType || !data.relationType) {
    throw new RfValidationError('sourceType, targetType and relationType must be valid enum values');
  }
  if (data.sourceType === data.targetType && data.sourceId === data.targetId) {
    throw new RfValidationError('An entity cannot link to itself');
  }
  data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

// --- Phase 4 enums ----------------------------------------------------------

export const MANUSCRIPT_SECTION_STATUSES = [
  'not_started', 'outline', 'draft', 'internal_review', 'revised', 'final',
];

export const REVIEW_SEVERITIES = ['minor', 'major', 'critical'];

export const REVIEW_STATUSES = ['open', 'in_progress', 'resolved', 'wont_fix'];

export const REVIEW_SOURCES = ['self_review', 'advisor', 'coauthor', 'internal_review', 'other'];

export const SUBMISSION_PROFILE_STATUSES = ['preparing', 'submission_ready', 'submitted', 'withdrawn'];

export const SUBMISSION_ITEM_STATUSES = ['todo', 'in_progress', 'done', 'waived'];

export const SUBMISSION_CATEGORIES = ['paper', 'experiments', 'artifacts', 'portal'];

// Default manuscript section template. discussion/appendix are optional.
export const MANUSCRIPT_DEFAULT_SECTIONS = [
  { key: 'abstract', title: 'Abstract', optional: false },
  { key: 'introduction', title: 'Introduction', optional: false },
  { key: 'related_work', title: 'Related Work', optional: false },
  { key: 'method', title: 'Method', optional: false },
  { key: 'experiments', title: 'Experiments', optional: false },
  { key: 'discussion', title: 'Discussion', optional: true },
  { key: 'conclusion', title: 'Conclusion', optional: false },
  { key: 'references', title: 'References', optional: false },
  { key: 'appendix', title: 'Appendix / Supplementary', optional: true },
];

// Default submission checklist template (PRODUCT_SPEC §19). Every item is
// editable/waivable by the user; required flags are advisory defaults.
export const SUBMISSION_DEFAULT_ITEMS = [
  { category: 'paper', title: 'PDF compiles', required: true },
  { category: 'paper', title: 'Page limit checked', required: true },
  { category: 'paper', title: 'Anonymous requirements checked', required: true },
  { category: 'paper', title: 'References checked', required: true },
  { category: 'paper', title: 'Figure readability checked', required: true },
  { category: 'experiments', title: 'Main results complete', required: true },
  { category: 'experiments', title: 'Required ablations complete', required: true },
  { category: 'experiments', title: 'Statistical reporting complete', required: true },
  { category: 'experiments', title: 'Frozen result snapshot exists', required: true },
  { category: 'artifacts', title: 'Supplementary prepared', required: true },
  { category: 'artifacts', title: 'Code snapshot prepared', required: false },
  { category: 'artifacts', title: 'Config snapshot prepared', required: true },
  { category: 'artifacts', title: 'Seeds/reproducibility record prepared', required: true },
  { category: 'portal', title: 'Title entered', required: true },
  { category: 'portal', title: 'Abstract entered', required: true },
  { category: 'portal', title: 'Authors entered', required: true },
  { category: 'portal', title: 'Conflicts/topics completed', required: true },
  { category: 'portal', title: 'Metadata completed', required: true },
  { category: 'portal', title: 'Final PDF uploaded', required: true },
];

// --- Phase 4 validation helpers ---------------------------------------------

export const validateCreateManuscriptSection = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  data.title = assertNonEmptyString(body.title, 'title');
  data.sectionKey = body.sectionKey ? assertSlug(body.sectionKey, 'sectionKey') : slugify(body.title);
  data.status = assertEnum(body.status, MANUSCRIPT_SECTION_STATUSES, 'status') || 'not_started';
  data.isOptional = body.isOptional === undefined ? false : Boolean(body.isOptional);
  data.filePath = assertOptionalString(body.filePath, 'filePath');
  data.notes = assertOptionalString(body.notes, 'notes');
  data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateUpdateManuscriptSection = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  if (body.title !== undefined) data.title = assertNonEmptyString(body.title, 'title');
  if (body.status !== undefined) data.status = assertEnum(body.status, MANUSCRIPT_SECTION_STATUSES, 'status');
  if (body.progress !== undefined) {
    const value = Number(body.progress);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RfValidationError('Field "progress" must be a number between 0 and 1');
    }
    data.progress = value;
  }
  if (body.isOptional !== undefined) data.isOptional = Boolean(body.isOptional);
  if (body.filePath !== undefined) data.filePath = assertOptionalString(body.filePath, 'filePath');
  if (body.notes !== undefined) data.notes = assertOptionalString(body.notes, 'notes');
  if (body.metadata !== undefined) data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateCreateFreeze = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  data.gitCommit = assertOptionalString(body.gitCommit, 'gitCommit');
  data.gitBranch = assertOptionalString(body.gitBranch, 'gitBranch');
  data.resultVersion = assertOptionalString(body.resultVersion, 'resultVersion');
  data.datasetVersion = assertOptionalString(body.datasetVersion, 'datasetVersion');
  data.configVersion = assertOptionalString(body.configVersion, 'configVersion');
  data.notes = assertOptionalString(body.notes, 'notes');
  data.overrideReason = assertOptionalString(body.overrideReason, 'overrideReason');
  data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateCreateReviewComment = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  data.title = assertNonEmptyString(body.title, 'title');
  data.body = assertOptionalString(body.body, 'body');
  data.severity = assertEnum(body.severity, REVIEW_SEVERITIES, 'severity') || 'minor';
  data.status = assertEnum(body.status, REVIEW_STATUSES, 'status') || 'open';
  data.source = assertEnum(body.source, REVIEW_SOURCES, 'source') || 'self_review';
  data.authorName = assertOptionalString(body.authorName, 'authorName');
  data.dueDate = assertOptionalString(body.dueDate, 'dueDate');
  data.manuscriptSectionId = assertOptionalString(body.manuscriptSectionId, 'manuscriptSectionId');
  data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateUpdateReviewComment = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  if (body.title !== undefined) data.title = assertNonEmptyString(body.title, 'title');
  if (body.body !== undefined) data.body = assertOptionalString(body.body, 'body');
  if (body.severity !== undefined) data.severity = assertEnum(body.severity, REVIEW_SEVERITIES, 'severity');
  if (body.status !== undefined) data.status = assertEnum(body.status, REVIEW_STATUSES, 'status');
  if (body.source !== undefined) data.source = assertEnum(body.source, REVIEW_SOURCES, 'source');
  if (body.authorName !== undefined) data.authorName = assertOptionalString(body.authorName, 'authorName');
  if (body.dueDate !== undefined) data.dueDate = assertOptionalString(body.dueDate, 'dueDate');
  if (body.manuscriptSectionId !== undefined) data.manuscriptSectionId = assertOptionalString(body.manuscriptSectionId, 'manuscriptSectionId');
  if (body.metadata !== undefined) data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateCreateSubmissionProfile = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  data.venue = assertNonEmptyString(body.venue, 'venue');
  data.track = assertOptionalString(body.track, 'track');
  data.deadline = assertOptionalString(body.deadline, 'deadline');
  data.deadlineTimezone = assertOptionalString(body.deadlineTimezone, 'deadlineTimezone');
  data.pageLimit = assertOptionalInt(body.pageLimit, 'pageLimit');
  data.anonymous = body.anonymous === undefined ? false : Boolean(body.anonymous);
  data.submissionUrl = assertOptionalString(body.submissionUrl, 'submissionUrl');
  data.notes = assertOptionalString(body.notes, 'notes');
  data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateUpdateSubmissionProfile = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  if (body.venue !== undefined) data.venue = assertNonEmptyString(body.venue, 'venue');
  if (body.track !== undefined) data.track = assertOptionalString(body.track, 'track');
  if (body.deadline !== undefined) data.deadline = assertOptionalString(body.deadline, 'deadline');
  if (body.deadlineTimezone !== undefined) data.deadlineTimezone = assertOptionalString(body.deadlineTimezone, 'deadlineTimezone');
  if (body.pageLimit !== undefined) data.pageLimit = assertOptionalInt(body.pageLimit, 'pageLimit');
  if (body.anonymous !== undefined) data.anonymous = Boolean(body.anonymous);
  if (body.submissionUrl !== undefined) data.submissionUrl = assertOptionalString(body.submissionUrl, 'submissionUrl');
  if (body.notes !== undefined) data.notes = assertOptionalString(body.notes, 'notes');
  if (body.metadata !== undefined) data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateUpdateSubmissionItem = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  const data = {};
  if (body.title !== undefined) data.title = assertNonEmptyString(body.title, 'title');
  if (body.category !== undefined) data.category = assertEnum(body.category, SUBMISSION_CATEGORIES, 'category');
  if (body.required !== undefined) data.required = Boolean(body.required);
  if (body.status !== undefined) data.status = assertEnum(body.status, SUBMISSION_ITEM_STATUSES, 'status');
  if (body.dueDate !== undefined) data.dueDate = assertOptionalString(body.dueDate, 'dueDate');
  if (body.notes !== undefined) data.notes = assertOptionalString(body.notes, 'notes');
  if (body.artifactPath !== undefined) data.artifactPath = assertOptionalString(body.artifactPath, 'artifactPath');
  if (body.metadata !== undefined) data.metadata = assertOptionalObject(body.metadata, 'metadata');
  return data;
};

export const validateMarkSubmitted = (body) => {
  if (!isPlainObject(body)) throw new RfValidationError('Request body must be an object');
  if (body.confirmation !== true) {
    throw new RfValidationError('Field "confirmation" must be true to mark a paper as submitted');
  }
  const data = {};
  data.confirmation = true; // passed through so the service layer can enforce it too
  data.finalPaperPath = assertOptionalString(body.finalPaperPath, 'finalPaperPath');
  data.externalSubmissionId = assertOptionalString(body.externalSubmissionId, 'externalSubmissionId');
  return data;
};

// --- small helpers used above -------------------------------------------------

const assertSlug = (value, field) => {
  if (!/^[a-z0-9_]+$/.test(value)) {
    throw new RfValidationError(`Field "${field}" must be a lowercase slug (a-z0-9_)`);
  }
  return value;
};

const slugify = (value) => String(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 64) || 'section';
