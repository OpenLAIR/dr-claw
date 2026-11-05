import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { credentialsDb } from '../database/db.js';
import { checkCommandAvailable } from '../utils/cliResolution.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Data directory for news config & results
const DATA_DIR = path.join(__dirname, '..', 'data');
export const NEWS_DATA_DIR = DATA_DIR;

/**
 * Tell agent sessions where the news feed results live. Every provider
 * session inherits process.env, and the news-idea-briefing skill reads
 * news-results-*.json from $DRCLAW_NEWS_DATA_DIR. A value set by the user
 * is kept.
 */
export function exposeNewsDataDirToAgents(env = process.env) {
  if (!env.DRCLAW_NEWS_DATA_DIR) {
    env.DRCLAW_NEWS_DATA_DIR = DATA_DIR;
  }
  return env.DRCLAW_NEWS_DATA_DIR;
}
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');

// ---------------------------------------------------------------------------
// Sensitive fields per source. Values for these fields are NEVER stored in
// the news-config-*.json file or returned by GET /api/news/config/:source —
// they live in credentialsDb (per-user, encrypted-at-rest by the same path
// as other credentials). The config JSON only carries `<field>_set: bool`
// for UI display.
// ---------------------------------------------------------------------------
const SECRET_FIELDS_BY_SOURCE = {
  github:      { api_token:  'news_github_token' },
  huggingface: { api_token:  'news_huggingface_token' },
  wechat:      { access_key: 'news_wechat_access_key' },
};

function hasActiveNewsCredential(userId, credentialType) {
  try {
    return Boolean(credentialsDb.getActiveCredential(userId, credentialType));
  } catch {
    return false;
  }
}

// credentialsDb has no native upsert. We enforce one-active-credential-per-type
// by deleting all rows of that type before inserting. (Per-user, so blast
// radius is the user's own news settings.)
function upsertSingleNewsCredential(userId, credentialType, name, value) {
  try {
    const existing = credentialsDb.getCredentials(userId, credentialType) || [];
    for (const cred of existing) {
      try { credentialsDb.deleteCredential(userId, cred.id); } catch { /* keep going */ }
    }
    credentialsDb.createCredential(userId, name, credentialType, value, null);
  } catch (err) {
    console.error(`[news] failed to upsert ${credentialType}: ${err.message}`);
    throw err;
  }
}

function deleteNewsCredentialsByType(userId, credentialType) {
  try {
    const existing = credentialsDb.getCredentials(userId, credentialType) || [];
    for (const cred of existing) {
      try { credentialsDb.deleteCredential(userId, cred.id); } catch { /* keep going */ }
    }
  } catch (err) {
    console.error(`[news] failed to delete ${credentialType}: ${err.message}`);
  }
}

function readActiveNewsCredential(userId, credentialType) {
  try {
    return credentialsDb.getActiveCredential(userId, credentialType) || '';
  } catch {
    return '';
  }
}

// One-time migration: scrub plaintext tokens that may live in news-config-*.json
// from earlier versions of this code path. Moves them into credentialsDb (only
// when no credential exists yet) and rewrites the file without the secret.
async function migrateLegacySecretsInPlace(sourceName, userId, configPath, parsedConfig) {
  const fieldMap = SECRET_FIELDS_BY_SOURCE[sourceName];
  if (!fieldMap) return parsedConfig;

  let mutated = false;
  for (const [field, credentialType] of Object.entries(fieldMap)) {
    const legacyValue = parsedConfig?.[field];
    if (typeof legacyValue === 'string' && legacyValue.trim()) {
      if (!hasActiveNewsCredential(userId, credentialType)) {
        try {
          upsertSingleNewsCredential(
            userId,
            credentialType,
            `${sourceName}_${field}`,
            legacyValue.trim(),
          );
        } catch { /* upsert errors already logged */ }
      }
      delete parsedConfig[field];
      mutated = true;
    }
  }

  if (mutated) {
    try {
      await fs.writeFile(configPath, JSON.stringify(parsedConfig, null, 2), 'utf8');
    } catch (err) {
      console.warn(
        `[news] failed to scrub legacy secret from ${configPath}: ${err.message}`,
      );
    }
  }
  return parsedConfig;
}

function decorateWithSecretFlags(sourceName, userId, config) {
  const fieldMap = SECRET_FIELDS_BY_SOURCE[sourceName];
  if (!fieldMap) return config;

  const safeConfig = { ...config };
  for (const [field, credentialType] of Object.entries(fieldMap)) {
    delete safeConfig[field];
    safeConfig[`${field}_set`] = hasActiveNewsCredential(userId, credentialType);
  }
  return safeConfig;
}
const PYTHON_RUNTIME_CACHE_TTL_MS = 30_000;
const PYTHON_RUNTIME_INSPECTION_CODE = [
  'import importlib.util, json, os, ssl, sys',
  'paths = ssl.get_default_verify_paths()',
  'data = {',
  '  "executable": sys.executable,',
  '  "version": sys.version.split()[0],',
  '  "has_certifi": importlib.util.find_spec("certifi") is not None,',
  '  "cafile": paths.cafile,',
  '  "cafile_exists": bool(paths.cafile and os.path.exists(paths.cafile)),',
  '  "openssl_cafile": paths.openssl_cafile,',
  '  "openssl_cafile_exists": bool(paths.openssl_cafile and os.path.exists(paths.openssl_cafile))',
  '}',
  'print(json.dumps(data))',
].join('\n');

let cachedPythonRuntime = null;
let pythonRuntimeCacheExpiry = 0;

function getPythonRuntimeCandidates() {
  if (process.platform === 'win32') {
    return [
      { command: 'python', args: [], label: 'python' },
      { command: 'py', args: ['-3'], label: 'py -3' },
      { command: 'python3', args: [], label: 'python3' },
    ];
  }

  return [
    { command: 'python3', args: [], label: 'python3' },
    { command: 'python', args: [], label: 'python' },
  ];
}

function inspectPythonRuntime(candidate) {
  return new Promise((resolve) => {
    const child = spawn(candidate.command, [...candidate.args, '-c', PYTHON_RUNTIME_INSPECTION_CODE], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timeout = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(null);
    }, 3000);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', () => {
      clearTimeout(timeout);
      finish(null);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        finish(null);
        return;
      }
      try {
        const inspected = JSON.parse(stdout.trim());
        finish({
          ...candidate,
          ...inspected,
          hasUsableCertificates: Boolean(
            inspected.has_certifi ||
            inspected.cafile_exists ||
            inspected.openssl_cafile_exists
          ),
          stderr: stderr.trim(),
        });
      } catch {
        finish(null);
      }
    });
  });
}

async function resolvePythonRuntime(options = {}) {
  const { refresh = false } = options;

  if (!refresh && cachedPythonRuntime && Date.now() < pythonRuntimeCacheExpiry) {
    return cachedPythonRuntime;
  }

  const inspectedCandidates = [];
  for (const candidate of getPythonRuntimeCandidates()) {
    const probeArgs = [...candidate.args, '--version'];
    if (await checkCommandAvailable(candidate.command, probeArgs, { platform: process.platform })) {
      const inspected = await inspectPythonRuntime(candidate);
      inspectedCandidates.push(inspected || {
        ...candidate,
        executable: null,
        version: null,
        has_certifi: false,
        cafile: null,
        cafile_exists: false,
        openssl_cafile: null,
        openssl_cafile_exists: false,
        hasUsableCertificates: false,
      });
    }
  }

  const selectedRuntime = inspectedCandidates.find((candidate) => candidate?.hasUsableCertificates)
    || inspectedCandidates[0]
    || null;

  if (selectedRuntime) {
    cachedPythonRuntime = selectedRuntime;
    pythonRuntimeCacheExpiry = Date.now() + PYTHON_RUNTIME_CACHE_TTL_MS;
  }

  return selectedRuntime;
}

// ---------------------------------------------------------------------------
// Source Registry
// ---------------------------------------------------------------------------
const SOURCE_REGISTRY = {
  arxiv: {
    label: 'arXiv',
    script: 'research-news/search_arxiv.py',
    configFile: 'news-config-arxiv.json',
    resultsFile: 'news-results-arxiv.json',
    defaultConfig: {
      research_domains: {
        'Large Language Models': {
          keywords: ['large language model', 'LLM', 'transformer', 'foundation model'],
          arxiv_categories: ['cs.AI', 'cs.LG', 'cs.CL'],
          priority: 5,
        },
        'Multimodal': {
          keywords: ['vision-language', 'multimodal', 'image-text', 'visual'],
          arxiv_categories: ['cs.CV', 'cs.MM', 'cs.CL'],
          priority: 4,
        },
        'AI Agents': {
          keywords: ['agent', 'multi-agent', 'orchestration', 'autonomous', 'planning'],
          arxiv_categories: ['cs.AI', 'cs.MA', 'cs.RO'],
          priority: 4,
        },
      },
      top_n: 10,
      max_results: 200,
      categories: 'cs.AI,cs.LG,cs.CL,cs.CV,cs.MM,cs.MA,cs.RO',
    },
    requiresCredentials: false,
  },
  huggingface: {
    label: 'HuggingFace',
    script: 'research-news/search_huggingface.py',
    configFile: 'news-config-huggingface.json',
    resultsFile: 'news-results-huggingface.json',
    defaultConfig: {
      research_domains: {},
      top_n: 30,
      // Comma-separated list of HF Hub modes to fetch.
      // Valid: papers, models, datasets, spaces.
      modes: 'papers,models,datasets,spaces',
      per_mode_limit: 40,
      // HF token (hf_xxx) is stored in credentialsDb, not in this config file.
      // The PUT route accepts an `api_token` field and routes it to the
      // credential store; GET returns `api_token_set: bool` instead.
    },
    requiresCredentials: false,
  },
  x: {
    label: 'X (Twitter)',
    script: 'research-news/search_x.py',
    configFile: 'news-config-x.json',
    resultsFile: 'news-results-x.json',
    defaultConfig: {
      research_domains: {
        'Large Language Models': {
          keywords: ['large language model', 'LLM', 'transformer', 'foundation model'],
          arxiv_categories: [],
          priority: 5,
        },
      },
      top_n: 10,
      queries: 'LLM,AI agents,foundation model',
      accounts: '',
    },
    requiresCredentials: false,
  },
  xiaohongshu: {
    label: 'Xiaohongshu',
    script: 'research-news/search_xiaohongshu.py',
    configFile: 'news-config-xiaohongshu.json',
    resultsFile: 'news-results-xiaohongshu.json',
    defaultConfig: {
      research_domains: {
        'Large Language Models': {
          keywords: ['大模型', 'LLM', 'AI', '人工智能'],
          arxiv_categories: [],
          priority: 5,
        },
      },
      top_n: 10,
      keywords: '大模型,AI论文,人工智能',
    },
    requiresCredentials: false,
  },
  github: {
    label: 'GitHub',
    script: 'research-news/search_github.py',
    configFile: 'news-config-github.json',
    resultsFile: 'news-results-github.json',
    defaultConfig: {
      research_domains: {
        'Large Language Models': {
          keywords: ['llm', 'large language model', 'transformer', 'foundation model'],
          arxiv_categories: [],
          priority: 5,
        },
        'AI Agents': {
          keywords: ['agent', 'autonomous', 'multi-agent', 'orchestration'],
          arxiv_categories: [],
          priority: 4,
        },
      },
      top_n: 12,
      // GitHub-specific
      language: '',                 // optional: python, typescript, ...
      time_window: 'weekly',        // daily | weekly | monthly
      include_trending: true,
      max_search_pages: 1,
      // GitHub token (ghp_xxx) is stored in credentialsDb, not in this config
      // file. PUT accepts `api_token`; GET returns `api_token_set: bool`.
    },
    requiresCredentials: false,
  },
  wechat: {
    label: 'WeChat 公众号',
    script: 'research-news/search_wechat.py',
    configFile: 'news-config-wechat.json',
    resultsFile: 'news-results-wechat.json',
    defaultConfig: {
      research_domains: {},
      top_n: 12,
      // RSSHub instance — public default, configurable in Settings.
      instance_url: 'https://rsshub.app',
      // Comma-separated WeChat 公众号 routes/IDs. Examples:
      //   wechat/ce/huxiu_com
      //   https://rsshub.app/wechat/ce/ifanr
      //   huxiu_com  (bare ID → wechat/ce/<id>)
      accounts: '',
      // RSSHub access key is stored in credentialsDb, not in this config file.
      // PUT accepts `access_key`; GET returns `access_key_set: bool`.
      per_account_limit: 20,
    },
    requiresCredentials: false,
  },
};

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function getSourceEntry(source) {
  return SOURCE_REGISTRY[source] || null;
}

// ---------------------------------------------------------------------------
// GET /api/news/sources — list all sources with status
// ---------------------------------------------------------------------------
router.get('/sources', async (req, res) => {
  try {
    await ensureDataDir();
    const sources = [];
    for (const [key, entry] of Object.entries(SOURCE_REGISTRY)) {
      // Check if results file exists
      let hasResults = false;
      let lastSearchDate = null;
      try {
        const resultsPath = path.join(DATA_DIR, entry.resultsFile);
        const data = JSON.parse(await fs.readFile(resultsPath, 'utf8'));
        hasResults = (data.top_papers?.length ?? 0) > 0;
        lastSearchDate = data.search_date || null;
      } catch { /* no results yet */ }

      // Check credentials status for sources that need them
      let credentialStatus = 'not_required';
      if (entry.requiresCredentials) {
        try {
          const cred = credentialsDb.getActiveCredential(req.user.id, entry.credentialType);
          credentialStatus = cred ? 'configured' : 'missing';
        } catch {
          credentialStatus = 'missing';
        }
      }

      sources.push({
        key,
        label: entry.label,
        hasResults,
        lastSearchDate,
        requiresCredentials: entry.requiresCredentials,
        credentialType: entry.credentialType || null,
        credentialStatus,
      });
    }
    res.json({ sources });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list sources', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/news/config/:source — per-source config
//
// Secret fields (see SECRET_FIELDS_BY_SOURCE) are NEVER returned. Instead the
// response carries `<field>_set: bool` flags for the UI to render a "saved"
// indicator. Legacy plaintext values found in older config files are migrated
// into credentialsDb on first read and scrubbed from disk.
// ---------------------------------------------------------------------------
router.get('/config/:source', async (req, res) => {
  try {
    const entry = getSourceEntry(req.params.source);
    if (!entry) return res.status(404).json({ error: `Unknown source: ${req.params.source}` });

    await ensureDataDir();
    const configPath = path.join(DATA_DIR, entry.configFile);

    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(configPath, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      parsed = { ...entry.defaultConfig };
    }

    parsed = await migrateLegacySecretsInPlace(
      req.params.source, req.user.id, configPath, parsed,
    );
    res.json(decorateWithSecretFlags(req.params.source, req.user.id, parsed));
  } catch (err) {
    res.status(500).json({ error: 'Failed to read config', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/news/config/:source — save per-source config
//
// Secret fields are routed to credentialsDb and stripped from the JSON file:
//   <field>: <non-empty string>  → upsert credential
//   <field>: null                → delete credential (explicit clear)
//   <field>: '' or absent        → no-op (preserve existing credential)
//
// `<field>_set` flags from a round-trip GET are also stripped on write.
// ---------------------------------------------------------------------------
router.put('/config/:source', async (req, res) => {
  try {
    const entry = getSourceEntry(req.params.source);
    if (!entry) return res.status(404).json({ error: `Unknown source: ${req.params.source}` });

    await ensureDataDir();
    const incoming = { ...(req.body || {}) };
    const fieldMap = SECRET_FIELDS_BY_SOURCE[req.params.source] || {};

    for (const [field, credentialType] of Object.entries(fieldMap)) {
      if (Object.prototype.hasOwnProperty.call(incoming, field)) {
        const raw = incoming[field];
        if (raw === null) {
          deleteNewsCredentialsByType(req.user.id, credentialType);
        } else if (typeof raw === 'string' && raw.trim()) {
          upsertSingleNewsCredential(
            req.user.id,
            credentialType,
            `${req.params.source}_${field}`,
            raw.trim(),
          );
        }
        // Anything else (empty string, non-string) is a no-op.
      }
      // Always strip the secret + the round-tripped flag from the on-disk JSON.
      delete incoming[field];
      delete incoming[`${field}_set`];
    }

    const configPath = path.join(DATA_DIR, entry.configFile);
    await fs.writeFile(configPath, JSON.stringify(incoming, null, 2), 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save config', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Search handler — streams progress via Server-Sent Events (SSE)
// ---------------------------------------------------------------------------
async function handleSearch(sourceName, req, res) {
  try {
    const entry = getSourceEntry(sourceName);
    if (!entry) return res.status(404).json({ error: `Unknown source: ${sourceName}` });

    await ensureDataDir();

    // Read current config
    const configPath = path.join(DATA_DIR, entry.configFile);
    let config;
    try {
      config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    } catch {
      config = entry.defaultConfig;
    }

    // Write JSON config for the Python script
    const tmpConfigPath = path.join(DATA_DIR, `research_interests_${sourceName}.json`);
    await fs.writeFile(tmpConfigPath, JSON.stringify(config, null, 2), 'utf8');

    const scriptPath = path.join(SCRIPTS_DIR, entry.script);

    // Check if script exists
    try {
      await fs.access(scriptPath);
    } catch {
      return res.status(404).json({ error: `Search script not found for source: ${sourceName}` });
    }

    const resultsPath = path.join(DATA_DIR, entry.resultsFile);
    const topN = config.top_n || 10;

    // Build args based on source
    // HuggingFace: config is optional (fetches all daily papers without filtering)
    const args = [scriptPath];
    const hasDomains = config.research_domains && Object.keys(config.research_domains).length > 0;
    if (sourceName !== 'huggingface' || hasDomains) {
      args.push('--config', tmpConfigPath);
    }
    args.push('--output', resultsPath, '--top-n', String(topN));

    if (sourceName === 'arxiv') {
      const maxResults = config.max_results || 200;
      const categories = config.categories || 'cs.AI,cs.LG,cs.CL,cs.CV,cs.MM,cs.MA,cs.RO';
      args.push('--max-results', String(maxResults), '--categories', categories);
    }

    if (sourceName === 'x' && config.queries) {
      args.push('--queries', config.queries);
    }
    if (sourceName === 'x' && config.accounts) {
      args.push('--accounts', config.accounts);
    }
    if (sourceName === 'xiaohongshu' && config.keywords) {
      args.push('--keywords', config.keywords);
    }

    if (sourceName === 'huggingface') {
      const modes = (typeof config.modes === 'string' && config.modes.trim())
        ? config.modes.trim()
        : 'papers';
      args.push('--modes', modes);
      if (Number.isFinite(config.per_mode_limit) && config.per_mode_limit > 0) {
        args.push('--per-mode-limit', String(config.per_mode_limit));
      }
    }

    if (sourceName === 'github') {
      if (typeof config.language === 'string' && config.language.trim()) {
        args.push('--language', config.language.trim());
      }
      const timeWindow = ['daily', 'weekly', 'monthly'].includes(config.time_window)
        ? config.time_window
        : 'weekly';
      args.push('--time-window', timeWindow);
      args.push('--include-trending', config.include_trending === false ? 'false' : 'true');
      if (Number.isFinite(config.max_search_pages) && config.max_search_pages > 0) {
        args.push('--max-search-pages', String(Math.min(3, config.max_search_pages)));
      }
    }

    if (sourceName === 'wechat') {
      const instance = (typeof config.instance_url === 'string' && config.instance_url.trim())
        ? config.instance_url.trim()
        : 'https://rsshub.app';
      args.push('--instance', instance);

      // Accounts may be stored as a string (comma/newline-separated) or array.
      let accountsList = [];
      if (Array.isArray(config.accounts)) {
        accountsList = config.accounts.map((a) => String(a).trim()).filter(Boolean);
      } else if (typeof config.accounts === 'string') {
        accountsList = config.accounts
          .split(/[\n,]/)
          .map((a) => a.trim())
          .filter(Boolean);
      }
      if (accountsList.length > 0) {
        args.push('--accounts', accountsList.join(','));
      }

      const wechatAccessKey = readActiveNewsCredential(
        req.user.id,
        SECRET_FIELDS_BY_SOURCE.wechat.access_key,
      );
      if (wechatAccessKey) {
        args.push('--access-key', wechatAccessKey);
      }
      if (Number.isFinite(config.per_account_limit) && config.per_account_limit > 0) {
        args.push('--per-account-limit', String(config.per_account_limit));
      }
    }

    // Build env — pass credentials if required.
    // Strip __PYVENV_LAUNCHER__ so uv-installed Python CLIs invoked by the
    // search scripts find the correct stdlib (macOS Python framework sets this
    // variable and it confuses child interpreters with a different version).
    const env = { ...process.env };
    delete env.__PYVENV_LAUNCHER__;

    // UI-supplied API tokens are read from credentialsDb (per-user) and
    // forwarded to the spawned fetcher only via the child process env. They
    // are never persisted in the news config JSON or echoed back over the API.
    if (sourceName === 'github') {
      const token = readActiveNewsCredential(
        req.user.id, SECRET_FIELDS_BY_SOURCE.github.api_token,
      );
      if (token) env.GITHUB_TOKEN = token;
    }
    if (sourceName === 'huggingface') {
      const token = readActiveNewsCredential(
        req.user.id, SECRET_FIELDS_BY_SOURCE.huggingface.api_token,
      );
      if (token) env.HF_TOKEN = token;
    }
    if (entry.requiresCredentials) {
      try {
        const credValue = credentialsDb.getActiveCredential(req.user.id, entry.credentialType);
        if (!credValue) {
          return res.status(400).json({
            error: `No active credential found for ${entry.label}. Please add your ${entry.credentialType} in settings.`,
          });
        }
        // Map credential types to environment variables
        const credEnvMap = {
          // Add future credential mappings here
        };
        const envVar = credEnvMap[entry.credentialType];
        if (envVar) {
          env[envVar] = credValue;
        }
      } catch (credErr) {
        return res.status(400).json({ error: 'Failed to retrieve credentials', details: credErr.message });
      }
    }

    // Write search logs to a file so they can be polled by the frontend
    const logPath = path.join(DATA_DIR, `news-log-${sourceName}.json`);
    await fs.writeFile(logPath, JSON.stringify([]), 'utf8');
    const logs = [];

    const pythonRuntime = await resolvePythonRuntime();
    if (!pythonRuntime) {
      const details = process.platform === 'win32'
        ? 'No usable Python runtime found. Tried: python, py -3, python3.'
        : 'No usable Python runtime found. Tried: python3, python.';
      logs.push(details);
      try { await fs.writeFile(logPath, JSON.stringify(logs), 'utf8'); } catch {}
      console.error(`[news][${sourceName}] ${details}`);
      return res.status(503).json({
        error: `Search failed for ${entry.label}`,
        details,
        logs,
      });
    }

    const runtimeDetails = [pythonRuntime.label];
    if (pythonRuntime.version) runtimeDetails.push(`Python ${pythonRuntime.version}`);
    if (pythonRuntime.executable) runtimeDetails.push(pythonRuntime.executable);
    logs.push(`[runtime] Using ${runtimeDetails.join(' | ')}`);
    if (!pythonRuntime.hasUsableCertificates) {
      logs.push('[runtime] Warning: selected Python runtime has no detectable CA bundle; HTTPS requests may fail.');
    }
    try { await fs.writeFile(logPath, JSON.stringify(logs), 'utf8'); } catch {}

    const child = spawn(pythonRuntime.command, [...pythonRuntime.args, ...args], {
      cwd: path.join(SCRIPTS_DIR, 'research-news'),
      env,
    });

    let stdout = '';
    let stderrBuf = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', async (data) => {
      const chunk = data.toString();
      stderrBuf += chunk;
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) logs.push(trimmed);
      }
      // Update log file for polling
      try { await fs.writeFile(logPath, JSON.stringify(logs), 'utf8'); } catch {}
    });

    child.on('close', async (code) => {
      if (stderrBuf.trim()) logs.push(stderrBuf.trim());
      try { await fs.writeFile(logPath, JSON.stringify(logs), 'utf8'); } catch {}

      // A spawn failure can emit both 'error' and 'close'; guard against a double response.
      if (res.headersSent) return;

      if (code !== 0) {
        console.error(`[news][${sourceName}] script failed (exit ${code})`);
        return res.status(500).json({
          error: `Search failed for ${entry.label}`,
          details: logs.join('\n'),
          logs,
          exitCode: code,
        });
      }

      try {
        const results = JSON.parse(await fs.readFile(resultsPath, 'utf8'));
        results.logs = logs;
        res.json(results);
      } catch (readErr) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to read search results', details: readErr.message });
        }
      }
    });

    child.on('error', (err) => {
      console.error(`[news][${sourceName}] Failed to spawn script:`, err);
      if (res.headersSent) return;
      res.status(500).json({ error: 'Failed to execute search script', details: err.message });
    });
  } catch (err) {
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
}

// POST /api/news/search/:source — trigger search for one source
router.post('/search/:source', (req, res) => handleSearch(req.params.source, req, res));

// GET /api/news/logs/:source — poll search progress logs
router.get('/logs/:source', async (req, res) => {
  try {
    const entry = getSourceEntry(req.params.source);
    if (!entry) return res.status(404).json({ error: `Unknown source: ${req.params.source}` });

    const logPath = path.join(DATA_DIR, `news-log-${req.params.source}.json`);
    const data = await fs.readFile(logPath, 'utf8');
    res.json({ logs: JSON.parse(data) });
  } catch {
    res.json({ logs: [] });
  }
});

// ---------------------------------------------------------------------------
// POST /api/news/xhs-login — trigger xiaohongshu-cli login
// ---------------------------------------------------------------------------
router.post('/xhs-login', (req, res) => {
  const requestedMethod = req.body?.method === 'qrcode' ? 'qrcode' : 'browser';
  const requestedCookieSource = typeof req.body?.cookieSource === 'string'
    ? req.body.cookieSource.trim().toLowerCase()
    : 'auto';
  const allowedCookieSources = new Set([
    'auto', 'arc', 'brave', 'chrome', 'chromium', 'edge', 'firefox', 'librewolf', 'opera', 'opera_gx', 'safari', 'vivaldi',
  ]);
  const cookieSource = allowedCookieSources.has(requestedCookieSource) ? requestedCookieSource : 'auto';
  const commandArgs = ['login'];
  if (requestedMethod === 'qrcode') {
    commandArgs.push('--qrcode');
  } else if (cookieSource !== 'auto') {
    commandArgs.push('--cookie-source', cookieSource);
  }
  commandArgs.push('--json');

  const xhsEnv = { ...process.env };
  delete xhsEnv.__PYVENV_LAUNCHER__;
  const child = spawn('xhs', commandArgs, {
    env: xhsEnv,
  });

  let stdoutBuf = '';
  let stderrBuf = '';
  const logs = [];
  let responded = false;

  const sendOnce = (status, payload) => {
    if (responded || res.headersSent) return;
    responded = true;
    res.status(status).json(payload);
  };

  child.stdout.on('data', (data) => { stdoutBuf += data.toString(); });
  child.stderr.on('data', (data) => {
    stderrBuf += data.toString();
    const lines = stderrBuf.split('\n');
    stderrBuf = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) logs.push(trimmed);
    }
  });

  child.on('close', (code) => {
    if (stderrBuf.trim()) logs.push(stderrBuf.trim());

    let authenticated = false;
    let nickname = '';
    let error = '';
    let contextHint = '';
    try {
      const result = JSON.parse(stdoutBuf);
      authenticated = !!(result?.ok && result?.data?.authenticated);
      nickname = result?.data?.user?.nickname || '';
      if (!authenticated) {
        error = result?.error?.message || result?.message || '';
      }
    } catch {
      authenticated = code === 0;
      if (!authenticated) {
        error = stdoutBuf.trim();
      }
    }

    if (!authenticated && !error) {
      error = requestedMethod === 'qrcode'
        ? 'QR login failed or timed out.'
        : 'Browser cookie extraction failed.';
    }

    if (!authenticated) {
      contextHint = requestedMethod === 'qrcode'
        ? 'QR login is recommended for remote deployments and Linux browser-cookie issues.'
        : 'Browser cookie extraction runs on the machine hosting the dr-claw service, not on the device where this page is open.';
    }

    sendOnce(200, {
      success: authenticated,
      nickname,
      logs,
      exitCode: code,
      method: requestedMethod,
      cookieSource,
      error,
      contextHint: contextHint || undefined,
    });
  });

  child.on('error', (err) => {
    const contextHint = requestedMethod === 'qrcode'
      ? 'QR login is recommended for remote deployments and Linux browser-cookie issues.'
      : 'Browser cookie extraction runs on the machine hosting the dr-claw service, not on the device where this page is open.';

    sendOnce(500, {
      success: false,
      error: `Failed to run xhs login: ${err.message}`,
      logs,
      method: requestedMethod,
      cookieSource,
      contextHint,
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/news/results/:source — cached results for one source
// ---------------------------------------------------------------------------
router.get('/results/:source', async (req, res) => {
  try {
    const entry = getSourceEntry(req.params.source);
    if (!entry) return res.status(404).json({ error: `Unknown source: ${req.params.source}` });

    const resultsPath = path.join(DATA_DIR, entry.resultsFile);
    const data = await fs.readFile(resultsPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.json({ top_papers: [], total_found: 0, total_filtered: 0 });
    } else {
      res.status(500).json({ error: 'Failed to read results', details: err.message });
    }
  }
});

// ---------------------------------------------------------------------------
// Backward-compatible aliases (old routes → arxiv source)
// ---------------------------------------------------------------------------
router.get('/config', async (req, res) => {
  try {
    await ensureDataDir();
    const entry = SOURCE_REGISTRY.arxiv;
    const configPath = path.join(DATA_DIR, entry.configFile);
    const data = await fs.readFile(configPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.json(SOURCE_REGISTRY.arxiv.defaultConfig);
    } else {
      res.status(500).json({ error: 'Failed to read config', details: err.message });
    }
  }
});

router.put('/config', async (req, res) => {
  try {
    const entry = SOURCE_REGISTRY.arxiv;
    await ensureDataDir();
    const configPath = path.join(DATA_DIR, entry.configFile);
    await fs.writeFile(configPath, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save config', details: err.message });
  }
});

router.post('/search', (req, res) => handleSearch('arxiv', req, res));

router.get('/results', async (req, res) => {
  try {
    const entry = SOURCE_REGISTRY.arxiv;
    const resultsPath = path.join(DATA_DIR, entry.resultsFile);
    const data = await fs.readFile(resultsPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Also try the legacy path for backward compat
      try {
        const legacyPath = path.join(DATA_DIR, 'news-results.json');
        const data = await fs.readFile(legacyPath, 'utf8');
        res.json(JSON.parse(data));
      } catch {
        res.json({ top_papers: [], total_found: 0, total_filtered: 0 });
      }
    } else {
      res.status(500).json({ error: 'Failed to read results', details: err.message });
    }
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildYamlConfig(config) {
  let yaml = '# Auto-generated from Dr. Claw News Dashboard config\n\n';
  yaml += 'research_domains:\n';

  const domains = config.research_domains || {};
  for (const [name, domain] of Object.entries(domains)) {
    yaml += `  "${name}":\n`;
    yaml += `    keywords:\n`;
    for (const kw of domain.keywords || []) {
      yaml += `      - "${kw}"\n`;
    }
    if (domain.arxiv_categories?.length) {
      yaml += `    arxiv_categories:\n`;
      for (const cat of domain.arxiv_categories) {
        yaml += `      - "${cat}"\n`;
      }
    }
    if (domain.priority) {
      yaml += `    priority: ${domain.priority}\n`;
    }
  }

  return yaml;
}

export default router;
