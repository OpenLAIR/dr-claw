import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.openclaw');
const CONFIG_FILE = path.join(CONFIG_DIR, 'community-tools.json');

async function loadToolsConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { tools: {} };
  }
}

async function saveToolsConfig(config) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export async function getInstalledTools() {
  const config = await loadToolsConfig();
  return config.tools || {};
}

export async function getInstalledTool(toolId) {
  const config = await loadToolsConfig();
  return (config.tools || {})[toolId] || null;
}

export async function setInstalledTool(toolId, data) {
  const config = await loadToolsConfig();
  if (!config.tools) config.tools = {};
  config.tools[toolId] = { ...data, updatedAt: new Date().toISOString() };
  await saveToolsConfig(config);
}

export async function removeInstalledTool(toolId) {
  const config = await loadToolsConfig();
  if (config.tools) {
    delete config.tools[toolId];
  }
  await saveToolsConfig(config);
}
