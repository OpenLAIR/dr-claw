import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';
import { resolveCursorCliCommand } from '../utils/cursorCommand.js';
import { resolveAvailableCliCommand } from '../utils/cliResolution.js';
import { buildCodexCliEnv, getCodexCliCommand } from '../utils/codexCli.js';
import {
  DEFAULT_OLLAMA_URL,
  detectGPUs,
  checkOllamaStatus,
  pullOllamaModel,
  normalizeLocalOllamaBaseUrl,
} from '../local-gpu.js';

const router = express.Router();

const PROVIDER_INSTALLERS = {
  claude: {
    displayName: 'Claude Code CLI',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    fallbackDownloadUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    commands: {
      darwin: [
        { bin: 'brew', args: ['install', 'claude-code'], label: 'brew install claude-code' },
      ],
      linux: [
        { bin: 'npm', args: ['install', '-g', '@anthropic-ai/claude-code'], label: 'npm install -g @anthropic-ai/claude-code' },
      ],
      win32: [
        { bin: 'winget', args: ['install', '--id', 'Anthropic.ClaudeCode', '-e'], label: 'winget install Anthropic.ClaudeCode' },
      ],
    },
  },
  cursor: {
    displayName: 'Cursor CLI',
    docsUrl: 'https://cursor.com/downloads',
    fallbackDownloadUrl: 'https://cursor.com/downloads',
    commands: {
      darwin: [
        { bin: 'brew', args: ['install', '--cask', 'cursor'], label: 'brew install --cask cursor' },
      ],
      win32: [
        { bin: 'winget', args: ['install', '--id', 'CursorAI,Inc.Cursor', '-e'], label: 'winget install CursorAI,Inc.Cursor' },
      ],
    },
  },
  codex: {
    displayName: 'OpenAI Codex CLI',
    docsUrl: 'https://github.com/openai/codex',
    fallbackDownloadUrl: 'https://github.com/openai/codex',
    commands: {
      darwin: [
        { bin: 'npm', args: ['install', '-g', '@openai/codex'], label: 'npm install -g @openai/codex' },
      ],
      linux: [
        { bin: 'npm', args: ['install', '-g', '@openai/codex'], label: 'npm install -g @openai/codex' },
      ],
      win32: [
        { bin: 'npm.cmd', args: ['install', '-g', '@openai/codex'], label: 'npm install -g @openai/codex' },
      ],
    },
  },
  gemini: {
    displayName: 'Gemini CLI',
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    fallbackDownloadUrl: 'https://github.com/google-gemini/gemini-cli',
    commands: {
      darwin: [
        { bin: 'npm', args: ['install', '-g', '@google/gemini-cli'], label: 'npm install -g @google/gemini-cli' },
      ],
      linux: [
        { bin: 'npm', args: ['install', '-g', '@google/gemini-cli'], label: 'npm install -g @google/gemini-cli' },
      ],
      win32: [
        { bin: 'npm.cmd', args: ['install', '-g', '@google/gemini-cli'], label: 'npm install -g @google/gemini-cli' },
      ],
    },
  },
  nano: {
    displayName: 'Nano Claude Code',
    docsUrl: 'https://github.com/OpenLAIR/nano-claude-code',
    fallbackDownloadUrl: 'https://github.com/OpenLAIR/nano-claude-code',
    commands: {
      darwin: [
        {
          bin: 'pip3',
          args: ['install', '-U', 'git+https://github.com/OpenLAIR/nano-claude-code.git'],
          label: 'pip3 install from GitHub (recommended)',
        },
      ],
      linux: [
        {
          bin: 'pip3',
          args: ['install', '-U', 'git+https://github.com/OpenLAIR/nano-claude-code.git'],
          label: 'pip3 install from GitHub (use a venv if your distro manages system Python)',
        },
      ],
      win32: [
        {
          bin: 'pip',
          args: ['install', '-U', 'git+https://github.com/OpenLAIR/nano-claude-code.git'],
          label: 'pip install from GitHub',
        },
      ],
    },
  },
};

function buildCliInstallHint(agent) {
  const installer = PROVIDER_INSTALLERS[agent];
  if (installer?.docsUrl) {
    return `${installer.displayName} is not installed. Install it in Dr. Claw or open the official guide: ${installer.docsUrl}`;
  }

  switch (agent) {
    case 'claude':
      return 'Claude Code CLI is not installed. Install it first, then retry login.';
    case 'cursor':
      return 'Cursor CLI is not installed. Install it first, then retry login.';
    case 'codex':
      return 'Codex CLI is not installed. Install it first, then retry login.';
    case 'gemini':
      return 'Gemini CLI is not installed. Install it first, then retry login.';
    case 'openrouter':
      return 'Set OPENROUTER_API_KEY in your .env file. Get a key at https://openrouter.ai/keys';
    case 'nano':
      return 'nano-claude-code is not on PATH. Install from https://github.com/OpenLAIR/nano-claude-code or set NANO_CLAUDE_CODE_COMMAND to the executable.';
    default:
      return 'Required CLI is not installed. Install it first, then retry login.';
  }
}

function getInstallerDefinition(agent) {
  return PROVIDER_INSTALLERS[agent] || null;
}

function getPlatformInstallCommands(agent, platform = process.platform) {
  const definition = getInstallerDefinition(agent);
  if (!definition) {
    return [];
  }

  return definition.commands?.[platform] || [];
}

function runInstallCommand(command, { cwd = process.cwd(), timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    let completed = false;
    const child = spawn(command.bin, command.args, {
      cwd,
      env: process.env,
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';

    const finish = (result) => {
      if (completed) {
        return;
      }
      completed = true;
      resolve(result);
    };

    const timeout = setTimeout(() => {
      if (!completed) {
        child.kill('SIGTERM');
      }
      finish({
        ok: false,
        code: null,
        signal: 'SIGTERM',
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}Installation timed out after ${timeoutMs}ms.`,
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      finish({
        ok: false,
        code: null,
        signal: null,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}${error.message}`,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      finish({
        ok: code === 0,
        code,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

function isCliMockedMissing(agent) {
  const raw = process.env.MOCK_MISSING_CLIS || '';
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(agent);
}

function buildStatusPayload(result, agent) {
  const installCommands = getPlatformInstallCommands(agent).map((command) => ({
    label: command.label,
    bin: command.bin,
    args: command.args,
  }));
  const definition = getInstallerDefinition(agent);

  return {
    authenticated: Boolean(result.authenticated),
    email: result.email || null,
    error: result.error || null,
    cliAvailable: result.cliAvailable !== false,
    cliCommand: result.cliCommand || null,
    installHint: result.installHint || (result.cliAvailable === false ? buildCliInstallHint(agent) : null),
    installable: installCommands.length > 0,
    installCommands,
    docsUrl: definition?.docsUrl || null,
    downloadUrl: definition?.fallbackDownloadUrl || null,
  };
}

router.get('/providers', async (_req, res) => {
  try {
    const statuses = await Promise.all([
      checkClaudeCredentials().then((result) => ['claude', buildStatusPayload(result, 'claude')]),
      checkCursorStatus().then((result) => ['cursor', buildStatusPayload(result, 'cursor')]),
      checkCodexCredentials().then((result) => ['codex', buildStatusPayload(result, 'codex')]),
      checkGeminiCredentials().then((result) => ['gemini', buildStatusPayload(result, 'gemini')]),
    ]);

    res.json({ providers: Object.fromEntries(statuses) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function checkNanoCliForInstall() {
  const resolvedCliCommand = await resolveAvailableCliCommand({
    envVarName: 'NANO_CLAUDE_CODE_COMMAND',
    defaultCommands: ['nano-claude-code'],
    args: ['--version'],
    appendWindowsSuffixes: true,
  });
  if (!resolvedCliCommand) {
    return {
      authenticated: false,
      email: null,
      error: 'nano-claude-code CLI not found',
      cliAvailable: false,
      cliCommand: 'nano-claude-code',
    };
  }
  return {
    authenticated: true,
    email: 'Nano Claude Code',
    cliAvailable: true,
    cliCommand: resolvedCliCommand,
  };
}

router.post('/install/:provider', async (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase();
  const definition = getInstallerDefinition(provider);

  if (!definition) {
    return res.status(404).json({ error: `Unknown provider: ${provider}` });
  }

  const commands = getPlatformInstallCommands(provider);
  if (commands.length === 0) {
    return res.status(400).json({
      ok: false,
      provider,
      error: `No automatic installer is configured for ${definition.displayName} on ${process.platform}. See the official docs for manual Linux steps.`,
      docsUrl: definition.docsUrl,
      downloadUrl: definition.fallbackDownloadUrl,
    });
  }

  const command = commands[0];
  const result = await runInstallCommand(command);

  const checker = provider === 'claude'
    ? checkClaudeCredentials
    : provider === 'cursor'
      ? checkCursorStatus
      : provider === 'codex'
        ? checkCodexCredentials
        : provider === 'nano'
          ? checkNanoCliForInstall
          : checkGeminiCredentials;

  const latestStatus = await checker();

  res.status(result.ok ? 200 : 500).json({
    ok: result.ok,
    provider,
    command: {
      label: command.label,
      bin: command.bin,
      args: command.args,
    },
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.code,
    signal: result.signal,
    status: buildStatusPayload(latestStatus, provider),
    docsUrl: definition.docsUrl,
    downloadUrl: definition.fallbackDownloadUrl,
  });
});

router.get('/download/:provider', async (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase();
  const definition = getInstallerDefinition(provider);

  if (!definition) {
    return res.status(404).json({ error: `Unknown provider: ${provider}` });
  }

  res.json({
    provider,
    displayName: definition.displayName,
    docsUrl: definition.docsUrl,
    downloadUrl: definition.fallbackDownloadUrl,
  });
});

router.get('/claude/status', async (req, res) => {
  try {
    const credentialsResult = await checkClaudeCredentials();

    if (credentialsResult.authenticated) {
      return res.json(buildStatusPayload({
        ...credentialsResult,
        email: credentialsResult.email || 'Authenticated',
        method: 'cli'
      }, 'claude'));
    }

    // Check for Custom API env var (ANTHROPIC_API_KEY is the correct var for the SDK;
    // also check legacy ANTHROPIC_AUTH_TOKEN for backward compatibility)
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
      return res.json(buildStatusPayload({
        authenticated: true,
        email: 'Custom API Connected',
        method: 'custom_api',
        cliAvailable: credentialsResult.cliAvailable,
        cliCommand: credentialsResult.cliCommand
      }, 'claude'));
    }

    return res.json(buildStatusPayload({
      authenticated: false,
      email: null,
      error: credentialsResult.error || 'Not authenticated'
    }, 'claude'));

  } catch (error) {
    console.error('Error checking Claude auth status:', error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message
    });
  }
});

router.get('/cursor/status', async (req, res) => {
  try {
    const result = await checkCursorStatus();

    res.json(buildStatusPayload(result, 'cursor'));

  } catch (error) {
    console.error('Error checking Cursor auth status:', error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message
    });
  }
});

router.get('/codex/status', async (req, res) => {
  try {
    const result = await checkCodexCredentials();

    res.json(buildStatusPayload(result, 'codex'));

  } catch (error) {
    console.error('Error checking Codex auth status:', error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message
    });
  }
});

router.get('/gemini/status', async (req, res) => {
  try {
    const result = await checkGeminiCredentials();

    res.json(buildStatusPayload(result, 'gemini'));

  } catch (error) {
    console.error('Error checking Gemini auth status:', error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message
    });
  }
});

router.get('/nano/status', async (req, res) => {
  try {
    const resolvedCliCommand = await resolveAvailableCliCommand({
      envVarName: 'NANO_CLAUDE_CODE_COMMAND',
      defaultCommands: ['nano-claude-code'],
      args: ['--version'],
      appendWindowsSuffixes: true,
    });

    if (!resolvedCliCommand) {
      return res.json(buildStatusPayload({
        authenticated: false,
        email: null,
        error: 'nano-claude-code CLI not found',
        cliAvailable: false,
        cliCommand: 'nano-claude-code',
        installHint: buildCliInstallHint('nano'),
      }, 'nano'));
    }

    return res.json(buildStatusPayload({
      authenticated: true,
      email: 'Nano Claude Code',
      cliAvailable: true,
      cliCommand: resolvedCliCommand,
    }, 'nano'));
  } catch (error) {
    console.error('Error checking Nano Claude Code status:', error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message,
    });
  }
});

async function checkGeminiCredentials() {
  console.log('[DEBUG] Checking Gemini credentials...');
  let cliCommand = process.env.GEMINI_CLI_PATH || 'gemini';
  try {
    if (isCliMockedMissing('gemini')) {
      return {
        authenticated: false,
        email: null,
        error: 'Gemini CLI not installed (mocked)',
        cliAvailable: false,
        cliCommand,
        installHint: buildCliInstallHint('gemini')
      };
    }

    const resolvedCliCommand = await resolveAvailableCliCommand({
      envVarName: 'GEMINI_CLI_PATH',
      defaultCommands: ['gemini'],
      appendWindowsSuffixes: true
    });
    cliCommand = resolvedCliCommand || cliCommand;

    if (!resolvedCliCommand) {
      if (process.env.GOOGLE_API_KEY) {
        return {
          authenticated: true,
          email: 'API Key Connected',
          method: 'custom_api',
          cliAvailable: false,
          cliCommand,
          installHint: buildCliInstallHint('gemini')
        };
      }
      return {
        authenticated: false,
        email: null,
        error: 'Gemini CLI not installed',
        cliAvailable: false,
        cliCommand,
        installHint: buildCliInstallHint('gemini')
      };
    }

    if (process.env.GOOGLE_API_KEY) {
      console.log('[DEBUG] Gemini: Found GOOGLE_API_KEY in environment');
      return {
        authenticated: true,
        email: 'API Key (Env)',
        cliAvailable: true,
        cliCommand
      };
    }

    const oauthPath = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
    console.log(`[DEBUG] Gemini: Checking for OAuth file at ${oauthPath}`);
    try {
      const content = await fs.readFile(oauthPath, 'utf8');
      const creds = JSON.parse(content);

      if (creds.refresh_token || creds.access_token) {
        let email = creds.email || 'OAuth (Config)';

        if (!creds.email && creds.id_token) {
          try {
            const parts = creds.id_token.split('.');
            if (parts.length >= 2) {
              const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
              email = payload.email || email;
            }
          } catch (jwtError) {
            console.warn('[DEBUG] Gemini: Failed to decode id_token', jwtError.message);
          }
        }

        console.log(`[DEBUG] Gemini: Authenticated via OAuth as ${email}`);
        return {
          authenticated: true,
          email: email,
          cliAvailable: true,
          cliCommand
        };
      } else {
        console.log('[DEBUG] Gemini: OAuth file found but no tokens present');
      }
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error('[DEBUG] Gemini: Error reading oauth_creds.json', e.message);
      } else {
        console.log('[DEBUG] Gemini: oauth_creds.json not found');
      }
    }

    const configPath = path.join(os.homedir(), '.gemini', 'config.json');
    console.log(`[DEBUG] Gemini: Checking for legacy config at ${configPath}`);
    try {
      const content = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(content);

      if (config.apiKey || config.GOOGLE_API_KEY) {
        console.log('[DEBUG] Gemini: Authenticated via legacy config API Key');
        return {
          authenticated: true,
          email: 'API Key (Config)',
          cliAvailable: true,
          cliCommand
        };
      }
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error('[DEBUG] Gemini: Error reading config.json', e.message);
      }
    }

    console.log('[DEBUG] Gemini: Not authenticated (no valid credentials found)');
    return {
      authenticated: false,
      email: null,
      error: 'Gemini not configured',
      cliAvailable: true,
      cliCommand
    };
  } catch (error) {
    console.error('[DEBUG] Gemini: Unexpected error during auth check', error);
    if (error.code === 'ENOENT') {
      return {
        authenticated: false,
        email: null,
        error: 'Gemini not configured',
        cliAvailable: true,
        cliCommand
      };
    }
    return {
      authenticated: false,
      email: null,
      error: error.message,
      cliAvailable: true,
      cliCommand
    };
  }
}

async function checkClaudeCredentials() {
  const resolvedCliCommand = await resolveAvailableCliCommand({
    envVarName: 'CLAUDE_CLI_PATH',
    defaultCommands: ['claude'],
    appendWindowsSuffixes: true
  });

  if (!resolvedCliCommand) {
    return checkClaudeCredentialsFile({ cliAvailable: false });
  }

  return new Promise((resolve) => {
    let processCompleted = false;

    const timeout = setTimeout(() => {
      if (!processCompleted) {
        processCompleted = true;
        if (childProcess) {
          childProcess.kill();
        }
        checkClaudeCredentialsFile({ cliAvailable: true, cliCommand: resolvedCliCommand }).then(resolve);
      }
    }, 5000);

    let childProcess;
    try {
      childProcess = spawn(resolvedCliCommand, ['auth', 'status', '--json'], {
        env: { ...process.env, CLAUDECODE: '' },
        shell: process.platform === 'win32'
      });
    } catch {
      clearTimeout(timeout);
      checkClaudeCredentialsFile({ cliAvailable: false }).then(resolve);
      return;
    }

    let stdout = '';

    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    childProcess.on('close', (code) => {
      if (processCompleted) return;
      processCompleted = true;
      clearTimeout(timeout);

      if (code === 0 && stdout.trim()) {
        try {
          const status = JSON.parse(stdout.trim());
          if (status.loggedIn) {
            resolve({
              authenticated: true,
              email: status.email || null,
              cliAvailable: true,
              cliCommand: resolvedCliCommand
            });
            return;
          }
        } catch {
        }
      }

      checkClaudeCredentialsFile({ cliAvailable: true, cliCommand: resolvedCliCommand }).then(resolve);
    });

    childProcess.on('error', () => {
      if (processCompleted) return;
      processCompleted = true;
      clearTimeout(timeout);
      checkClaudeCredentialsFile({ cliAvailable: true, cliCommand: resolvedCliCommand }).then(resolve);
    });
  });
}

async function checkClaudeCredentialsFile({ cliAvailable = true, cliCommand = 'claude' } = {}) {
  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const content = await fs.readFile(credPath, 'utf8');
    const creds = JSON.parse(content);

    const oauth = creds.claudeAiOauth;
    if (oauth && oauth.accessToken) {
      const isExpired = oauth.expiresAt && Date.now() >= oauth.expiresAt;

      if (!isExpired) {
        return {
          authenticated: true,
          email: creds.email || creds.user || null,
          cliAvailable,
          cliCommand
        };
      }
    }

    return {
      authenticated: false,
      email: null,
      cliAvailable,
      cliCommand,
      error: cliAvailable ? null : 'Claude Code CLI not installed',
      installHint: cliAvailable ? null : buildCliInstallHint('claude')
    };
  } catch (_error) {
    return {
      authenticated: false,
      email: null,
      cliAvailable,
      cliCommand,
      error: cliAvailable ? null : 'Claude Code CLI not installed',
      installHint: cliAvailable ? null : buildCliInstallHint('claude')
    };
  }
}

function checkCursorStatus() {
  return new Promise((resolve) => {
    let processCompleted = false;
    const cursorCommand = resolveCursorCliCommand();

    if (!cursorCommand) {
      resolve({
        authenticated: false,
        email: null,
        error: 'Cursor CLI not installed',
        cliAvailable: false,
        cliCommand: process.env.CURSOR_CLI_PATH || 'agent',
        installHint: buildCliInstallHint('cursor')
      });
      return;
    }

    const timeout = setTimeout(() => {
      if (!processCompleted) {
        processCompleted = true;
        if (childProcess) {
          childProcess.kill();
        }
        resolve({
          authenticated: false,
          email: null,
          error: 'Command timeout'
        });
      }
    }, 5000);

    let childProcess;
    childProcess = spawn(cursorCommand, ['status']);

    let stdout = '';
    let stderr = '';

    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    childProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    childProcess.on('close', (code) => {
      if (processCompleted) return;
      processCompleted = true;
      clearTimeout(timeout);

      if (code === 0) {
        const emailMatch = stdout.match(/Logged in as ([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);

        if (emailMatch) {
          resolve({
            authenticated: true,
            email: emailMatch[1],
            output: stdout,
            cliAvailable: true,
            cliCommand: cursorCommand
          });
        } else if (stdout.includes('Logged in')) {
          resolve({
            authenticated: true,
            email: 'Logged in',
            output: stdout,
            cliAvailable: true,
            cliCommand: cursorCommand
          });
        } else {
          resolve({
            authenticated: false,
            email: null,
            error: 'Not logged in',
            cliAvailable: true,
            cliCommand: cursorCommand
          });
        }
      } else {
        resolve({
          authenticated: false,
          email: null,
          error: stderr || 'Not logged in',
          cliAvailable: true,
          cliCommand: cursorCommand
        });
      }
    });

    childProcess.on('error', () => {
      if (processCompleted) return;
      processCompleted = true;
      clearTimeout(timeout);

      resolve({
        authenticated: false,
        email: null,
        error: 'Cursor CLI not installed',
        cliAvailable: false,
        cliCommand: cursorCommand,
        installHint: buildCliInstallHint('cursor')
      });
    });
  });
}

// Auth precedence:
// 1. JWT tokens (id_token / access_token) from ~/.codex/auth.json
// 2. OPENAI_API_KEY from server environment variable
// 3. OPENAI_API_KEY from ~/.codex/auth.json
async function checkCodexCredentials() {
  const codexCliEnv = buildCodexCliEnv(process.env);
  let cliCommand = getCodexCliCommand(process.env);
  try {
    if (isCliMockedMissing('codex')) {
      return {
        authenticated: false,
        email: null,
        error: 'Codex CLI not installed (mocked)',
        cliAvailable: false,
        cliCommand,
        installHint: buildCliInstallHint('codex')
      };
    }

    const resolvedCliCommand = await resolveAvailableCliCommand({
      envVarName: 'CODEX_CLI_PATH',
      defaultCommands: ['codex'],
      appendWindowsSuffixes: true,
      env: codexCliEnv
    });
    cliCommand = resolvedCliCommand || cliCommand;

    if (!resolvedCliCommand) {
      // Even without CLI, an OPENAI_API_KEY env var means Codex SDK can work
      if (process.env.OPENAI_API_KEY) {
        return {
          authenticated: true,
          email: 'API Key Connected',
          method: 'custom_api',
          cliAvailable: false,
          cliCommand,
          installHint: buildCliInstallHint('codex')
        };
      }
      return {
        authenticated: false,
        email: null,
        error: 'Codex CLI not installed',
        cliAvailable: false,
        cliCommand,
        installHint: buildCliInstallHint('codex')
      };
    }

    const envApiKey = String(process.env.OPENAI_API_KEY || '').trim();
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    let auth = null;

    try {
      const content = await fs.readFile(authPath, 'utf8');
      auth = JSON.parse(content);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('[DEBUG] Codex: Failed to read auth.json, falling back to env auth if available:', error.message);
      }
    }

    // Tokens are nested under 'tokens' key
    const tokens = auth?.tokens || {};

    if (tokens.id_token || tokens.access_token) {
      let email = 'Authenticated';
      if (tokens.id_token) {
        try {
          const parts = tokens.id_token.split('.');
          if (parts.length >= 2) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            email = payload.email || payload.user || 'Authenticated';
          }
        } catch {
          email = 'Authenticated';
        }
      }

      return {
        authenticated: true,
        email,
        cliAvailable: true,
        cliCommand
      };
    }

    // Service deployments may authenticate Codex through server env only.
    if (envApiKey) {
      return {
        authenticated: true,
        email: 'API Key Connected',
        method: 'custom_api',
        cliAvailable: true,
        cliCommand
      };
    }

    // Also check for OPENAI_API_KEY stored in auth.json as a fallback auth method
    if (auth?.OPENAI_API_KEY) {
      return {
        authenticated: true,
        email: 'API Key Connected',
        method: 'custom_api',
        cliAvailable: true,
        cliCommand
      };
    }

    return {
      authenticated: false,
      email: null,
      error: auth ? 'No valid tokens found' : 'Codex not configured',
      cliAvailable: true,
      cliCommand
    };
  } catch (error) {
    return {
      authenticated: false,
      email: null,
      error: error.message,
      cliAvailable: true,
      cliCommand
    };
  }
}

router.get('/openrouter/status', async (req, res) => {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (apiKey) {
      return res.json(buildStatusPayload({
        authenticated: true,
        email: 'API Key Connected',
        cliAvailable: true,
        cliCommand: 'openrouter'
      }, 'openrouter'));
    }

    return res.json(buildStatusPayload({
      authenticated: false,
      email: null,
      error: 'OPENROUTER_API_KEY not set',
      cliAvailable: true,
      cliCommand: 'openrouter',
      installHint: 'Set OPENROUTER_API_KEY in your .env file or environment. Get a key at https://openrouter.ai/keys'
    }, 'openrouter'));
  } catch (error) {
    console.error('Error checking OpenRouter auth status:', error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message
    });
  }
});

router.post('/openrouter/verify-api-key', async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'API key is required' });

    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (response.ok) {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';
      try { envContent = await fs.readFile(envPath, 'utf8'); } catch {}

      const lines = envContent.split('\n');
      let found = false;
      const newLines = lines.map(line => {
        if (line.trim().startsWith('OPENROUTER_API_KEY=')) {
          found = true;
          return `OPENROUTER_API_KEY=${apiKey}`;
        }
        return line;
      }).filter(l => l.trim() !== '' || found);

      if (!found) newLines.push(`OPENROUTER_API_KEY=${apiKey}`);
      await fs.writeFile(envPath, newLines.join('\n') + '\n');
      process.env.OPENROUTER_API_KEY = apiKey;

      return res.json({ success: true, message: 'OpenRouter API key verified and saved.' });
    } else {
      return res.status(401).json({ error: 'Invalid API key' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/gemini/verify-api-key', async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'API key is required' });

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);

    if (response.ok) {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';
      try { envContent = await fs.readFile(envPath, 'utf8'); } catch {}

      const lines = envContent.split('\n');
      let found = false;
      const newLines = lines.map(line => {
        if (line.trim().startsWith('GOOGLE_API_KEY=')) {
          found = true;
          return `GOOGLE_API_KEY=${apiKey}`;
        }
        return line;
      }).filter(l => l.trim() !== '' || found);

      if (!found) newLines.push(`GOOGLE_API_KEY=${apiKey}`);
      await fs.writeFile(envPath, newLines.join('\n') + '\n');
      process.env.GOOGLE_API_KEY = apiKey;

      return res.json({ success: true, message: 'Google API key verified and saved.' });
    } else {
      return res.status(401).json({ error: 'Invalid API key' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/codex/verify-api-key', async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'API key is required' });

    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (response.ok) {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';
      try { envContent = await fs.readFile(envPath, 'utf8'); } catch {}

      const lines = envContent.split('\n');
      let found = false;
      const newLines = lines.map(line => {
        if (line.trim().startsWith('OPENAI_API_KEY=')) {
          found = true;
          return `OPENAI_API_KEY=${apiKey}`;
        }
        return line;
      }).filter(l => l.trim() !== '' || found);

      if (!found) newLines.push(`OPENAI_API_KEY=${apiKey}`);
      await fs.writeFile(envPath, newLines.join('\n') + '\n');
      process.env.OPENAI_API_KEY = apiKey;

      return res.json({ success: true, message: 'OpenAI API key verified and saved.' });
    } else {
      return res.status(401).json({ error: 'Invalid API key' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/claude/verify-custom-api', async (req, res) => {
  try {
    const { baseUrl, token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });

    const verifyUrl = `${baseUrl || 'https://api.anthropic.com'}/v1/messages`;
    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': token,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }]
      })
    });

    if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 403)) {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';
      try {
        envContent = await fs.readFile(envPath, 'utf8');
      } catch (e) {}

      const lines = envContent ? envContent.split(/\r?\n/) : [];
      const nextLines = lines.filter((line) => !line.startsWith('ANTHROPIC_BASE_URL=') && !line.startsWith('ANTHROPIC_AUTH_TOKEN='));
      nextLines.push(`ANTHROPIC_BASE_URL=${baseUrl || 'https://api.anthropic.com'}`);
      nextLines.push(`ANTHROPIC_AUTH_TOKEN=${token}`);
      await fs.writeFile(envPath, `${nextLines.filter(Boolean).join('\n')}\n`, 'utf8');

      return res.json({ success: true });
      const keysToUpdate = {
        'ANTHROPIC_BASE_URL': baseUrl || 'https://api.anthropic.com',
        'ANTHROPIC_API_KEY': token,
        'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS': '1'
      };

      const keysToRemove = new Set(['ANTHROPIC_AUTH_TOKEN']);

      const newLines = [];
      const existingKeys = new Set();
      envContent.split('\n').forEach(line => {
        const [key] = line.split('=');
        const trimmedKey = key.trim();
        if (keysToRemove.has(trimmedKey)) {
          return;
        }
        if (keysToUpdate[trimmedKey]) {
          newLines.push(`${trimmedKey}=${keysToUpdate[trimmedKey]}`);
          existingKeys.add(trimmedKey);
        } else if (line.trim()) {
          newLines.push(line);
        }
      });

      Object.entries(keysToUpdate).forEach(([key, val]) => {
        if (!existingKeys.has(key)) {
          newLines.push(`${key}=${val}`);
        }
      });

      await fs.writeFile(envPath, newLines.join('\n') + '\n');

      Object.entries(keysToUpdate).forEach(([key, val]) => {
        process.env[key] = val;
      });
      delete process.env.ANTHROPIC_AUTH_TOKEN;

      return res.json({ success: true, message: 'Custom API verified and applied.' });
    } else {
      const err = await response.text();
      return res.status(response.status).json({ error: `Verification failed: ${err}` });
    }

    return res.status(400).json({ error: 'Failed to verify custom API token' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Local GPU / Ollama routes
// ---------------------------------------------------------------------------

router.get('/local/gpu-info', async (req, res) => {
  try {
    const result = await detectGPUs();
    return res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/local/status', async (req, res) => {
  try {
    const serverUrl = process.env.LOCAL_GPU_SERVER_URL || DEFAULT_OLLAMA_URL;
    const status = await checkOllamaStatus(serverUrl);

    if (status.running) {
      const gpus = await detectGPUs().catch(() => ({ gpus: [] }));
      const hasGpu = gpus.gpus && gpus.gpus.length > 0;

      return res.json(buildStatusPayload({
        authenticated: true,
        email: `Ollama · ${status.models.length} model${status.models.length !== 1 ? 's' : ''}${hasGpu ? ' · GPU detected' : ''}`,
        cliAvailable: true,
        cliCommand: null,
      }, 'local'));
    }

    return res.json(buildStatusPayload({
      authenticated: false,
      email: null,
      error: status.error,
      cliAvailable: true,
      cliCommand: null,
      installHint: 'Install Ollama from https://ollama.com and run: ollama serve',
    }, 'local'));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/local/models', async (req, res) => {
  try {
    let serverUrl;
    try {
      serverUrl = normalizeLocalOllamaBaseUrl(
        req.query.serverUrl || process.env.LOCAL_GPU_SERVER_URL || DEFAULT_OLLAMA_URL,
      );
    } catch (e) {
      return res.status(400).json({ error: e.message, models: [] });
    }
    const status = await checkOllamaStatus(serverUrl);
    if (!status.running) {
      return res.status(503).json({ error: 'Ollama is not running', models: [] });
    }

    const gpus = await detectGPUs().catch(() => ({ gpus: [] }));
    const hasGpu = gpus.gpus && gpus.gpus.length > 0;
    let maxVramMb = 0;
    if (hasGpu) {
      for (const gpu of gpus.gpus) {
        if (gpu.memoryTotal) maxVramMb = Math.max(maxVramMb, gpu.memoryTotal);
      }
    }

    return res.json({
      models: status.models,
      hasGpu,
      maxVramMb,
      gpuCount: gpus.gpus.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/local/pull-model', async (req, res) => {
  try {
    const { modelName, serverUrl } = req.body;
    if (!modelName) return res.status(400).json({ error: 'modelName is required' });

    let url;
    try {
      url = normalizeLocalOllamaBaseUrl(
        serverUrl || process.env.LOCAL_GPU_SERVER_URL || DEFAULT_OLLAMA_URL,
      );
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    await pullOllamaModel(url, modelName);
    return res.json({ success: true, message: `Model "${modelName}" pulled successfully.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/local/save-config', async (req, res) => {
  try {
    const { serverUrl } = req.body;
    if (serverUrl) {
      let normalizedUrl;
      try {
        normalizedUrl = normalizeLocalOllamaBaseUrl(serverUrl);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';
      try { envContent = await fs.readFile(envPath, 'utf8'); } catch {}

      const lines = envContent.split('\n');
      let found = false;
      const newLines = lines.map(line => {
        if (line.trim().startsWith('LOCAL_GPU_SERVER_URL=')) {
          found = true;
          return `LOCAL_GPU_SERVER_URL=${normalizedUrl}`;
        }
        return line;
      }).filter(l => l.trim() !== '' || found);

      if (!found) newLines.push(`LOCAL_GPU_SERVER_URL=${normalizedUrl}`);
      await fs.writeFile(envPath, newLines.join('\n') + '\n');
      process.env.LOCAL_GPU_SERVER_URL = normalizedUrl;
    }

    return res.json({ success: true, message: 'Local GPU configuration saved.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export {
  checkCodexCredentials,
};

export default router;
