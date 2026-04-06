import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const command = process.argv[2];
const projectRoot = process.cwd();
const statePath = path.join(projectRoot, '.native-runtime.json');
const nativeModules = ['better-sqlite3', 'sqlite3', 'node-pty'];
const electronVersion = require(path.join(projectRoot, 'node_modules', 'electron', 'package.json')).version;

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(target, extra = {}) {
  const payload = {
    target,
    updatedAt: new Date().toISOString(),
    node: process.version,
    modules: process.versions.modules,
    electronVersion,
    ...extra,
  };

  fs.writeFileSync(statePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function checkNodeModules() {
  for (const moduleName of nativeModules) {
    require(moduleName);
  }
}

function run(bin, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const error = new Error(`${bin} ${args.join(' ')} failed`);
      error.code = code;
      error.signal = signal;
      reject(error);
    });
  });
}

async function ensureNodeRuntime() {
  const state = readState();

  if (state?.target === 'node') {
    try {
      checkNodeModules();
      console.log('[native-runtime] Node native modules already ready');
      return;
    } catch (error) {
      console.log(`[native-runtime] Rebuilding Node native modules because require check failed: ${error.code || error.message}`);
    }
  } else {
    console.log(`[native-runtime] Switching native modules from ${state?.target || 'unknown'} to node`);
  }

  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['rebuild', ...nativeModules]);
  checkNodeModules();
  writeState('node');
  console.log('[native-runtime] Node native modules ready');
}

async function ensureElectronRuntime() {
  const state = readState();

  if (state?.target === 'electron' && state?.electronVersion === electronVersion) {
    console.log(`[native-runtime] Electron native modules already prepared for ${electronVersion}`);
    return;
  }

  console.log(`[native-runtime] Preparing Electron native modules for ${electronVersion}`);
  await run('npx', [
    'electron-rebuild',
    '--force',
    '--version', electronVersion,
    '--module-dir', projectRoot,
    '--only', nativeModules.join(','),
  ]);
  writeState('electron', { electronVersion });
  console.log(`[native-runtime] Electron native modules ready for ${electronVersion}`);
}

async function main() {
  if (command === 'node') {
    await ensureNodeRuntime();
    return;
  }

  if (command === 'electron') {
    await ensureElectronRuntime();
    return;
  }

  throw new Error(`Unknown native runtime command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(typeof error?.code === 'number' ? error.code : 1);
});
