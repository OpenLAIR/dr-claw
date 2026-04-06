import { useCallback, useEffect, useRef, useState } from 'react';

interface ElectronAPI {
  getAppInfo: () => Promise<AppInfo>;
  selectDirectory: (options?: DirectoryDialogOptions) => Promise<DialogResult>;
  selectFile: (options?: FileDialogOptions) => Promise<DialogResult>;
  showItemInFolder: (fullPath: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  openPath: (fullPath: string) => Promise<void>;
  getSystemInfo: () => Promise<SystemInfo>;
  checkDependencies: () => Promise<DependencyResult[]>;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  checkForUpdates: () => Promise<{ updateAvailable: boolean }>;
  installUpdate: () => Promise<void>;
  showNotification: (title: string, body: string) => Promise<boolean>;
  writeClipboard: (text: string) => Promise<void>;
  readClipboard: () => Promise<string>;
  on: (channel: string, callback: (...args: any[]) => void) => () => void;
}

interface AppInfo {
  version: string;
  name: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  userData: string;
  appRoot: string;
  logsPath: string;
}

interface SystemInfo {
  platform: string;
  arch: string;
  osVersion: string;
  hostname: string;
  homedir: string;
  totalMemory: number;
  freeMemory: number;
  cpus: number;
  nodeVersion: string;
  electronVersion: string;
}

export interface DependencyResult {
  name: string;
  available: boolean;
  version: string | null;
}

interface DirectoryDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
}

interface FileDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

interface DialogResult {
  canceled: boolean;
  filePaths: string[];
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    isElectron?: boolean;
    electronPlatform?: string;
  }
}

/** Synchronous — available on very first render. */
export const isElectron = typeof window !== 'undefined' && window.isElectron === true;

/** Synchronous platform string when running inside Electron (e.g. 'darwin', 'win32', 'linux'). */
export const electronPlatform: string | null =
  typeof window !== 'undefined' && window.isElectron ? (window.electronPlatform ?? null) : null;

/** true when running as Electron desktop on macOS — synchronous, safe for first paint. */
export const isMacElectron = isElectron && electronPlatform === 'darwin';

function getAPI(): ElectronAPI | null {
  if (isElectron && window.electronAPI) {
    return window.electronAPI;
  }
  return null;
}

/**
 * Hook providing access to desktop-native features when running inside Electron.
 * Falls back gracefully to web behavior when not in Electron.
 */
export function useDesktop() {
  const api = getAPI();

  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    if (api) {
      api.getAppInfo().then((info) => {
        if (mounted.current) {
          setAppInfo(info);
        }
      }).catch(() => { /* ignore */ });
    }

    return () => {
      mounted.current = false;
    };
  }, [api]);

  const selectDirectory = useCallback(async (options?: DirectoryDialogOptions): Promise<string | null> => {
    if (!api) {
      return null;
    }
    const result = await api.selectDirectory(options);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  }, [api]);

  const selectFile = useCallback(async (options?: FileDialogOptions): Promise<string | null> => {
    if (!api) {
      return null;
    }
    const result = await api.selectFile(options);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  }, [api]);

  const showItemInFolder = useCallback((fullPath: string) => {
    if (api) {
      api.showItemInFolder(fullPath);
    }
  }, [api]);

  const openExternal = useCallback((url: string) => {
    if (api) {
      api.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [api]);

  const openPath = useCallback((fullPath: string) => {
    api?.openPath(fullPath);
  }, [api]);

  const checkDependencies = useCallback(async (): Promise<DependencyResult[]> => {
    if (!api) {
      return [];
    }
    return api.checkDependencies();
  }, [api]);

  const showNotification = useCallback((title: string, body: string) => {
    if (api) {
      api.showNotification(title, body);
    } else if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  }, [api]);

  const writeClipboard = useCallback(async (text: string) => {
    if (api) {
      await api.writeClipboard(text);
    } else {
      await navigator.clipboard.writeText(text);
    }
  }, [api]);

  return {
    isDesktop: isElectron,
    appInfo,
    selectDirectory,
    selectFile,
    showItemInFolder,
    openExternal,
    openPath,
    checkDependencies,
    showNotification,
    writeClipboard,
    on: api?.on ?? null,
  };
}
