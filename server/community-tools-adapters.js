import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const SETUP_BASE = path.join(os.homedir(), '.openclaw', 'community-tools');

/** Bundled source inside the repo (read-only). */
function getBundledDir(tool) {
  return path.join(REPO_ROOT, tool.localPath || `community-tools/${tool.id}`);
}

/** Mutable artifacts dir (~/.openclaw/community-tools/{id}). */
function getSetupDir(toolId) {
  return path.join(SETUP_BASE, toolId);
}

// ── Helpers ──

function exec(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { shell: true, ...options });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Command failed (code ${code}): ${stderr || stdout}`));
    });
    proc.on('error', reject);
  });
}

async function dirExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function copyDirRecursive(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function rmrf(p) {
  try { await fs.rm(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ══════════════════════════════════════════════════
// ClaudeSkillAdapter  (type: "claude-skill")
// ══════════════════════════════════════════════════

export const ClaudeSkillAdapter = {
  async install(tool, onLog) {
    const bundledDir = getBundledDir(tool);
    if (!await dirExists(bundledDir)) {
      throw new Error(`Bundled source not found at ${bundledDir}. Run "git submodule update --init".`);
    }
    onLog?.('Syncing skill files from bundled source …');
    await this._syncFiles(tool, bundledDir, onLog);
    onLog?.('Installation complete.');
    return { installDir: bundledDir, installedAt: new Date().toISOString() };
  },

  async uninstall(tool, _installDir, onLog) {
    const claudeHome = path.join(os.homedir(), '.claude');
    const skillsDest = path.join(claudeHome, 'skills', tool.id);
    const commandsDest = path.join(claudeHome, 'commands', tool.id);
    onLog?.('Removing skill files …');
    await rmrf(skillsDest);
    await rmrf(commandsDest);
    onLog?.('Uninstall complete.');
  },

  async doctor(tool, _installDir, onLog) {
    const results = [];
    // Check Claude CLI
    try {
      await exec('claude', ['--version']);
      results.push({ check: 'Claude Code CLI', ok: true });
    } catch {
      results.push({ check: 'Claude Code CLI', ok: false, message: 'claude command not found in PATH' });
    }
    // Check ~/.claude directory
    const claudeHome = path.join(os.homedir(), '.claude');
    if (await dirExists(claudeHome)) {
      results.push({ check: '~/.claude directory', ok: true });
    } else {
      results.push({ check: '~/.claude directory', ok: false, message: 'Directory does not exist' });
    }
    // Check bundled source
    const bundledDir = getBundledDir(tool);
    if (await dirExists(bundledDir)) {
      results.push({ check: 'Bundled source', ok: true });
    } else {
      results.push({ check: 'Bundled source', ok: false, message: `Not found at ${bundledDir}` });
    }
    return results;
  },

  // ── internal ──
  async _syncFiles(tool, bundledDir, onLog) {
    const claudeHome = path.join(os.homedir(), '.claude');
    const toolId = tool.id;

    // Try common repo layouts for skill files
    const skillsSrc = path.join(bundledDir, 'claude-plugin', 'skills', toolId);
    const commandsSrc = path.join(bundledDir, 'claude-plugin', 'commands', toolId);

    if (await dirExists(skillsSrc)) {
      const dest = path.join(claudeHome, 'skills', toolId);
      await rmrf(dest);
      await copyDirRecursive(skillsSrc, dest);
      onLog?.(`Synced skills to ~/.claude/skills/${toolId}`);
    }
    if (await dirExists(commandsSrc)) {
      const dest = path.join(claudeHome, 'commands', toolId);
      await rmrf(dest);
      await copyDirRecursive(commandsSrc, dest);
      onLog?.(`Synced commands to ~/.claude/commands/${toolId}`);
    }

    // Fallback: check root-level skills/ and commands/ dirs
    const altSkillsSrc = path.join(bundledDir, 'skills');
    const altCommandsSrc = path.join(bundledDir, 'commands');
    if (!await dirExists(skillsSrc) && await dirExists(altSkillsSrc)) {
      const dest = path.join(claudeHome, 'skills', toolId);
      await rmrf(dest);
      await copyDirRecursive(altSkillsSrc, dest);
      onLog?.('Synced skills from root skills/ dir');
    }
    if (!await dirExists(commandsSrc) && await dirExists(altCommandsSrc)) {
      const dest = path.join(claudeHome, 'commands', toolId);
      await rmrf(dest);
      await copyDirRecursive(altCommandsSrc, dest);
      onLog?.('Synced commands from root commands/ dir');
    }
  },
};

// ══════════════════════════════════════════════════
// Python environment helpers (prefer uv, fallback to venv+pip)
// ══════════════════════════════════════════════════

let _hasUv = null;
async function hasUv() {
  if (_hasUv === null) {
    try { await exec('uv', ['--version']); _hasUv = true; } catch { _hasUv = false; }
  }
  return _hasUv;
}

/** Extract minimum minor version from a requirement string like ">=3.11". */
function parseMinVersion(req = '>=3.11') {
  const m = req.match(/(\d+)\.(\d+)/);
  return { major: m ? parseInt(m[1]) : 3, minor: m ? parseInt(m[2]) : 11 };
}

async function createVenv(venvDir, pythonVersion, onLog) {
  if (await hasUv()) {
    const { major, minor } = parseMinVersion(pythonVersion);
    onLog?.(`Creating venv via uv (Python ${major}.${minor}+) …`);
    await exec('uv', ['venv', '--python', `${major}.${minor}`, venvDir]);
  } else {
    onLog?.('Creating venv via python3 -m venv …');
    await exec('python3', ['-m', 'venv', venvDir]);
  }
}

async function pipInstall(venvDir, args, opts = {}, onLog) {
  if (await hasUv()) {
    const python = path.join(venvDir, 'bin', 'python');
    onLog?.('Installing dependencies via uv …');
    await exec('uv', ['pip', 'install', '--python', python, ...args], opts);
  } else {
    const pip = path.join(venvDir, 'bin', 'pip');
    onLog?.('Upgrading pip …');
    await exec(pip, ['install', '--upgrade', 'pip']);
    onLog?.('Installing dependencies …');
    await exec(pip, ['install', ...args], opts);
  }
}

// ══════════════════════════════════════════════════
// PythonAppAdapter  (type: "python-app")
// ══════════════════════════════════════════════════

export const PythonAppAdapter = {
  async install(tool, onLog) {
    const bundledDir = getBundledDir(tool);
    if (!await dirExists(bundledDir)) {
      throw new Error(`Bundled source not found at ${bundledDir}. Run "git submodule update --init".`);
    }

    const setupDir = getSetupDir(tool.id);
    await fs.mkdir(setupDir, { recursive: true });

    const venvDir = path.join(setupDir, '.venv');
    await createVenv(venvDir, tool.requirements?.pythonVersion, onLog);
    await pipInstall(venvDir, ['-e', '.'], { cwd: bundledDir }, onLog);
    onLog?.('Dependencies installed.');

    return { installDir: bundledDir, setupDir, installedAt: new Date().toISOString() };
  },

  async configure(tool, _installDir, config, onLog) {
    const setupDir = getSetupDir(tool.id);
    await fs.mkdir(setupDir, { recursive: true });
    const yamlLines = [];
    for (const [key, value] of Object.entries(config)) {
      yamlLines.push(`${key}: ${JSON.stringify(value)}`);
    }
    const configPath = path.join(setupDir, 'config.arc.yaml');
    await fs.writeFile(configPath, yamlLines.join('\n') + '\n');
    onLog?.(`Configuration written to ${configPath}`);
  },

  run(tool, _installDir, command, args = [], onData) {
    const bundledDir = getBundledDir(tool);
    const setupDir = getSetupDir(tool.id);
    const venvBin = path.join(setupDir, '.venv', 'bin');
    const env = { ...process.env, PATH: `${venvBin}:${process.env.PATH}`, VIRTUAL_ENV: path.join(setupDir, '.venv') };
    const cmdArgs = [command, ...args];
    const proc = spawn('researchclaw', cmdArgs, { cwd: bundledDir, env, shell: true });

    proc.stdout?.on('data', (d) => onData?.(d.toString()));
    proc.stderr?.on('data', (d) => onData?.(d.toString()));

    return proc;
  },

  async uninstall(tool, _installDir, onLog) {
    const setupDir = getSetupDir(tool.id);
    onLog?.('Removing setup directory (venv + config) …');
    await rmrf(setupDir);
    onLog?.('Uninstall complete.');
  },

  async doctor(tool, _installDir, onLog) {
    const results = [];
    const reqVersion = tool.requirements?.pythonVersion || '>=3.11';

    // Check uv
    if (await hasUv()) {
      results.push({ check: 'uv', ok: true, message: 'Available (fast installs)' });
    } else {
      results.push({ check: 'uv', ok: true, message: 'Not found — will use pip (slower)' });
    }

    // Check Python version in venv
    const setupDir = getSetupDir(tool.id);
    const venvPython = path.join(setupDir, '.venv', 'bin', 'python');
    try {
      const version = await exec(venvPython, ['--version']);
      results.push({ check: `Python ${reqVersion}`, ok: true, message: version });
    } catch {
      results.push({ check: `Python ${reqVersion}`, ok: false, message: 'venv python not found — try reinstalling' });
    }

    // Check bundled source
    const bundledDir = getBundledDir(tool);
    if (await dirExists(bundledDir)) {
      results.push({ check: 'Bundled source', ok: true });
    } else {
      results.push({ check: 'Bundled source', ok: false, message: `Not found at ${bundledDir}` });
    }

    // Check venv in setup dir
    const setupDir = getSetupDir(tool.id);
    const venvDir = path.join(setupDir, '.venv');
    if (await dirExists(venvDir)) {
      results.push({ check: 'Virtual environment', ok: true });
    } else {
      results.push({ check: 'Virtual environment', ok: false, message: '.venv not found in setup dir' });
    }

    return results;
  },
};

// ══════════════════════════════════════════════════
// Adapter registry
// ══════════════════════════════════════════════════

const adapters = {
  'claude-skill': ClaudeSkillAdapter,
  'python-app': PythonAppAdapter,
};

export function getAdapter(type) {
  const adapter = adapters[type];
  if (!adapter) throw new Error(`Unknown tool type: ${type}`);
  return adapter;
}
