import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';
import { resolveCursorCliCommand } from '../utils/cursorCommand.js';
import { resolveAvailableCliCommand } from '../utils/cliResolution.js';

const router = express.Router();

function buildCliInstallHint(agent) {
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
    default:
      return 'Required CLI is not installed. Install it first, then retry login.';
  }
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
  return {
    authenticated: Boolean(result.authenticated),
    email: result.email || null,
    error: result.error || null,
    cliAvailable: result.cliAvailable !== false,
    cliCommand: result.cliCommand || null,
    installHint: result.installHint || (result.cliAvailable === false ? buildCliInstallHint(agent) : null)
  };
}

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

    // Check for Custom API env var
    if (process.env.ANTHROPIC_AUTH_TOKEN) {
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
      return {
        authenticated: false,
        email: null,
        error: 'Gemini CLI not installed',
        cliAvailable: false,
        cliCommand,
        installHint: buildCliInstallHint('gemini')
      };
    }

    // Check for GOOGLE_API_KEY environment variable first
    if (process.env.GOOGLE_API_KEY) {
      console.log('[DEBUG] Gemini: Found GOOGLE_API_KEY in environment');
      return {
        authenticated: true,
        email: 'API Key (Env)',
        cliAvailable: true,
        cliCommand
      };
    }

    // Check for OAuth credentials file (new Gemini CLI)
    const oauthPath = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
    console.log(`[DEBUG] Gemini: Checking for OAuth file at ${oauthPath}`);
    try {
      const content = await fs.readFile(oauthPath, 'utf8');
      const creds = JSON.parse(content);

      // Check for presence of refresh_token or access_token
      if (creds.refresh_token || creds.access_token) {
        let email = creds.email || 'OAuth (Config)';

        // Try to extract email from id_token if available
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

    // Fallback to legacy config file check
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
        // Fall back to credentials file check on timeout
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
          // JSON parse failed, fall through
        }
      }

      // CLI check failed, fall back to credentials file
      checkClaudeCredentialsFile({ cliAvailable: true, cliCommand: resolvedCliCommand }).then(resolve);
    });

    childProcess.on('error', () => {
      if (processCompleted) return;
      processCompleted = true;
      clearTimeout(timeout);
      // Command was already validated by resolveAvailableCliCommand, so treat
      // any spawn error as a transient failure rather than "CLI missing".
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
  } catch (error) {
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

    childProcess.on('error', (err) => {
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

async function checkCodexCredentials() {
  let cliCommand = process.env.CODEX_CLI_PATH || 'codex';
  try {
    const resolvedCliCommand = await resolveAvailableCliCommand({
      envVarName: 'CODEX_CLI_PATH',
      defaultCommands: ['codex'],
      appendWindowsSuffixes: true
    });
    cliCommand = resolvedCliCommand || cliCommand;

    if (!resolvedCliCommand) {
      return {
        authenticated: false,
        email: null,
        error: 'Codex CLI not installed',
        cliAvailable: false,
        cliCommand,
        installHint: buildCliInstallHint('codex')
      };
    }

    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    const content = await fs.readFile(authPath, 'utf8');
    const auth = JSON.parse(content);

    // Tokens are nested under 'tokens' key
    const tokens = auth.tokens || {};

    // Check for valid tokens (id_token or access_token)
    if (tokens.id_token || tokens.access_token) {
      // Try to extract email from id_token JWT payload
      let email = 'Authenticated';
      if (tokens.id_token) {
        try {
          // JWT is base64url encoded: header.payload.signature
          const parts = tokens.id_token.split('.');
          if (parts.length >= 2) {
            // Decode the payload (second part)
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            email = payload.email || payload.user || 'Authenticated';
          }
        } catch {
          // If JWT decoding fails, use fallback
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

    // Also check for OPENAI_API_KEY as fallback auth method
    if (auth.OPENAI_API_KEY) {
      return {
        authenticated: true,
        email: 'API Key Auth',
        cliAvailable: true,
        cliCommand
      };
    }

    return {
      authenticated: false,
      email: null,
      error: 'No valid tokens found',
      cliAvailable: true,
      cliCommand
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        authenticated: false,
        email: null,
        error: 'Codex not configured',
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

    // 200 = success, 401/403 = bad token, anything else with a valid JSON body means the endpoint is reachable
    if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 403)) {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';
      try {
        envContent = await fs.readFile(envPath, 'utf8');
      } catch (e) { /* ignore if not exists */ }

      const keysToUpdate = {
        'ANTHROPIC_BASE_URL': baseUrl || 'https://api.anthropic.com',
        'ANTHROPIC_AUTH_TOKEN': token,
        'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS': '1'
      };

      const newLines = [];
      const existingKeys = new Set();
      envContent.split('\n').forEach(line => {
        const [key] = line.split('=');
        if (keysToUpdate[key.trim()]) {
          newLines.push(`${key.trim()}=${keysToUpdate[key.trim()]}`);
          existingKeys.add(key.trim());
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

      return res.json({ success: true, message: 'Custom API verified and applied.' });
    } else {
      const err = await response.text();
      return res.status(response.status).json({ error: `Verification failed: ${err}` });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
