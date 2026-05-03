import express from 'express';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { resolveAvailableCliCommand } from '../utils/cliResolution.js';

const router = express.Router();

function createCliResponder(res) {
  let responded = false;
  return (status, payload) => {
    if (responded || res.headersSent) {
      return;
    }
    responded = true;
    res.status(status).json(payload);
  };
}

async function resolveCopilotCommand() {
  return resolveAvailableCliCommand({
    envVarName: 'GITHUB_COPILOT_CLI_PATH',
    legacyEnvVarNames: ['COPILOT_CLI_PATH'],
    defaultCommands: ['copilot'],
    appendWindowsSuffixes: true,
  });
}

function parseJsonOutput(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) {
    return null;
  }
  return JSON.parse(trimmed);
}

function normalizeCopilotMcpServer(name, config = {}) {
  const type = config.type || config.transport || 'stdio';
  return {
    id: name,
    name,
    type,
    scope: 'user',
    config: {
      command: config.command || '',
      args: Array.isArray(config.args) ? config.args : [],
      env: config.env && typeof config.env === 'object' ? config.env : {},
      url: config.url || '',
      headers: config.headers && typeof config.headers === 'object' ? config.headers : {},
      timeout: Number.isFinite(config.timeout) ? config.timeout : undefined,
      tools: Array.isArray(config.tools) ? config.tools : [],
    },
    raw: config,
  };
}

function parseCopilotModelsFromConfigHelp(stdout) {
  const text = String(stdout || '');
  const lines = text.split(/\r?\n/);
  const models = [];
  let inModelSection = false;

  for (const line of lines) {
    if (!inModelSection) {
      if (/^\s*`model`:\s*AI model to use/i.test(line)) {
        inModelSection = true;
      }
      continue;
    }

    const quotedMatch = line.match(/^\s*-\s+"([^"]+)"\s*$/);
    if (quotedMatch) {
      const value = quotedMatch[1].trim();
      models.push({
        value,
        label: value,
      });
      continue;
    }

    if (/^\s*`[a-z0-9_.-]+`:/i.test(line) || /^\S/.test(line)) {
      break;
    }
  }

  return models;
}

async function runCopilotCli(args, res, successHandler, failureStatus = 400) {
  const respond = createCliResponder(res);
  const command = await resolveCopilotCommand();

  if (!command) {
    respond(503, {
      error: 'GitHub Copilot CLI not installed',
      details: 'Install @github/copilot or set GITHUB_COPILOT_CLI_PATH.',
    });
    return;
  }

  const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';

  proc.stdout?.on('data', (data) => {
    stdout += data.toString();
  });
  proc.stderr?.on('data', (data) => {
    stderr += data.toString();
  });

  proc.on('close', (code) => {
    if (code === 0) {
      try {
        successHandler(stdout, stderr, respond);
      } catch (error) {
        respond(500, { error: 'Failed to parse GitHub Copilot CLI output', details: error.message });
      }
      return;
    }

    const trimmedError = stderr.trim() || stdout.trim() || `Exited with code ${code}`;
    const status = /not found/i.test(trimmedError) ? 404 : failureStatus;
    respond(status, { error: 'GitHub Copilot CLI command failed', details: trimmedError });
  });

  proc.on('error', (error) => {
    const isMissing = error?.code === 'ENOENT';
    respond(isMissing ? 503 : 500, {
      error: isMissing ? 'GitHub Copilot CLI not installed' : 'Failed to run GitHub Copilot CLI',
      details: error.message,
      code: error.code,
    });
  });
}

router.get('/models', async (req, res) => {
  await runCopilotCli(['help', 'config'], res, (stdout, _stderr, respond) => {
    const parsedModels = parseCopilotModelsFromConfigHelp(stdout);
    const models = [{ value: 'auto', label: 'Auto' }, ...parsedModels.filter(model => model.value !== 'auto')];
    respond(200, {
      success: true,
      source: 'copilot-help-config',
      models,
    });
  }, 500);
});

router.get('/mcp/cli/list', async (req, res) => {
  await runCopilotCli(['mcp', 'list', '--json'], res, (stdout, _stderr, respond) => {
    const parsed = parseJsonOutput(stdout) || {};
    const serversObject = parsed.mcpServers && typeof parsed.mcpServers === 'object' ? parsed.mcpServers : {};
    const servers = Object.entries(serversObject).map(([name, config]) => normalizeCopilotMcpServer(name, config));
    respond(200, { success: true, servers, raw: parsed });
  });
});

router.get('/mcp/cli/get/:name', async (req, res) => {
  const { name } = req.params;
  await runCopilotCli(['mcp', 'get', name, '--json', '--show-secrets'], res, (stdout, _stderr, respond) => {
    const parsed = parseJsonOutput(stdout) || {};
    const config = parsed.mcpServer || parsed.server || parsed;
    respond(200, {
      success: true,
      server: normalizeCopilotMcpServer(name, config),
      raw: parsed,
    });
  }, 404);
});

router.post('/mcp/cli/add', async (req, res) => {
  const {
    name,
    type = 'stdio',
    command,
    args = [],
    url,
    env = {},
    headers = {},
    timeout,
    tools = [],
  } = req.body || {};

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  if (type === 'stdio' && !command) {
    return res.status(400).json({ error: 'command is required for stdio MCP servers' });
  }

  if ((type === 'http' || type === 'sse') && !url) {
    return res.status(400).json({ error: 'url is required for remote MCP servers' });
  }

  const cliArgs = ['mcp', 'add', name];

  if (type !== 'stdio') {
    cliArgs.push('--transport', type);
  }

  Object.entries(env).forEach(([key, value]) => {
    cliArgs.push('--env', `${key}=${value}`);
  });

  Object.entries(headers).forEach(([key, value]) => {
    cliArgs.push('--header', `${key}: ${value}`);
  });

  if (Number.isFinite(Number(timeout)) && Number(timeout) > 0) {
    cliArgs.push('--timeout', String(Number(timeout)));
  }

  if (Array.isArray(tools) && tools.length > 0) {
    cliArgs.push('--tools', tools.join(','));
  }

  if (type === 'stdio') {
    cliArgs.push('--', command, ...(Array.isArray(args) ? args : []));
  } else {
    cliArgs.push(url);
  }

  await runCopilotCli(cliArgs, res, (stdout, _stderr, respond) => {
    respond(200, { success: true, output: stdout, message: `MCP server "${name}" added successfully` });
  });
});

router.delete('/mcp/cli/remove/:name', async (req, res) => {
  const { name } = req.params;
  await runCopilotCli(['mcp', 'remove', name], res, (stdout, _stderr, respond) => {
    respond(200, { success: true, output: stdout, message: `MCP server "${name}" removed successfully` });
  }, 404);
});

router.get('/mcp/config/read', async (_req, res) => {
  try {
    const configPath = path.join(os.homedir(), '.copilot', 'mcp-config.json');

    let parsed = { mcpServers: {} };
    try {
      const content = await fs.readFile(configPath, 'utf8');
      parsed = JSON.parse(content);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    const serversObject = parsed.mcpServers && typeof parsed.mcpServers === 'object' ? parsed.mcpServers : {};
    const servers = Object.entries(serversObject).map(([name, config]) => normalizeCopilotMcpServer(name, config));
    res.json({ success: true, path: configPath, servers, raw: parsed });
  } catch (error) {
    console.error('Error reading GitHub Copilot MCP config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;