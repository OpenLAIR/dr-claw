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
    register: (username, password, resetExisting = false) => fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, resetExisting }),
    }),
    user: () => authenticatedFetch('/api/auth/user'),
    logout: () => authenticatedFetch('/api/auth/logout', { method: 'POST' }),
  },

  // Protected endpoints
  // config endpoint removed - no longer needed (frontend uses window.location)
  projects: () => authenticatedFetch('/api/projects'),
  sessions: (projectName, limit = 5, offset = 0) =>
    authenticatedFetch(`/api/projects/${projectName}/sessions?limit=${limit}&offset=${offset}`),
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
  renameProject: (projectName, displayName) =>
    authenticatedFetch(`/api/projects/${projectName}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
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
  readFile: (projectName, filePath) =>
    authenticatedFetch(`/api/projects/${projectName}/file?filePath=${encodeURIComponent(filePath)}`),
  /** Fetch binary file content (e.g. PDF) as Blob. absolutePath must be the full filesystem path. */
  getFileContentBlob: (projectName, absolutePath) =>
    authenticatedFetch(`/api/projects/${projectName}/files/content?path=${encodeURIComponent(absolutePath)}`).then((r) => {
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
    const { path, maxDepth, showHidden, ...fetchOptions } = options || {};
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

  // Generic GET method for any endpoint
  get: (endpoint) => authenticatedFetch(`/api${endpoint}`),

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
    // Backward-compatible
    getConfig: () => authenticatedFetch('/api/compute/config'),
    configure: (config) => authenticatedFetch('/api/compute/configure', { method: 'POST', body: JSON.stringify(config) }),
    test: () => authenticatedFetch('/api/compute/test', { method: 'POST' }),
    sync: (direction, cwd) => authenticatedFetch('/api/compute/sync', { method: 'POST', body: JSON.stringify({ direction, cwd }) }),
    run: (command, cwd, skipSync) => authenticatedFetch('/api/compute/run', { method: 'POST', body: JSON.stringify({ command, cwd, skipSync }) }),
    status: () => authenticatedFetch('/api/compute/status'),
  },
};
