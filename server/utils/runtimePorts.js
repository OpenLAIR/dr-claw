import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const DEFAULT_BACKEND_PORT = 3001;
export const DEFAULT_FRONTEND_PORT = 5173;
const DEFAULT_MAX_PORT_ATTEMPTS = 20;

function getProjectRoot() {
    return path.join(__dirname, '../..');
}

function getRuntimePortsPath() {
    if (process.env.DR_CLAW_RUNTIME_FILE) {
        return process.env.DR_CLAW_RUNTIME_FILE;
    }

    const runtimeDir = process.env.DR_CLAW_RUNTIME_DIR || path.join(getProjectRoot(), '.runtime');
    return path.join(runtimeDir, 'ports.json');
}

function ensureRuntimeDirSync() {
    fs.mkdirSync(path.dirname(getRuntimePortsPath()), { recursive: true });
}

function isPidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }

    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === 'EPERM';
    }
}

function sanitizeRuntimeEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }

    const port = Number(entry.port);
    if (!Number.isInteger(port) || port <= 0) {
        return null;
    }

    const pid = Number(entry.pid);
    if (Number.isInteger(pid) && pid > 0 && !isPidAlive(pid)) {
        return null;
    }

    return {
        port,
        pid: Number.isInteger(pid) && pid > 0 ? pid : null,
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
    };
}

function readRawRuntimePortsSync() {
    try {
        const content = fs.readFileSync(getRuntimePortsPath(), 'utf8');
        const parsed = JSON.parse(content);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn('[runtimePorts] Failed to read runtime ports file:', error.message);
        }
        return {};
    }
}

function writeRawRuntimePortsSync(state) {
    ensureRuntimeDirSync();
    fs.writeFileSync(getRuntimePortsPath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function parsePortNumber(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getRuntimePortStateSync() {
    const rawState = readRawRuntimePortsSync();
    return {
        backend: sanitizeRuntimeEntry(rawState.backend),
        frontend: sanitizeRuntimeEntry(rawState.frontend),
    };
}

export function getRuntimePortSync(kind, fallback) {
    const state = getRuntimePortStateSync();
    return state[kind]?.port ?? fallback;
}

export function getBackendPortSync(fallback = DEFAULT_BACKEND_PORT) {
    return getRuntimePortSync('backend', fallback);
}

export function getFrontendPortSync(fallback = DEFAULT_FRONTEND_PORT) {
    return getRuntimePortSync('frontend', fallback);
}

export function setRuntimePortSync(kind, port, pid = process.pid) {
    const normalizedPort = parsePortNumber(port, null);
    if (!normalizedPort) {
        throw new Error(`Invalid port for ${kind}: ${port}`);
    }

    const rawState = readRawRuntimePortsSync();
    rawState[kind] = {
        port: normalizedPort,
        pid,
        updatedAt: new Date().toISOString(),
    };
    writeRawRuntimePortsSync(rawState);
}

async function isPortAvailable(port, host) {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();

        const handleError = (error) => {
            cleanup();
            if (error.code === 'EADDRINUSE') {
                resolve(false);
                return;
            }
            reject(error);
        };

        const cleanup = () => {
            probe.off('error', handleError);
        };

        probe.once('error', handleError);
        probe.listen(port, host, () => {
            probe.close((error) => {
                cleanup();
                if (error) {
                    reject(error);
                    return;
                }
                resolve(true);
            });
        });
    });
}

async function listenOnce(server, port, host) {
    await new Promise((resolve, reject) => {
        const handleError = (error) => {
            cleanup();
            reject(error);
        };

        const cleanup = () => {
            server.off('error', handleError);
        };

        server.once('error', handleError);
        server.listen(port, host, () => {
            cleanup();
            resolve();
        });
    });
}

export async function listenOnAvailablePort(server, options = {}) {
    const startPort = parsePortNumber(options.startPort, DEFAULT_BACKEND_PORT);
    const host = options.host || '0.0.0.0';
    const maxAttempts = Number.isInteger(options.maxAttempts) && options.maxAttempts > 0
        ? options.maxAttempts
        : DEFAULT_MAX_PORT_ATTEMPTS;

    let lastError = null;

    for (let offset = 0; offset < maxAttempts; offset += 1) {
        const port = startPort + offset;

        try {
            const available = await isPortAvailable(port, host);
            if (!available) {
                const portBusyError = new Error(`Port ${port} is already in use.`);
                portBusyError.code = 'EADDRINUSE';
                lastError = portBusyError;
                continue;
            }

            await listenOnce(server, port, host);

            return port;
        } catch (error) {
            if (error.code !== 'EADDRINUSE') {
                throw error;
            }
            lastError = error;
        }
    }

    const endPort = startPort + maxAttempts - 1;
    const error = new Error(`No available port found between ${startPort} and ${endPort}.`);
    error.code = 'EADDRINUSE';
    error.cause = lastError;
    throw error;
}
