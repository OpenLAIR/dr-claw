import express from 'express';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { loadAllNodes, loadNodeConfig, ComputeNode } from '../compute-node.js';

const router = express.Router();

// Ensure ~/.local/bin and common paths are on PATH for spawned processes
const EXTENDED_ENV = {
  ...process.env,
  HOME: os.homedir(),
  PATH: [
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.npm-global', 'bin'),
    '/usr/local/bin',
    process.env.PATH || '',
  ].join(':'),
};

function spawnAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`Command failed: ${command} ${args.join(' ')}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

// POST /api/community-tools/configure
// Body: { projectPath, mcpBackend, apiKeys, gpuConfig }
router.post('/configure', async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    const { projectPath, mcpBackend, apiKeys, gpuConfig } = req.body;

    // Resolve project path: use provided path, or fall back to server's working directory
    // (which is typically the VibeLab install directory)
    let resolvedPath;
    if (projectPath && projectPath !== '.') {
      resolvedPath = path.resolve(projectPath);
    } else {
      // Use __dirname parent (VibeLab root) as default
      // community-tools.js is in server/routes/ — go up 2 levels to VibeLab root
      resolvedPath = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..'));
    }

    const results = { steps: [], errors: [] };

    // ── Step 1: Write API keys to ~/.dr-claw/community-tools.json ──
    // (NOT project .env — writing .env triggers Vite restart and kills the fetch)
    if (apiKeys && Object.keys(apiKeys).length > 0) {
      try {
        const configDir = path.join(os.homedir(), '.dr-claw');
        const configPath = path.join(configDir, 'community-tools.json');
        await fs.mkdir(configDir, { recursive: true });

        let existing = {};
        try {
          existing = JSON.parse(await fs.readFile(configPath, 'utf8'));
        } catch {
          // Migrate from legacy ~/.openclaw/ if it exists
          const legacyPath = path.join(os.homedir(), '.openclaw', 'community-tools.json');
          try {
            const legacyData = await fs.readFile(legacyPath, 'utf8');
            existing = JSON.parse(legacyData);
            await fs.writeFile(configPath, legacyData, { mode: 0o600 });
            console.log('[community-tools] Migrated config from ~/.openclaw/ to ~/.dr-claw/');
          } catch {
            // Neither file exists — start fresh
          }
        }

        // Merge keys into config
        const envKeys = existing.envKeys || {};
        for (const [key, value] of Object.entries(apiKeys)) {
          if (value && value.trim()) {
            envKeys[key] = value.trim();
          }
        }
        existing.envKeys = envKeys;

        await fs.writeFile(configPath, JSON.stringify(existing, null, 2), { mode: 0o600 });

        // Also write a shell-sourceable file for convenience
        // Escape values: replace \ with \\, " with \", $ with \$, ` with \`
        const shellEscape = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
        const rcPath = path.join(configDir, 'community-tools.env');
        const rcContent = Object.entries(envKeys)
          .map(([k, v]) => `export ${k}="${shellEscape(v)}"`)
          .join('\n') + '\n';
        await fs.writeFile(rcPath, rcContent, { mode: 0o600 });

        results.steps.push({ step: 'env', status: 'ok', message: `Saved ${Object.keys(apiKeys).length} key(s) to ~/.dr-claw/community-tools.json` });
      } catch (err) {
        results.errors.push({ step: 'env', error: err.message });
      }
    }

    // ── Step 2: Register MCP server ──
    if (mcpBackend) {
      try {
        const mcpCommands = {
          codex: ['mcp', 'add', 'codex', '-s', 'user', '--', 'codex', 'mcp-server'],
          'llm-chat': ['mcp', 'add', 'llm-chat', '-s', 'user', '--', 'python3', path.join(resolvedPath, 'skills/aris-infra/mcp-servers/llm-chat/server.py')],
          gemini: ['mcp', 'add', 'gemini-review', '-s', 'user', '--', 'python3', path.join(resolvedPath, 'skills/aris-infra/mcp-servers/gemini-review/server.py')],
        };

        const ENV_ONLY_BACKENDS = ['gemini-figure'];
        const args = mcpCommands[mcpBackend];
        if (!args) {
          if (ENV_ONLY_BACKENDS.includes(mcpBackend)) {
            results.steps.push({ step: 'mcp', status: 'skipped', message: `No MCP server needed for ${mcpBackend}` });
          } else {
            results.errors.push({ step: 'mcp', error: `Unknown backend: ${mcpBackend}` });
          }
        } else {
          // Check if already registered
          let alreadyRegistered = false;
          try {
            const { stdout } = await spawnAsync('claude', ['mcp', 'list'], { env: EXTENDED_ENV });
            alreadyRegistered = stdout.includes(mcpBackend);
          } catch {
            // claude mcp list failed, proceed with registration
          }

          if (alreadyRegistered) {
            results.steps.push({ step: 'mcp', status: 'skipped', message: `${mcpBackend} MCP already registered` });
          } else {
            await spawnAsync('claude', args, { env: EXTENDED_ENV });
            results.steps.push({ step: 'mcp', status: 'ok', message: `Registered ${mcpBackend} MCP server` });
          }
        }

        // Install codex CLI if needed
        if (mcpBackend === 'codex') {
          try {
            await spawnAsync('which', ['codex']);
            results.steps.push({ step: 'codex-cli', status: 'skipped', message: 'Codex CLI already installed' });
          } catch {
            try {
              await spawnAsync('npm', ['install', '-g', '@openai/codex'], { env: EXTENDED_ENV });
              results.steps.push({ step: 'codex-cli', status: 'ok', message: 'Installed Codex CLI' });
            } catch (err) {
              results.errors.push({ step: 'codex-cli', error: `Failed to install codex: ${err.message}` });
            }
          }
        }
      } catch (err) {
        results.errors.push({ step: 'mcp', error: err.message });
      }
    }

    // ── Step 3: Write GPU config to CLAUDE.md ──
    if (gpuConfig) {
      try {
        const claudeMdPath = path.join(resolvedPath, 'CLAUDE.md');
        let claudeContent = '';
        try {
          claudeContent = await fs.readFile(claudeMdPath, 'utf8');
        } catch {
          // CLAUDE.md doesn't exist
        }

        // Check if GPU section already exists
        if (claudeContent.includes('gpu:')) {
          results.steps.push({ step: 'gpu', status: 'skipped', message: 'GPU config already exists in CLAUDE.md' });
        } else {
          const separator = claudeContent.trim() ? '\n\n' : '';
          await fs.writeFile(claudeMdPath, claudeContent + separator + gpuConfig.trim() + '\n', 'utf8');
          results.steps.push({ step: 'gpu', status: 'ok', message: 'Added GPU config to CLAUDE.md' });
        }
      } catch (err) {
        results.errors.push({ step: 'gpu', error: err.message });
      }
    }

    // ── Step 4: Symlink skills ──
    try {
      const skillsDir = path.join(resolvedPath, 'skills');
      const claudeSkillsDir = path.join(os.homedir(), '.claude', 'skills');
      await fs.mkdir(claudeSkillsDir, { recursive: true });

      let linked = 0;
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && (entry.name.startsWith('aris-') || entry.name.startsWith('inno-') || entry.name === 'autoresearch')) {
          const target = path.join(claudeSkillsDir, entry.name);
          try {
            await fs.access(target);
            // already exists
          } catch {
            await fs.symlink(path.join(skillsDir, entry.name), target);
            linked++;
          }
        }
      }
      results.steps.push({ step: 'skills', status: 'ok', message: `${linked} new skill(s) linked` });
    } catch (err) {
      results.errors.push({ step: 'skills', error: err.message });
    }

    const success = results.errors.length === 0;
    res.json({ success, ...results });
  } catch (error) {
    console.error('Community tools configure error:', error);
    res.status(500).json({ error: 'Configuration failed. Check server logs for details.' });
  }
});

// GET /api/community-tools/status
router.get('/status', async (req, res) => {
  try {
    const projectPath = req.query.path;
    if (!projectPath) {
      return res.status(400).json({ error: 'path query param required' });
    }

    const resolvedPath = path.resolve(projectPath);
    // Validate path is within home directory to prevent path traversal
    if (!resolvedPath.startsWith(os.homedir())) {
      return res.status(403).json({ error: 'Invalid path' });
    }
    const status = {
      mcpRegistered: {},
      envKeys: {},
      gpuConfigured: false,
      skillsLinked: 0,
    };

    // Check MCP servers
    try {
      const { stdout } = await spawnAsync('claude', ['mcp', 'list'], { env: EXTENDED_ENV });
      status.mcpRegistered.codex = stdout.includes('codex');
      status.mcpRegistered['llm-chat'] = stdout.includes('llm-chat');
      status.mcpRegistered.gemini = stdout.includes('gemini-review');
    } catch {
      // claude CLI not available
    }

    // Check .env keys
    try {
      const envContent = await fs.readFile(path.join(resolvedPath, '.env'), 'utf8');
      status.envKeys.OPENAI_API_KEY = envContent.includes('OPENAI_API_KEY=') && !envContent.includes('OPENAI_API_KEY=\n');
      status.envKeys.LLM_API_KEY = envContent.includes('LLM_API_KEY=') && !envContent.includes('LLM_API_KEY=\n');
      status.envKeys.GEMINI_API_KEY = envContent.includes('GEMINI_API_KEY=') && !envContent.includes('GEMINI_API_KEY=\n');
    } catch {
      // no .env
    }

    // Check CLAUDE.md GPU config
    try {
      const claudeContent = await fs.readFile(path.join(resolvedPath, 'CLAUDE.md'), 'utf8');
      status.gpuConfigured = claudeContent.includes('gpu:');
    } catch {
      // no CLAUDE.md
    }

    // Check skill symlinks
    try {
      const claudeSkillsDir = path.join(os.homedir(), '.claude', 'skills');
      const entries = await fs.readdir(claudeSkillsDir);
      status.skillsLinked = entries.filter((e) => e.startsWith('aris-')).length;
    } catch {
      // no skills dir
    }

    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/community-tools/compute-nodes — list available compute nodes for GPU config
router.get('/compute-nodes', async (req, res) => {
  try {
    const config = await loadAllNodes();
    const nodes = (config.nodes || []).map((n) => ({
      id: n.id,
      name: n.name || n.host,
      host: n.host,
      user: n.user,
      port: n.port || 22,
      workDir: n.workDir || '~',
      type: n.type || 'direct',
      gpuInfo: n.gpuInfo || null,
    }));
    res.json({ nodes, activeNodeId: config.activeNodeId });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/community-tools/detect-gpu — detect GPU info from a compute node and return CLAUDE.md template
router.post('/detect-gpu', async (req, res) => {
  try {
    const { nodeId } = req.body;
    if (!nodeId) {
      return res.status(400).json({ error: 'nodeId is required' });
    }

    const node = await loadNodeConfig(nodeId);
    let gpuOutput = '';

    try {
      gpuOutput = await ComputeNode.run({
        nodeId,
        command: 'nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader 2>/dev/null || echo "NO_GPU"',
      });
    } catch (err) {
      gpuOutput = 'NO_GPU';
    }

    // Parse GPU info
    let gpuLine = 'No GPU detected';
    const gpuLines = gpuOutput.trim().split('\n').filter((l) => l && !l.includes('NO_GPU'));

    if (gpuLines.length > 0) {
      // Parse: "0, NVIDIA A100-SXM4-80GB, 81920 MiB"
      const gpus = gpuLines.map((line) => {
        const parts = line.split(',').map((s) => s.trim());
        const name = (parts[1] || 'GPU').replace('NVIDIA ', '');
        const memMb = parseInt(parts[2]) || 0;
        const memGb = Math.round(memMb / 1024);
        return { name, memGb };
      });
      const firstName = gpus[0]?.name || 'GPU';
      const firstMem = gpus[0]?.memGb || 0;
      gpuLine = `${gpus.length}x ${firstName}${firstMem ? ` (${firstMem}GB)` : ''}`;
    }

    // Detect conda
    let condaEnv = '';
    try {
      const condaOut = await ComputeNode.run({
        nodeId,
        command: 'conda info --envs 2>/dev/null | grep "\\*" | head -1 || echo ""',
      });
      const match = condaOut.trim().match(/^(\S+)/);
      if (match && match[1] !== '') {
        condaEnv = match[1];
      }
    } catch {
      // no conda
    }

    // Build SSH command — sanitize user/host to prevent shell injection
    const safeStr = (s) => String(s || '').replace(/[^a-zA-Z0-9._@\-]/g, '');
    const sshCmd = node.port && node.port !== 22
      ? `ssh -p ${parseInt(node.port) || 22} ${safeStr(node.user)}@${safeStr(node.host)}`
      : `ssh ${safeStr(node.user)}@${safeStr(node.host)}`;

    // Generate CLAUDE.md template
    const template = [
      '## Remote Server',
      '- gpu: remote',
      `- SSH: \`${sshCmd}\``,
      `- GPU: ${gpuLine}`,
      condaEnv ? `- Conda: \`conda activate ${condaEnv}\`` : '- Conda: `conda activate your_env`',
      `- Code dir: \`${node.workDir || '~/experiments'}\``,
      '- code_sync: rsync',
    ].join('\n');

    res.json({
      success: true,
      nodeId: node.id,
      nodeName: node.name || node.host,
      gpuLine,
      template,
    });
  } catch (error) {
    console.error('GPU detect error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
