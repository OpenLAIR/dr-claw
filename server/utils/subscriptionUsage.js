/**
 * Remaining subscription usage (plan rate-limit windows) per connected agent
 * account. Every number here comes from data the provider itself reports;
 * when a provider exposes nothing reliable the entry says so with a
 * `reasonCode` instead of guessing.
 *
 * - Claude Code: the Agent SDK's `/usage` control request returns claude.ai
 *   plan utilization windows. It runs against an idle CLI process (no prompt
 *   is sent, so it spends no model tokens).
 * - Codex: every `token_count` event Codex writes to its session logs carries
 *   a `rate_limits` snapshot. We report the newest one and its timestamp.
 * - Gemini: neither Gemini CLI nor the Gemini API key flow records remaining
 *   quota anywhere we can read, so it is always reported as unavailable.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const CODEX_TAIL_BYTES = 512 * 1024;
const CODEX_MAX_FILES_TO_SCAN = 20;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampPercent(value) {
  const n = finiteNumber(value);
  if (n === null) return null;
  return Math.min(100, Math.max(0, n));
}

function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatWindowLabel(windowMinutes) {
  const minutes = finiteNumber(windowMinutes);
  if (minutes === null || minutes <= 0) return null;
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function buildWindow({ id, label, windowMinutes = null, usedPercent, resetsAt, now }) {
  const used = clampPercent(usedPercent);
  const resetIso = toIso(resetsAt);
  // A window whose reset time has already passed tells us nothing about usage
  // since then, so report the reset instead of the old percentage.
  const resetSinceObserved = Boolean(resetIso && now && new Date(resetIso).getTime() <= now.getTime());
  return {
    id,
    label,
    windowMinutes,
    usedPercent: resetSinceObserved ? null : used,
    remainingPercent: resetSinceObserved || used === null ? null : Math.round((100 - used) * 10) / 10,
    resetsAt: resetIso,
    resetSinceObserved,
  };
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

const CLAUDE_WINDOWS = [
  { key: 'five_hour', label: '5h', windowMinutes: 300 },
  { key: 'seven_day', label: '7d', windowMinutes: 10080 },
  { key: 'seven_day_opus', label: '7d Opus', windowMinutes: 10080 },
  { key: 'seven_day_sonnet', label: '7d Sonnet', windowMinutes: 10080 },
];

/**
 * Normalize the SDK's `SDKControlGetUsageResponse` into provider windows.
 * Only fields typed in the SDK's public declarations are read.
 */
export function normalizeClaudeUsageResponse(response, { now = new Date() } = {}) {
  const subscriptionType = typeof response?.subscription_type === 'string' ? response.subscription_type : null;
  const rateLimits = response?.rate_limits;

  if (!response || response.rate_limits_available !== true || !rateLimits || typeof rateLimits !== 'object') {
    return { plan: subscriptionType, windows: [], available: false };
  }

  const windows = [];
  for (const { key, label, windowMinutes } of CLAUDE_WINDOWS) {
    const entry = rateLimits[key];
    if (!entry || finiteNumber(entry.utilization) === null) continue;
    windows.push(buildWindow({ id: key, label, windowMinutes, usedPercent: entry.utilization, resetsAt: entry.resets_at, now }));
  }

  if (Array.isArray(rateLimits.model_scoped)) {
    for (const entry of rateLimits.model_scoped) {
      if (!entry || typeof entry.display_name !== 'string' || finiteNumber(entry.utilization) === null) continue;
      const label = `7d ${entry.display_name}`;
      if (windows.some((window) => window.label === label)) continue;
      windows.push(buildWindow({
        id: `model:${entry.display_name}`,
        label,
        windowMinutes: 10080,
        usedPercent: entry.utilization,
        resetsAt: entry.resets_at,
        now,
      }));
    }
  }

  return { plan: subscriptionType, windows, available: true };
}

/**
 * Ask an idle Claude Code process for its `/usage` data. No prompt is sent.
 * The SDK marks this call experimental, so any failure or a missing method is
 * reported as `probe_failed` / `probe_unsupported` rather than thrown.
 */
export async function probeClaudePlanUsage({ timeoutMs = 15000 } = {}) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  // Streaming-input mode with an input stream that never yields: the CLI
  // starts and answers control requests, but no model turn ever runs.
  async function* idleInput() { await gate; }

  const instance = query({
    prompt: idleInput(),
    options: {
      cwd: os.homedir(),
      settingSources: [],
      env: { ...process.env, CLAUDECODE: '' },
    },
  });

  const usageMethod = instance.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
  let timer;
  try {
    if (typeof usageMethod !== 'function') {
      return { ok: false, reasonCode: 'probe_unsupported' };
    }
    const response = await Promise.race([
      usageMethod.call(instance),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    return { ok: true, response };
  } catch (error) {
    return { ok: false, reasonCode: 'probe_failed', error: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
    release();
    try { instance.close?.(); } catch { /* already closed */ }
  }
}

export function buildClaudeEntry({ auth, probe, now = new Date() }) {
  const base = { provider: 'claude', account: auth?.email || null, plan: null, windows: [], source: 'live', observedAt: null };

  if (!auth?.authenticated) {
    return { ...base, status: 'unavailable', reasonCode: 'not_signed_in' };
  }
  if (auth.method === 'custom_api') {
    return { ...base, status: 'unavailable', reasonCode: 'api_key_no_plan_limits' };
  }
  if (!probe?.ok) {
    return { ...base, status: 'error', reasonCode: probe?.reasonCode || 'probe_failed', detail: probe?.error || null };
  }

  const normalized = normalizeClaudeUsageResponse(probe.response, { now });
  if (!normalized.available) {
    return { ...base, plan: normalized.plan, status: 'unavailable', reasonCode: 'api_key_no_plan_limits' };
  }
  if (normalized.windows.length === 0) {
    return { ...base, plan: normalized.plan, status: 'unavailable', reasonCode: 'no_windows_reported', observedAt: now.toISOString() };
  }
  return { ...base, plan: normalized.plan, status: 'ok', windows: normalized.windows, observedAt: now.toISOString(), reasonCode: null };
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

function codexWindow(id, raw, observedAt, now) {
  if (!raw || typeof raw !== 'object') return null;
  const usedPercent = finiteNumber(raw.used_percent);
  if (usedPercent === null) return null;
  const windowMinutes = finiteNumber(raw.window_minutes);
  let resetsAt = null;
  if (finiteNumber(raw.resets_at) !== null) {
    resetsAt = raw.resets_at * 1000; // epoch seconds
  } else if (finiteNumber(raw.resets_in_seconds) !== null && observedAt) {
    // Older Codex builds wrote a relative offset from the event time.
    resetsAt = new Date(observedAt).getTime() + raw.resets_in_seconds * 1000;
  }
  return buildWindow({
    id,
    label: formatWindowLabel(windowMinutes) || id,
    windowMinutes,
    usedPercent,
    resetsAt,
    now,
  });
}

/**
 * Find the newest `rate_limits` snapshot in a chunk of Codex session JSONL.
 * The chunk may start mid-line (we read file tails); unparsable lines are
 * skipped.
 */
export function parseCodexRateLimitsFromJsonl(text, { now = new Date() } = {}) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line || !line.includes('"rate_limits"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const rateLimits = entry?.payload?.rate_limits ?? entry?.rate_limits;
    if (!rateLimits || typeof rateLimits !== 'object') continue;

    const observedAt = toIso(entry.timestamp);
    const windows = [
      codexWindow('primary', rateLimits.primary, observedAt, now),
      codexWindow('secondary', rateLimits.secondary, observedAt, now),
    ].filter(Boolean);
    if (windows.length === 0) continue;

    return {
      observedAt,
      plan: typeof rateLimits.plan_type === 'string' ? rateLimits.plan_type : null,
      windows,
      limitReached: rateLimits.rate_limit_reached_type ?? null,
    };
  }
  return null;
}

async function listJsonlFilesNewestFirst(root) {
  const files = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const stats = await fs.stat(fullPath);
          files.push({ path: fullPath, mtimeMs: stats.mtimeMs, size: stats.size });
        } catch { /* deleted while scanning */ }
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function readTail(filePath, size, maxBytes) {
  const start = Math.max(0, size - maxBytes);
  const handle = await fs.open(filePath, 'r');
  try {
    const length = size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    let text = buffer.toString('utf8');
    if (start > 0) {
      // Drop the partial first line.
      const newline = text.indexOf('\n');
      text = newline === -1 ? '' : text.slice(newline + 1);
    }
    return text;
  } finally {
    await handle.close();
  }
}

export async function readLatestCodexRateLimits({
  sessionsDir = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions'),
  now = new Date(),
  maxFiles = CODEX_MAX_FILES_TO_SCAN,
  tailBytes = CODEX_TAIL_BYTES,
} = {}) {
  const files = await listJsonlFilesNewestFirst(sessionsDir);
  for (const file of files.slice(0, maxFiles)) {
    try {
      const snapshot = parseCodexRateLimitsFromJsonl(await readTail(file.path, file.size, tailBytes), { now });
      if (snapshot) return snapshot;
    } catch { /* unreadable file: try the next one */ }
  }
  return null;
}

export function buildCodexEntry({ auth, snapshot }) {
  const base = { provider: 'codex', account: auth?.email || null, plan: null, windows: [], source: 'session-log', observedAt: null };
  if (!auth?.authenticated) {
    return { ...base, status: 'unavailable', reasonCode: 'not_signed_in' };
  }
  if (auth.method === 'custom_api') {
    return { ...base, status: 'unavailable', reasonCode: 'api_key_no_plan_limits' };
  }
  if (!snapshot) {
    return { ...base, status: 'unavailable', reasonCode: 'no_codex_snapshot' };
  }
  return {
    ...base,
    plan: snapshot.plan,
    status: 'ok',
    windows: snapshot.windows,
    observedAt: snapshot.observedAt,
    limitReached: snapshot.limitReached,
    reasonCode: null,
  };
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

export function buildGeminiEntry({ auth }) {
  return {
    provider: 'gemini',
    account: auth?.authenticated ? auth.email || null : null,
    plan: null,
    windows: [],
    source: null,
    observedAt: null,
    status: 'unavailable',
    reasonCode: auth?.authenticated ? 'gemini_no_quota_source' : 'not_signed_in',
  };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

async function settle(promise) {
  try {
    return await promise;
  } catch {
    return null;
  }
}

/**
 * @param {object} deps Injected so tests can run without CLIs or a home dir.
 */
export async function buildSubscriptionUsageSummary({
  checkClaudeAuth,
  checkCodexAuth,
  checkGeminiAuth,
  probeClaude,
  readCodexSnapshot,
  now = new Date(),
}) {
  const [claudeAuth, codexAuth, geminiAuth, codexSnapshot] = await Promise.all([
    settle(checkClaudeAuth()),
    settle(checkCodexAuth()),
    settle(checkGeminiAuth()),
    settle(readCodexSnapshot()),
  ]);
  const claudeProbe = claudeAuth?.authenticated && claudeAuth.method !== 'custom_api'
    ? await settle(probeClaude())
    : null;

  return {
    generatedAt: now.toISOString(),
    providers: [
      buildClaudeEntry({ auth: claudeAuth, probe: claudeProbe, now }),
      buildCodexEntry({ auth: codexAuth, snapshot: codexSnapshot }),
      buildGeminiEntry({ auth: geminiAuth }),
    ],
  };
}
