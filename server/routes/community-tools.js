import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getInstalledTools, getInstalledTool, setInstalledTool, removeInstalledTool } from '../community-tools-store.js';
import { getAdapter } from '../community-tools-adapters.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_PATH = path.join(__dirname, '..', 'data', 'community-tools-registry.json');

const router = express.Router();

// In-flight operations: Map<toolId, { type, logs[], process?, aborted? }>
const activeOps = new Map();

async function loadRegistry() {
  const data = await fs.readFile(REGISTRY_PATH, 'utf8');
  return JSON.parse(data);
}

function getToolFromRegistry(registry, toolId) {
  return registry.find((t) => t.id === toolId) || null;
}

// ─── GET /registry ───
router.get('/registry', async (_req, res) => {
  try {
    const registry = await loadRegistry();
    res.json({ tools: registry });
  } catch (error) {
    console.error('Error loading community tools registry:', error);
    res.status(500).json({ error: 'Failed to load registry' });
  }
});

// ─── GET /installed ───
router.get('/installed', async (_req, res) => {
  try {
    const installed = await getInstalledTools();
    res.json({ tools: installed });
  } catch (error) {
    console.error('Error loading installed community tools:', error);
    res.status(500).json({ error: 'Failed to load installed tools' });
  }
});

// ─── GET /:toolId/status ───
router.get('/:toolId/status', async (req, res) => {
  try {
    const { toolId } = req.params;
    const installed = await getInstalledTool(toolId);
    const op = activeOps.get(toolId);
    res.json({
      installed: !!installed,
      info: installed,
      activeOperation: op ? { type: op.type, logs: op.logs, running: op.process !== null } : null,
    });
  } catch (error) {
    console.error('Error getting tool status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// ─── POST /:toolId/install ───
router.post('/:toolId/install', async (req, res) => {
  try {
    const { toolId } = req.params;
    const existingOp = activeOps.get(toolId);
    if (existingOp?.type === 'install') {
      return res.status(409).json({ error: 'An operation is already in progress for this tool' });
    }

    const registry = await loadRegistry();
    const tool = getToolFromRegistry(registry, toolId);
    if (!tool) return res.status(404).json({ error: 'Tool not found in registry' });

    const existing = await getInstalledTool(toolId);
    if (existing) return res.status(409).json({ error: 'Tool is already installed' });

    const adapter = getAdapter(tool.type);

    // Claude-skill installs are fast (file copy only) — run synchronously
    if (tool.type === 'claude-skill') {
      try {
        const logs = [];
        const result = await adapter.install(tool, (msg) => { logs.push(msg); });
        await setInstalledTool(toolId, {
          installDir: result.installDir,
          installedAt: result.installedAt,
          type: tool.type,
          repoUrl: tool.repoUrl,
          localPath: tool.localPath,
        });
        logs.push('✓ Done');
        return res.json({ success: true, synchronous: true, message: 'Installation complete', logs });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // Python-app and others: async with polling
    const op = { type: 'install', logs: [] };
    activeOps.set(toolId, op);

    res.json({ success: true, message: 'Installation started' });

    try {
      const result = await adapter.install(tool, (msg) => { op.logs.push(msg); });
      await setInstalledTool(toolId, {
        installDir: result.installDir,
        setupDir: result.setupDir,
        installedAt: result.installedAt,
        type: tool.type,
        repoUrl: tool.repoUrl,
        localPath: tool.localPath,
      });
      op.logs.push('✓ Done');
    } catch (err) {
      op.logs.push(`✗ Error: ${err.message}`);
    } finally {
      const currentOp = op;
      setTimeout(() => {
        if (activeOps.get(toolId) === currentOp) activeOps.delete(toolId);
      }, 60_000);
    }
  } catch (error) {
    console.error('Error installing community tool:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /:toolId/uninstall ───
router.post('/:toolId/uninstall', async (req, res) => {
  try {
    const { toolId } = req.params;
    const registry = await loadRegistry();
    const tool = getToolFromRegistry(registry, toolId);
    if (!tool) return res.status(404).json({ error: 'Tool not found in registry' });

    const installed = await getInstalledTool(toolId);
    if (!installed) return res.status(400).json({ error: 'Tool is not installed' });

    const adapter = getAdapter(tool.type);
    await adapter.uninstall(tool, installed.installDir, (msg) => console.log(`[community-tools] ${msg}`));
    await removeInstalledTool(toolId);

    res.json({ success: true, message: 'Tool uninstalled' });
  } catch (error) {
    console.error('Error uninstalling community tool:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── PUT /:toolId/config ───
router.put('/:toolId/config', async (req, res) => {
  try {
    const { toolId } = req.params;
    const registry = await loadRegistry();
    const tool = getToolFromRegistry(registry, toolId);
    if (!tool) return res.status(404).json({ error: 'Tool not found in registry' });

    const installed = await getInstalledTool(toolId);
    if (!installed) return res.status(400).json({ error: 'Tool is not installed' });

    const adapter = getAdapter(tool.type);
    if (!adapter.configure) return res.status(400).json({ error: 'This tool does not support configuration' });

    await adapter.configure(tool, installed.installDir, req.body, (msg) => console.log(`[community-tools] ${msg}`));
    await setInstalledTool(toolId, { ...installed, config: req.body });
    res.json({ success: true, message: 'Configuration saved' });
  } catch (error) {
    console.error('Error configuring community tool:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /:toolId/run ───
router.post('/:toolId/run', async (req, res) => {
  try {
    const { toolId } = req.params;
    const { command, args = [] } = req.body;
    if (!command) return res.status(400).json({ error: 'Command is required' });

    const registry = await loadRegistry();
    const tool = getToolFromRegistry(registry, toolId);
    if (!tool) return res.status(404).json({ error: 'Tool not found in registry' });

    const installed = await getInstalledTool(toolId);
    if (!installed) return res.status(400).json({ error: 'Tool is not installed' });

    const adapter = getAdapter(tool.type);
    if (!adapter.run) return res.status(400).json({ error: 'This tool does not support run' });

    const existingRunOp = activeOps.get(toolId);
    if (existingRunOp?.type === 'run' && existingRunOp.process !== null) {
      return res.status(409).json({ error: 'Tool is already running' });
    }

    const op = { type: 'run', logs: [], process: null, aborted: false, cleanupScheduled: false };
    activeOps.set(toolId, op);

    const proc = adapter.run(tool, installed.installDir, command, args, (data) => {
      op.logs.push(data);
    });
    op.process = proc;

    proc.on('close', (code) => {
      op.logs.push(code === 0 ? '\n✓ Process exited successfully' : `\n✗ Process exited with code ${code}`);
      op.process = null;
      if (!op.cleanupScheduled) {
        op.cleanupScheduled = true;
        const currentOp = op;
        setTimeout(() => {
          if (activeOps.get(toolId) === currentOp) activeOps.delete(toolId);
        }, 60_000);
      }
    });

    proc.on('error', (err) => {
      op.logs.push(`\n✗ Error: ${err.message}`);
      op.process = null;
      if (!op.cleanupScheduled) {
        op.cleanupScheduled = true;
        const currentOp = op;
        setTimeout(() => {
          if (activeOps.get(toolId) === currentOp) activeOps.delete(toolId);
        }, 60_000);
      }
    });

    res.json({ success: true, message: 'Command started' });
  } catch (error) {
    console.error('Error running community tool:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /:toolId/stop ───
router.post('/:toolId/stop', async (req, res) => {
  try {
    const { toolId } = req.params;
    const op = activeOps.get(toolId);
    if (!op || !op.process) {
      return res.status(400).json({ error: 'No running process for this tool' });
    }
    op.aborted = true;
    op.process.kill('SIGTERM');
    res.json({ success: true, message: 'Stop signal sent' });
  } catch (error) {
    console.error('Error stopping community tool:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /:toolId/doctor ───
router.post('/:toolId/doctor', async (req, res) => {
  try {
    const { toolId } = req.params;
    const registry = await loadRegistry();
    const tool = getToolFromRegistry(registry, toolId);
    if (!tool) return res.status(404).json({ error: 'Tool not found in registry' });

    const installed = await getInstalledTool(toolId);
    const adapter = getAdapter(tool.type);
    const results = await adapter.doctor(tool, installed?.installDir, (msg) => console.log(`[community-tools] ${msg}`));

    res.json({ success: true, results });
  } catch (error) {
    console.error('Error running doctor for community tool:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /:toolId/outputs ───
// List output files (runs/stages) for the tool.
// Lists setupDir directly — researchclaw writes artifacts/ there by default.
router.get('/:toolId/outputs', async (req, res) => {
  try {
    const { toolId } = req.params;
    const installed = await getInstalledTool(toolId);
    if (!installed) return res.status(400).json({ error: 'Tool is not installed' });

    const setupDir = installed.setupDir || installed.installDir;
    const outputBase = path.resolve(setupDir);

    async function listDir(dir, depth = 0) {
      if (depth > 4) return [];
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
      const items = [];
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const rel = path.relative(outputBase, path.join(dir, e.name));
        if (e.isDirectory()) {
          items.push({ name: e.name, path: rel, type: 'dir', children: await listDir(path.join(dir, e.name), depth + 1) });
        } else {
          const stat = await fs.stat(path.join(dir, e.name)).catch(() => null);
          items.push({ name: e.name, path: rel, type: 'file', size: stat?.size || 0 });
        }
      }
      return items;
    }

    const tree = await listDir(outputBase);
    res.json({ outputDir: outputBase, tree });
  } catch (error) {
    console.error('Error listing outputs:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /:toolId/outputs/file ───
// Read a single output file
router.get('/:toolId/outputs/file', async (req, res) => {
  try {
    const { toolId } = req.params;
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path query parameter is required' });

    const installed = await getInstalledTool(toolId);
    if (!installed) return res.status(400).json({ error: 'Tool is not installed' });

    const setupDir = installed.setupDir || installed.installDir;
    const outputBase = path.resolve(setupDir);
    const resolved = path.resolve(outputBase, filePath);

    // Prevent path traversal
    if (!resolved.startsWith(outputBase + path.sep) && resolved !== outputBase) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const content = await fs.readFile(resolved, 'utf8');
    res.json({ content, path: filePath });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    console.error('Error reading output file:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── DELETE /:toolId/outputs/run ───
// Move a run directory to .trash (soft delete)
router.delete('/:toolId/outputs/run', async (req, res) => {
  try {
    const { toolId } = req.params;
    const { runPath } = req.body;
    if (!runPath) return res.status(400).json({ error: 'runPath is required' });

    const installed = await getInstalledTool(toolId);
    if (!installed) return res.status(400).json({ error: 'Tool is not installed' });

    const setupDir = installed.setupDir || installed.installDir;
    const outputBase = path.resolve(setupDir);
    const resolved = path.resolve(outputBase, runPath);

    // Prevent path traversal
    if (!resolved.startsWith(outputBase + path.sep) && resolved !== outputBase) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Don't allow trashing the output base itself
    if (resolved === outputBase) {
      return res.status(403).json({ error: 'Cannot trash output root' });
    }

    // Move to .trash/ under outputBase, preserving the run directory name
    const runDirName = path.basename(resolved);
    const trashBase = path.join(outputBase, '.trash');
    await fs.mkdir(trashBase, { recursive: true });

    // Append timestamp to avoid collisions if the same name is trashed twice
    const trashDest = path.join(trashBase, `${runDirName}__${Date.now()}`);
    await fs.rename(resolved, trashDest);

    res.json({ success: true, message: 'Run moved to trash', trashPath: path.relative(outputBase, trashDest) });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Run not found' });
    console.error('Error trashing run:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
