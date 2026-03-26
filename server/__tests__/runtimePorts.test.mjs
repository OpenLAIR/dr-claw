import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const probeResults = [];

vi.mock('net', () => ({
  default: {
    createServer() {
      let errorHandler = null;

      return {
        once(event, handler) {
          if (event === 'error') {
            errorHandler = handler;
          }
        },
        off(event, handler) {
          if (event === 'error' && errorHandler === handler) {
            errorHandler = null;
          }
        },
        listen(port, host, callback) {
          const nextResult = probeResults.shift();
          if (nextResult instanceof Error) {
            queueMicrotask(() => errorHandler?.(nextResult));
            return;
          }
          queueMicrotask(() => callback());
        },
        close(callback) {
          queueMicrotask(() => callback?.());
        },
      };
    },
  },
}));

const {
  DEFAULT_FRONTEND_PORT,
  getBackendPortSync,
  getFrontendPortSync,
  listenOnAvailablePort,
  setRuntimePortSync,
} = await import('../utils/runtimePorts.js');

const cleanupTasks = [];

function createFakeHttpServer() {
  let errorHandler = null;
  let listenedPort = null;

  return {
    once(event, handler) {
      if (event === 'error') {
        errorHandler = handler;
      }
    },
    off(event, handler) {
      if (event === 'error' && errorHandler === handler) {
        errorHandler = null;
      }
    },
    listen(port, host, callback) {
      listenedPort = port;
      queueMicrotask(() => callback());
    },
    get listenedPort() {
      return listenedPort;
    },
  };
}

afterEach(async () => {
  probeResults.length = 0;

  while (cleanupTasks.length > 0) {
    const task = cleanupTasks.pop();
    await task();
  }

  delete process.env.DR_CLAW_RUNTIME_DIR;
  delete process.env.DR_CLAW_RUNTIME_FILE;
});

describe('runtimePorts', () => {
  it('listens on the next available backend port when the requested port is occupied', async () => {
    const busyPortError = new Error('busy');
    busyPortError.code = 'EADDRINUSE';
    probeResults.push(busyPortError, true);

    const server = createFakeHttpServer();
    const activePort = await listenOnAvailablePort(server, {
      startPort: 3001,
      host: '0.0.0.0',
      maxAttempts: 5,
    });

    expect(activePort).toBe(3002);
    expect(server.listenedPort).toBe(3002);
  });

  it('reads runtime ports from an override directory and ignores stale process entries', async () => {
    const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dr-claw-runtime-'));
    process.env.DR_CLAW_RUNTIME_DIR = runtimeDir;
    cleanupTasks.push(() => fs.rm(runtimeDir, { recursive: true, force: true }));

    setRuntimePortSync('backend', 4321);
    setRuntimePortSync('frontend', 9876, 999999999);

    expect(getBackendPortSync(3001)).toBe(4321);
    expect(getFrontendPortSync(DEFAULT_FRONTEND_PORT)).toBe(DEFAULT_FRONTEND_PORT);
  });
});
