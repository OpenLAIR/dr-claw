import { spawn, spawnSync } from 'child_process';

function isCommandNotFoundExitCode(code) {
    return code === 127 || code === 9009;
}

/**
 * Build ordered CLI command candidates from env override + defaults.
 *
 * @param {Object} options
 * @param {string} options.envVarName Environment variable name containing an override command.
 * @param {string[]} [options.legacyEnvVarNames=[]] Older env var names checked after envVarName (migration).
 * @param {string[]} options.defaultCommands Fallback command names in preference order.
 * @param {object} [options.env=process.env] Environment used for env var overrides.
 * @param {string} [options.platform=process.platform] Runtime platform, used for Windows suffix handling.
 * @param {boolean} [options.appendWindowsSuffixes=false] Whether to append .cmd/.exe candidates on Windows.
 * @returns {string[]} Unique command candidates in probe order.
 */
function getCliCommandCandidates({
    envVarName,
    legacyEnvVarNames = [],
    defaultCommands,
    env = process.env,
    platform = process.platform,
    appendWindowsSuffixes = false
}) {
    let envCommand = '';
    for (const key of [envVarName, ...legacyEnvVarNames].filter(Boolean)) {
        const s = String(env[key] || '').trim();
        if (s) {
            envCommand = s;
            break;
        }
    }
    const rawCandidates = [];

    if (envCommand) {
        rawCandidates.push(envCommand);
    }

    for (const command of defaultCommands) {
        if (command) {
            rawCandidates.push(command);
        }
    }

    const candidates = [];
    for (const candidate of rawCandidates) {
        candidates.push(candidate);

        if (appendWindowsSuffixes && platform === 'win32' && !/\.(cmd|exe|bat)$/i.test(candidate)) {
            candidates.push(`${candidate}.cmd`, `${candidate}.exe`);
        }
    }

    return [...new Set(candidates)];
}

/**
 * Probe command availability via synchronous spawn.
 *
 * @param {string} command Command to check.
 * @param {string[]} [args=['--help']] Probe arguments.
 * @param {string} [platform=process.platform] Runtime platform.
 * @returns {boolean} True when command can be invoked.
 */
function isCommandAvailable(command, args = ['--help'], platform = process.platform) {
    if (!command) return false;

    const result = spawnSync(command, args, {
        stdio: 'ignore',
        env: process.env,
        shell: platform === 'win32'
    });

    return !result.error && !isCommandNotFoundExitCode(result.status);
}

/**
 * Probe command availability via async spawn with timeout.
 *
 * @param {string} command Command to check.
 * @param {string[]} [args=['--help']] Probe arguments.
 * @param {Object} [options]
 * @param {string} [options.platform=process.platform] Runtime platform.
 * @param {number} [options.timeoutMs=3000] Max probe duration.
 * @param {object} [options.env=process.env] Environment used for command probes.
 * @returns {Promise<boolean>} True when command can be spawned.
 */
function checkCommandAvailable(command, args = ['--help'], { platform = process.platform, timeoutMs = 3000, env = process.env } = {}) {
    return new Promise((resolve) => {
        let completed = false;

        let childProcess;
        try {
            childProcess = spawn(command, args, {
                stdio: 'ignore',
                env,
                shell: platform === 'win32'
            });
        } catch {
            resolve(false);
            return;
        }

        const finish = (value) => {
            if (completed) return;
            completed = true;
            resolve(value);
        };

        const timeout = setTimeout(() => {
            if (!completed) {
                childProcess.kill();
            }
            finish(true);
        }, timeoutMs);

        childProcess.on('error', (error) => {
            clearTimeout(timeout);
            if (error?.code === 'ENOENT') {
                finish(false);
                return;
            }
            finish(true);
        });

        childProcess.on('spawn', () => {
            if (platform !== 'win32') {
                clearTimeout(timeout);
                finish(true);
            }
        });

        childProcess.on('close', (code) => {
            clearTimeout(timeout);
            finish(!isCommandNotFoundExitCode(code));
        });
    });
}

/**
 * Resolve the first available command from a candidate list.
 *
 * @param {Object} options
 * @param {string} options.envVarName Environment variable with command override.
 * @param {string[]} [options.legacyEnvVarNames=[]] Older env vars (after envVarName) for migration.
 * @param {string[]} options.defaultCommands Fallback command names in preference order.
 * @param {string[]} [options.args=['--help']] Probe arguments.
 * @param {string} [options.platform=process.platform] Runtime platform.
 * @param {object} [options.env=process.env] Environment used for command probes.
 * @param {boolean} [options.appendWindowsSuffixes=false] Whether to append .cmd/.exe candidates on Windows.
 * @param {(command: string, args: string[], options: {platform: string, env: object}) => Promise<boolean>} [options.probe=checkCommandAvailable] Async probe function.
 * @returns {Promise<string|null>} First available command, or null.
 */
async function resolveAvailableCliCommand({
    envVarName,
    legacyEnvVarNames = [],
    defaultCommands,
    args = ['--help'],
    platform = process.platform,
    env = process.env,
    appendWindowsSuffixes = false,
    probe = (command, probeArgs, probeOptions) => checkCommandAvailable(command, probeArgs, probeOptions)
}) {
    const candidates = getCliCommandCandidates({
        envVarName,
        legacyEnvVarNames,
        defaultCommands,
        env,
        platform,
        appendWindowsSuffixes
    });

    for (const candidate of candidates) {
        if (await probe(candidate, args, { platform, env })) {
            return candidate;
        }
    }

    return null;
}

export {
    getCliCommandCandidates,
    isCommandAvailable,
    checkCommandAvailable,
    resolveAvailableCliCommand
};
