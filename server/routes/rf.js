// ResearchFlow REST API — thin routing layer under /api/rf/*.
// All endpoints reuse the standard authenticateToken middleware (mounted in
// server/index.js). Business logic lives in server/rf/* — this file only wires
// HTTP to the service and maps errors to status codes.

import express from 'express';
import { db } from '../database/db.js';
import { createResearchFlowServiceFor } from '../rf/index.js';
import { RfError } from '../rf/errors.js';
import * as validate from '../rf/validation.js';

const router = express.Router();
const service = createResearchFlowServiceFor(db);

const asyncHandler = (handler) => (req, res) => {
  Promise.resolve(handler(req, res)).catch((error) => {
    console.error('[ERROR] ResearchFlow API:', error.message);
    const status = error instanceof RfError ? error.status : 500;
    const code = error instanceof RfError ? error.code : 'RF_INTERNAL';
    res.status(status).json({ success: false, error: error.message, code });
  });
};

// --- Projects ---------------------------------------------------------------

router.get('/projects', asyncHandler(async (req, res) => {
  const data = service.listProjects(req.user.id, {
    includeArchived: req.query.includeArchived === 'true',
  });
  res.json({ success: true, data });
}));

router.post('/projects', asyncHandler(async (req, res) => {
  const input = validate.validateCreateProject(req.body);
  const data = service.createProject(req.user.id, input);
  res.status(201).json({ success: true, data });
}));

router.get('/projects/:id', asyncHandler(async (req, res) => {
  const data = service.getProject(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.patch('/projects/:id', asyncHandler(async (req, res) => {
  const fields = validate.validateUpdateProject(req.body);
  const data = service.updateProject(req.user.id, req.params.id, fields);
  res.json({ success: true, data });
}));

router.delete('/projects/:id', asyncHandler(async (req, res) => {
  const data = service.archiveProject(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.post('/projects/:id/advance-stage', asyncHandler(async (req, res) => {
  const data = service.advanceStage(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

// --- Stages -----------------------------------------------------------------

router.get('/projects/:id/stages', asyncHandler(async (req, res) => {
  const data = service.listStages(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.patch('/stages/:id', asyncHandler(async (req, res) => {
  const fields = validate.validateStagePatch(req.body);
  const data = service.updateStage(req.user.id, req.params.id, fields);
  res.json({ success: true, data });
}));

router.post('/stages/:id/complete', asyncHandler(async (req, res) => {
  const data = service.completeStage(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

// --- Gates ------------------------------------------------------------------

router.get('/projects/:id/gates', asyncHandler(async (req, res) => {
  const data = service.listGates(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.patch('/gates/:id', asyncHandler(async (req, res) => {
  const fields = validate.validateGatePatch(req.body);
  const data = service.patchGate(req.user.id, req.params.id, fields);
  res.json({ success: true, data });
}));

// --- Tasks ------------------------------------------------------------------

router.get('/projects/:id/tasks', asyncHandler(async (req, res) => {
  const data = service.listTasks(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.post('/projects/:id/tasks', asyncHandler(async (req, res) => {
  const input = validate.validateCreateTask(req.body);
  const data = service.createTask(req.user.id, req.params.id, input);
  res.status(201).json({ success: true, data });
}));

router.get('/tasks/:id', asyncHandler(async (req, res) => {
  const data = service.getTask(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.patch('/tasks/:id', asyncHandler(async (req, res) => {
  const fields = validate.validateUpdateTask(req.body);
  const data = service.updateTask(req.user.id, req.params.id, fields);
  res.json({ success: true, data });
}));

router.delete('/tasks/:id', asyncHandler(async (req, res) => {
  const data = service.deleteTask(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

// --- Task dependencies ------------------------------------------------------

router.get('/projects/:id/task-dependencies', asyncHandler(async (req, res) => {
  const data = service.listDependencies(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.post('/tasks/:id/dependencies', asyncHandler(async (req, res) => {
  const input = validate.validateCreateDependency(req.body);
  const data = service.createDependency(req.user.id, req.params.id, input);
  res.status(201).json({ success: true, data });
}));

router.delete('/task-dependencies/:id', asyncHandler(async (req, res) => {
  const data = service.deleteDependency(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

// --- Task links (polymorphic) ----------------------------------------------

router.get('/projects/:id/task-links', asyncHandler(async (req, res) => {
  const data = service.listTaskLinks(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.post('/tasks/:id/links', asyncHandler(async (req, res) => {
  const input = validate.validateCreateTaskLink(req.body);
  const data = service.createTaskLink(req.user.id, req.params.id, input);
  res.status(201).json({ success: true, data });
}));

router.delete('/task-links/:id', asyncHandler(async (req, res) => {
  const data = service.deleteTaskLink(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

// --- Activity ---------------------------------------------------------------

router.get('/projects/:id/activity', asyncHandler(async (req, res) => {
  const query = validate.validateActivityQuery(req.query);
  const data = service.listActivity(req.user.id, req.params.id, query);
  res.json({ success: true, data });
}));

export default router;
