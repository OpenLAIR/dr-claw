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

// Dashboard aggregate (Phase 2): project + lifecycle + next critical action + health.
router.get('/projects/:id/dashboard', asyncHandler(async (req, res) => {
  const data = service.getProjectDashboard(req.user.id, req.params.id);
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

// --- Phase 3: Experiments ---------------------------------------------------

router.get('/projects/:projectId/experiments', asyncHandler(async (req, res) => {
  const data = service.listExperiments(req.user.id, req.params.projectId);
  res.json({ success: true, data });
}));

router.post('/projects/:projectId/experiments', asyncHandler(async (req, res) => {
  const input = validate.validateCreateExperiment(req.body);
  const data = service.createExperiment(req.user.id, req.params.projectId, input);
  res.status(201).json({ success: true, data });
}));

router.get('/experiments/:id', asyncHandler(async (req, res) => {
  const data = service.getExperiment(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.patch('/experiments/:id', asyncHandler(async (req, res) => {
  const fields = validate.validateUpdateExperiment(req.body);
  const data = service.updateExperiment(req.user.id, req.params.id, fields);
  res.json({ success: true, data });
}));

router.delete('/experiments/:id', asyncHandler(async (req, res) => {
  const data = service.deleteExperiment(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.post('/experiments/:id/runs', asyncHandler(async (req, res) => {
  const input = validate.validateCreateRun(req.body);
  const data = service.createRun(req.user.id, req.params.id, input);
  res.status(201).json({ success: true, data });
}));

router.patch('/experiment-runs/:id', asyncHandler(async (req, res) => {
  const fields = validate.validateUpdateRun(req.body);
  const data = service.updateRun(req.user.id, req.params.id, fields);
  res.json({ success: true, data });
}));

router.delete('/experiment-runs/:id', asyncHandler(async (req, res) => {
  const data = service.deleteRun(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

// --- Phase 3: Claims / Evidence ---------------------------------------------

router.get('/projects/:projectId/claims', asyncHandler(async (req, res) => {
  const data = service.listClaims(req.user.id, req.params.projectId);
  res.json({ success: true, data });
}));

router.post('/projects/:projectId/claims', asyncHandler(async (req, res) => {
  const input = validate.validateCreateClaim(req.body);
  const data = service.createClaim(req.user.id, req.params.projectId, input);
  res.status(201).json({ success: true, data });
}));

router.get('/claims/:id', asyncHandler(async (req, res) => {
  const data = service.getClaim(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.patch('/claims/:id', asyncHandler(async (req, res) => {
  const fields = validate.validateUpdateClaim(req.body);
  const data = service.updateClaim(req.user.id, req.params.id, fields);
  res.json({ success: true, data });
}));

router.delete('/claims/:id', asyncHandler(async (req, res) => {
  const data = service.deleteClaim(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.get('/projects/:projectId/evidence', asyncHandler(async (req, res) => {
  const data = service.listEvidence(req.user.id, req.params.projectId);
  res.json({ success: true, data });
}));

router.post('/projects/:projectId/evidence', asyncHandler(async (req, res) => {
  const input = validate.validateCreateEvidence(req.body);
  const data = service.createEvidence(req.user.id, req.params.projectId, input);
  res.status(201).json({ success: true, data });
}));

router.get('/evidence/:id', asyncHandler(async (req, res) => {
  const data = service.getEvidence(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.patch('/evidence/:id', asyncHandler(async (req, res) => {
  const fields = validate.validateUpdateEvidence(req.body);
  const data = service.updateEvidence(req.user.id, req.params.id, fields);
  res.json({ success: true, data });
}));

router.delete('/evidence/:id', asyncHandler(async (req, res) => {
  const data = service.deleteEvidence(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.post('/claim-evidence', asyncHandler(async (req, res) => {
  const input = validate.validateClaimEvidence(req.body);
  const data = service.linkClaimEvidence(req.user.id, input);
  res.status(201).json({ success: true, data });
}));

router.delete('/claim-evidence/:id', asyncHandler(async (req, res) => {
  const data = service.unlinkClaimEvidence(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.get('/projects/:projectId/evidence-health', asyncHandler(async (req, res) => {
  const data = service.getEvidenceHealth(req.user.id, req.params.projectId);
  res.json({ success: true, data });
}));

// --- Phase 3: Decisions -----------------------------------------------------

router.get('/projects/:projectId/decisions', asyncHandler(async (req, res) => {
  const data = service.listDecisions(req.user.id, req.params.projectId);
  res.json({ success: true, data });
}));

router.post('/projects/:projectId/decisions', asyncHandler(async (req, res) => {
  const input = validate.validateCreateDecision(req.body);
  const data = service.createDecision(req.user.id, req.params.projectId, input);
  res.status(201).json({ success: true, data });
}));

router.get('/decisions/:id', asyncHandler(async (req, res) => {
  const data = service.getDecision(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.patch('/decisions/:id', asyncHandler(async (req, res) => {
  const fields = validate.validateUpdateDecision(req.body);
  const data = service.updateDecision(req.user.id, req.params.id, fields);
  res.json({ success: true, data });
}));

router.delete('/decisions/:id', asyncHandler(async (req, res) => {
  const data = service.deleteDecision(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

// --- Phase 3: Literature ----------------------------------------------------

router.get('/projects/:projectId/literature', asyncHandler(async (req, res) => {
  const data = service.listLiterature(req.user.id, req.params.projectId);
  res.json({ success: true, data });
}));

router.post('/projects/:projectId/literature', asyncHandler(async (req, res) => {
  const input = validate.validateCreateLiterature(req.body);
  const data = service.createLiterature(req.user.id, req.params.projectId, input);
  res.status(201).json({ success: true, data });
}));

router.get('/literature/:id', asyncHandler(async (req, res) => {
  const data = service.getLiterature(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.patch('/literature/:id', asyncHandler(async (req, res) => {
  const fields = validate.validateUpdateLiterature(req.body);
  const data = service.updateLiterature(req.user.id, req.params.id, fields);
  res.json({ success: true, data });
}));

router.delete('/literature/:id', asyncHandler(async (req, res) => {
  const data = service.deleteLiterature(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

// --- Phase 3: Figures / Tables ----------------------------------------------

router.get('/projects/:projectId/figures-tables', asyncHandler(async (req, res) => {
  const data = service.listFiguresTables(req.user.id, req.params.projectId);
  res.json({ success: true, data });
}));

router.post('/projects/:projectId/figures-tables', asyncHandler(async (req, res) => {
  const input = validate.validateCreateFigureTable(req.body);
  const data = service.createFigureTable(req.user.id, req.params.projectId, input);
  res.status(201).json({ success: true, data });
}));

router.get('/figures-tables/:id', asyncHandler(async (req, res) => {
  const data = service.getFigureTable(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.patch('/figures-tables/:id', asyncHandler(async (req, res) => {
  const fields = validate.validateUpdateFigureTable(req.body);
  const data = service.updateFigureTable(req.user.id, req.params.id, fields);
  res.json({ success: true, data });
}));

router.delete('/figures-tables/:id', asyncHandler(async (req, res) => {
  const data = service.deleteFigureTable(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

// --- Phase 3: Entity links (provenance) -------------------------------------

router.post('/entity-links', asyncHandler(async (req, res) => {
  const input = validate.validateEntityLink(req.body);
  const data = service.createEntityLink(req.user.id, input);
  res.status(201).json({ success: true, data });
}));

router.delete('/entity-links/:id', asyncHandler(async (req, res) => {
  const data = service.deleteEntityLink(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.get('/projects/:projectId/entity-links', asyncHandler(async (req, res) => {
  const data = service.listEntityLinks(req.user.id, req.params.projectId);
  res.json({ success: true, data });
}));

// --- Phase 4: Manuscript ----------------------------------------------------

router.get('/projects/:projectId/manuscript', asyncHandler(async (req, res) => {
  const data = service.getManuscript(req.user.id, req.params.projectId);
  res.json({ success: true, data });
}));

router.post('/projects/:projectId/manuscript/initialize', asyncHandler(async (req, res) => {
  const data = service.initializeManuscript(req.user.id, req.params.projectId);
  res.status(201).json({ success: true, data });
}));

router.patch('/manuscript-sections/:id', asyncHandler(async (req, res) => {
  const fields = validate.validateUpdateManuscriptSection(req.body);
  const data = service.updateManuscriptSection(req.user.id, req.params.id, fields);
  res.json({ success: true, data });
}));

router.delete('/manuscript-sections/:id', asyncHandler(async (req, res) => {
  const data = service.deleteManuscriptSection(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

// --- Phase 4: Results Freeze ------------------------------------------------

router.get('/projects/:projectId/results-freeze/readiness', asyncHandler(async (req, res) => {
  const data = service.getFreezeReadiness(req.user.id, req.params.projectId);
  res.json({ success: true, data });
}));

router.get('/projects/:projectId/results-freezes', asyncHandler(async (req, res) => {
  const data = service.listResultFreezes(req.user.id, req.params.projectId);
  res.json({ success: true, data });
}));

router.post('/projects/:projectId/results-freezes', asyncHandler(async (req, res) => {
  const input = validate.validateCreateFreeze(req.body);
  const data = service.createResultsFreeze(req.user.id, req.params.projectId, input);
  res.status(201).json({ success: true, data });
}));

// --- Phase 4: Review Comments -----------------------------------------------

router.get('/projects/:projectId/review-comments', asyncHandler(async (req, res) => {
  const data = service.listReviewComments(req.user.id, req.params.projectId);
  res.json({ success: true, data });
}));

router.post('/projects/:projectId/review-comments', asyncHandler(async (req, res) => {
  const input = validate.validateCreateReviewComment(req.body);
  const data = service.createReviewComment(req.user.id, req.params.projectId, input);
  res.status(201).json({ success: true, data });
}));

router.patch('/review-comments/:id', asyncHandler(async (req, res) => {
  const fields = validate.validateUpdateReviewComment(req.body);
  const data = service.updateReviewComment(req.user.id, req.params.id, fields);
  res.json({ success: true, data });
}));

router.delete('/review-comments/:id', asyncHandler(async (req, res) => {
  const data = service.deleteReviewComment(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

// --- Phase 4: Submission ----------------------------------------------------

router.get('/projects/:projectId/submissions', asyncHandler(async (req, res) => {
  const data = service.listSubmissionProfiles(req.user.id, req.params.projectId);
  res.json({ success: true, data });
}));

router.post('/projects/:projectId/submissions', asyncHandler(async (req, res) => {
  const input = validate.validateCreateSubmissionProfile(req.body);
  const data = service.createSubmissionProfile(req.user.id, req.params.projectId, input);
  res.status(201).json({ success: true, data });
}));

router.get('/submissions/:id', asyncHandler(async (req, res) => {
  const data = service.getSubmissionProfile(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.patch('/submissions/:id', asyncHandler(async (req, res) => {
  const fields = validate.validateUpdateSubmissionProfile(req.body);
  const data = service.updateSubmissionProfile(req.user.id, req.params.id, fields);
  res.json({ success: true, data });
}));

router.get('/submissions/:id/readiness', asyncHandler(async (req, res) => {
  const data = service.getSubmissionReadiness(req.user.id, req.params.id);
  res.json({ success: true, data });
}));

router.patch('/submission-items/:id', asyncHandler(async (req, res) => {
  const fields = validate.validateUpdateSubmissionItem(req.body);
  const data = service.updateSubmissionItem(req.user.id, req.params.id, fields);
  res.json({ success: true, data });
}));

router.post('/submissions/:id/mark-submitted', asyncHandler(async (req, res) => {
  const input = validate.validateMarkSubmitted(req.body);
  const data = service.markSubmitted(req.user.id, req.params.id, input);
  res.json({ success: true, data });
}));

// --- Phase 5: diagnostics / data safety -------------------------------------

router.get('/info', asyncHandler(async (req, res) => {
  res.json({ success: true, data: service.getAppInfo() });
}));

router.post('/backup', asyncHandler(async (req, res) => {
  const data = await service.createBackup();
  res.status(201).json({ success: true, data });
}));

router.get('/backups', asyncHandler(async (req, res) => {
  res.json({ success: true, data: service.getBackups() });
}));

router.post('/backup/restore', asyncHandler(async (req, res) => {
  const { backupFile } = req.body || {};
  const data = await service.restoreBackup({ backupFile });
  res.json({ success: true, data });
}));

router.get('/projects/:projectId/export', asyncHandler(async (req, res) => {
  const data = service.exportProject(req.user.id, req.params.projectId);
  res.download(data.path, data.file, (error) => {
    if (error && !res.headersSent) {
      res.status(500).json({ success: false, error: error.message, code: 'RF_EXPORT_FAILED' });
    }
  });
}));

// --- Phase 5: workspace / WSL ----------------------------------------------

router.get('/projects/:projectId/workspace', asyncHandler(async (req, res) => {
  res.json({ success: true, data: service.getWorkspaceInfo(req.user.id, req.params.projectId) });
}));

router.put('/projects/:projectId/workspace', asyncHandler(async (req, res) => {
  const fields = validate.validateWorkspaceUpdate(req.body);
  const data = service.updateProjectWorkspace(req.user.id, req.params.projectId, fields);
  res.json({ success: true, data });
}));

router.post('/projects/:projectId/workspace/validate', asyncHandler(async (req, res) => {
  const data = await service.validateWorkspace(req.user.id, req.params.projectId);
  res.json({ success: true, data });
}));

router.post('/projects/:projectId/workspace/open-terminal', asyncHandler(async (req, res) => {
  const data = await service.openWorkspaceTerminal(req.user.id, req.params.projectId);
  res.json({ success: true, data });
}));

export default router;
