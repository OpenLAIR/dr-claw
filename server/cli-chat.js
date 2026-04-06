#!/usr/bin/env node
/**
 * dr-claw chat — Interactive terminal chat using OpenRouter
 *
 * Usage:
 *   dr-claw chat                              # Use defaults from .env
 *   dr-claw chat --model deepseek/deepseek-r1 # Override model
 *   dr-claw chat --key sk-or-...              # Override API key
 */

import readline from 'readline';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

function spawnAsync(command, args, options = {}) {
  const maxBuffer = options.maxBuffer || 1024 * 1024; // 1 MB default
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;

    child.stdout.on('data', (data) => {
      if (!truncated) {
        stdout += data.toString();
        if (stdout.length > maxBuffer) {
          stdout = stdout.slice(0, maxBuffer);
          truncated = true;
          child.kill('SIGTERM');
        }
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error(`Command failed: ${command} ${args.join(' ')}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const MAX_AGENT_TURNS = 25;
const BASH_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 80_000;

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  white: '\x1b[97m',
};

function styled(color, text) { return `${color}${text}${c.reset}`; }

// ── Tool schemas ──────────────────────────────────────────────────────────────

const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'Read',
      description: 'Read the contents of a file at the given path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          offset: { type: 'integer', description: 'Starting line (1-based)' },
          limit: { type: 'integer', description: 'Number of lines to read' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Write',
      description: 'Create or overwrite a file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Edit',
      description: 'Replace an exact substring in a file. old_str must appear exactly once.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_str: { type: 'string' },
          new_str: { type: 'string' },
        },
        required: ['path', 'old_str', 'new_str'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Bash',
      description: 'Execute a shell command.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Glob',
      description: 'Find files matching a glob pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string', description: 'Directory to search in' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Grep',
      description: 'Search file contents for a regex pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string' },
          include: { type: 'string', description: 'Glob to filter files' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'LS',
      description: 'List directory contents.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'WebSearch',
      description: 'Search the web.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
];

// ── Tool execution ────────────────────────────────────────────────────────────

async function executeTool(name, args, workingDir) {
  const resolve = (p) => {
    if (!p) return workingDir;
    return path.isAbsolute(p) ? p : path.resolve(workingDir, p);
  };
  const trunc = (s) =>
    s.length <= MAX_OUTPUT_CHARS ? s : s.slice(0, MAX_OUTPUT_CHARS) + `\n…(truncated)`;

  try {
    switch (name) {
      case 'Read': {
        const content = await fs.readFile(resolve(args.path), 'utf-8');
        const lines = content.split('\n');
        const start = Math.max(0, (args.offset || 1) - 1);
        const end = args.limit ? start + args.limit : lines.length;
        return trunc(lines.slice(start, end).map((l, i) => `${String(start + i + 1).padStart(6)}|${l}`).join('\n'));
      }
      case 'Write': {
        const fp = resolve(args.path);
        await fs.mkdir(path.dirname(fp), { recursive: true });
        await fs.writeFile(fp, args.content, 'utf-8');
        return `Wrote ${args.content.length} chars → ${args.path}`;
      }
      case 'Edit': {
        const fp = resolve(args.path);
        const src = await fs.readFile(fp, 'utf-8');
        const count = src.split(args.old_str).length - 1;
        if (count === 0) return `Error: old_str not found in ${args.path}`;
        if (count > 1) return `Error: old_str matches ${count} times`;
        await fs.writeFile(fp, src.replace(args.old_str, args.new_str), 'utf-8');
        return `Edited ${args.path}`;
      }
      case 'Bash': {
        try {
          const { stdout, stderr } = await execAsync(args.command, {
            cwd: workingDir, timeout: BASH_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024,
            env: { ...process.env, HOME: os.homedir() },
          });
          let out = stdout || '';
          if (stderr) out += (out ? '\n' : '') + `STDERR:\n${stderr}`;
          return trunc(out || '(no output)');
        } catch (err) {
          return trunc(`Exit code ${err.code ?? 1}\n${err.stdout || ''}${err.stderr ? '\nSTDERR:\n' + err.stderr : ''}`);
        }
      }
      case 'Glob': {
        const dir = resolve(args.path);
        try {
          const { stdout } = await spawnAsync('rg', ['--files', '--glob', args.pattern], {
            cwd: dir, timeout: 30_000,
          });
          const lines = stdout.split('\n').filter(Boolean).slice(0, 300);
          return trunc(lines.join('\n') || '(no matches)');
        } catch {
          try {
            const { stdout } = await spawnAsync('find', ['.', '-name', args.pattern, '-type', 'f'], {
              cwd: dir, timeout: 30_000,
            });
            const lines = stdout.split('\n').filter(Boolean).slice(0, 300);
            return trunc(lines.join('\n') || '(no matches)');
          } catch {
            return '(no matches)';
          }
        }
      }
      case 'Grep': {
        const target = resolve(args.path);
        const rgArgs = ['--line-number', '--max-count', '100', '--max-columns', '200'];
        if (args.include) rgArgs.push('--glob', args.include);
        rgArgs.push('-e', args.pattern, '--', target);
        try {
          const { stdout } = await spawnAsync('rg', rgArgs, {
            cwd: workingDir, timeout: 30_000,
          });
          return trunc(stdout || '(no matches)');
        } catch (err) {
          if (err.code === 1) return '(no matches)';
          return `Error: ${err.message}`;
        }
      }
      case 'LS': {
        const entries = await fs.readdir(resolve(args.path), { withFileTypes: true });
        return entries.map((e) => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`).join('\n') || '(empty)';
      }
      case 'WebSearch': {
        const encoded = encodeURIComponent(args.query);
        try {
          const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
            headers: { 'User-Agent': 'Dr. Claw CLI' }, signal: AbortSignal.timeout(15_000),
          });
          const html = await resp.text();
          const results = [];
          const regex = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
          let m;
          while ((m = regex.exec(html)) !== null && results.length < 8) {
            results.push({ url: m[1], title: m[2].replace(/<[^>]+>/g, '').trim() });
          }
          return results.length
            ? results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join('\n\n')
            : '(no results)';
        } catch (err) {
          return `Search error: ${err.message}`;
        }
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (error) {
    return `Error executing ${name}: ${error.message}`;
  }
}

// ── Streaming API call ────────────────────────────────────────────────────────

async function streamApiCall(apiKey, model, messages, tools) {
  const body = { model, messages, stream: true, stream_options: { include_usage: true } };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  return fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/OpenLAIR/dr-claw',
      'X-Title': 'Dr. Claw CLI',
    },
    body: JSON.stringify(body),
  });
}

async function consumeStream(response, onText) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCalls = {};
  let finishReason = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const payload = trimmed.slice(6);
      if (payload === '[DONE]') continue;

      try {
        const parsed = JSON.parse(payload);
        const choice = parsed.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta;
        if (delta?.content) {
          content += delta.content;
          onText?.(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCalls[idx]) toolCalls[idx] = { id: '', name: '', arguments: '' };
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function?.name) toolCalls[idx].name = tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
          }
        }
      } catch { /* skip */ }
    }
  }

  return {
    content,
    toolCalls: Object.values(toolCalls).filter((tc) => tc.id && tc.name),
    finishReason,
  };
}

// ── Main chat loop ────────────────────────────────────────────────────────────

export async function startChat(options = {}) {
  const apiKey = options.key || process.env.OPENROUTER_API_KEY;
  const model = options.model || process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4';
  const workingDir = process.cwd();

  if (!apiKey) {
    console.error(styled(c.red, '\n  Error: No OpenRouter API key found.'));
    console.error(styled(c.gray, '  Set OPENROUTER_API_KEY in your .env file or pass --key <key>\n'));
    process.exit(1);
  }

  const modelShort = model.includes('/') ? model.split('/').pop() : model;

  console.log('');
  console.log(styled(c.bold, `  Dr. Claw Chat — ${modelShort}`));
  console.log(styled(c.dim, `  ─────────────────────────────────────`));
  console.log(styled(c.gray, `  Model:     ${model}`));
  console.log(styled(c.gray, `  Directory: ${workingDir}`));
  console.log(styled(c.gray, `  Tools:     Read, Write, Edit, Bash, Glob, Grep, LS, WebSearch`));
  console.log(styled(c.dim, `  Type "exit" or Ctrl+C to quit.\n`));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: styled(c.cyan, '  ❯ '),
  });

  const systemPrompt = [
    `You are a powerful agentic AI assistant. You operate in the directory: ${workingDir}`,
    '',
    'You have tools to read/write files, run shell commands, search code, and browse the web.',
    'Use tools proactively to explore the project and produce high-quality output.',
    'Always prefer tools over guessing about file contents or project structure.',
    `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`,
  ].join('\n');

  const messages = [{ role: 'system', content: systemPrompt }];

  const ask = () => {
    rl.prompt();
    rl.once('line', async (line) => {
      const input = line.trim();
      if (!input) { ask(); return; }
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        console.log(styled(c.dim, '\n  Goodbye!\n'));
        rl.close();
        process.exit(0);
      }

      messages.push({ role: 'user', content: input });
      process.stdout.write('\n');

      try {
        await agentLoop(apiKey, model, messages, workingDir);
      } catch (err) {
        console.error(styled(c.red, `\n  Error: ${err.message}\n`));
      }

      process.stdout.write('\n');
      ask();
    });
  };

  rl.on('close', () => {
    console.log(styled(c.dim, '\n  Goodbye!\n'));
    process.exit(0);
  });

  ask();
}

async function agentLoop(apiKey, model, messages, workingDir) {
  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const response = await streamApiCall(apiKey, model, messages, TOOL_SCHEMAS);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(styled(c.red, `  API error ${response.status}: ${errText.slice(0, 300)}`));
      return;
    }

    process.stdout.write(styled(c.green, '  '));
    const result = await consumeStream(response, (delta) => {
      process.stdout.write(styled(c.reset, delta));
    });
    if (result.content) {
      process.stdout.write('\n');
    }

    if (result.toolCalls.length === 0) {
      if (result.content) {
        messages.push({ role: 'assistant', content: result.content });
      }
      return;
    }

    // Record assistant message with tool calls
    const assistantMsg = { role: 'assistant', content: result.content || null, tool_calls: [] };
    for (const tc of result.toolCalls) {
      assistantMsg.tool_calls.push({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      });
    }
    messages.push(assistantMsg);

    // Execute each tool
    for (const tc of result.toolCalls) {
      let args;
      try { args = JSON.parse(tc.arguments); } catch { args = {}; }

      const argSummary = tc.name === 'Read' ? args.path
        : tc.name === 'Write' ? args.path
        : tc.name === 'Edit' ? args.path
        : tc.name === 'Bash' ? args.command?.slice(0, 80)
        : tc.name === 'Glob' ? args.pattern
        : tc.name === 'Grep' ? `${args.pattern} ${args.path || ''}`
        : tc.name === 'LS' ? args.path
        : tc.name === 'WebSearch' ? args.query
        : JSON.stringify(args).slice(0, 60);

      process.stdout.write(styled(c.yellow, `  ⚡ ${tc.name}`));
      process.stdout.write(styled(c.gray, ` ${argSummary}\n`));

      const output = await executeTool(tc.name, args, workingDir);

      // Show a brief preview for file reads
      if (tc.name === 'Read' || tc.name === 'LS') {
        const preview = output.split('\n').slice(0, 3).join('\n');
        process.stdout.write(styled(c.dim, `    ${preview.split('\n').join('\n    ')}\n`));
        if (output.split('\n').length > 3) {
          process.stdout.write(styled(c.dim, `    …(${output.split('\n').length} lines)\n`));
        }
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: output.slice(0, 20_000),
      });
    }

    process.stdout.write('\n');
  }

  console.log(styled(c.yellow, `  (reached max ${MAX_AGENT_TURNS} turns)`));
}
