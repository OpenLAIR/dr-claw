import { contextBridge, ipcRenderer } from 'electron';

const ALLOWED_CHANNELS_INVOKE = new Set([
  'app:getInfo',
  'dialog:selectDirectory',
  'dialog:selectFile',
  'shell:showItemInFolder',
  'shell:openExternal',
  'shell:openPath',
  'system:getInfo',
  'system:checkDependencies',
  'window:minimize',
  'window:maximize',
  'window:close',
  'window:isMaximized',
  'updater:check',
  'updater:install',
  'notification:show',
  'clipboard:writeText',
  'clipboard:readText',
]);

const ALLOWED_CHANNELS_ON = new Set([
  'updater:available',
  'updater:not-available',
  'updater:downloaded',
  'updater:progress',
  'updater:error',
  'app:navigate',
  'server:status',
]);

function safeInvoke(channel, ...args) {
  if (!ALLOWED_CHANNELS_INVOKE.has(channel)) {
    return Promise.reject(new Error(`IPC channel "${channel}" is not allowed`));
  }
  return ipcRenderer.invoke(channel, ...args);
}

function safeOn(channel, callback) {
  if (!ALLOWED_CHANNELS_ON.has(channel)) {
    throw new Error(`IPC channel "${channel}" is not allowed`);
  }

  const wrappedCallback = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, wrappedCallback);

  return () => {
    ipcRenderer.removeListener(channel, wrappedCallback);
  };
}

contextBridge.exposeInMainWorld('electronAPI', {
  getAppInfo: () => safeInvoke('app:getInfo'),

  selectDirectory: (options) => safeInvoke('dialog:selectDirectory', options),
  selectFile: (options) => safeInvoke('dialog:selectFile', options),

  showItemInFolder: (fullPath) => safeInvoke('shell:showItemInFolder', fullPath),
  openExternal: (url) => safeInvoke('shell:openExternal', url),
  openPath: (fullPath) => safeInvoke('shell:openPath', fullPath),

  getSystemInfo: () => safeInvoke('system:getInfo'),
  checkDependencies: () => safeInvoke('system:checkDependencies'),

  minimize: () => safeInvoke('window:minimize'),
  maximize: () => safeInvoke('window:maximize'),
  close: () => safeInvoke('window:close'),
  isMaximized: () => safeInvoke('window:isMaximized'),

  checkForUpdates: () => safeInvoke('updater:check'),
  installUpdate: () => safeInvoke('updater:install'),

  showNotification: (title, body) => safeInvoke('notification:show', title, body),

  writeClipboard: (text) => safeInvoke('clipboard:writeText', text),
  readClipboard: () => safeInvoke('clipboard:readText'),

  on: safeOn,
});

contextBridge.exposeInMainWorld('isElectron', true);
contextBridge.exposeInMainWorld('electronPlatform', process.platform);

// Stamp data attributes onto <html> before React renders so CSS / first-paint
// logic can detect Electron + platform without any async round-trips.
document.documentElement.dataset.electron = 'true';
document.documentElement.dataset.platform = process.platform;
