import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import os from 'os';
import pty from 'node-pty';
import crypto from 'crypto';

const CONFIG_DIR = path.join(os.homedir(), '.openclaw');
const CONFIG_FILE = path.join(CONFIG_DIR, 'compute-node.json');

// ─── ID generation ───

function generateId(hint) {
  const base = hint.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const short = base.slice(0, 20) || 'node';
  return `${short}-${crypto.randomBytes(3).toString('hex')}`;
}

// ─── Config storage (multi-node) ───

async function loadRawConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return { nodes: [], activeNodeId: null };
  }
}

async function migrateIfNeeded(data) {
  if (data.host && !data.nodes) {
    // Old single-node format → migrate
    const id = generateId(data.host);
    const node = {
      id,
      name: data.host,
      host: data.host,
      user: data.user,
      workDir: data.workDir || '~',
      type: 'direct',
    };
    if (data.keyPath) node.keyPath = data.keyPath;
    if (data.password) node.password = data.password;
    const migrated = { nodes: [node], activeNodeId: id };
    await saveRawConfig(migrated);
    return migrated;
  }
  return data;
}

async function saveRawConfig(config) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

// ─── Public config API ───

export async function loadAllNodes() {
  const raw = await loadRawConfig();
  const config = await migrateIfNeeded(raw);
  return config;
}

export async function loadNodeConfig(nodeId) {
  const config = await loadAllNodes();
  const node = config.nodes.find(n => n.id === nodeId);
  if (!node) throw new Error(`Node "${nodeId}" not found`);
  return node;
}

export async function getActiveNode() {
  const config = await loadAllNodes();
  if (!config.activeNodeId || config.nodes.length === 0) return null;
  return config.nodes.find(n => n.id === config.activeNodeId) || config.nodes[0] || null;
}

export async function saveNode(nodeConfig) {
  const config = await loadAllNodes();
  const idx = config.nodes.findIndex(n => n.id === nodeConfig.id);
  if (idx >= 0) {
    config.nodes[idx] = nodeConfig;
  } else {
    config.nodes.push(nodeConfig);
  }
  if (!config.activeNodeId || config.nodes.length === 1) {
    config.activeNodeId = nodeConfig.id;
  }
  await saveRawConfig(config);
  return nodeConfig;
}

export async function deleteNode(nodeId) {
  const config = await loadAllNodes();
  config.nodes = config.nodes.filter(n => n.id !== nodeId);
  if (config.activeNodeId === nodeId) {
    config.activeNodeId = config.nodes.length > 0 ? config.nodes[0].id : null;
  }
  await saveRawConfig(config);
}

export async function setActiveNode(nodeId) {
  const config = await loadAllNodes();
  const node = config.nodes.find(n => n.id === nodeId);
  if (!node) throw new Error(`Node "${nodeId}" not found`);
  config.activeNodeId = nodeId;
  await saveRawConfig(config);
  return node;
}

// Backward-compatible: returns active node config (flat object)
export async function loadConfig() {
  return await getActiveNode() || {};
}

export async function isComputeConfigured() {
  try {
    const node = await getActiveNode();
    return !!(node && node.host && node.user && (node.keyPath || node.password));
  } catch {
    return false;
  }
}

// ─── Shell execution helpers ───

function execLocal(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { ...options, shell: true });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Command failed (code ${code}): ${stderr || stdout}`));
    });
  });
}

function execWithPassword(command, password, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let output = '';
    let passwordSent = false;
    let finished = false;

    const proc = pty.spawn('bash', ['-c', command], {
      name: 'xterm',
      cols: 200,
      rows: 50,
      cwd: os.homedir(),
      env: { ...process.env, TERM: 'xterm' }
    });

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        proc.kill();
        reject(new Error('Command timed out'));
      }
    }, timeoutMs);

    proc.onData((data) => {
      const text = data.toString();
      output += text;

      if (!passwordSent && /[Pp]assword[:\s]*$/.test(output.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, ''))) {
        passwordSent = true;
        proc.write(password + '\n');
      }
    });

    proc.onExit(({ exitCode }) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      let cleanOutput = output
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');

      const lines = cleanOutput.split('\n');
      const filtered = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed &&
          !/^[Pp]assword[:\s]*$/.test(trimmed) &&
          trimmed !== password;
      });

      const resultLines = filtered.slice(1);
      const result = resultLines.join('\n').trim();

      if (exitCode === 0) {
        resolve(result);
      } else {
        reject(new Error(`Command failed (code ${exitCode}): ${result}`));
      }
    });
  });
}

// Execute SSH command on a specific node
async function execSsh(nodeConfig, remoteCmd) {
  const port = nodeConfig.port || 22;
  const sshBase = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 -p ${port}`;

  if (nodeConfig.keyPath) {
    const cmd = `${sshBase} -i ${nodeConfig.keyPath} ${nodeConfig.user}@${nodeConfig.host} ${JSON.stringify(remoteCmd)}`;
    return await execLocal(cmd);
  } else if (nodeConfig.password) {
    const cmd = `${sshBase} ${nodeConfig.user}@${nodeConfig.host} ${JSON.stringify(remoteCmd)}`;
    return await execWithPassword(cmd, nodeConfig.password);
  } else {
    throw new Error('No authentication method configured (need SSH key or password)');
  }
}

// Execute rsync on a specific node
async function execRsync(nodeConfig, src, dst, excludes = '') {
  const port = nodeConfig.port || 22;
  const sshCmd = nodeConfig.keyPath
    ? `ssh -o StrictHostKeyChecking=no -p ${port} -i ${nodeConfig.keyPath}`
    : `ssh -o StrictHostKeyChecking=no -p ${port}`;

  const cmd = `rsync -avz ${excludes} -e "${sshCmd}" ${src} ${dst}`;

  if (nodeConfig.keyPath) {
    return await execLocal(cmd);
  } else if (nodeConfig.password) {
    return await execWithPassword(cmd, nodeConfig.password, 120000);
  } else {
    throw new Error('No authentication method configured');
  }
}

function getProjectName(cwd) {
  return path.basename(cwd);
}

// ─── Helper: resolve node config from optional nodeId ───

async function resolveNode(nodeId) {
  if (nodeId) {
    return await loadNodeConfig(nodeId);
  }
  const active = await getActiveNode();
  if (!active) throw new Error('No compute node configured. Please add a node first.');
  return active;
}

// ─── Main ComputeNode API ───

export const ComputeNode = {
  // Configure / save a node
  async configure({ id, name, host, user, key, password, workDir = '~', type = 'direct', slurm, port }) {
    const nodeId = id || generateId(host);
    const node = {
      id: nodeId,
      name: name || host,
      host,
      user,
      port: port || 22,
      workDir,
      type,
    };

    if (key) {
      if (key.includes('BEGIN')) {
        const keyPath = path.join(os.homedir(), '.ssh', `compute_${nodeId}_key`);
        await fs.mkdir(path.dirname(keyPath), { recursive: true });
        await fs.writeFile(keyPath, key + '\n', { mode: 0o600 });
        node.keyPath = keyPath;
      } else {
        node.keyPath = key;
      }
    } else if (password) {
      node.password = password;
    }

    if (type === 'slurm' && slurm) {
      node.slurm = slurm;
    }

    await saveNode(node);
    return `Configuration saved for ${node.user}@${node.host} (${nodeId})`;
  },

  // Sync code up/down
  async sync({ nodeId, direction = 'up', files = [], cwd }) {
    const config = await resolveNode(nodeId);

    const projectName = getProjectName(cwd);
    const remoteBase = config.workDir.endsWith('/') ? config.workDir : config.workDir + '/';
    const remotePath = `${remoteBase}${projectName}/`;

    if (direction === 'up') {
      await execSsh(config, `mkdir -p ${remotePath}`);
      const excludes = "--exclude '.git' --exclude 'node_modules' --exclude '__pycache__' --exclude '*.pyc' --exclude '.DS_Store'";
      return await execRsync(config, `${cwd}/`, `${config.user}@${config.host}:${remotePath}`, excludes);
    } else {
      const filesToSync = files.length > 0 ? files.join(' ') : 'logs/ checkpoints/ results/';
      return await execRsync(config, `${config.user}@${config.host}:${remotePath}{${filesToSync}}`, `${cwd}/`);
    }
  },

  // Run a command on a node
  async run({ nodeId, command, cwd, skipSync = false }) {
    const config = await resolveNode(nodeId);

    if (cwd && !skipSync) {
      const projectName = getProjectName(cwd);
      const remoteBase = config.workDir.endsWith('/') ? config.workDir : config.workDir + '/';
      const remotePath = `${remoteBase}${projectName}/`;

      await this.sync({ nodeId: config.id, direction: 'up', cwd });
      return await execSsh(config, `cd ${remotePath} && ${command}`);
    } else {
      return await execSsh(config, command);
    }
  },

  // ─── Slurm-specific methods ───

  // Get partition info
  async sinfo({ nodeId }) {
    const config = await resolveNode(nodeId);
    if (config.type !== 'slurm') throw new Error('Node is not a Slurm cluster');
    const output = await execSsh(config, 'sinfo --format="%P %a %l %D %G" --noheader');
    // Parse into structured data
    const partitions = output.split('\n').filter(Boolean).map(line => {
      const parts = line.trim().split(/\s+/);
      const name = parts[0]?.replace('*', '') || '';
      const isDefault = parts[0]?.endsWith('*') || false;
      return {
        name,
        isDefault,
        available: parts[1] || '',
        timeLimit: parts[2] || '',
        nodes: parts[3] || '',
        gres: parts[4] || '',
      };
    });
    return partitions;
  },

  // Get job queue
  async squeue({ nodeId }) {
    const config = await resolveNode(nodeId);
    if (config.type !== 'slurm') throw new Error('Node is not a Slurm cluster');
    const output = await execSsh(config, `squeue -u ${config.user} --format="%i %j %P %T %M %l %D %R" --noheader`);
    if (!output.trim()) return [];
    const jobs = output.split('\n').filter(Boolean).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        jobId: parts[0] || '',
        name: parts[1] || '',
        partition: parts[2] || '',
        state: parts[3] || '',
        elapsed: parts[4] || '',
        timeLimit: parts[5] || '',
        nodes: parts[6] || '',
        reason: parts.slice(7).join(' ') || '',
      };
    });
    return jobs;
  },

  // Interactive GPU allocation (salloc + srun)
  async salloc({ nodeId, partition, time, gpus, account, command }) {
    const config = await resolveNode(nodeId);
    if (config.type !== 'slurm') throw new Error('Node is not a Slurm cluster');

    const defaults = config.slurm || {};
    const p = partition || defaults.defaultPartition;
    const t = time || defaults.defaultTime || '00:30:00';
    const g = gpus ?? defaults.defaultGpus ?? 1;
    const a = account || defaults.defaultAccount;

    let sallocCmd = 'salloc';
    if (p) sallocCmd += ` --partition=${p}`;
    sallocCmd += ` --time=${t}`;
    sallocCmd += ` --gres=gpu:${g}`;
    if (a) sallocCmd += ` -A ${a}`;

    if (command) {
      sallocCmd += ` srun ${command}`;
    }

    return await execSsh(config, sallocCmd);
  },

  // Submit batch job
  async sbatch({ nodeId, rawScript, script, partition, time, gpus, account, jobName }) {
    const config = await resolveNode(nodeId);
    if (config.type !== 'slurm') throw new Error('Node is not a Slurm cluster');

    let sbatchScript;

    if (rawScript) {
      // User provided the full script with #SBATCH directives — use as-is
      sbatchScript = rawScript;
    } else {
      // Auto-generate headers + append user script body
      const defaults = config.slurm || {};
      const p = partition || defaults.defaultPartition;
      const t = time || defaults.defaultTime || '02:00:00';
      const g = gpus ?? defaults.defaultGpus ?? 1;
      const a = account || defaults.defaultAccount;
      const name = jobName || 'vibelab-job';

      sbatchScript = '#!/bin/bash\n';
      sbatchScript += `#SBATCH --job-name=${name}\n`;
      if (p) sbatchScript += `#SBATCH --partition=${p}\n`;
      sbatchScript += `#SBATCH --time=${t}\n`;
      sbatchScript += `#SBATCH --gres=gpu:${g}\n`;
      if (a) sbatchScript += `#SBATCH -A ${a}\n`;
      sbatchScript += `#SBATCH --output=${name}-%j.out\n`;
      sbatchScript += `#SBATCH --error=${name}-%j.err\n`;
      sbatchScript += '\n';
      sbatchScript += script;
    }

    // Write script to remote via base64 to preserve newlines and special chars
    const workDir = config.workDir || '~';
    const scriptPath = `${workDir}/.vibelab-sbatch-${Date.now()}.sh`;
    const b64 = Buffer.from(sbatchScript).toString('base64');
    const remoteCmd = `echo '${b64}' | base64 -d > ${scriptPath} && chmod +x ${scriptPath} && sbatch ${scriptPath} && rm -f ${scriptPath}`;
    return await execSsh(config, remoteCmd);
  },

  // Cancel a job
  async scancel({ nodeId, jobId }) {
    const config = await resolveNode(nodeId);
    if (config.type !== 'slurm') throw new Error('Node is not a Slurm cluster');
    return await execSsh(config, `scancel ${jobId}`);
  },
};
