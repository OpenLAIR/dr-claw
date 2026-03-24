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

  async update(tool, _installDir, onLog) {
    const bundledDir = getBundledDir(tool);
    onLog?.('Re-syncing skill files from bundled source …');
    await this._syncFiles(tool, bundledDir, onLog);
    onLog?.('Update complete.');
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

    onLog?.('Creating virtual environment …');
    const venvDir = path.join(setupDir, '.venv');
    await exec('python3', ['-m', 'venv', venvDir]);
    const pip = path.join(venvDir, 'bin', 'pip');
    onLog?.('Upgrading pip …');
    await exec(pip, ['install', '--upgrade', 'pip']);
    onLog?.('Installing dependencies …');
    await exec(pip, ['install', '-e', '.'], { cwd: bundledDir });
    onLog?.('Dependencies installed.');

    return { installDir: bundledDir, setupDir, installedAt: new Date().toISOString() };
  },

  async update(tool, _installDir, onLog) {
    const bundledDir = getBundledDir(tool);
    const setupDir = getSetupDir(tool.id);
    const pip = path.join(setupDir, '.venv', 'bin', 'pip');
    onLog?.('Updating dependencies …');
    await exec(pip, ['install', '-e', '.'], { cwd: bundledDir });
    onLog?.('Update complete.');
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

    // Check Python version
    try {
      const version = await exec('python3', ['--version']);
      const match = version.match(/(\d+)\.(\d+)/);
      if (match && (parseInt(match[1]) > 3 || (parseInt(match[1]) === 3 && parseInt(match[2]) >= 11))) {
        results.push({ check: 'Python >= 3.11', ok: true, message: version });
      } else {
        results.push({ check: 'Python >= 3.11', ok: false, message: `Found ${version}, need 3.11+` });
      }
    } catch {
      results.push({ check: 'Python >= 3.11', ok: false, message: 'python3 not found' });
    }

    // Check pip
    try {
      await exec('python3', ['-m', 'pip', '--version']);
      results.push({ check: 'pip', ok: true });
    } catch {
      results.push({ check: 'pip', ok: false, message: 'pip not available' });
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
