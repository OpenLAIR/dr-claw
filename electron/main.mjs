import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
} from 'electron';
import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const productName = 'Dr. Claw';
const appId = 'io.openlair.drclaw';
const isMac = process.platform === 'darwin';
const isDev = !app.isPackaged;

app.setName(productName);
if (process.platform === 'win32') {
  app.setAppUserModelId(appId);
}
app.setPath('userData', path.join(app.getPath('appData'), productName));

let mainWindow = null;
let serverProcess = null;
let serverOrigin = null;
let quitting = false;

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function getDesktopLogPath() {
  const baseDir = app.isReady()
    ? app.getPath('userData')
    : path.join(process.cwd(), '.electron-home', 'logs');

  return path.join(baseDir, 'desktop.log');
}

function logDesktop(message, details = null) {
  const line = `[${new Date().toISOString()}] ${message}${details ? ` ${typeof details === 'string' ? details : JSON.stringify(details)}` : ''}`;
  console.log(line);

  try {
    fs.mkdirSync(path.dirname(getDesktopLogPath()), { recursive: true });
    fs.appendFileSync(getDesktopLogPath(), `${line}\n`, 'utf8');
  } catch {
    // Ignore log write failures.
  }
}

process.on('uncaughtException', (error) => {
  logDesktop('uncaughtException', error instanceof Error ? {
    message: error.message,
    stack: error.stack,
  } : String(error));
});

process.on('unhandledRejection', (reason) => {
  logDesktop('unhandledRejection', reason instanceof Error ? {
    message: reason.message,
    stack: reason.stack,
  } : String(reason));
});

// ---------------------------------------------------------------------------
// Window state persistence
// ---------------------------------------------------------------------------

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf8');
    const state = JSON.parse(raw);
    if (typeof state.width === 'number' && typeof state.height === 'number') {
      return state;
    }
  } catch {
    // First launch or corrupt file — use defaults.
  }
  return null;
}

function saveWindowState(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  const bounds = window.getBounds();
  const state = {
    ...bounds,
    isMaximized: window.isMaximized(),
  };

  try {
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state), 'utf8');
  } catch {
    // Non-critical — ignore.
  }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function resolveAppRoot() {
  if (!app.isPackaged) return process.cwd();
  return path.join(process.resourcesPath, 'app');
}

function resolveNodeBinary() {
  if (!app.isPackaged && process.env.npm_node_execpath && fs.existsSync(process.env.npm_node_execpath)) {
    return process.env.npm_node_execpath;
  }

  if (process.env.NODE_BINARY && fs.existsSync(process.env.NODE_BINARY)) {
    return process.env.NODE_BINARY;
  }

  return process.execPath;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(open);
    };

    const socket = net.createConnection({ host, port });
    socket.setTimeout(5000);

    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function findAvailablePort(startPort, host) {
  for (let offset = 0; offset < 20; offset += 1) {
    const candidate = startPort + offset;
    const inUse = await isPortOpen(host, candidate);
    if (!inUse) {
      return candidate;
    }
  }

  throw new Error(`No free port available near ${startPort}`);
}

async function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        logDesktop('Server health check passed', { url });
        return;
      }
      lastError = new Error(`Unexpected health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await wait(500);
  }

  throw new Error(`Timed out waiting for local server at ${url}${lastError ? `: ${lastError.message}` : ''}`);
}

// ---------------------------------------------------------------------------
// Database and workspace paths (with legacy migration)
// ---------------------------------------------------------------------------

function resolveSharedDatabasePath() {
  const homeDir = app.getPath('home');
  const legacyDir = path.join(homeDir, '.vibelab');
  const legacyDbPath = path.join(legacyDir, 'auth.db');
  const legacySidecars = [`${legacyDbPath}-shm`, `${legacyDbPath}-wal`];

  const currentDir = path.join(homeDir, '.dr-claw');
  const currentDbPath = path.join(currentDir, 'auth.db');
  const currentSidecars = [`${currentDbPath}-shm`, `${currentDbPath}-wal`];

  if (fs.existsSync(currentDbPath)) {
    return currentDbPath;
  }

  if (!fs.existsSync(legacyDbPath)) {
    return currentDbPath;
  }

  try {
    fs.mkdirSync(currentDir, { recursive: true });
    fs.copyFileSync(legacyDbPath, currentDbPath);

    legacySidecars.forEach((legacySidecar, index) => {
      if (fs.existsSync(legacySidecar) && !fs.existsSync(currentSidecars[index])) {
        fs.copyFileSync(legacySidecar, currentSidecars[index]);
      }
    });

    return currentDbPath;
  } catch (error) {
    logDesktop('Failed to migrate legacy auth DB, using legacy path', error instanceof Error ? { message: error.message } : String(error));
    return legacyDbPath;
  }
}

function resolveSharedWorkspacesRoot() {
  const homeDir = app.getPath('home');
  const currentRoot = path.join(homeDir, 'dr-claw');
  const legacyRoot = path.join(homeDir, 'vibelab');

  if (fs.existsSync(currentRoot)) {
    return currentRoot;
  }

  if (fs.existsSync(legacyRoot)) {
    return legacyRoot;
  }

  return currentRoot;
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

function buildServerEnv(appRoot) {
  const userDataDir = app.getPath('userData');
  const runtimeDir = path.join(userDataDir, 'runtime');
  const databasePath = resolveSharedDatabasePath();
  const workspacesRoot = resolveSharedWorkspacesRoot();

  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.mkdirSync(workspacesRoot, { recursive: true });

  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DR_CLAW_DESKTOP: '1',
    DATABASE_PATH: process.env.DATABASE_PATH || databasePath,
    DR_CLAW_RUNTIME_DIR: process.env.DR_CLAW_RUNTIME_DIR || runtimeDir,
    WORKSPACES_ROOT: process.env.WORKSPACES_ROOT || workspacesRoot,
    NODE_ENV: process.env.NODE_ENV || (isDev ? 'development' : 'production'),
    PORT: process.env.PORT || '3001',
    HOST: '127.0.0.1',
    VITE_PORT: process.env.VITE_PORT || '5173',
    APP_ROOT: appRoot,
  };
}

async function startServer() {
  const appRoot = resolveAppRoot();
  const env = buildServerEnv(appRoot);
  const requestedPort = Number.parseInt(env.PORT, 10) || 3001;
  const selectedPort = await findAvailablePort(requestedPort, env.HOST);
  env.PORT = String(selectedPort);
  const entrypoint = path.join(appRoot, 'server', 'index.js');
  const nodeBinary = resolveNodeBinary();

  if (!fs.existsSync(entrypoint)) {
    const message = `Server entrypoint not found: ${entrypoint}. If you are developing, run from the repo root. If packaged, reinstall the app.`;
    logDesktop('Desktop server entrypoint missing', { entrypoint, appRoot });
    throw new Error(message);
  }

  logDesktop('Starting desktop server', {
    nodeBinary,
    entrypoint,
    port: env.PORT,
    host: env.HOST,
    appRoot,
    userData: app.getPath('userData'),
  });

  serverProcess = spawn(nodeBinary, [entrypoint], {
    cwd: appRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout?.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    const trimmed = text.trim();
    if (trimmed) {
      logDesktop('server:stdout', trimmed);
    }
  });

  serverProcess.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    process.stderr.write(text);
    const trimmed = text.trim();
    if (trimmed) {
      logDesktop('server:stderr', trimmed);
    }
  });

  serverProcess.once('exit', (code, signal) => {
    serverProcess = null;
    logDesktop('Desktop server exited', { code, signal });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server:status', { running: false, code, signal });
    }

    if (!quitting) {
      dialog.showErrorBox(
        'Dr. Claw server exited',
        `The local server stopped unexpectedly${signal ? ` (${signal})` : ''}${typeof code === 'number' ? ` (exit code ${code})` : ''}.\n\nSee desktop.log in the app data directory for details.`,
      );
      app.quit();
    }
  });

  await waitForServer(`http://${env.HOST}:${env.PORT}/health`);

  return `http://${env.HOST}:${env.PORT}`;
}

// ---------------------------------------------------------------------------
// Window helpers
// ---------------------------------------------------------------------------

function isWindowVisibleOnSomeDisplay(bounds) {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapWidth = Math.max(
      0,
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x),
    );
    const overlapHeight = Math.max(
      0,
      Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y),
    );

    return overlapWidth >= 240 && overlapHeight >= 180;
  });
}

function ensureWindowVisible(window) {
  if (window.isDestroyed()) {
    return;
  }

  const bounds = window.getBounds();
  if (isWindowVisibleOnSomeDisplay(bounds)) {
    return;
  }

  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(Math.max(bounds.width || 1440, 1100), Math.max(workArea.width - 48, 1100));
  const height = Math.min(Math.max(bounds.height || 960, 760), Math.max(workArea.height - 64, 760));

  window.setBounds({
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
  });
}

// ---------------------------------------------------------------------------
// Native application menu
// ---------------------------------------------------------------------------

function buildAppMenu() {
  const template = [];

  if (isMac) {
    template.push({
      label: productName,
      submenu: [
        { role: 'about', label: `About ${productName}` },
        { type: 'separator' },
        {
          label: 'Settings...',
          accelerator: 'Cmd+,',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('app:navigate', { action: 'openSettings' });
            }
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push({
    label: 'File',
    submenu: [
      {
        label: 'New Chat',
        accelerator: isMac ? 'Cmd+N' : 'Ctrl+N',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('app:navigate', { action: 'newChat' });
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Open Workspace...',
        accelerator: isMac ? 'Cmd+O' : 'Ctrl+O',
        click: async () => {
          if (!mainWindow || mainWindow.isDestroyed()) {
            return;
          }
          const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
            title: 'Open Workspace',
          });
          if (!result.canceled && result.filePaths.length > 0) {
            mainWindow.webContents.send('app:navigate', {
              action: 'openWorkspace',
              path: result.filePaths[0],
            });
          }
        },
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  });

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  });

  template.push({
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  });

  template.push({
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac ? [
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' },
      ] : [
        { role: 'close' },
      ]),
    ],
  });

  template.push({
    label: 'Help',
    submenu: [
      {
        label: 'Dr. Claw Documentation',
        click: () => {
          shell.openExternal('https://github.com/OpenLAIR/dr-claw');
        },
      },
      {
        label: 'Report an Issue',
        click: () => {
          shell.openExternal('https://github.com/OpenLAIR/dr-claw/issues');
        },
      },
      { type: 'separator' },
      {
        label: 'View Logs',
        click: () => {
          shell.showItemInFolder(getDesktopLogPath());
        },
      },
      {
        label: 'Open Data Directory',
        click: () => {
          shell.openPath(app.getPath('userData'));
        },
      },
    ],
  });

  return Menu.buildFromTemplate(template);
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

function registerIpcHandlers() {
  ipcMain.handle('app:getInfo', () => {
    let pkg = {};
    try {
      const pkgPath = path.join(resolveAppRoot(), 'package.json');
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {
      // Ignore — version info not available.
    }

    return {
      version: pkg.version || app.getVersion(),
      name: productName,
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome,
      userData: app.getPath('userData'),
      appRoot: resolveAppRoot(),
      logsPath: getDesktopLogPath(),
    };
  });

  ipcMain.handle('dialog:selectDirectory', async (_event, options = {}) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { canceled: true, filePaths: [] };
    }

    return dialog.showOpenDialog(mainWindow, {
      title: options.title || 'Select Folder',
      defaultPath: options.defaultPath || app.getPath('home'),
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: options.buttonLabel || 'Select',
    });
  });

  ipcMain.handle('dialog:selectFile', async (_event, options = {}) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { canceled: true, filePaths: [] };
    }

    return dialog.showOpenDialog(mainWindow, {
      title: options.title || 'Select File',
      defaultPath: options.defaultPath || app.getPath('home'),
      properties: ['openFile'],
      filters: options.filters || [],
      buttonLabel: options.buttonLabel || 'Select',
    });
  });

  ipcMain.handle('shell:showItemInFolder', (_event, fullPath) => {
    if (typeof fullPath === 'string' && fullPath.length > 0) {
      shell.showItemInFolder(fullPath);
    }
  });

  ipcMain.handle('shell:openExternal', (_event, url) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      return shell.openExternal(url);
    }
  });

  ipcMain.handle('shell:openPath', (_event, fullPath) => {
    if (typeof fullPath === 'string' && fullPath.length > 0) {
      return shell.openPath(fullPath);
    }
  });

  ipcMain.handle('system:getInfo', () => ({
    platform: process.platform,
    arch: process.arch,
    osVersion: os.release(),
    hostname: os.hostname(),
    homedir: os.homedir(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    cpus: os.cpus().length,
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron,
  }));

  ipcMain.handle('system:checkDependencies', async () => {
    const deps = [
      { name: 'node', command: 'node', args: ['--version'] },
      { name: 'npm', command: 'npm', args: ['--version'] },
      { name: 'git', command: 'git', args: ['--version'] },
      { name: 'claude', command: 'claude', args: ['--version'] },
      { name: 'codex', command: 'codex', args: ['--version'] },
      { name: 'gemini', command: 'gemini', args: ['--version'] },
    ];

    const results = await Promise.all(
      deps.map((dep) => new Promise((resolve) => {
        const bin = process.platform === 'win32' && !dep.command.includes(path.sep)
          ? `${dep.command}.cmd`
          : dep.command;

        execFile(bin, dep.args, { timeout: 10000, env: process.env }, (error, stdout) => {
          resolve({
            name: dep.name,
            available: !error,
            version: error ? null : (stdout || '').trim().split('\n')[0],
          });
        });
      })),
    );

    return results;
  });

  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle('window:close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });

  ipcMain.handle('updater:check', () => {
    // Placeholder — will be wired when electron-updater is added.
    return { updateAvailable: false };
  });

  ipcMain.handle('updater:install', () => {
    // Placeholder — will be wired when electron-updater is added.
  });

  ipcMain.handle('notification:show', (_event, title, body) => {
    if (Notification.isSupported()) {
      const notification = new Notification({ title, body });
      notification.show();
      return true;
    }
    return false;
  });

  ipcMain.handle('clipboard:writeText', (_event, text) => {
    clipboard.writeText(text);
  });

  ipcMain.handle('clipboard:readText', () => {
    return clipboard.readText();
  });
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function createWindow(baseUrl) {
  logDesktop('Creating BrowserWindow', { baseUrl });

  const iconPath = path.join(resolveAppRoot(), 'build', 'icon.png');
  const preloadPath = path.join(__dirname, 'preload.mjs');

  const savedState = loadWindowState();
  const defaultWidth = 1440;
  const defaultHeight = 960;

  const windowOptions = {
    width: savedState?.width || defaultWidth,
    height: savedState?.height || defaultHeight,
    minWidth: 1100,
    minHeight: 760,
    title: productName,
    show: false,
    center: !savedState,
    backgroundColor: '#0b1220',
    autoHideMenuBar: !isMac,
    icon: iconPath,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
    },
  };

  if (savedState?.x != null && savedState?.y != null) {
    windowOptions.x = savedState.x;
    windowOptions.y = savedState.y;
  }

  mainWindow = new BrowserWindow(windowOptions);

  if (savedState?.isMaximized) {
    mainWindow.maximize();
  }

  Menu.setApplicationMenu(buildAppMenu());

  let revealed = false;
  const revealWindow = (reason) => {
    if (!mainWindow || mainWindow.isDestroyed() || revealed) {
      return;
    }

    revealed = true;
    ensureWindowVisible(mainWindow);
    mainWindow.show();
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.moveTop();
    mainWindow.focus();
    logDesktop('BrowserWindow revealed', { reason, bounds: mainWindow.getBounds() });
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(baseUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Persist window state on move/resize.
  let saveTimeout = null;
  const debouncedSave = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
      saveWindowState(mainWindow);
    }, 500);
  };

  mainWindow.on('resize', debouncedSave);
  mainWindow.on('move', debouncedSave);

  mainWindow.on('closed', () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    logDesktop('BrowserWindow closed');
    mainWindow = null;
  });

  mainWindow.on('unresponsive', () => {
    logDesktop('BrowserWindow became unresponsive');
  });

  mainWindow.once('ready-to-show', () => {
    logDesktop('BrowserWindow ready-to-show');
    revealWindow('ready-to-show');
  });

  mainWindow.webContents.once('did-finish-load', () => {
    logDesktop('BrowserWindow did-finish-load');
    revealWindow('did-finish-load');
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logDesktop('did-fail-load', { errorCode, errorDescription, validatedURL });
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logDesktop('render-process-gone', details);
  });

  mainWindow.loadURL(baseUrl);
  setTimeout(() => revealWindow('timeout'), 4000);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  try {
    const iconPath = path.join(resolveAppRoot(), 'build', 'icon.png');
    if (isMac && fs.existsSync(iconPath)) {
      const dockIcon = nativeImage.createFromPath(iconPath);
      if (!dockIcon.isEmpty()) {
        app.dock.setIcon(dockIcon);
      }
    }

    registerIpcHandlers();

    const baseUrl = await startServer();
    serverOrigin = baseUrl;
    createWindow(baseUrl);
  } catch (error) {
    logDesktop('boot failed', error instanceof Error ? { message: error.message, stack: error.stack } : String(error));
    dialog.showErrorBox('Failed to start Dr. Claw', error instanceof Error ? error.message : String(error));
    app.quit();
  }
}

async function stopServer() {
  if (!serverProcess) {
    return;
  }

  const child = serverProcess;
  serverProcess = null;

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5000);

    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    child.kill('SIGTERM');
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.on('second-instance', () => {
  if (!mainWindow) {
    return;
  }

  ensureWindowVisible(mainWindow);
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit();
  }
});

app.on('before-quit', () => {
  quitting = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    saveWindowState(mainWindow);
  }
});

app.on('will-quit', (event) => {
  if (!serverProcess) {
    return;
  }

  event.preventDefault();
  void stopServer().finally(() => {
    app.exit(0);
  });
});

app.on('activate', () => {
  if (!mainWindow) {
    void boot();
    return;
  }

  ensureWindowVisible(mainWindow);
  mainWindow.show();
  mainWindow.focus();
});

logDesktop('Electron main process starting', {
  pid: process.pid,
  isDev,
  platform: process.platform,
  cwd: process.cwd(),
  userData: app.getPath('userData'),
});

app.whenReady()
  .then(() => {
    void boot();
  })
  .catch((error) => {
    logDesktop('app.whenReady failed', error instanceof Error ? {
      message: error.message,
      stack: error.stack,
    } : String(error));
    dialog.showErrorBox('Failed to start Dr. Claw', error instanceof Error ? error.message : String(error));
    app.quit();
  });
