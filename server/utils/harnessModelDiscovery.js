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
export function mergeModelOptions(discovered, staticOptions) {
  const seen = new Set();
  const merged = [];

  for (const option of discovered) {
    if (!option?.value || seen.has(option.value)) continue;
    seen.add(option.value);
    merged.push({ value: option.value, label: option.label || option.value });
  }

  for (const option of staticOptions || []) {
    if (!option?.value || seen.has(option.value)) continue;
    seen.add(option.value);
    merged.push({ ...option, deprecated: true });
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
    .map((model) => ({
      value: model.model || model.id,
      label: model.displayName || model.model || model.id,
      description: model.description || undefined,
      isDefault: Boolean(model.isDefault),
    }));
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
    source: 'static',
    discoveredAt: null,
    error: error ? String(error.message || error) : null,
  };
}

async function runDiscovery(provider, { timeoutMs, env }) {
  const config = STATIC_MODELS[provider];
  const discoverer = DISCOVERERS[provider];

  if (!discoverer) {
    return buildFallbackPayload(provider);
  }

  try {
    const discovered = await discoverer({ timeoutMs, env });

    if (!Array.isArray(discovered) || discovered.length === 0) {
      throw new Error('harness returned no models');
    }

    const options = mergeModelOptions(discovered, config?.OPTIONS);
    const discoveredDefault = discovered.find((model) => model.isDefault)?.value;

    // Keep the configured default only if the *harness* still serves it — not
    // merely if it survived into the merged list, which also carries retired
    // entries. Defaulting to a model the harness dropped sends every new session
    // straight into an error.
    const configuredDefault = config?.DEFAULT;
    const harnessStillServesConfigured = discovered.some((model) => model.value === configuredDefault);

    return {
      provider,
      options,
      default: harnessStillServesConfigured
        ? configuredDefault
        : (discoveredDefault || options[0]?.value || configuredDefault || ''),
      allowsCustom: Boolean(config?.ALLOWS_CUSTOM),
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

  const promise = runDiscovery(provider, { timeoutMs, env })
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
  discoverCodexModels,
  discoverOpenRouterModels,
  jsonRpcOverStdio,
  STATIC_MODELS,
};
