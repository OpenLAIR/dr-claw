import { spawn } from 'node:child_process';
import crossSpawn from 'cross-spawn';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const [command = 'dev', ...rawArgs] = process.argv.slice(2);
const projectRoot = process.cwd();
const electronGypDir = path.join(projectRoot, '.electron-gyp');
const electronCacheDir = path.join(projectRoot, '.electron-cache');
const electronHomeDir = path.join(projectRoot, '.electron-home');
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

fs.mkdirSync(electronGypDir, { recursive: true });
fs.mkdirSync(electronCacheDir, { recursive: true });
fs.mkdirSync(electronHomeDir, { recursive: true });

const env = {
  ...process.env,
  npm_config_devdir: electronGypDir,
  ELECTRON_GYP_DIR: electronGypDir,
  ELECTRON_CACHE: electronCacheDir,
};

function npmBin() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function npxBin() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function run(bin, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnFunction(bin, args, {
      cwd: projectRoot,
      env: {
        ...env,
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

async function buildIcons() {
  await run(npmBin(), ['run', 'desktop:icons']);

  if (process.platform === 'darwin') {
    await run('iconutil', ['-c', 'icns', 'build/icon.iconset', '-o', 'build/icon.icns']);
  }
}

async function prepareElectronRuntime() {
  await buildIcons();
  await run(npmBin(), ['run', 'native:electron']);
}

async function prepareNodeDevRuntime() {
  await buildIcons();
  await run(npmBin(), ['run', 'native:node']);
}

function parseBuilderArgs(args) {
  const builderArgs = [];
  let hasPublishFlag = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--publish') {
      hasPublishFlag = true;
      builderArgs.push(arg);
      if (args[index + 1]) {
        builderArgs.push(args[index + 1]);
        index += 1;
      }
      continue;
    }

    builderArgs.push(arg);
  }

  if (!hasPublishFlag) {
    builderArgs.push('--publish', 'never');
  }

  return builderArgs;
}

async function main() {
  if (command === 'prepare') {
    await prepareElectronRuntime();
    return;
  }

  if (command === 'dev') {
    await prepareNodeDevRuntime();
    await run(npmBin(), ['run', 'build']);
    await run(npxBin(), ['electron', 'electron/main.mjs']);
    return;
  }

  await prepareElectronRuntime();
  await run(npmBin(), ['run', 'build']);

  const builderArgs = parseBuilderArgs(rawArgs);

  if (command === 'pack') {
    await run(npxBin(), ['electron-builder', '--dir', ...builderArgs], {
      HOME: electronHomeDir,
      USERPROFILE: electronHomeDir,
    });
    return;
  }

  if (command === 'dist') {
    await run(npxBin(), ['electron-builder', ...builderArgs], {
      HOME: electronHomeDir,
      USERPROFILE: electronHomeDir,
    });
    return;
  }

  throw new Error(`Unknown desktop command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(typeof error?.code === 'number' ? error.code : 1);
});
