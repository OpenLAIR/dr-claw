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
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
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
    label: 'HuggingFace Daily Papers',
    script: 'research-news/search_huggingface.py',
    configFile: 'news-config-huggingface.json',
    resultsFile: 'news-results-huggingface.json',
    defaultConfig: {
      research_domains: {},
      top_n: 30,
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
// ---------------------------------------------------------------------------
router.get('/config/:source', async (req, res) => {
  try {
    const entry = getSourceEntry(req.params.source);
    if (!entry) return res.status(404).json({ error: `Unknown source: ${req.params.source}` });

    await ensureDataDir();
    const configPath = path.join(DATA_DIR, entry.configFile);
    const data = await fs.readFile(configPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    if (err.code === 'ENOENT') {
      const entry = getSourceEntry(req.params.source);
      res.json(entry.defaultConfig);
    } else {
      res.status(500).json({ error: 'Failed to read config', details: err.message });
    }
  }
});

// ---------------------------------------------------------------------------
// PUT /api/news/config/:source — save per-source config
// ---------------------------------------------------------------------------
router.put('/config/:source', async (req, res) => {
  try {
    const entry = getSourceEntry(req.params.source);
    if (!entry) return res.status(404).json({ error: `Unknown source: ${req.params.source}` });

    await ensureDataDir();
    const configPath = path.join(DATA_DIR, entry.configFile);
    await fs.writeFile(configPath, JSON.stringify(req.body, null, 2), 'utf8');
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

    // Build env — pass credentials if required.
    // Strip __PYVENV_LAUNCHER__ so uv-installed Python CLIs invoked by the
    // search scripts find the correct stdlib (macOS Python framework sets this
    // variable and it confuses child interpreters with a different version).
    const env = { ...process.env };
    delete env.__PYVENV_LAUNCHER__;
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
        res.status(500).json({ error: 'Failed to read search results', details: readErr.message });
      }
    });

    child.on('error', (err) => {
      console.error(`[news][${sourceName}] Failed to spawn script:`, err);
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
