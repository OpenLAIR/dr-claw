import { sessionDb, tagDb } from '../database/db.js';
import { encodeProjectPath } from '../projects.js';

function defaultSessionName(provider) {
  switch (provider) {
    case 'cursor':
      return 'Untitled Session';
    case 'codex':
      return 'Codex Session';
    case 'gemini':
      return 'Gemini Session';
    case 'openrouter':
      return 'OpenRouter Session';
    default:
      return 'New Session';
  }
}

function normalizeStageTagKeys(stageTagKeys = []) {
  const normalized = Array.from(new Set(
    (Array.isArray(stageTagKeys) ? stageTagKeys : [])
      .map((value) => String(value || '').trim().toLowerCase())
      .filter((value) => ['survey', 'ideation', 'experiment', 'publication', 'promotion'].includes(value))
  ));

  return normalized;
}

export function applyStageTagsToSession({
  sessionId,
  projectPath = null,
  projectName = null,
  stageTagKeys = [],
  source = 'chat_context',
  linkedBy = null,
}) {
  if (!sessionId) {
    return [];
  }

  const normalizedStageTagKeys = normalizeStageTagKeys(stageTagKeys);
  if (normalizedStageTagKeys.length === 0) {
    return [];
  }

  const resolvedProjectName = projectName || (projectPath ? encodeProjectPath(projectPath) : null);
  if (!resolvedProjectName) {
    return [];
  }

  tagDb.ensureDefaultStageTags(resolvedProjectName);
  return tagDb.appendSessionTagsByKeys(sessionId, resolvedProjectName, 'stage', normalizedStageTagKeys, {
    source,
    linkedBy,
  });
}

export function recordIndexedSession({
  sessionId,
  provider,
  projectPath,
  sessionMode = 'research',
  displayName = null,
  lastActivity = null,
  stageTagKeys = [],
  tagSource = 'chat_context',
  linkedBy = null,
}) {
  if (!sessionId || !provider || !projectPath) {
    return;
  }

  const projectName = encodeProjectPath(projectPath);
  sessionDb.upsertSessionPlaceholder(
    sessionId,
    projectName,
    provider,
    displayName || defaultSessionName(provider),
    lastActivity || new Date().toISOString(),
    {
      sessionMode,
      projectPath,
      indexState: 'placeholder',
    },
  );

  // Dual-path tag application: tags are also applied at spawn start (in the CLI modules)
  // for immediate tagging of existing sessions. This second call ensures tags are applied
  // for newly created sessions. INSERT OR IGNORE in appendSessionTagsByKeys prevents duplicates.
  applyStageTagsToSession({
    sessionId,
    projectPath,
    projectName,
    stageTagKeys,
    source: tagSource,
    linkedBy,
  });
}
