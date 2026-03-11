import { promises as fs } from 'fs';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';

import { getCodexSessions, getGeminiSessions } from './projects.js';

const CACHE_TTL_MS = 5_000;

let summaryCache = null;

function createEmptyUsageTotals() {
  return {
    todayTokens: 0,
    weekTokens: 0,
  };
}

function normalizeProjectRefs(projectRefs = []) {
  return projectRefs
    .filter((project) => project && typeof project.name === 'string' && typeof project.fullPath === 'string')
    .map((project) => ({
      name: project.name,
      fullPath: project.fullPath,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getUsageWindowBounds(now = new Date()) {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date(todayStart);
  const dayOfWeek = weekStart.getDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  weekStart.setDate(weekStart.getDate() - daysSinceMonday);

  return {
    nowMs: now.getTime(),
    todayStartMs: todayStart.getTime(),
    weekStartMs: weekStart.getTime(),
    cacheKey: `${todayStart.toISOString()}|${weekStart.toISOString()}`,
  };
}

function addUsageForTimestamp(target, timestampMs, tokens, bounds) {
  if (!Number.isFinite(timestampMs) || !Number.isFinite(tokens) || tokens <= 0) {
    return;
  }

  if (timestampMs >= bounds.weekStartMs && timestampMs <= bounds.nowMs) {
    target.weekTokens += tokens;
  }

  if (timestampMs >= bounds.todayStartMs && timestampMs <= bounds.nowMs) {
    target.todayTokens += tokens;
  }
}

function getClaudeProjectDir(projectName) {
  return path.join(os.homedir(), '.claude', 'projects', projectName);
}

async function collectJsonlFiles(dirPath) {
  const files = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...await collectJsonlFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(`[token-usage] Failed to read directory ${dirPath}:`, error.message);
    }
  }

  return files;
}

function getClaudeUsageSnapshot(entry) {
  const usage = entry?.message?.usage;
  if (!usage) {
    return null;
  }

  const model = entry?.message?.model;
  if (model === '<synthetic>') {
    return null;
  }

  const inputTokens = Number(usage.input_tokens || 0);
  const cacheCreationTokens = Number(usage.cache_creation_input_tokens || 0);
  const cacheReadTokens = Number(usage.cache_read_input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const totalTokens = inputTokens + cacheCreationTokens + cacheReadTokens + outputTokens;

  return {
    timestampMs: new Date(entry.timestamp || 0).getTime(),
    inputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    outputTokens,
    totalTokens,
  };
}

async function summarizeClaudeProject(projectRef, bounds) {
  const totals = createEmptyUsageTotals();
  const projectDir = getClaudeProjectDir(projectRef.name);
  const jsonlFiles = await collectJsonlFiles(projectDir);
  const requestUsageMap = new Map();
  let fallbackIndex = 0;

  for (const filePath of jsonlFiles) {
    try {
      const fileStream = fsSync.createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) {
          continue;
        }

        try {
          const entry = JSON.parse(line);
          if (entry.type !== 'assistant' || !entry.message?.usage) {
            continue;
          }

          const snapshot = getClaudeUsageSnapshot(entry);
          if (!snapshot || snapshot.totalTokens <= 0) {
            continue;
          }

          const rawRequestId = typeof entry.requestId === 'string' ? entry.requestId.trim() : '';
          const requestKey = rawRequestId || `${filePath}:${entry.uuid || entry.timestamp || fallbackIndex++}`;
          const previous = requestUsageMap.get(requestKey);

          if (!previous) {
            requestUsageMap.set(requestKey, snapshot);
            continue;
          }

          requestUsageMap.set(requestKey, {
            timestampMs: Math.max(previous.timestampMs, snapshot.timestampMs),
            inputTokens: Math.max(previous.inputTokens, snapshot.inputTokens),
            cacheCreationTokens: Math.max(previous.cacheCreationTokens, snapshot.cacheCreationTokens),
            cacheReadTokens: Math.max(previous.cacheReadTokens, snapshot.cacheReadTokens),
            outputTokens: Math.max(previous.outputTokens, snapshot.outputTokens),
            totalTokens: Math.max(previous.totalTokens, snapshot.totalTokens),
          });
        } catch {
          // Skip malformed JSONL rows.
        }
      }
    } catch (error) {
      console.warn(`[token-usage] Failed to read Claude session file ${filePath}:`, error.message);
    }
  }

  for (const usage of requestUsageMap.values()) {
    addUsageForTimestamp(totals, usage.timestampMs, usage.totalTokens, bounds);
  }

  return totals;
}

function getCodexCumulativeTokens(entry) {
  const totalTokens = Number(entry?.payload?.info?.total_token_usage?.total_tokens || 0);
  return Number.isFinite(totalTokens) ? totalTokens : 0;
}

function getCodexLastTokens(entry) {
  const lastTokens = Number(entry?.payload?.info?.last_token_usage?.total_tokens || 0);
  return Number.isFinite(lastTokens) ? lastTokens : 0;
}

async function summarizeCodexProject(projectRef, bounds, codexIndexRef) {
  const totals = createEmptyUsageTotals();
  const sessions = await getCodexSessions(projectRef.fullPath, {
    limit: 0,
    indexRef: codexIndexRef,
  });

  for (const session of sessions) {
    if (!session?.filePath) {
      continue;
    }

    let previousCumulativeTokens = 0;

    try {
      const fileStream = fsSync.createReadStream(session.filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) {
          continue;
        }

        try {
          const entry = JSON.parse(line);
          if (entry.type !== 'event_msg' || entry.payload?.type !== 'token_count' || !entry.payload?.info) {
            continue;
          }

          const timestampMs = new Date(entry.timestamp || 0).getTime();
          const cumulativeTokens = getCodexCumulativeTokens(entry);
          let deltaTokens = 0;

          if (cumulativeTokens > previousCumulativeTokens) {
            deltaTokens = cumulativeTokens - previousCumulativeTokens;
            previousCumulativeTokens = cumulativeTokens;
          } else if (cumulativeTokens < previousCumulativeTokens) {
            const lastTokens = getCodexLastTokens(entry);
            if (lastTokens > 0) {
              deltaTokens = lastTokens;
            }
            previousCumulativeTokens = Math.max(cumulativeTokens, 0);
          }

          addUsageForTimestamp(totals, timestampMs, deltaTokens, bounds);
        } catch {
          // Skip malformed JSONL rows.
        }
      }
    } catch (error) {
      console.warn(`[token-usage] Failed to read Codex session file ${session.filePath}:`, error.message);
    }
  }

  return totals;
}

function getGeminiUsedTokens(stats) {
  const totalTokens = Number(stats?.total_tokens || 0);
  if (totalTokens > 0) {
    return totalTokens;
  }

  const inputTokens = Number(stats?.input_tokens || 0);
  const outputTokens = Number(stats?.output_tokens || 0);
  return inputTokens + outputTokens;
}

async function summarizeGeminiProject(projectRef, bounds) {
  const totals = createEmptyUsageTotals();
  const sessions = await getGeminiSessions(projectRef.fullPath, { limit: 0 });

  for (const session of sessions) {
    if (!session?.filePath) {
      continue;
    }

    const seenStatusEvents = new Set();

    try {
      const fileStream = fsSync.createReadStream(session.filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) {
          continue;
        }

        try {
          const entry = JSON.parse(line);
          if (entry.type !== 'status' || !entry.stats) {
            continue;
          }

          const usedTokens = getGeminiUsedTokens(entry.stats);
          if (usedTokens <= 0) {
            continue;
          }

          const timestampMs = new Date(entry.timestamp || 0).getTime();
          const dedupeKey = [
            entry.timestamp || '',
            usedTokens,
            Number(entry.stats.input_tokens || 0),
            Number(entry.stats.output_tokens || 0),
            Number(entry.stats.cache_creation_input_tokens || 0),
            Number(entry.stats.cache_read_input_tokens || 0),
          ].join('|');

          if (seenStatusEvents.has(dedupeKey)) {
            continue;
          }
          seenStatusEvents.add(dedupeKey);

          addUsageForTimestamp(totals, timestampMs, usedTokens, bounds);
        } catch {
          // Skip malformed JSONL rows.
        }
      }
    } catch (error) {
      console.warn(`[token-usage] Failed to read Gemini session file ${session.filePath}:`, error.message);
    }
  }

  return totals;
}

function mergeUsageTotals(...totalsList) {
  return totalsList.reduce((merged, totals) => ({
    todayTokens: merged.todayTokens + Number(totals?.todayTokens || 0),
    weekTokens: merged.weekTokens + Number(totals?.weekTokens || 0),
  }), createEmptyUsageTotals());
}

export async function getProjectTokenUsageSummary(projectRefs = []) {
  const normalizedProjectRefs = normalizeProjectRefs(projectRefs);
  const bounds = getUsageWindowBounds();
  const cacheKey = `${bounds.cacheKey}|${JSON.stringify(normalizedProjectRefs)}`;

  if (summaryCache && summaryCache.key === cacheKey && summaryCache.expiresAt > Date.now()) {
    return summaryCache.data;
  }

  const codexIndexRef = { sessionsByProject: null };
  const projectUsageEntries = await Promise.all(
    normalizedProjectRefs.map(async (projectRef) => {
      const [claudeTotals, codexTotals, geminiTotals] = await Promise.all([
        summarizeClaudeProject(projectRef, bounds),
        summarizeCodexProject(projectRef, bounds, codexIndexRef),
        summarizeGeminiProject(projectRef, bounds),
      ]);

      return [
        projectRef.name,
        mergeUsageTotals(claudeTotals, codexTotals, geminiTotals),
      ];
    }),
  );

  const projects = Object.fromEntries(projectUsageEntries);
  const workspace = Object.values(projects).reduce(
    (accumulator, totals) => mergeUsageTotals(accumulator, totals),
    createEmptyUsageTotals(),
  );

  const data = {
    generatedAt: new Date().toISOString(),
    workspace,
    projects,
  };

  summaryCache = {
    key: cacheKey,
    expiresAt: Date.now() + CACHE_TTL_MS,
    data,
  };

  return data;
}

export function clearProjectTokenUsageSummaryCache() {
  summaryCache = null;
}
