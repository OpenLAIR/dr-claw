import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getCliCommandCandidates,
    resolveAvailableCliCommand
} from '../server/utils/cliResolution.js';

test('Windows candidates include npm shim extensions', () => {
    process.env.GEMINI_CLI_PATH = 'gemini';

    const candidates = getCliCommandCandidates({
        envVarName: 'GEMINI_CLI_PATH',
        defaultCommands: ['gemini'],
        platform: 'win32',
        appendWindowsSuffixes: true
    });

    assert.deepEqual(candidates, ['gemini', 'gemini.cmd', 'gemini.exe']);

    delete process.env.GEMINI_CLI_PATH;
});

test('Non-Windows candidates keep plain command names', () => {
    process.env.CODEX_CLI_PATH = '';

    const candidates = getCliCommandCandidates({
        envVarName: 'CODEX_CLI_PATH',
        defaultCommands: ['codex'],
        platform: 'linux',
        appendWindowsSuffixes: true
    });

    assert.deepEqual(candidates, ['codex']);
});

test('Command resolver prefers first working candidate on Windows', async () => {
    process.env.CODEX_CLI_PATH = 'codex';
    const calls = [];

    const selected = await resolveAvailableCliCommand({
        envVarName: 'CODEX_CLI_PATH',
        defaultCommands: ['codex'],
        platform: 'win32',
        appendWindowsSuffixes: true,
        probe: async (candidate) => {
            calls.push(candidate);
            return candidate === 'codex.cmd';
        }
    });

    assert.equal(selected, 'codex.cmd');
    assert.deepEqual(calls, ['codex', 'codex.cmd']);

    delete process.env.CODEX_CLI_PATH;
});

test('Command resolver returns null when no candidates are executable', async () => {
    delete process.env.GEMINI_CLI_PATH;

    const selected = await resolveAvailableCliCommand({
        envVarName: 'GEMINI_CLI_PATH',
        defaultCommands: ['gemini'],
        platform: 'linux',
        appendWindowsSuffixes: true,
        probe: async () => false
    });

    assert.equal(selected, null);
});
