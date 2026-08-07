import { IS_PLATFORM } from "../constants/config";

// Utility function for authenticated API calls
export const authenticatedFetch = (url, options = {}) => {
  const token = localStorage.getItem('auth-token');

  const defaultHeaders = {};

  // Only set Content-Type for non-FormData requests
  if (!(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  if (!IS_PLATFORM && token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  return fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });
};

// API endpoints
export const api = {
  // Auth endpoints (no token required)
  auth: {
    status: () => fetch('/api/auth/status'),
    login: (username, password) => fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    register: (username, password, notificationEmail, resetExisting = false) => fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, notificationEmail, resetExisting }),
    }),
    user: () => authenticatedFetch('/api/auth/user'),
    logout: () => authenticatedFetch('/api/auth/logout', { method: 'POST' }),
  },

  // Protected endpoints
  // config endpoint removed - no longer needed (frontend uses window.location)
  projects: () => authenticatedFetch('/api/projects'),
  trashedProjects: () => authenticatedFetch('/api/projects/trash'),
  settings: {
    autoResearchEmail: () => authenticatedFetch('/api/settings/auto-research-email'),
    updateAutoResearchEmail: (senderEmail) =>
      authenticatedFetch('/api/settings/auto-research-email', {
        method: 'PUT',
        body: JSON.stringify({ senderEmail }),
      }),
    autoResearchResendKey: () => authenticatedFetch('/api/settings/auto-research-resend-key'),
    updateAutoResearchResendKey: (apiKey) =>
      authenticatedFetch('/api/settings/auto-research-resend-key', {
        method: 'PUT',
        body: JSON.stringify({ apiKey }),
      }),
  },
  projectTokenUsageSummary: (projects) =>
    authenticatedFetch('/api/projects/token-usage-summary', {
      method: 'POST',
      body: JSON.stringify({
        projects: (projects || []).map((project) => ({
          name: project.name,
          fullPath: project.fullPath,
        })),
      }),
    }),
  sessions: (projectName, limit = 5, offset = 0) =>
    authenticatedFetch(`/api/projects/${projectName}/sessions?limit=${limit}&offset=${offset}`),
  projectTags: (projectName, tagType = null) => {
    const params = new URLSearchParams();
    if (tagType) {
      params.append('tagType', tagType);
    }
    const query = params.toString();
    return authenticatedFetch(`/api/projects/${projectName}/tags${query ? `?${query}` : ''}`);
  },
  sessionTags: (projectName, sessionId) =>
    authenticatedFetch(`/api/projects/${projectName}/sessions/${sessionId}/tags`),
  updateSessionTags: (projectName, sessionId, tagIds) =>
    authenticatedFetch(`/api/projects/${projectName}/sessions/${sessionId}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tagIds }),
    }),
  sessionMessages: (projectName, sessionId, limit = null, offset = 0, provider = 'claude') => {
    const params = new URLSearchParams();
    if (limit !== null) {
      params.append('limit', limit);
      params.append('offset', offset);
    }
    params.append('provider', provider);
    const queryString = params.toString();

    // Route to the correct endpoint based on provider
    let url;
    if (provider === 'codex') {
      url = `/api/codex/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    } else if (provider === 'cursor') {
      url = `/api/cursor/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    } else {
      url = `/api/projects/${projectName}/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    }
    return authenticatedFetch(url);
  },
  sessionContextReview: (projectName, sessionId) =>
    authenticatedFetch(`/api/projects/${projectName}/sessions/${sessionId}/context-review`),
  updateSessionContextReview: (projectName, sessionId, reviews) =>
    authenticatedFetch(`/api/projects/${projectName}/sessions/${sessionId}/context-review`, {
      method: 'PUT',
      body: JSON.stringify({ reviews }),
    }),
  renameProject: (projectName, displayName) =>
    authenticatedFetch(`/api/projects/${projectName}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    }),
  renameSession: (projectName, sessionId, summary, provider = 'claude') =>
    authenticatedFetch(`/api/projects/${projectName}/sessions/${sessionId}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ summary, provider }),
    }),
  deleteSession: (projectName, sessionId, provider = 'claude') =>
    authenticatedFetch(`/api/projects/${projectName}/sessions/${sessionId}?provider=${provider}`, {
      method: 'DELETE',
    }),
  deleteCodexSession: (sessionId) =>
    authenticatedFetch(`/api/codex/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  deleteProject: (projectName, force = false) =>
    authenticatedFetch(`/api/projects/${projectName}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
    }),
  restoreProject: (projectName) =>
    authenticatedFetch(`/api/projects/trash/${projectName}/restore`, {
      method: 'POST',
    }),
  deleteTrashedProject: (projectName, mode = 'logical') =>
    authenticatedFetch(`/api/projects/trash/${projectName}?mode=${encodeURIComponent(mode)}`, {
      method: 'DELETE',
    }),
  createProject: (path) =>
    authenticatedFetch('/api/projects/create', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  createWorkspace: (workspaceData) =>
    authenticatedFetch('/api/projects/create-workspace', {
      method: 'POST',
      body: JSON.stringify(workspaceData),
    }),
  readFile: (projectName, filePath, options = {}) =>
    authenticatedFetch(`/api/projects/${projectName}/file?filePath=${encodeURIComponent(filePath)}`, options),
  resolveSkill: (skillName, workingDir) =>
    authenticatedFetch(`/api/skills/resolve?name=${encodeURIComponent(skillName)}&workingDir=${encodeURIComponent(workingDir || '')}`),
  /** Fetch binary file content (e.g. PDF) as Blob. absolutePath must be the full filesystem path. */
  getFileContentBlob: (projectName, absolutePath, options = {}) =>
    authenticatedFetch(`/api/projects/${projectName}/files/content?path=${encodeURIComponent(absolutePath)}`, options).then((r) => {
      if (!r.ok) throw new Error(r.status === 404 ? 'Not found' : `HTTP ${r.status}`);
      return r.blob();
    }),
  saveFile: (projectName, filePath, content) =>
    authenticatedFetch(`/api/projects/${projectName}/file`, {
      method: 'PUT',
      body: JSON.stringify({ filePath, content }),
    }),
  deleteFile: (projectName, filePath) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/file`, {
      method: 'DELETE',
      body: JSON.stringify({ filePath }),
    }),
  getFiles: (projectName, options = {}) => {
    const { path, maxDepth, showHidden, metadata, ...fetchOptions } = options || {};
    const params = new URLSearchParams();

    if (typeof path === 'string' && path) {
      params.append('path', path);
    }
    if (maxDepth !== undefined && maxDepth !== null) {
      params.append('maxDepth', String(maxDepth));
    }
    if (showHidden !== undefined && showHidden !== null) {
      params.append('showHidden', String(showHidden));
    }
    if (metadata !== undefined && metadata !== null) {
      params.append('metadata', String(metadata));
    }

    const query = params.toString();
    return authenticatedFetch(
      `/api/projects/${projectName}/files${query ? `?${query}` : ''}`,
      fetchOptions
    );
  },
  transcribe: (formData) =>
    authenticatedFetch('/api/transcribe', {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    }),

  // TaskMaster endpoints
  taskmaster: {
    detect: (projectName) =>
      authenticatedFetch(`/api/taskmaster/detect/${encodeURIComponent(projectName)}`),

    // Initialize TaskMaster in a project
    init: (projectName) =>
      authenticatedFetch(`/api/taskmaster/init/${projectName}`, {
        method: 'POST',
      }),

    // Add a new task
    addTask: (projectName, { prompt, title, description, priority, dependencies, stage, insertAfterId }) =>
      authenticatedFetch(`/api/taskmaster/add-task/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ prompt, title, description, priority, dependencies, stage, insertAfterId }),
      }),

    // Parse PRD to generate tasks
    parsePRD: (projectName, { fileName, numTasks, append }) =>
      authenticatedFetch(`/api/taskmaster/parse-prd/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ fileName, numTasks, append }),
      }),

    // Get available PRD templates
    getTemplates: () =>
      authenticatedFetch('/api/taskmaster/prd-templates'),

    // Apply a PRD template
    applyTemplate: (projectName, { templateId, fileName, customizations }) =>
      authenticatedFetch(`/api/taskmaster/apply-template/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ templateId, fileName, customizations }),
      }),

    // Update a task
    updateTask: (projectName, taskId, updates) =>
      authenticatedFetch(`/api/taskmaster/update-task/${projectName}/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      }),

    // Delete a task
    deleteTask: (projectName, taskId) =>
      authenticatedFetch(`/api/taskmaster/delete-task/${projectName}/${taskId}`, {
        method: 'DELETE',
      }),
  },

  autoResearch: {
    status: (projectName) =>
      authenticatedFetch(`/api/auto-research/${encodeURIComponent(projectName)}/status`),
    start: (projectName, { provider, model, permissionMode } = {}) =>
      authenticatedFetch(`/api/auto-research/${encodeURIComponent(projectName)}/start`, {
        method: 'POST',
        body: JSON.stringify({
          provider,
          model,
          permissionMode,
        }),
      }),
    cancel: (projectName) =>
      authenticatedFetch(`/api/auto-research/${encodeURIComponent(projectName)}/cancel`, {
        method: 'POST',
      }),
  },

  // Workspace root
  getWorkspaceRoot: () => authenticatedFetch('/api/projects/workspace-root'),
  setWorkspaceRoot: (path) =>
    authenticatedFetch('/api/projects/workspace-root', {
      method: 'PUT',
      body: JSON.stringify({ path }),
    }),

  // Browse filesystem for project suggestions
  browseFilesystem: (dirPath = null) => {
    const params = new URLSearchParams();
    if (dirPath) params.append('path', dirPath);

    return authenticatedFetch(`/api/browse-filesystem?${params}`);
  },

  createFolder: (folderPath) =>
    authenticatedFetch('/api/create-folder', {
      method: 'POST',
      body: JSON.stringify({ path: folderPath }),
    }),

  // User endpoints
  user: {
    profile: () => authenticatedFetch('/api/user/profile'),
    updateProfile: (notificationEmail) =>
      authenticatedFetch('/api/user/profile', {
        method: 'PUT',
        body: JSON.stringify({ notificationEmail }),
      }),
    gitConfig: () => authenticatedFetch('/api/user/git-config'),
    updateGitConfig: (gitName, gitEmail) =>
      authenticatedFetch('/api/user/git-config', {
        method: 'POST',
        body: JSON.stringify({ gitName, gitEmail }),
      }),
    onboardingStatus: () => authenticatedFetch('/api/user/onboarding-status'),
    completeOnboarding: () =>
      authenticatedFetch('/api/user/complete-onboarding', {
        method: 'POST',
      }),
  },

  // Global skills endpoints
  getGlobalSkills: () => authenticatedFetch('/api/skills'),
  readGlobalSkillFile: (filePath) =>
    authenticatedFetch(`/api/skills/file?filePath=${encodeURIComponent(filePath)}`),
  saveGlobalSkillFile: (filePath, content) =>
    authenticatedFetch('/api/skills/file', {
      method: 'PUT',
      body: JSON.stringify({ filePath, content }),
    }),
  uploadFiles: (projectName, formData) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/upload-files`, {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set multipart boundary
    }),
  validateSkillZip: (projectName, formData) =>
    authenticatedFetch(`/api/skills/${projectName}/validate-skill-zip`, {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set multipart boundary
    }),
  uploadSkill: (projectName, formData) =>
    authenticatedFetch(`/api/skills/${projectName}/upload-skill`, {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set multipart boundary
    }),
  scanLocalSkills: (dirPath) =>
    authenticatedFetch(`/api/skills/scan-local?path=${encodeURIComponent(dirPath)}`),
  importLocalSkills: (sourcePath, skillNames) =>
    authenticatedFetch('/api/skills/import-from-local', {
      method: 'POST',
      body: JSON.stringify({ sourcePath, skillNames }),
    }),
  deleteProjectSkill: (projectName, skillDirName) =>
    authenticatedFetch(`/api/skills/${encodeURIComponent(projectName)}/${encodeURIComponent(skillDirName)}`, {
      method: 'DELETE',
    }),
  deleteGlobalSkill: (dirPath) =>
    authenticatedFetch('/api/skills/global-skill', {
      method: 'DELETE',
      body: JSON.stringify({ dirPath }),
    }),

  // News dashboard endpoints
  news: {
    getSources: () => authenticatedFetch('/api/news/sources'),
    getConfig: (source = 'arxiv') => authenticatedFetch(`/api/news/config/${source}`),
    updateConfig: (source, config) =>
      authenticatedFetch(`/api/news/config/${source}`, {
        method: 'PUT',
        body: JSON.stringify(config),
      }),
    search: (source = 'arxiv') =>
      authenticatedFetch(`/api/news/search/${source}`, { method: 'POST' }),
    getResults: (source = 'arxiv') => authenticatedFetch(`/api/news/results/${source}`),
    /** Poll search progress logs for a source. */
    getLogs: (source) => authenticatedFetch(`/api/news/logs/${source}`),
    /** Trigger xhs login (returns JSON with success, nickname, logs). */
    xhsLogin: (options = {}) => authenticatedFetch('/api/news/xhs-login', {
      method: 'POST',
      body: JSON.stringify(options),
    }),
  },

  // References (literature library) endpoints
  references: {
    list: (params) => authenticatedFetch(`/api/references?${new URLSearchParams(params || {})}`),
    get: (id) => authenticatedFetch(`/api/references/${encodeURIComponent(id)}`),
    delete: (id) => authenticatedFetch(`/api/references/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    getPdf: (id) => authenticatedFetch(`/api/references/${encodeURIComponent(id)}/pdf`),
    syncZotero: ({ projectName, collectionKey, sourceIds } = {}) => authenticatedFetch('/api/references/sync/zotero', { method: 'POST', body: JSON.stringify({ projectName, collectionKey, sourceIds }) }),
    zoteroItems: (params) => {
      const qs = new URLSearchParams();
      if (params?.collectionKey) qs.set('collectionKey', params.collectionKey);
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.start) qs.set('start', String(params.start));
      return authenticatedFetch(`/api/references/zotero/items?${qs}`);
    },
    importBibtex: (formData) => authenticatedFetch('/api/references/import/bibtex', { method: 'POST', body: formData, headers: {} }),
    zoteroStatus: () => authenticatedFetch('/api/references/zotero/status'),
    zoteroCollections: () => authenticatedFetch('/api/references/zotero/collections'),
    projectRefs: (projectName) => authenticatedFetch(`/api/references/project/${encodeURIComponent(projectName)}`),
    linkToProject: (projectName, refId) => authenticatedFetch(`/api/references/project/${encodeURIComponent(projectName)}/${encodeURIComponent(refId)}`, { method: 'POST' }),
    unlinkFromProject: (projectName, refId) => authenticatedFetch(`/api/references/project/${encodeURIComponent(projectName)}/${encodeURIComponent(refId)}`, { method: 'DELETE' }),
    bulkDelete: (ids) => authenticatedFetch('/api/references/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
    tags: () => authenticatedFetch('/api/references/tags'),
  },

  // Generic GET method for any endpoint
  get: (endpoint) => authenticatedFetch(`/api${endpoint}`),

  // ResearchFlow domain (Phase 1 backend + Phase 2 dashboard/roadmap/tasks)
  rf: {
    listProjects: (includeArchived = false) =>
      authenticatedFetch(`/api/rf/projects${includeArchived ? '?includeArchived=true' : ''}`),
    createProject: (body) => authenticatedFetch('/api/rf/projects', { method: 'POST', body: JSON.stringify(body) }),
    getProject: (id) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(id)}`),
    getDashboard: (id) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(id)}/dashboard`),
    updateProject: (id, body) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    archiveProject: (id) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    advanceStage: (id) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(id)}/advance-stage`, { method: 'POST' }),
    listStages: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/stages`),
    updateStage: (stageId, body) => authenticatedFetch(`/api/rf/stages/${encodeURIComponent(stageId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    completeStage: (stageId) => authenticatedFetch(`/api/rf/stages/${encodeURIComponent(stageId)}/complete`, { method: 'POST' }),
    listGates: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/gates`),
    patchGate: (gateId, body) => authenticatedFetch(`/api/rf/gates/${encodeURIComponent(gateId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    listTasks: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/tasks`),
    createTask: (projectId, body) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/tasks`, { method: 'POST', body: JSON.stringify(body) }),
    getTask: (taskId) => authenticatedFetch(`/api/rf/tasks/${encodeURIComponent(taskId)}`),
    updateTask: (taskId, body) => authenticatedFetch(`/api/rf/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteTask: (taskId) => authenticatedFetch(`/api/rf/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' }),
    listDependencies: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/task-dependencies`),
    addDependency: (taskId, body) => authenticatedFetch(`/api/rf/tasks/${encodeURIComponent(taskId)}/dependencies`, { method: 'POST', body: JSON.stringify(body) }),
    removeDependency: (depId) => authenticatedFetch(`/api/rf/task-dependencies/${encodeURIComponent(depId)}`, { method: 'DELETE' }),
    listTaskLinks: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/task-links`),
    addTaskLink: (taskId, body) => authenticatedFetch(`/api/rf/tasks/${encodeURIComponent(taskId)}/links`, { method: 'POST', body: JSON.stringify(body) }),
    removeTaskLink: (linkId) => authenticatedFetch(`/api/rf/task-links/${encodeURIComponent(linkId)}`, { method: 'DELETE' }),
    listActivity: (projectId, limit = 50, offset = 0) =>
      authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/activity?limit=${limit}&offset=${offset}`),
    // Phase 3: Experiments
    listExperiments: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/experiments`),
    createExperiment: (projectId, body) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/experiments`, { method: 'POST', body: JSON.stringify(body) }),
    getExperiment: (id) => authenticatedFetch(`/api/rf/experiments/${encodeURIComponent(id)}`),
    updateExperiment: (id, body) => authenticatedFetch(`/api/rf/experiments/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteExperiment: (id) => authenticatedFetch(`/api/rf/experiments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    createRun: (experimentId, body) => authenticatedFetch(`/api/rf/experiments/${encodeURIComponent(experimentId)}/runs`, { method: 'POST', body: JSON.stringify(body) }),
    updateRun: (runId, body) => authenticatedFetch(`/api/rf/experiment-runs/${encodeURIComponent(runId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteRun: (runId) => authenticatedFetch(`/api/rf/experiment-runs/${encodeURIComponent(runId)}`, { method: 'DELETE' }),
    // Phase 3: Claims / Evidence
    listClaims: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/claims`),
    createClaim: (projectId, body) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/claims`, { method: 'POST', body: JSON.stringify(body) }),
    getClaim: (id) => authenticatedFetch(`/api/rf/claims/${encodeURIComponent(id)}`),
    updateClaim: (id, body) => authenticatedFetch(`/api/rf/claims/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteClaim: (id) => authenticatedFetch(`/api/rf/claims/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    listEvidence: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/evidence`),
    createEvidence: (projectId, body) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/evidence`, { method: 'POST', body: JSON.stringify(body) }),
    getEvidence: (id) => authenticatedFetch(`/api/rf/evidence/${encodeURIComponent(id)}`),
    updateEvidence: (id, body) => authenticatedFetch(`/api/rf/evidence/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteEvidence: (id) => authenticatedFetch(`/api/rf/evidence/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    linkClaimEvidence: (body) => authenticatedFetch('/api/rf/claim-evidence', { method: 'POST', body: JSON.stringify(body) }),
    unlinkClaimEvidence: (linkId) => authenticatedFetch(`/api/rf/claim-evidence/${encodeURIComponent(linkId)}`, { method: 'DELETE' }),
    getEvidenceHealth: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/evidence-health`),
    // Phase 3: Decisions
    listDecisions: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/decisions`),
    createDecision: (projectId, body) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/decisions`, { method: 'POST', body: JSON.stringify(body) }),
    getDecision: (id) => authenticatedFetch(`/api/rf/decisions/${encodeURIComponent(id)}`),
    updateDecision: (id, body) => authenticatedFetch(`/api/rf/decisions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteDecision: (id) => authenticatedFetch(`/api/rf/decisions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    // Phase 3: Literature
    listLiterature: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/literature`),
    createLiterature: (projectId, body) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/literature`, { method: 'POST', body: JSON.stringify(body) }),
    getLiterature: (id) => authenticatedFetch(`/api/rf/literature/${encodeURIComponent(id)}`),
    updateLiterature: (id, body) => authenticatedFetch(`/api/rf/literature/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteLiterature: (id) => authenticatedFetch(`/api/rf/literature/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    // Phase 3: Figures / Tables
    listFiguresTables: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/figures-tables`),
    createFigureTable: (projectId, body) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/figures-tables`, { method: 'POST', body: JSON.stringify(body) }),
    getFigureTable: (id) => authenticatedFetch(`/api/rf/figures-tables/${encodeURIComponent(id)}`),
    updateFigureTable: (id, body) => authenticatedFetch(`/api/rf/figures-tables/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteFigureTable: (id) => authenticatedFetch(`/api/rf/figures-tables/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    // Phase 3: Entity links (provenance)
    createEntityLink: (body) => authenticatedFetch('/api/rf/entity-links', { method: 'POST', body: JSON.stringify(body) }),
    deleteEntityLink: (linkId) => authenticatedFetch(`/api/rf/entity-links/${encodeURIComponent(linkId)}`, { method: 'DELETE' }),
    listEntityLinks: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/entity-links`),
    // Phase 4: Manuscript
    getManuscript: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/manuscript`),
    initializeManuscript: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/manuscript/initialize`, { method: 'POST' }),
    updateManuscriptSection: (sectionId, body) => authenticatedFetch(`/api/rf/manuscript-sections/${encodeURIComponent(sectionId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteManuscriptSection: (sectionId) => authenticatedFetch(`/api/rf/manuscript-sections/${encodeURIComponent(sectionId)}`, { method: 'DELETE' }),
    // Phase 4: Results Freeze
    getFreezeReadiness: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/results-freeze/readiness`),
    listResultFreezes: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/results-freezes`),
    createResultsFreeze: (projectId, body) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/results-freezes`, { method: 'POST', body: JSON.stringify(body) }),
    // Phase 4: Review Comments
    listReviewComments: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/review-comments`),
    createReviewComment: (projectId, body) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/review-comments`, { method: 'POST', body: JSON.stringify(body) }),
    updateReviewComment: (commentId, body) => authenticatedFetch(`/api/rf/review-comments/${encodeURIComponent(commentId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteReviewComment: (commentId) => authenticatedFetch(`/api/rf/review-comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' }),
    // Phase 4: Submission
    listSubmissions: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/submissions`),
    createSubmissionProfile: (projectId, body) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/submissions`, { method: 'POST', body: JSON.stringify(body) }),
    getSubmissionProfile: (profileId) => authenticatedFetch(`/api/rf/submissions/${encodeURIComponent(profileId)}`),
    updateSubmissionProfile: (profileId, body) => authenticatedFetch(`/api/rf/submissions/${encodeURIComponent(profileId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    getSubmissionReadiness: (profileId) => authenticatedFetch(`/api/rf/submissions/${encodeURIComponent(profileId)}/readiness`),
    updateSubmissionItem: (itemId, body) => authenticatedFetch(`/api/rf/submission-items/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    markSubmitted: (profileId, body) => authenticatedFetch(`/api/rf/submissions/${encodeURIComponent(profileId)}/mark-submitted`, { method: 'POST', body: JSON.stringify(body) }),
    // Phase 5: Data safety & diagnostics
    getAppInfo: () => authenticatedFetch('/api/rf/info'),
    createBackup: () => authenticatedFetch('/api/rf/backup', { method: 'POST' }),
    getBackups: () => authenticatedFetch('/api/rf/backups'),
    restoreBackup: (backupFile) => authenticatedFetch('/api/rf/backup/restore', { method: 'POST', body: JSON.stringify({ backupFile }) }),
    // Returns a fetch Response (zip blob) — callers use res.blob() and download.
    exportProject: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/export`),
    // Phase 5: Workspace (Windows/WSL)
    getWorkspace: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/workspace`),
    updateWorkspace: (projectId, body) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/workspace`, { method: 'PUT', body: JSON.stringify(body) }),
    validateWorkspace: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/workspace/validate`, { method: 'POST' }),
    openWorkspaceTerminal: (projectId) => authenticatedFetch(`/api/rf/projects/${encodeURIComponent(projectId)}/workspace/open-terminal`, { method: 'POST' }),
  },

  // Compute node management
  compute: {
    getNodes: () => authenticatedFetch('/api/compute/nodes'),
    addNode: (node) => authenticatedFetch('/api/compute/nodes', { method: 'POST', body: JSON.stringify(node) }),
    updateNode: (id, node) => authenticatedFetch(`/api/compute/nodes/${id}`, { method: 'PUT', body: JSON.stringify(node) }),
    deleteNode: (id) => authenticatedFetch(`/api/compute/nodes/${id}`, { method: 'DELETE' }),
    setActive: (id) => authenticatedFetch(`/api/compute/nodes/${id}/active`, { method: 'POST' }),
    testNode: (id) => authenticatedFetch(`/api/compute/nodes/${id}/test`, { method: 'POST' }),
    syncNode: (id, direction, cwd) => authenticatedFetch(`/api/compute/nodes/${id}/sync`, { method: 'POST', body: JSON.stringify({ direction, cwd }) }),
    runOnNode: (id, command, cwd, skipSync) => authenticatedFetch(`/api/compute/nodes/${id}/run`, { method: 'POST', body: JSON.stringify({ command, cwd, skipSync }) }),
    slurmInfo: (id) => authenticatedFetch(`/api/compute/nodes/${id}/slurm/info`),
    slurmQueue: (id) => authenticatedFetch(`/api/compute/nodes/${id}/slurm/queue`),
    slurmSalloc: (id, opts) => authenticatedFetch(`/api/compute/nodes/${id}/slurm/salloc`, { method: 'POST', body: JSON.stringify(opts) }),
    slurmSbatch: (id, opts) => authenticatedFetch(`/api/compute/nodes/${id}/slurm/sbatch`, { method: 'POST', body: JSON.stringify(opts) }),
    slurmCancel: (id, jobId) => authenticatedFetch(`/api/compute/nodes/${id}/slurm/cancel/${jobId}`, { method: 'POST' }),
    monitorNode: (id) => authenticatedFetch(`/api/compute/nodes/${id}/monitor`),
    monitorLocal: () => authenticatedFetch('/api/compute/local/monitor'),
    // Backward-compatible
    getConfig: () => authenticatedFetch('/api/compute/config'),
    configure: (config) => authenticatedFetch('/api/compute/configure', { method: 'POST', body: JSON.stringify(config) }),
    test: () => authenticatedFetch('/api/compute/test', { method: 'POST' }),
    sync: (direction, cwd) => authenticatedFetch('/api/compute/sync', { method: 'POST', body: JSON.stringify({ direction, cwd }) }),
    run: (command, cwd, skipSync) => authenticatedFetch('/api/compute/run', { method: 'POST', body: JSON.stringify({ command, cwd, skipSync }) }),
    status: () => authenticatedFetch('/api/compute/status'),
  },

  // Community tools configuration
  communityTools: {
    configure: (projectPath, mcpBackend, apiKeys, gpuConfig) =>
      authenticatedFetch('/api/community-tools/configure', {
        method: 'POST',
        body: JSON.stringify({ projectPath, mcpBackend, apiKeys, gpuConfig }),
      }),
    getStatus: (projectPath) =>
      authenticatedFetch(`/api/community-tools/status?path=${encodeURIComponent(projectPath)}`),
    getComputeNodes: () =>
      authenticatedFetch('/api/community-tools/compute-nodes'),
    detectGpu: (nodeId) =>
      authenticatedFetch('/api/community-tools/detect-gpu', {
        method: 'POST',
        body: JSON.stringify({ nodeId }),
      }),
  },
};
