#!/usr/bin/env node

/**
 * Compute Tools MCP Server
 *
 * Exposes compute node operations (run, sync, slurm) as MCP tools
 * that the AI agent can use during a chat session.
 *
 * Launched as a child process by the Claude Agent SDK via mcpServers config.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ComputeNode, getActiveNode } from './compute-node.js';

const server = new Server(
  { name: 'compute-tools', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// ─── Tool definitions ───

const TOOLS = [
  {
    name: 'compute_info',
    description:
      'Get information about the active remote compute node, including hostname, type, and GPU status. Use this first to check what compute resources are available.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'compute_run',
    description:
      'Run a shell command on the active remote compute node via SSH. Use this for GPU tasks, training scripts, or any command that should execute on the remote server instead of locally.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute on the remote node',
        },
        cwd: {
          type: 'string',
          description:
            'Local working directory. If provided and skipSync is false, code will be synced to the remote node before execution.',
        },
        skipSync: {
          type: 'boolean',
          description:
            'If true, skip syncing code before running. Default: true. Set to false if you need to sync local code first.',
          default: true,
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'compute_sync',
    description:
      'Sync project code between the local machine and the active remote compute node. Use "up" to push local code to remote, "down" to pull results back.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down'],
          description: '"up" = push local→remote, "down" = pull remote→local',
        },
        cwd: {
          type: 'string',
          description: 'Local project directory to sync',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description:
            'For "down" direction: specific file patterns to pull (e.g., ["logs/", "checkpoints/"]). Defaults to logs/, checkpoints/, results/.',
        },
      },
      required: ['direction', 'cwd'],
    },
  },
  {
    name: 'compute_slurm_submit',
    description:
      'Submit a Slurm batch job on the active compute node. Provide a full sbatch script including #SBATCH directives. Only works on Slurm HPC nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description:
            'Full sbatch script content including #!/bin/bash and #SBATCH directives',
        },
      },
      required: ['script'],
    },
  },
  {
    name: 'compute_slurm_queue',
    description:
      'List current Slurm jobs on the active compute node. Shows job ID, name, state, and elapsed time. Only works on Slurm HPC nodes.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'compute_check_available',
    description:
      'Check whether compute resources (GPU) are available for running experiments. Returns COMPUTE_OK=true/false with details. Use this BEFORE running any experiment to avoid hallucinating results when no GPU is available. If COMPUTE_OK=false, STOP and inform the user — do NOT proceed with experiments.',
    inputSchema: {
      type: 'object',
      properties: {
        environment: {
          type: 'string',
          enum: ['local', 'remote', 'auto'],
          description: 'Which environment to check. "auto" checks remote first (if configured), then local. Default: auto.',
          default: 'auto',
        },
      },
    },
  },
];

// ─── Tool handlers ───

async function requireActiveNode() {
  const node = await getActiveNode();
  if (!node) {
    throw new Error(
      'No active compute node configured. Please set one in the Compute Dashboard (click "Set as Active" on a node).',
    );
  }
  return node;
}

async function handleTool(name, args) {
  switch (name) {
    case 'compute_info': {
      const node = await requireActiveNode();
      let gpuInfo = 'Unknown';
      try {
        gpuInfo = await ComputeNode.run({
          nodeId: node.id,
          command: 'nvidia-smi --query-gpu=name,memory.total,utilization.gpu --format=csv,noheader 2>/dev/null || echo "No GPU detected"',
          skipSync: true,
        });
      } catch {
        gpuInfo = 'Could not query GPU (connection error)';
      }
      return [
        `Active Compute Node: ${node.name}`,
        `Host: ${node.user}@${node.host}${node.port && node.port !== 22 ? ':' + node.port : ''}`,
        `Type: ${node.type === 'slurm' ? 'Slurm HPC cluster' : 'Direct GPU server'}`,
        `Work Directory: ${node.workDir || '~'}`,
        `GPU Info:\n${gpuInfo}`,
      ].join('\n');
    }

    case 'compute_run': {
      const node = await requireActiveNode();
      const output = await ComputeNode.run({
        nodeId: node.id,
        command: args.command,
        cwd: args.cwd || undefined,
        skipSync: args.skipSync !== false,
      });
      return output || '(no output)';
    }

    case 'compute_sync': {
      const node = await requireActiveNode();
      const output = await ComputeNode.sync({
        nodeId: node.id,
        direction: args.direction,
        cwd: args.cwd,
        files: args.files || [],
      });
      return output || `Sync ${args.direction} completed successfully.`;
    }

    case 'compute_slurm_submit': {
      const node = await requireActiveNode();
      const output = await ComputeNode.sbatch({
        nodeId: node.id,
        rawScript: args.script,
      });
      return output || 'Job submitted.';
    }

    case 'compute_slurm_queue': {
      const node = await requireActiveNode();
      const jobs = await ComputeNode.squeue({ nodeId: node.id });
      if (jobs.length === 0) return 'No active jobs.';
      const header = 'JobID\tName\tPartition\tState\tElapsed\tTime Limit';
      const rows = jobs.map(
        (j) => `${j.jobId}\t${j.name}\t${j.partition}\t${j.state}\t${j.elapsed}\t${j.timeLimit}`,
      );
      return [header, ...rows].join('\n');
    }

    case 'compute_check_available': {
      const env = args.environment || 'auto';
      const lines = [];
      let available = false;

      const checkRemote = async () => {
        const node = await getActiveNode();
        if (!node) return null;
        try {
          const gpuOut = await ComputeNode.run({
            nodeId: node.id,
            command: 'nvidia-smi --query-gpu=index,name,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null || echo "NO_GPU"',
            skipSync: true,
          });
          if (gpuOut.includes('NO_GPU')) {
            return { available: false, reason: `Remote node "${node.name}" has no GPU` };
          }
          let freeCount = 0;
          const gpuLines = [];
          for (const line of gpuOut.split('\n')) {
            const parts = line.split(',').map(s => s.trim());
            if (parts.length >= 4) {
              const used = parseFloat(parts[2]) || 0;
              const total = parseFloat(parts[3]) || 0;
              const isFree = used < 500;
              if (isFree) freeCount++;
              gpuLines.push(`  GPU ${parts[0]}: ${parts[1]} — ${used}/${total} MiB${isFree ? ' (FREE)' : ' (BUSY)'}`);
            }
          }
          return {
            available: freeCount > 0,
            reason: freeCount > 0
              ? `Remote node "${node.name}": ${freeCount} free GPU(s)`
              : `Remote node "${node.name}": all GPUs occupied`,
            details: gpuLines.join('\n'),
          };
        } catch (err) {
          return { available: false, reason: `Remote node "${node.name}" unreachable: ${err.message}` };
        }
      };

      const checkLocal = async () => {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const run = async (cmd) => { try { return (await execAsync(cmd, { timeout: 15000 })).stdout.trim(); } catch { return ''; } };

        const gpuOut = await run('nvidia-smi --query-gpu=index,name,memory.used,memory.total --format=csv,noheader,nounits');
        if (gpuOut) {
          let freeCount = 0;
          const gpuLines = [];
          for (const line of gpuOut.split('\n')) {
            const parts = line.split(',').map(s => s.trim());
            if (parts.length >= 4) {
              const used = parseFloat(parts[2]) || 0;
              const total = parseFloat(parts[3]) || 0;
              const isFree = used < 500;
              if (isFree) freeCount++;
              gpuLines.push(`  GPU ${parts[0]}: ${parts[1]} — ${used}/${total} MiB${isFree ? ' (FREE)' : ' (BUSY)'}`);
            }
          }
          return {
            available: freeCount > 0,
            reason: freeCount > 0 ? `Local: ${freeCount} free CUDA GPU(s)` : 'Local: all CUDA GPUs occupied',
            details: gpuLines.join('\n'),
          };
        }

        const mpsOut = await run('python3 -c "import torch; print(hasattr(torch.backends, \'mps\') and torch.backends.mps.is_available())" 2>/dev/null');
        if (mpsOut === 'True') {
          return { available: true, reason: 'Local: Apple MPS available', details: '  GPU 0: Apple MPS (Metal)' };
        }

        return {
          available: false,
          reason: 'Local: no GPU detected (no CUDA, no MPS)',
          details: '  nvidia-smi not found, PyTorch MPS not available',
        };
      };

      if (env === 'remote') {
        const r = await checkRemote();
        if (!r) {
          lines.push('COMPUTE_OK=false', 'REASON=No active remote compute node configured.');
        } else {
          available = r.available;
          lines.push(`COMPUTE_OK=${r.available}`, `REASON=${r.reason}`);
          if (r.details) lines.push(r.details);
        }
      } else if (env === 'local') {
        const r = await checkLocal();
        available = r.available;
        lines.push(`COMPUTE_OK=${r.available}`, `REASON=${r.reason}`);
        if (r.details) lines.push(r.details);
      } else {
        const remote = await checkRemote();
        if (remote?.available) {
          available = true;
          lines.push(`COMPUTE_OK=true`, `REASON=${remote.reason} (remote)`, remote.details || '');
        } else {
          const local = await checkLocal();
          available = local.available;
          lines.push(`COMPUTE_OK=${local.available}`, `REASON=${local.reason} (local)`);
          if (local.details) lines.push(local.details);
          if (remote) lines.push(`(Remote also checked: ${remote.reason})`);
        }
      }

      if (!available) {
        lines.push('', 'ACTION REQUIRED: Do NOT proceed with experiment execution.',
          'Inform the user that compute resources are unavailable.',
          'Do NOT fabricate or hallucinate experiment results.',
          'Suggest: gpu: modal (serverless), gpu: vast (on-demand), or configure a remote server.');
      }

      return lines.filter(Boolean).join('\n');
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP protocol handlers ───

server.setRequestHandler(
  ListToolsRequestSchema,
  async () => ({ tools: TOOLS }),
);

server.setRequestHandler(
  CallToolRequestSchema,
  async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleTool(name, args || {});
      return {
        content: [{ type: 'text', text: result }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  },
);

// ─── Start server ───

const transport = new StdioServerTransport();
await server.connect(transport);
