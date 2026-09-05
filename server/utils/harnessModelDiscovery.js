/**
 * Ask each harness which models it actually supports.
 *
 * The model lists in shared/modelConstants.js are hand-maintained, so every time
 * a CLI ships a new model somebody has to notice and send a patch — and until
 * they do, the picker offers models that no longer exist and hides the ones that
 * do. (Concrete example: the pinned Codex list still offered `gpt-5.6`, `o3` and
 * `o4-mini`, while codex-cli 0.145.0 actually serves `gpt-5.6-sol`,
 * `gpt-5.4-mini` and `gpt-5.3-codex-spark`.)
 *
 * This module asks the tool instead. Discovery is strictly additive: every
 * provider keeps its hand-maintained list, and a failed, slow or unsupported
 * probe simply falls back to it. A harness must never be able to break the
 * picker just by being absent, old, or unresponsive — hence the hard timeouts
 * and the fact that nothing here is ever awaited on a critical path.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { StringDecoder } from 'string_decoder';
import {
  CLAUDE_MODELS,
  CODEX_MODELS,
  CURSOR_MODELS,
  GEMINI_MODELS,
  LOCAL_MODELS,
  NANO_CLAUDE_CODE_MODELS,
  OPENROUTER_MODELS,
} from '../../shared/modelConstants.js';
import { buildCodexCliEnv, getCodexCliCommand } from './codexCli.js';

const STATIC_MODELS = {
  claude: CLAUDE_MODELS,
  codex: CODEX_MODELS,
  cursor: CURSOR_MODELS,
  gemini: GEMINI_MODELS,
  local: LOCAL_MODELS,
  nano: NANO_CLAUDE_CODE_MODELS,
  openrouter: OPENROUTER_MODELS,
};

/**
 * Per-provider facts discovery cannot infer from the list itself.
 *
 * acceptsUnlisted: the harness accepts model ids beyond the ones it advertises.
 * Claude Code's list is a short menu of aliases (`opus[1m]`, `sonnet`) while the
 * CLI still runs any `claude-*` id you hand it, so for that provider absence
 * from the list must not demote a built-in entry or trigger a rescue.
 */
const PROVIDER_TRAITS = {
  claude: { acceptsUnlisted: true },
};

export const DISCOVERY_TTL_MS = 10 * 60 * 1000;
export const DISCOVERY_TIMEOUT_MS = 15 * 1000;

const cache = new Map(); // provider -> { expiresAt, payload }
const inFlight = new Map(); // provider -> Promise
const generation = new Map(); // provider -> number; only the newest probe may write
const lastLoggedFailure = new Map(); // provider -> message

/**
 * Report a discovery failure once per distinct cause.
 *
 * Falling back is an expected, benign state — the CLI may simply not be
 * installed — and failures are re-tried on a short TTL, so logging every one
 * would spam the console for a non-problem.
 */
function reportDiscoveryFailure(provider, error) {
  const message = String(error?.message || error);
  if (lastLoggedFailure.get(provider) === message) {
    return;
  }
  lastLoggedFailure.set(provider, message);
  console.warn(`[models] ${provider} model discovery unavailable, using built-in list: ${message}`);
}

/**
 * Merge discovered options over the static list.
 *
 * Discovered order wins (the harness knows which model it wants to surface
 * first), but static entries that the probe did not return are kept at the end
 * rather than dropped. A harness can legitimately report a narrower list than
 * dr-claw supports — for example only the models the current account is
 * entitled to — and silently deleting a model a user already has selected would
 * strand their saved preference.
 */
export function mergeModelOptions(discovered, staticOptions, { acceptsUnlisted = false } = {}) {
  const seen = new Set();
  const merged = [];

  for (const option of discovered) {
    if (!option?.value || seen.has(option.value)) continue;
    seen.add(option.value);
    // Spread rather than pick: discoverers attach metadata (description,
    // isDefault) that clients may want to surface, and dropping it here would
    // silently strip it from the API response.
    merged.push({ ...option, label: option.label || option.value });
  }

  for (const option of staticOptions || []) {
    if (!option?.value || seen.has(option.value)) continue;
    seen.add(option.value);
    merged.push(acceptsUnlisted ? { ...option } : { ...option, deprecated: true });
  }

  return merged;
}

/**
 * Drive one JSON-RPC request/response exchange over a child process's stdio.
 *
 * Kept generic because more than one harness speaks line-delimited JSON-RPC over
 * stdio; `onMessage` returns a value to finish, or undefined to keep reading.
 */
function jsonRpcOverStdio({ command, args, env, cwd, timeoutMs, requests, onMessage }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        cwd,
        shell: false,
      });
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    // A multi-byte UTF-8 character can straddle two stdout chunks; decoding each
    // chunk independently would corrupt model labels and descriptions.
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let stderr = '';

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
        // SIGTERM is a request. Escalate so a CLI that traps or ignores it
        // cannot outlive the probe holding its pipes open. Unref'd so this
        // timer can never keep the server alive on its own.
        const killTimer = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
        }, 2000);
        killTimer.unref?.();
      } catch (_) { /* already gone */ }
      fn(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (error) => finish(reject, error));
    child.stderr?.on('data', (chunk) => {
      // Bounded: a chatty harness must not be able to grow this without limit.
      if (stderr.length < 8192) stderr += chunk.toString();
    });

    child.on('close', (code) => {
      finish(reject, new Error(`${command} exited with code ${code}${stderr ? `: ${stderr.trim().slice(0, 300)}` : ''}`));
    });

    child.stdout?.on('data', (chunk) => {
      buffer += decoder.write(chunk);
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;

        let message;
        try {
          message = JSON.parse(line);
        } catch (_) {
          continue; // Non-JSON banner lines are normal on some CLIs.
        }

        let outcome;
        try {
          outcome = onMessage(message, (request) => {
            child.stdin?.write(`${JSON.stringify(request)}\n`);
          });
        } catch (error) {
          finish(reject, error);
          return;
        }

        if (outcome !== undefined) {
          finish(resolve, outcome);
          return;
        }
      }
    });

    for (const request of requests) {
      child.stdin?.write(`${JSON.stringify(request)}\n`);
    }
  });
}

/**
 * Codex exposes its live catalogue through the app-server's `model/list`
 * JSON-RPC method, which is the same source the Codex UI's own picker reads.
 */
const CODEX_INITIALIZE_ID = 1;
const CODEX_MODEL_LIST_BASE_ID = 100;
// Bounded so a harness that keeps handing back a cursor cannot spin forever.
// The real catalogue is a single page of well under 100 entries.
const CODEX_MAX_MODEL_PAGES = 10;

async function discoverCodexModels({ timeoutMs, env = process.env } = {}) {
  const command = getCodexCliCommand(env);
  const collected = [];
  let page = 0;

  const requestPage = (send, cursor) => {
    page += 1;
    send({
      jsonrpc: '2.0',
      id: CODEX_MODEL_LIST_BASE_ID + page,
      method: 'model/list',
      params: { includeHidden: false, ...(cursor ? { cursor } : {}) },
    });
  };

  const models = await jsonRpcOverStdio({
    command,
    args: ['app-server'],
    env: buildCodexCliEnv(env),
    timeoutMs,
    requests: [{
      jsonrpc: '2.0',
      id: CODEX_INITIALIZE_ID,
      method: 'initialize',
      params: { clientInfo: { name: 'dr-claw', title: 'Dr. Claw', version: '1.0.0' } },
    }],
    onMessage: (message, send) => {
      if (message.id === CODEX_INITIALIZE_ID) {
        if (message.error) {
          throw new Error(`initialize failed: ${message.error.message || 'unknown error'}`);
        }
        // codex-cli 0.145 answers model/list without this, but the documented
        // lifecycle expects it and other versions may enforce it. It is a
        // notification, so sending it costs nothing where it is not required.
        send({ jsonrpc: '2.0', method: 'initialized', params: {} });
        requestPage(send, null);
        return undefined;
      }

      if (typeof message.id === 'number' && message.id > CODEX_MODEL_LIST_BASE_ID) {
        if (message.error) {
          throw new Error(`model/list failed: ${message.error.message || 'unknown error'}`);
        }
        collected.push(...(message.result?.data || []));

        const nextCursor = message.result?.nextCursor;
        if (nextCursor && page < CODEX_MAX_MODEL_PAGES) {
          requestPage(send, nextCursor);
          return undefined;
        }

        return collected;
      }

      return undefined; // Notifications and unrelated ids.
    },
  });

  return models
    .filter((model) => model && !model.hidden && (model.model || model.id))
    .map((model) => {
      // Codex reports which reasoning efforts each model accepts; without this
      // the picker would have to guess from a hand-maintained table that is
      // wrong for every model name it has not seen yet.
      const reasoningEfforts = (Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : [])
        .map((effort) => (typeof effort === 'string' ? effort : effort?.reasoningEffort))
        .filter((effort) => typeof effort === 'string' && effort);

      return {
        value: model.model || model.id,
        label: model.displayName || model.model || model.id,
        description: model.description || undefined,
        isDefault: Boolean(model.isDefault),
        reasoningEfforts: reasoningEfforts.length > 0 ? reasoningEfforts : undefined,
        defaultReasoningEffort: typeof model.defaultReasoningEffort === 'string' ? model.defaultReasoningEffort : undefined,
      };
    });
}

/**
 * Claude Code appends the model configured in the user's own settings to its
 * menu (that is how a `claude-fable-5-1[1m]` set in settings.json shows up in
 * the CLI's /model list). The probe below runs with settings disabled so no
 * hooks can fire, so mirror that one behaviour here: read `model` from the
 * user settings file, honouring CLAUDE_CONFIG_DIR like the CLI does, plus the
 * ANTHROPIC_MODEL override.
 */
function readConfiguredClaudeModels(env = process.env) {
  const values = [];
  if (typeof env.ANTHROPIC_MODEL === 'string' && env.ANTHROPIC_MODEL.trim()) {
    values.push(env.ANTHROPIC_MODEL.trim());
  }
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'));
    if (typeof settings?.model === 'string' && settings.model.trim()) {
      values.push(settings.model.trim());
    }
  } catch (_) {
    // No settings file, or not JSON: nothing configured.
  }
  return values;
}

/**
 * Human label for a Claude model id: `claude-fable-5-1[1m]` -> `Fable 5.1 [1M]`.
 * Ids that do not follow the `claude-<family>-<version>` shape come back as-is.
 */
export function labelForClaudeModelId(value) {
  const match = /^claude-([a-z]+)-(\d+(?:-\d+)*)(\[1m\])?$/i.exec(String(value || ''));
  if (!match) return value;
  const family = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
  const version = match[2].replace(/-/g, '.');
  return `${family} ${version}${match[3] ? ' [1M]' : ''}`;
}

/**
 * Turn the CLI's menu entries into picker labels that stand on their own.
 *
 * The CLI's display names are terse ("Fable", "Sonnet") and reused across
 * versions ("Fable" is both Fable 5 and Fable 5.1), so next to the built-in
 * entries they read as duplicates. The description's leading segment names
 * the concrete version ("Fable 5.1 · Most capable…"), so prefer it whenever
 * it is a more specific form of the display name, and spell out the 1M
 * context variant the way the built-in list does.
 */
export function labelClaudeOptions(options) {
  const counts = new Map();
  for (const option of options) {
    counts.set(option.displayName, (counts.get(option.displayName) || 0) + 1);
  }
  return options.map(({ displayName, ...option }) => {
    const detail = option.description ? String(option.description).split(' · ')[0].trim() : '';
    const baseName = displayName.replace(/\s*\(.*\)$/, '').trim();
    const shared = (counts.get(displayName) || 0) > 1;

    let label;
    if (option.value === 'default') {
      label = detail ? `Default (${detail})` : displayName;
    } else if (detail && detail.toLowerCase().startsWith(baseName.toLowerCase()) && detail.length > baseName.length) {
      label = detail;
    } else if (shared) {
      label = detail && detail !== displayName ? detail : `${displayName} (${option.value})`;
    } else {
      label = displayName;
    }
    if (/\[1m\]$/i.test(option.value) && !/1m/i.test(label)) {
      label = `${label} [1M]`;
    }
    return { ...option, label };
  });
}

/**
 * Claude Code reports the models its bundled CLI serves over the Agent SDK's
 * control channel, so the list tracks the SDK version dr-claw ships rather
 * than a hand-maintained table (the 0.3.226 CLI lists Opus 5 and Fable 5.1;
 * 0.3.170 did not know Opus 5 existed).
 *
 * The session is opened in streaming-input mode with a prompt that never
 * yields: the CLI answers the control request during initialization and is
 * closed before any turn is consumed, so this costs no tokens. Settings
 * sources are disabled so the probe cannot fire SessionStart hooks or pick up
 * project configuration.
 */
async function discoverClaudeModels({ timeoutMs, env = process.env, sdkQuery } = {}) {
  const queryFn = sdkQuery || (await import('@anthropic-ai/claude-agent-sdk')).query;

  async function* idle() {
    await new Promise(() => {});
  }

  const session = queryFn({
    prompt: idle(),
    options: {
      cwd: os.tmpdir(),
      settingSources: [],
      maxTurns: 1,
    },
  });

  let timer;
  try {
    const models = await Promise.race([
      session.supportedModels(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`claude supportedModels timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);

    const served = labelClaudeOptions(
      (Array.isArray(models) ? models : [])
        .filter((model) => model && typeof model.value === 'string' && model.value)
        .map((model) => ({
          value: model.value,
          displayName: model.displayName || model.value,
          description: model.description || undefined,
          // The CLI's "default" pseudo-model resolves to whatever it currently
          // recommends; it is the closest thing the list has to a harness default.
          isDefault: model.value === 'default',
        })),
    );

    for (const configured of readConfiguredClaudeModels(env)) {
      if (!served.some((option) => option.value === configured)) {
        served.push({
          value: configured,
          label: labelForClaudeModelId(configured),
          description: 'Configured in your Claude Code settings',
          isDefault: false,
        });
      }
    }

    return served;
  } finally {
    clearTimeout(timer);
    // close() tears the child down; without it a timed-out probe would leave a
    // CLI process alive for the rest of the server's life.
    try { session.close(); } catch (_) { /* already gone */ }
  }
}

/**
 * OpenRouter publishes its full catalogue over HTTP, so no CLI is involved.
 * The list is thousands of entries long; the picker already allows free-form
 * entry, so we surface it whole and let the combo box filter.
 */
async function discoverOpenRouterModels({ timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`OpenRouter responded ${response.status}`);
    }

    const body = await response.json();
    return (body?.data || [])
      .filter((model) => model?.id)
      .map((model) => ({
        value: model.id,
        label: model.name || model.id,
        description: model.description ? String(model.description).slice(0, 200) : undefined,
      }));
  } finally {
    clearTimeout(timer);
  }
}

const DISCOVERERS = {
  claude: discoverClaudeModels,
  codex: discoverCodexModels,
  openrouter: discoverOpenRouterModels,
};

/** Providers this build knows how to probe. */
export function getDiscoverableProviders() {
  return Object.keys(DISCOVERERS);
}

function buildFallbackPayload(provider, error = null) {
  const config = STATIC_MODELS[provider];
  return {
    provider,
    options: config?.OPTIONS || [],
    default: config?.DEFAULT ?? '',
    allowsCustom: Boolean(config?.ALLOWS_CUSTOM),
    acceptsUnlisted: Boolean(PROVIDER_TRAITS[provider]?.acceptsUnlisted),
    source: 'static',
    discoveredAt: null,
    error: error ? String(error.message || error) : null,
  };
}

async function runDiscovery(provider, { timeoutMs, env, sdkQuery }) {
  const config = STATIC_MODELS[provider];
  const discoverer = DISCOVERERS[provider];
  const acceptsUnlisted = Boolean(PROVIDER_TRAITS[provider]?.acceptsUnlisted);

  if (!discoverer) {
    return buildFallbackPayload(provider);
  }

  try {
    const discovered = await discoverer({ timeoutMs, env, sdkQuery });

    if (!Array.isArray(discovered) || discovered.length === 0) {
      throw new Error('harness returned no models');
    }

    const options = mergeModelOptions(discovered, config?.OPTIONS, { acceptsUnlisted });
    const discoveredDefault = discovered.find((model) => model.isDefault)?.value;

    // Keep the configured default only if the *harness* still serves it — not
    // merely if it survived into the merged list, which also carries retired
    // entries. Defaulting to a model the harness dropped sends every new session
    // straight into an error. A harness that accepts unlisted ids cannot have
    // dropped anything, so its configured default always stands.
    const configuredDefault = config?.DEFAULT;
    const harnessStillServesConfigured = acceptsUnlisted
      || discovered.some((model) => model.value === configuredDefault);

    return {
      provider,
      options,
      default: harnessStillServesConfigured
        ? configuredDefault
        : (discoveredDefault || options[0]?.value || configuredDefault || ''),
      allowsCustom: Boolean(config?.ALLOWS_CUSTOM),
      acceptsUnlisted,
      source: 'discovered',
      discoveredAt: new Date().toISOString(),
      error: null,
    };
  } catch (error) {
    reportDiscoveryFailure(provider, error);
    return buildFallbackPayload(provider, error);
  }
}

/**
 * Resolve the model list for a provider, discovering it when possible.
 *
 * Always resolves — never rejects — so a caller can render a picker
 * unconditionally.
 */
export async function getModelsForProvider(provider, options = {}) {
  const {
    force = false,
    timeoutMs = DISCOVERY_TIMEOUT_MS,
    ttlMs = DISCOVERY_TTL_MS,
    env = process.env,
    sdkQuery = null, // test seam: replaces the Agent SDK's query() for Claude
  } = options;

  if (!STATIC_MODELS[provider]) {
    return { ...buildFallbackPayload(provider), error: `Unknown provider: ${provider}` };
  }

  const cached = cache.get(provider);
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  // Collapse concurrent callers: several picker mounts can race on a cold cache,
  // and each miss spawns a child process. An explicit refresh must not join an
  // already-running probe, though — that probe was started before whatever the
  // user just changed (a CLI upgrade, a login), so its result is exactly the
  // stale answer they asked us to discard.
  if (!force && inFlight.has(provider)) {
    return inFlight.get(provider);
  }

  // Probes are not cancellable, so a superseded one still runs to completion and
  // resolves whenever it likes — often after the probe that replaced it. Stamp
  // each with a generation and let only the newest write to the cache, or a slow
  // stale probe lands last and undoes the refresh that replaced it.
  const myGeneration = (generation.get(provider) || 0) + 1;
  generation.set(provider, myGeneration);

  const promise = runDiscovery(provider, { timeoutMs, env, sdkQuery })
    .then((payload) => {
      if (generation.get(provider) !== myGeneration) {
        return payload;
      }
      // Only a successful probe earns the full TTL. A fallback is re-tried
      // sooner so the picker recovers once the CLI is installed or logged in.
      const ttl = payload.source === 'discovered' ? ttlMs : Math.min(ttlMs, 60_000);
      cache.set(provider, { expiresAt: Date.now() + ttl, payload });
      return payload;
    })
    .finally(() => {
      if (inFlight.get(provider) === promise) {
        inFlight.delete(provider);
      }
    });

  inFlight.set(provider, promise);
  return promise;
}

/**
 * Forget cached results. Also drops the in-flight entry so a probe already
 * running against the old state cannot repopulate the cache after the clear.
 */
export function clearModelDiscoveryCache(provider = null) {
  // Bumping the generation invalidates any probe already running against the
  // state we were just told to forget, so it cannot repopulate the cache.
  const invalidate = (key) => {
    cache.delete(key);
    inFlight.delete(key);
    lastLoggedFailure.delete(key);
    generation.set(key, (generation.get(key) || 0) + 1);
  };

  if (provider) {
    invalidate(provider);
    return;
  }

  for (const key of new Set([...cache.keys(), ...inFlight.keys(), ...generation.keys()])) {
    invalidate(key);
  }
}

export const __testing = {
  readConfiguredClaudeModels,
  discoverClaudeModels,
  discoverCodexModels,
  discoverOpenRouterModels,
  jsonRpcOverStdio,
  STATIC_MODELS,
};
