/**
 * Helpers for driving the Antigravity CLI (`agy`) over the Agent Client
 * Protocol: locating the binary, mapping Dr. Claw permission modes, and
 * translating ACP session updates into the tool cards and token usage the
 * chat UI already understands.
 */

import { spawn as spawnChild } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/** Dr. Claw permission mode -> ACP session mode id exposed by `agy acp`. */
export function acpModeForPermission(permissionMode) {
  if (permissionMode === 'plan') return 'plan';
  if (permissionMode === 'acceptEdits') return 'accept-edits';
  return 'default';
}

/** True when every tool should run without asking (Dr. Claw's bypass mode). */
export function shouldSkipPermissions(permissionMode, toolsSettings) {
  return permissionMode === 'bypassPermissions' || toolsSettings?.skipPermissions === true;
}

/**
 * Where to find `agy`: an explicit override, then the installer's default
 * location (the desktop app is not started from a login shell, so
 * ~/.local/bin is often missing from its PATH), then plain `agy` on PATH.
 */
export function resolveAntigravityBinary({ env = process.env, homeDir = os.homedir(), platform = process.platform, exists = fs.existsSync } = {}) {
  const override = env.ANTIGRAVITY_CLI_PATH || env.AGY_CLI_PATH;
  if (override && override.trim()) return override.trim();

  const candidates = platform === 'win32'
    ? [path.join(env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'agy', 'bin', 'agy.exe')]
    : [path.join(homeDir, '.local', 'bin', 'agy')];
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return platform === 'win32' ? 'agy.exe' : 'agy';
}

/**
 * Model ids differ between the Gemini API and agy (`gemini-3.8-flash` vs
 * `gemini-3.8-flash-high`). Use the requested id when agy offers it, else the
 * best variant of the same family, else leave agy's default in place (null).
 */
export function resolveAcpModelId(requested, availableModels = []) {
  if (!requested || typeof requested !== 'string') return null;
  const ids = availableModels.map((model) => model?.modelId).filter(Boolean);
  if (ids.includes(requested)) return requested;
  for (const suffix of ['-high', '-medium', '-low']) {
    if (ids.includes(`${requested}${suffix}`)) return `${requested}${suffix}`;
  }
  return null;
}

const DR_CLAW_TOOL_BY_NAME = {
  run_command: 'Bash',
  write_file: 'Write',
  write_to_file: 'Write',
  edit_file: 'Edit',
  replace_file_content: 'Edit',
  multi_replace_file_content: 'Edit',
  read_file: 'Read',
  view_file: 'Read',
  list_dir: 'LS',
  grep_search: 'Grep',
  find_by_name: 'Glob',
  search_web: 'WebSearch',
  read_url_content: 'WebFetch',
  ask_question: 'AskUserQuestion',
};

const pick = (object, ...keys) => {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
};

/** A Dr. Claw tool card `{ name, input }` for an ACP tool call. */
export function toolCardForAcpCall(toolCall = {}) {
  const rawName = toolCall.name || toolCall.title || 'tool';
  const args = toolCall.rawInput || toolCall.args || {};
  const filePath = pick(args, 'Path', 'AbsolutePath', 'TargetFile', 'path', 'file_path');
  const looksLikeDirectory = rawName === 'read_file' && toolCall.title === 'File .';
  const name = looksLikeDirectory ? 'LS' : (DR_CLAW_TOOL_BY_NAME[rawName] || rawName);

  switch (name) {
    case 'Bash':
      return { name, input: { command: pick(args, 'CommandLine', 'command') || '', description: args.toolSummary || undefined } };
    case 'Write':
      return { name, input: { file_path: filePath, content: pick(args, 'Content', 'CodeContent', 'content') ?? '' } };
    case 'Edit':
      return { name, input: { file_path: filePath, old_string: pick(args, 'Target', 'TargetContent') ?? '', new_string: pick(args, 'Replacement', 'ReplacementContent') ?? '' } };
    case 'Read':
      return { name, input: { file_path: filePath } };
    case 'LS':
      return { name, input: { path: filePath || pick(args, 'DirectoryPath') } };
    case 'Grep':
      return { name, input: { pattern: pick(args, 'Query', 'pattern') || '', path: pick(args, 'SearchPath', 'SearchDirectory', 'path') } };
    case 'Glob':
      return { name, input: { pattern: pick(args, 'Pattern', 'pattern') || '', path: pick(args, 'SearchDirectory', 'path') } };
    case 'WebSearch':
      return { name, input: { query: pick(args, 'query', 'Query') || '' } };
    case 'WebFetch':
      return { name, input: { url: pick(args, 'Url', 'url') || '' } };
    default:
      return { name, input: { ...args } };
  }
}

const LEGACY_GEMINI_TOOL_NAMES = {
  Bash: ['run_shell_command'],
  Read: ['read_file', 'read_many_files'],
  Write: ['write_file'],
  Edit: ['replace'],
  LS: ['list_directory'],
  Glob: ['glob'],
  Grep: ['grep_search'],
  WebSearch: ['google_web_search'],
  WebFetch: ['web_fetch'],
};

/**
 * Names a permission entry may use for this tool: the Claude-style card name
 * plus the Gemini CLI names users may have saved before the switch.
 */
export function permissionNamesForCard(cardName) {
  return [cardName, ...(LEGACY_GEMINI_TOOL_NAMES[cardName] || [])];
}

/** Plain-text result of a finished ACP tool call. */
export function toolResultTextForAcpCall(update = {}) {
  const parts = [];
  for (const item of Array.isArray(update.content) ? update.content : []) {
    if (item?.type === 'content' && item.content?.type === 'text' && item.content.text) {
      parts.push(item.content.text);
    } else if (item?.type === 'diff' && item.path) {
      parts.push(`Updated ${item.path}`);
    }
  }
  if (parts.length > 0) return parts.join('\n');

  const raw = update.rawOutput;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw.output === 'string') return raw.output;
  if (raw && typeof raw === 'object') return JSON.stringify(raw, null, 2);
  return update.status === 'failed' ? 'Tool call failed.' : 'Done.';
}

/** ACP plan entries -> TodoWrite items. */
export function todosFromAcpPlan(entries = []) {
  const statusMap = { pending: 'pending', in_progress: 'in_progress', completed: 'completed' };
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry.content === 'string' && entry.content.trim())
    .map((entry) => ({
      content: entry.content.trim(),
      activeForm: entry.content.trim(),
      status: statusMap[entry.status] || 'pending',
    }));
}

/**
 * The option to answer `session/request_permission` with. Falls back to the
 * first option of the right kind so unknown option ids still work.
 */
export function pickPermissionOptionId(options = [], { allow, remember = false } = {}) {
  const list = Array.isArray(options) ? options : [];
  const kinds = allow
    ? (remember ? ['allow_always', 'allow_once'] : ['allow_once', 'allow_always'])
    : ['reject_once', 'reject_always'];
  for (const kind of kinds) {
    const match = list.find((option) => option?.kind === kind);
    if (match) return match.optionId;
  }
  return null;
}

/** ACP prompt usage -> the token-budget breakdown the chat header shows. */
export function tokenBudgetFromAcpUsage(usage, contextWindow) {
  if (!usage || typeof usage !== 'object') return null;
  const input = Number(usage.inputTokens) || 0;
  const output = Number(usage.outputTokens) || 0;
  const total = Number(usage.totalTokens) || input + output;
  return {
    used: total,
    total: contextWindow,
    breakdown: {
      input,
      output,
      cacheCreation: Number(usage.cachedWriteTokens) || 0,
      cacheRead: Number(usage.cachedReadTokens) || 0,
    },
  };
}

/** Parse `agy models` output (`<id>\t<name>` per line) into model options. */
export function parseAgyModelsOutput(stdout = '') {
  const models = [];
  for (const line of String(stdout).split('\n')) {
    const [id, ...rest] = line.split('\t');
    const modelId = (id || '').trim();
    if (!modelId || rest.length === 0 || /\s/.test(modelId)) continue;
    models.push({ value: modelId, label: rest.join('\t').trim() || modelId });
  }
  return models;
}

/**
 * Run `agy models`. It needs a signed-in account, so it doubles as the login
 * check (agy has no status command). Resolves `{ ok, models, error }`.
 */
export function runAgyModels({ binary = resolveAntigravityBinary(), env = process.env, timeoutMs = 20000, spawnImpl } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = (spawnImpl || spawnChild)(binary, ['models'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, models: [], error: error.message, notInstalled: error.code === 'ENOENT' });
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* gone */ }
      finish({ ok: false, models: [], error: 'agy models timed out' });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish({ ok: false, models: [], error: error.message, notInstalled: error.code === 'ENOENT' }));
    child.on('close', (code) => {
      const models = parseAgyModelsOutput(stdout);
      if (code === 0 && models.length > 0) {
        finish({ ok: true, models });
        return;
      }
      const message = `${stdout}\n${stderr}`.split('\n').map((line) => line.trim()).find((line) => /^Error:/i.test(line))
        || `agy models exited with code ${code}`;
      finish({ ok: false, models: [], error: message.replace(/^Error:\s*/i, ''), notSignedIn: /sign in/i.test(message) });
    });
  });
}
