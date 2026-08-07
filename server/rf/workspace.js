// ResearchFlow — workspace / execution adapter (Phase 5)
//
// ResearchFlow Desktop runs on Windows; research code may live on the Windows
// filesystem or inside WSL2. This module defines the controlled adapter
// boundary (SPEC §19 / Implementation Prompt §13):
//
//   interface ExecutionAdapter {
//     validate(): Promise<EnvironmentStatus>
//     exists(path): Promise<boolean>
//     git(args, cwd): Promise<ExecutionResult>
//     openTerminal?(cwd): Promise<void>
//   }
//
// V1 scope is intentionally limited: represent the workspace, validate distro
// + path, open a terminal, retrieve git status via controlled commands.
// No schedulers, GPU queues, SSH, or arbitrary script orchestration.
//
// Safety: ALL subprocess execution uses `spawn` with argument arrays — never
// shell-concatenated strings. Distro and path inputs are validated before use.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const WORKSPACE_TYPES = ['none', 'windows', 'wsl'];

// ---------------------------------------------------------------------------
// Validation (pure, unit-testable)
// ---------------------------------------------------------------------------

export function validateWorkspaceType(value) {
  return WORKSPACE_TYPES.includes(value);
}

// Distro names: letters/digits/dot/underscore/hyphen, no spaces, no slashes,
// no leading '-'. Prevents `--` / option injection into `wsl.exe -d`.
const DISTRO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validateWslDistro(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && DISTRO_RE.test(value);
}

// WSL paths must be absolute Linux paths: start with '/', no NUL/newline, and
// must not contain Windows-style separators ('\\' or drive letters).
export function validateWslPath(value) {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.includes('\0') &&
    !value.includes('\n') &&
    !value.includes('\\') &&
    !/^[A-Za-z]:/.test(value)
  );
}

// Windows paths: no NUL/newline; must be absolute (drive letter or UNC).
export function validateWindowsPath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('\0') &&
    !value.includes('\n') &&
    (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\'))
  );
}

export function validateWorkspaceFields({ workspaceType, windowsPath, wslDistro, wslPath }) {
  if (!validateWorkspaceType(workspaceType)) {
    return { ok: false, errors: [`Invalid workspace_type "${workspaceType}"`] };
  }
  const errors = [];
  if (workspaceType === 'windows' && !validateWindowsPath(windowsPath)) {
    errors.push('workspace_type "windows" requires a valid absolute Windows path (e.g. D:\\Research\\ProjectA)');
  }
  if (workspaceType === 'wsl') {
    if (!validateWslDistro(wslDistro)) {
      errors.push('workspace_type "wsl" requires a valid distro name (letters/digits/._- only, no spaces)');
    }
    if (!validateWslPath(wslPath)) {
      errors.push('workspace_type "wsl" requires a valid absolute Linux path (e.g. /home/user/project)');
    }
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Spawn helper (runner injectable for tests)
// ---------------------------------------------------------------------------

function defaultRunner(command, args, options) {
  return spawn(command, args, options);
}

function runWithTimeout(runner, command, args, { timeoutMs = 10000, cwd, detached, stdio }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = runner(command, args, { cwd, detached, stdio: stdio || ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // already exited
      }
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`));
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

export class WindowsLocalAdapter {
  constructor({ runner = defaultRunner } = {}) {
    this.type = 'windows';
    this.runner = runner;
  }

  async validate({ windowsPath } = {}) {
    if (!validateWindowsPath(windowsPath)) {
      return { ok: false, errors: ['Invalid Windows path'] };
    }
    try {
      const stat = fs.statSync(windowsPath);
      return { ok: stat.isDirectory(), errors: stat.isDirectory() ? [] : ['Path is not a directory'] };
    } catch (error) {
      return { ok: false, errors: [`Cannot access path: ${error.message}`] };
    }
  }

  async exists(p) {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  }

  // git(args, cwd) — controlled: spawn('git', ['-C', cwd, ...args]) with an
  // argument array. cwd must be an absolute Windows path (validated).
  async git(args = [], cwd) {
    if (!validateWindowsPath(cwd)) {
      throw new Error('git: invalid Windows cwd');
    }
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
      throw new Error('git: args must be an array of strings');
    }
    return runWithTimeout(this.runner, 'git', ['-C', cwd, ...args], { timeoutMs: 15000 });
  }

  // Open a terminal/folder for a Windows workspace: use explorer.exe to open
  // the directory (V1 scope — "Open Files" action).
  async openTerminal({ windowsPath } = {}) {
    if (!validateWindowsPath(windowsPath)) {
      throw new Error('Invalid Windows path');
    }
    const child = this.runner('explorer.exe', [windowsPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { ok: true };
  }
}

export class WSLAdapter {
  constructor({ distro, runner = defaultRunner } = {}) {
    if (!validateWslDistro(distro)) {
      throw new Error(`Invalid WSL distro: "${distro}"`);
    }
    this.type = 'wsl';
    this.distro = distro;
    this.runner = runner;
  }

  // wsl.exe -d <distro> -- test -d <path>
  async validate({ wslPath } = {}) {
    if (!validateWslPath(wslPath)) {
      return { ok: false, errors: ['Invalid WSL path'] };
    }
    const { code, stderr } = await runWithTimeout(
      this.runner,
      'wsl.exe',
      ['-d', this.distro, '--', 'test', '-d', wslPath],
      { timeoutMs: 15000 }
    );
    if (code === 0) {
      return { ok: true, errors: [] };
    }
    return { ok: false, errors: [`Path not accessible in distro "${this.distro}"${stderr ? `: ${stderr}` : ''}`] };
  }

  async exists(wslPath) {
    if (!validateWslPath(wslPath)) {
      return false;
    }
    const { code } = await runWithTimeout(this.runner, 'wsl.exe', ['-d', this.distro, '--', 'test', '-d', wslPath]);
    return code === 0;
  }

  // git(args, cwd) — cwd is the LINUX path inside the distro; passed via
  // `git -C` (the wsl.exe process's own cwd is a Windows path we never rely on).
  async git(args = [], cwd) {
    if (!validateWslPath(cwd)) {
      throw new Error('git: invalid WSL cwd');
    }
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
      throw new Error('git: args must be an array of strings');
    }
    return runWithTimeout(
      this.runner,
      'wsl.exe',
      ['-d', this.distro, '--', 'git', '-C', cwd, ...args],
      { timeoutMs: 15000 }
    );
  }

  // Open a terminal inside the distro at the workspace path.
  async openTerminal({ wslPath } = {}) {
    if (!validateWslPath(wslPath)) {
      throw new Error('Invalid WSL path');
    }
    const child = this.runner('wsl.exe', ['-d', this.distro, '--cd', wslPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWorkspaceAdapter(project, { runner } = {}) {
  const { workspace_type: workspaceType, windows_path: windowsPath, wsl_distro: wslDistro, wsl_path: wslPath } = project || {};
  if (workspaceType === 'windows') {
    return new WindowsLocalAdapter({ runner });
  }
  if (workspaceType === 'wsl') {
    return new WSLAdapter({ distro: wslDistro, runner });
  }
  return null;
}

export function workspacePathFor(project) {
  if (!project) {
    return null;
  }
  if (project.workspace_type === 'windows') {
    return project.windows_path;
  }
  if (project.workspace_type === 'wsl') {
    return project.wsl_path;
  }
  return null;
}

// Convenience: validate an existing project's stored workspace metadata.
export async function validateProjectWorkspace(project, { runner } = {}) {
  if (!project || !project.workspace_type || project.workspace_type === 'none') {
    return { ok: false, type: null, errors: ['No workspace configured'] };
  }
  const adapter = createWorkspaceAdapter(project, { runner });
  if (!adapter) {
    return { ok: false, type: project.workspace_type, errors: ['Unsupported workspace type'] };
  }
  const target = project.workspace_type === 'windows'
    ? { windowsPath: project.windows_path }
    : { wslPath: project.wsl_path };
  const result = await adapter.validate(target);
  return { ok: result.ok, type: adapter.type, errors: result.errors, path: workspacePathFor(project) };
}

export { path as nodePath };
