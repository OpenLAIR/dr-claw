import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';

import { appSettingsDb, autoResearchDb, userDb } from '../database/db.js';
import { extractProjectDirectory } from '../projects.js';
import { CLAUDE_MODELS, CODEX_MODELS, GEMINI_MODELS, OPENROUTER_MODELS } from '../../shared/modelConstants.js';
import { queryClaudeSDK, abortClaudeSDKSession, isClaudeSDKSessionActive } from '../claude-sdk.js';
import { queryCodex, abortCodexSession, isCodexSessionActive } from '../openai-codex.js';
import { spawnGemini, abortGeminiSession, isGeminiSessionActive } from '../gemini-cli.js';
import { queryOpenRouter, abortOpenRouterSession, isOpenRouterSessionActive } from '../openrouter.js';
import { sendAutoResearchCompletionEmail } from '../utils/auto-research-mailer.js';
import { getGeminiApiKeyForUser, withGeminiApiKeyEnv } from '../utils/geminiApiKey.js';

const router = express.Router();

const activeRuns = new Map();
const TASK_TIMEOUT_MS = Number.parseInt(process.env.AUTO_RESEARCH_TASK_TIMEOUT_MS || '', 10) || 30 * 60 * 1000;
const AUTO_RESEARCH_SENDER_EMAIL_KEY = 'auto_research_sender_email';
const AUTO_RESEARCH_RESEND_API_KEY = 'auto_research_resend_api_key';
const AUTO_RESEARCH_DEFAULT_PERMISSION_MODE = 'bypassPermissions';
const AUTO_RESEARCH_PERMISSION_MODES = new Set(['default', 'acceptEdits', 'bypassPermissions', 'plan']);

function getDefaultModelForProvider(provider) {
  if (provider === 'codex') {
    return CODEX_MODELS.DEFAULT || 'gpt-5.4';
  }
  if (provider === 'gemini') {
    return GEMINI_MODELS.DEFAULT || 'gemini-3-flash-preview';
  }
  if (provider === 'openrouter') {
    return OPENROUTER_MODELS.DEFAULT || 'anthropic/claude-sonnet-4';
  }
  return CLAUDE_MODELS.DEFAULT || 'sonnet';
}

function normalizeAutoResearchProvider(provider) {
  if (provider === 'claude' || provider === 'codex' || provider === 'gemini' || provider === 'openrouter') {
    return provider;
  }
  return 'claude';
}

function normalizePermissionMode(permissionMode) {
  if (AUTO_RESEARCH_PERMISSION_MODES.has(permissionMode)) {
    return permissionMode;
  }
  return AUTO_RESEARCH_DEFAULT_PERMISSION_MODE;
}

function abortActiveSession(provider, sessionId) {
  if (provider === 'codex') {
    return abortCodexSession(sessionId);
  }
  if (provider === 'gemini') {
    return abortGeminiSession(sessionId);
  }
  if (provider === 'openrouter') {
    return abortOpenRouterSession(sessionId);
  }
  return abortClaudeSDKSession(sessionId);
}

function isSessionActiveForProvider(provider, sessionId) {
  if (provider === 'codex') {
    return isCodexSessionActive(sessionId);
  }
  if (provider === 'gemini') {
    return isGeminiSessionActive(sessionId);
  }
  if (provider === 'openrouter') {
    return isOpenRouterSessionActive(sessionId);
  }
  return isClaudeSDKSessionActive(sessionId);
}

function getPipelinePaths(projectPath) {
  return {
    researchBriefFile: path.join(projectPath, '.pipeline', 'docs', 'research_brief.json'),
    tasksFile: path.join(projectPath, '.pipeline', 'tasks', 'tasks.json'),
  };
}

function extractTasksFromData(tasksData) {
  let currentTag = 'master';
  let tasks = [];

  if (Array.isArray(tasksData)) {
    tasks = tasksData;
  } else if (tasksData?.tasks) {
    tasks = tasksData.tasks;
  } else if (tasksData && typeof tasksData === 'object') {
    if (tasksData[currentTag]?.tasks) {
      tasks = tasksData[currentTag].tasks;
    } else {
      const firstTag = Object.keys(tasksData).find((key) => Array.isArray(tasksData[key]?.tasks));
      if (firstTag) {
        currentTag = firstTag;
        tasks = tasksData[firstTag].tasks;
      }
    }
  }

  return { currentTag, tasks: Array.isArray(tasks) ? tasks : [] };
}

function normalizeTaskStatus(status) {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw) return 'pending';
  if (raw === 'completed' || raw === 'complete') return 'done';
  if (raw === 'in_progress' || raw === 'inprogress') return 'in-progress';
  if (raw === 'todo' || raw === 'open') return 'pending';
  return raw;
}

function normalizeTaskStage(stage) {
  const raw = String(stage || '').trim().toLowerCase();
  if (raw === 'presentation') return 'promotion';
  if (raw === 'research') return 'survey';
  return raw;
}

function normalizeTask(task) {
  return {
    id: task.id,
    title: task.title || 'Untitled Task',
    status: normalizeTaskStatus(task.status),
    stage: normalizeTaskStage(task.stage),
    nextActionPrompt: typeof task.nextActionPrompt === 'string' ? task.nextActionPrompt : '',
  };
}

async function readPipelineState(projectPath) {
  const paths = getPipelinePaths(projectPath);
  const [briefStat, tasksStat] = await Promise.allSettled([
    fs.access(paths.researchBriefFile),
    fs.access(paths.tasksFile),
  ]);

  const hasResearchBrief = briefStat.status === 'fulfilled';
  const hasTasksFile = tasksStat.status === 'fulfilled';
  let tasks = [];

  if (hasTasksFile) {
    const content = await fs.readFile(paths.tasksFile, 'utf8');
    const parsed = JSON.parse(content);
    tasks = extractTasksFromData(parsed).tasks.map(normalizeTask);
  }

  const actionableTasks = tasks.filter((task) => task.status === 'pending' || task.status === 'in-progress');
  const nextTask = tasks.find((task) => task.status === 'in-progress')
    || tasks.find((task) => task.status === 'pending')
    || null;

  return {
    ...paths,
    hasResearchBrief,
    hasTasksFile,
    tasks,
    nextTask,
    actionableTaskCount: actionableTasks.length,
    completedTaskCount: tasks.filter((task) => task.status === 'done').length,
  };
}

function serializeRun(run, runtime = null) {
  if (!run) return null;
  return {
    id: run.id,
    projectName: run.project_name,
    projectPath: run.project_path,
    provider: runtime?.provider || run.provider,
    status: run.status,
    sessionId: runtime?.sessionId || run.session_id,
    currentTaskId: run.current_task_id,
    completedTasks: run.completed_tasks,
    totalTasks: run.total_tasks,
    error: run.error,
    metadata: run.metadata || null,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    emailSentAt: run.email_sent_at,
  };
}

function buildEligibility(profile, pipelineState, activeRun) {
  const reasons = [];

  if (!profile?.notification_email) {
    reasons.push('notification_email_missing');
  }
  if (!pipelineState.hasResearchBrief) {
    reasons.push('research_brief_missing');
  }
  if (!pipelineState.hasTasksFile) {
    reasons.push('tasks_file_missing');
  }
  if (pipelineState.hasTasksFile && pipelineState.actionableTaskCount === 0) {
    reasons.push('no_actionable_tasks');
  }
  if (activeRun) {
    reasons.push('run_in_progress');
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

class AutoResearchWriter {
  constructor(onEvent) {
    this.sessionId = null;
    this.onEvent = onEvent;
  }

  send(data) {
    if (data?.type === 'session-created' && data.sessionId) {
      this.sessionId = data.sessionId;
    }
    if (typeof this.onEvent === 'function') {
      this.onEvent(data, this.sessionId);
    }
  }

  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  getSessionId() {
    return this.sessionId;
  }
}

function withTimeout(promise, timeoutMs, onTimeout) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(async () => {
      try {
        await onTimeout?.();
      } catch (error) {
        console.error('[AutoResearch] Timeout cleanup failed:', error);
      }
      reject(new Error(`Task timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([
    promise.finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }),
    timeoutPromise,
  ]);
}

async function deliverCompletionEmail(runId, userId, projectName) {
  const run = autoResearchDb.getRunById(runId);
  const profile = userDb.getProfile(userId);

  if (!run || !profile?.notification_email) {
    return;
  }

  try {
    const result = await sendAutoResearchCompletionEmail({
      toEmail: profile.notification_email,
      run,
      projectName,
    });
    if (result?.sent) {
      autoResearchDb.updateRun(runId, { emailSentAt: new Date().toISOString() });
    }
  } catch (error) {
    console.error('[AutoResearch] Failed to send completion email:', error);
  }
}

function isRunSessionStillActive(run) {
  return isSessionActiveForProvider(run?.provider, run?.session_id);
}

function reconcileActiveRun(run) {
  if (!run) {
    return null;
  }

  const hasRuntime = activeRuns.has(run.id);
  const sessionStillActive = isRunSessionStillActive(run);
  if (hasRuntime || sessionStillActive) {
    return run;
  }

  const staleStatus = run.status === 'cancelling' ? 'cancelled' : 'failed';
  return autoResearchDb.updateRun(run.id, {
    status: staleStatus,
    error: run.error || 'Recovered stale Auto Research run after session interruption',
    currentTaskId: null,
    finishedAt: run.finished_at || new Date().toISOString(),
  });
}

async function runAutoResearch(runId, userId, projectName, projectPath) {
  const runState = activeRuns.get(runId);
  if (!runState) {
    return;
  }

  try {
    const geminiApiKey = getGeminiApiKeyForUser(userId);
    const sessionEnv = withGeminiApiKeyEnv(process.env, geminiApiKey);

    let pipelineState = await readPipelineState(projectPath);
    autoResearchDb.updateRun(runId, {
      status: 'running',
      totalTasks: pipelineState.tasks.length,
      completedTasks: pipelineState.completedTaskCount,
    });

    while (pipelineState.nextTask) {
      if (runState.cancelRequested) {
        throw new Error('Run cancelled by user');
      }

      const task = pipelineState.nextTask;
      const prompt = task.nextActionPrompt?.trim();
      if (!prompt) {
        throw new Error(`Task ${task.id} does not have a nextActionPrompt`);
      }

      autoResearchDb.updateRun(runId, {
        status: 'running',
        currentTaskId: String(task.id),
        totalTasks: pipelineState.tasks.length,
        completedTasks: pipelineState.completedTaskCount,
      });

      const writer = new AutoResearchWriter((event, sessionId) => {
        if (event?.type === 'session-created' && sessionId) {
          runState.sessionId = sessionId;
          autoResearchDb.updateRun(runId, { sessionId });
        }
      });
      const provider = runState.provider || 'claude';
      const model = runState.model || getDefaultModelForProvider(provider);
      const permissionMode = runState.permissionMode || AUTO_RESEARCH_DEFAULT_PERMISSION_MODE;

      const agentOptions = {
        cwd: projectPath,
        projectPath,
        sessionId: runState.sessionId,
        env: sessionEnv,
        model,
        permissionMode,
        stageTagKeys: task.stage ? [task.stage] : [],
        stageTagSource: 'auto_research',
      };

      const agentPromise =
        provider === 'codex'   ? queryCodex(prompt, agentOptions, writer)
        : provider === 'gemini'  ? spawnGemini(prompt, agentOptions, writer)
        : provider === 'openrouter' ? queryOpenRouter(prompt, agentOptions, writer)
        : queryClaudeSDK(prompt, agentOptions, writer);

      await withTimeout(
        agentPromise,
        TASK_TIMEOUT_MS,
        async () => {
          if (runState.sessionId) {
            await abortActiveSession(provider, runState.sessionId);
          }
        },
      );

      pipelineState = await readPipelineState(projectPath);
      const taskAfterRun = pipelineState.tasks.find((entry) => String(entry.id) === String(task.id));
      if (!taskAfterRun || taskAfterRun.status !== 'done') {
        throw new Error(`Task ${task.id} did not transition to done after execution`);
      }

      autoResearchDb.updateRun(runId, {
        completedTasks: pipelineState.completedTaskCount,
        totalTasks: pipelineState.tasks.length,
        currentTaskId: null,
      });
    }

    autoResearchDb.updateRun(runId, {
      status: 'completed',
      currentTaskId: null,
      completedTasks: pipelineState.completedTaskCount,
      totalTasks: pipelineState.tasks.length,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    const isCancelled = runState.cancelRequested || /cancelled by user/i.test(String(error?.message || ''));
    autoResearchDb.updateRun(runId, {
      status: isCancelled ? 'cancelled' : 'failed',
      error: error.message,
      currentTaskId: null,
      finishedAt: new Date().toISOString(),
    });
  } finally {
    activeRuns.delete(runId);
    await deliverCompletionEmail(runId, userId, projectName);
  }
}

router.get('/:projectName/status', async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectName } = req.params;
    const projectPath = await extractProjectDirectory(projectName);
    const pipelineState = await readPipelineState(projectPath);
    const profile = userDb.getProfile(userId);
    const activeRun = reconcileActiveRun(autoResearchDb.getActiveRunForProject(userId, projectName));
    const latestRun = autoResearchDb.getLatestRunForProject(userId, projectName);
    const activeRuntime = activeRun ? activeRuns.get(activeRun.id) || null : null;
    const latestRuntime = latestRun ? activeRuns.get(latestRun.id) || null : null;
    const eligibility = buildEligibility(profile, pipelineState, activeRun);

    const activeProvider = activeRuntime?.provider || activeRun?.provider || latestRuntime?.provider || latestRun?.provider || 'claude';
    res.json({
      success: true,
      provider: activeProvider,
      eligibility,
      profile: {
        notificationEmail: profile?.notification_email || null,
      },
      mail: {
        senderEmail: appSettingsDb.get(AUTO_RESEARCH_SENDER_EMAIL_KEY),
        resendConfigured: Boolean(appSettingsDb.get(AUTO_RESEARCH_RESEND_API_KEY)),
      },
      pipeline: {
        hasResearchBrief: pipelineState.hasResearchBrief,
        hasTasksFile: pipelineState.hasTasksFile,
        actionableTaskCount: pipelineState.actionableTaskCount,
        completedTaskCount: pipelineState.completedTaskCount,
        totalTaskCount: pipelineState.tasks.length,
        nextTask: pipelineState.nextTask,
      },
      activeRun: serializeRun(activeRun, activeRuntime),
      latestRun: serializeRun(latestRun, latestRuntime),
    });
  } catch (error) {
    console.error('[AutoResearch] Failed to get status:', error);
    res.status(500).json({ error: 'Failed to get Auto Research status' });
  }
});

router.post('/:projectName/start', async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectName } = req.params;
    const {
      provider: rawProvider,
      model: rawModel,
      permissionMode: rawPermissionMode,
    } = req.body || {};
    const provider = normalizeAutoResearchProvider(rawProvider);
    const permissionMode = normalizePermissionMode(rawPermissionMode);
    const model = rawModel || getDefaultModelForProvider(provider);
    const projectPath = await extractProjectDirectory(projectName);
    const profile = userDb.getProfile(userId);
    const existingRun = autoResearchDb.getActiveRunForProject(userId, projectName);
    const pipelineState = await readPipelineState(projectPath);
    const eligibility = buildEligibility(profile, pipelineState, existingRun);

    if (!eligibility.eligible) {
      return res.status(400).json({
        error: 'Project is not eligible for Auto Research',
        eligibility,
      });
    }

    const runId = crypto.randomUUID();
    const run = autoResearchDb.createRun({
      id: runId,
      userId,
      projectName,
      projectPath,
      provider,
      status: 'queued',
      completedTasks: pipelineState.completedTaskCount,
      totalTasks: pipelineState.tasks.length,
      metadata: {
        mode: 'auto_research_v1',
        autoResearchModel: model,
        autoResearchPermissionMode: permissionMode,
      },
    });

    activeRuns.set(runId, {
      cancelRequested: false,
      sessionId: null,
      provider,
      model,
      permissionMode,
    });

    void runAutoResearch(runId, userId, projectName, projectPath);

    res.json({
      success: true,
      run: serializeRun(run),
    });
  } catch (error) {
    console.error('[AutoResearch] Failed to start run:', error);
    res.status(500).json({ error: 'Failed to start Auto Research' });
  }
});

router.post('/:projectName/cancel', async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectName } = req.params;
    const activeRun = reconcileActiveRun(autoResearchDb.getActiveRunForProject(userId, projectName));

    if (!activeRun) {
      return res.status(404).json({ error: 'No active Auto Research run found' });
    }

    const runtime = activeRuns.get(activeRun.id);
    const sessionStillActive = isRunSessionStillActive(activeRun);
    if (runtime) {
      runtime.cancelRequested = true;
      if (runtime.sessionId || activeRun.session_id) {
        await abortActiveSession(runtime.provider || activeRun.provider || 'claude', runtime.sessionId || activeRun.session_id);
      }
    }

    let updatedRun;
    if (!runtime && !sessionStillActive) {
      updatedRun = autoResearchDb.updateRun(activeRun.id, {
        status: 'cancelled',
        error: activeRun.error || 'Cancelled after recovering stale Auto Research run',
        currentTaskId: null,
        finishedAt: activeRun.finished_at || new Date().toISOString(),
      });
    } else {
      updatedRun = autoResearchDb.updateRun(activeRun.id, {
        status: 'cancelling',
      });
    }

    res.json({
      success: true,
      run: serializeRun(updatedRun),
    });
  } catch (error) {
    console.error('[AutoResearch] Failed to cancel run:', error);
    res.status(500).json({ error: 'Failed to cancel Auto Research' });
  }
});

export default router;
