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
