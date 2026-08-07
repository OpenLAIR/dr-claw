// ResearchFlow Phase 5 workspace / WSL adapter tests.
// Pure validation + adapter behavior with an injected fake runner (no real
// WSL required in CI). Spawn args are asserted verbatim to prove no shell
// concatenation or injection surface.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runResearchFlowMigrations, createResearchFlowServiceFor } from '../rf/index.js';
import {
  validateWorkspaceType,
  validateWslDistro,
  validateWslPath,
  validateWindowsPath,
  validateWorkspaceFields,
  WindowsLocalAdapter,
  WSLAdapter,
  createWorkspaceAdapter,
  validateProjectWorkspace,
  workspacePathFor,
} from '../rf/workspace.js';
import { RfValidationError } from '../rf/errors.js';

const USER_ID = 1;

let tmpDir;
let db;
let service;

beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'rf-p5-wsl-'));
  db = new Database(path.join(tmpDir, 'rf.db'));
  db.pragma('foreign_keys = ON');
  runResearchFlowMigrations(db);
  service = createResearchFlowServiceFor(db);
});

afterAll(async () => {
  if (db) db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

/** Fake spawn runner that records command + args and returns a canned result. */
const fakeRunner = (records, result) => (command, args, options) => {
  records.push({ command, args, options });
  const child = {
    stdout: null,
    stderr: null,
    on() {},
    kill() {},
    unref() {},
  };
  // Simulate success/failure synchronously by resolving via 'close'.
  queueMicrotask(() => {
    child.on('close', () => {});
    // RunWithTimeout waits on 'close' — deliver it.
  });
  // Provide the close handler registration we need:
  const real = {
    ...child,
    _handlers: {},
    on(event, cb) {
      this._handlers[event] = cb;
      if (event === 'close') {
        // emit result after a tick
        queueMicrotask(() => {
          if (typeof this._handlers.close === 'function') {
            this._handlers.close(result?.code ?? 0);
          }
        });
      }
      return this;
    },
  };
  return real;
};

describe('workspace validation (pure)', () => {
  it('1. workspace_type is a controlled enum', () => {
    expect(validateWorkspaceType('windows')).toBe(true);
    expect(validateWorkspaceType('wsl')).toBe(true);
    expect(validateWorkspaceType('none')).toBe(true);
    expect(validateWorkspaceType('ssh')).toBe(false);
    expect(validateWorkspaceType('')).toBe(false);
  });

  it('2. WSL distro names are validated strictly', () => {
    expect(validateWslDistro('Ubuntu-22.04')).toBe(true);
    expect(validateWslDistro('ubuntu')).toBe(true);
    expect(validateWslDistro('Debian_Linux')).toBe(true);
    expect(validateWslDistro('has space')).toBe(false);
    expect(validateWslDistro('--distro')).toBe(false);
    expect(validateWslDistro('a/b')).toBe(false);
    expect(validateWslDistro('')).toBe(false);
    expect(validateWslDistro('evil\nrm -rf')).toBe(false);
  });

  it('3. WSL paths must be absolute Linux paths without Windows separators', () => {
    expect(validateWslPath('/home/user/project')).toBe(true);
    expect(validateWslPath('/home/user/my project (A)-v2')).toBe(true);
    expect(validateWslPath('/home/user/中文项目')).toBe(true);
    expect(validateWslPath('home/user')).toBe(false);
    expect(validateWslPath('D:\\Research\\ProjectA')).toBe(false);
    expect(validateWslPath('/home/user\\project')).toBe(false);
    expect(validateWslPath('/home/user;rm -rf /')).toBe(true); // semicolon is a char, safe in argv
    expect(validateWslPath('/home/user\nb')).toBe(false);
  });

  it('4. Windows paths must be absolute (drive or UNC) without control chars', () => {
    expect(validateWindowsPath('D:\\Research\\ProjectA')).toBe(true);
    expect(validateWindowsPath('D:/Research/ProjectA')).toBe(true);
    expect(validateWindowsPath('\\\\server\\share\\proj')).toBe(true);
    expect(validateWindowsPath('Research\\ProjectA')).toBe(false);
    expect(validateWindowsPath('/home/user/x')).toBe(false);
    expect(validateWindowsPath('C:\\proj\nx')).toBe(false);
  });

  it('5. validateWorkspaceFields enforces per-type requirements', () => {
    expect(validateWorkspaceFields({ workspaceType: 'windows', windowsPath: 'D:\\Research\\A' }).ok).toBe(true);
    expect(validateWorkspaceFields({ workspaceType: 'windows', windowsPath: null }).ok).toBe(false);
    expect(validateWorkspaceFields({ workspaceType: 'wsl', wslDistro: 'Ubuntu-22.04', wslPath: '/home/u/p' }).ok).toBe(true);
    expect(validateWorkspaceFields({ workspaceType: 'wsl', wslDistro: 'bad distro', wslPath: '/home/u/p' }).ok).toBe(false);
    expect(validateWorkspaceFields({ workspaceType: 'wsl', wslDistro: 'Ubuntu', wslPath: 'relative/path' }).ok).toBe(false);
    expect(validateWorkspaceFields({ workspaceType: 'none' }).ok).toBe(true);
    expect(validateWorkspaceFields({ workspaceType: 'docker' }).ok).toBe(false);
  });
});

describe('WSLAdapter', () => {
  it('6. invalid distro is rejected at construction', () => {
    expect(() => new WSLAdapter({ distro: 'bad distro' })).toThrow(/Invalid WSL distro/);
    expect(() => new WSLAdapter({ distro: '--help' })).toThrow(/Invalid WSL distro/);
    expect(() => new WSLAdapter({ distro: 'Ubuntu-22.04' })).not.toThrow();
  });

  it('7. validate runs wsl.exe -d <distro> -- test -d <path> with argv only', async () => {
    const records = [];
    const adapter = new WSLAdapter({ distro: 'Ubuntu-22.04', runner: fakeRunner(records, { code: 0 }) });
    const result = await adapter.validate({ wslPath: '/home/user/project' });
    expect(result.ok).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0].command).toBe('wsl.exe');
    expect(records[0].args).toEqual(['-d', 'Ubuntu-22.04', '--', 'test', '-d', '/home/user/project']);
  });

  it('8. validate failure surfaces a readable error', async () => {
    const records = [];
    const adapter = new WSLAdapter({ distro: 'Ubuntu', runner: fakeRunner(records, { code: 1, stderr: 'No such directory' }) });
    const result = await adapter.validate({ wslPath: '/nope' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/not accessible/);
  });

  it('9. git passes controlled argv with -C cwd (Linux path inside distro)', async () => {
    const records = [];
    const adapter = new WSLAdapter({ distro: 'Ubuntu', runner: fakeRunner(records, { code: 0 }) });
    await adapter.git(['status', '--short'], '/home/user/project (A)');
    expect(records[0].args).toEqual(['-d', 'Ubuntu', '--', 'git', '-C', '/home/user/project (A)', 'status', '--short']);
    await expect(adapter.git(['status'], 'relative/path')).rejects.toThrow(/invalid WSL cwd/);
    await expect(adapter.git('status', '/home/u')).rejects.toThrow(/array/);
  });

  it('10. openTerminal uses --cd with detached spawn and no shell', async () => {
    const records = [];
    const adapter = new WSLAdapter({ distro: 'Ubuntu', runner: fakeRunner(records, { code: 0 }) });
    await adapter.openTerminal({ wslPath: '/home/user/proj' });
    expect(records[0].args).toEqual(['-d', 'Ubuntu', '--cd', '/home/user/proj']);
    expect(records[0].options.detached).toBe(true);
  });
});

describe('WindowsLocalAdapter', () => {
  it('11. validate rejects non-Windows paths; missing dirs fail on Windows', async () => {
    const adapter = new WindowsLocalAdapter();
    // Non-Windows (Linux-style) path is rejected by path validation first.
    const badPath = await adapter.validate({ windowsPath: tmpDir });
    expect(badPath.ok).toBe(false);
    expect(badPath.errors[0]).toMatch(/Invalid Windows path/);
    // A valid-format Windows path that does not exist on this machine fails fs.
    const missing = await adapter.validate({ windowsPath: 'D:\\Research\\does-not-exist-xyz' });
    expect(missing.ok).toBe(false);
  });

  it('12. git uses -C with argv array', async () => {
    const records = [];
    const adapter = new WindowsLocalAdapter({ runner: fakeRunner(records, { code: 0 }) });
    await adapter.git(['log', '-1'], 'D:\\Research\\My Project');
    expect(records[0].command).toBe('git');
    expect(records[0].args).toEqual(['-C', 'D:\\Research\\My Project', 'log', '-1']);
  });

  it('13. openTerminal opens explorer with the validated path', async () => {
    const records = [];
    const adapter = new WindowsLocalAdapter({ runner: fakeRunner(records, { code: 0 }) });
    await adapter.openTerminal({ windowsPath: 'D:\\Research\\A' });
    expect(records[0].command).toBe('explorer.exe');
    expect(records[0].args).toEqual(['D:\\Research\\A']);
  });
});

describe('workspace factory + service', () => {
  it('14. createWorkspaceAdapter maps project metadata to the right adapter', () => {
    expect(createWorkspaceAdapter({ workspace_type: 'windows', windows_path: 'D:\\A' }).type).toBe('windows');
    expect(createWorkspaceAdapter({ workspace_type: 'wsl', wsl_distro: 'Ubuntu', wsl_path: '/home/u' }).type).toBe('wsl');
    expect(createWorkspaceAdapter({ workspace_type: 'none' })).toBeNull();
    expect(createWorkspaceAdapter({})).toBeNull();
  });

  it('15. workspacePathFor returns the typed path', () => {
    expect(workspacePathFor({ workspace_type: 'windows', windows_path: 'D:\\A' })).toBe('D:\\A');
    expect(workspacePathFor({ workspace_type: 'wsl', wsl_path: '/home/u/a' })).toBe('/home/u/a');
    expect(workspacePathFor({ workspace_type: 'none' })).toBeNull();
  });

  it('16. updateProjectWorkspace persists and validates workspace metadata', () => {
    const project = service.createProject(USER_ID, { name: 'WSL Project' });
    const projectId = project.project.id;

    // Invalid combinations rejected.
    expect(() => service.updateProjectWorkspace(USER_ID, projectId, { workspaceType: 'wsl' }))
      .toThrow(RfValidationError);
    expect(() => service.updateProjectWorkspace(USER_ID, projectId, { workspaceType: 'windows' }))
      .toThrow(RfValidationError);
    expect(() => service.updateProjectWorkspace(USER_ID, projectId, { workspaceType: 'bogus' }))
      .toThrow(RfValidationError);

    // Valid WSL metadata.
    const updated = service.updateProjectWorkspace(USER_ID, projectId, {
      workspaceType: 'wsl',
      wslDistro: 'Ubuntu-22.04',
      wslPath: '/home/user/project (A)',
    });
    // buildProjectDetail wraps the project; use getWorkspaceInfo for details.
    expect(updated.project.id).toBe(projectId);

    const info = service.getWorkspaceInfo(USER_ID, projectId);
    expect(info).toMatchObject({
      workspaceType: 'wsl',
      wslDistro: 'Ubuntu-22.04',
      wslPath: '/home/user/project (A)',
      path: '/home/user/project (A)',
    });
  });

  it('17. validateProjectWorkspace reports unconfigured workspaces', async () => {
    const project = service.createProject(USER_ID, { name: 'No Workspace' });
    const result = await validateProjectWorkspace(project.project);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/No workspace configured/);
  });

  it('18. validateProjectWorkspace with a real wsl adapter reports failure gracefully', async () => {
    const project = service.createProject(USER_ID, { name: 'WSL Validate' });
    service.updateProjectWorkspace(USER_ID, project.project.id, {
      workspaceType: 'wsl',
      wslDistro: 'Ubuntu-22.04',
      wslPath: '/home/user/p',
    });
    const detail = service.getProject(USER_ID, project.project.id);
    // On this Linux CI box wsl.exe does not exist; the adapter must surface a
    // readable failure rather than crash or hang.
    const result = await service.validateWorkspace(USER_ID, project.project.id);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('19. service workspace endpoints honor project ownership', async () => {
    const project = service.createProject(USER_ID, { name: 'Owner Check' });
    const projectId = project.project.id;
    expect(() => service.getWorkspaceInfo(999, projectId)).toThrow(/not found/i);
    expect(() => service.updateProjectWorkspace(999, projectId, { workspaceType: 'none' })).toThrow(/not found/i);
  });
});
