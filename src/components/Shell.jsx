import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { IS_PLATFORM } from '../constants/config';
import { stripInternalContextPrefix } from '../utils/sessionFormatting';

const xtermStyles = `
  .xterm .xterm-screen {
    outline: none !important;
  }
  .xterm:focus .xterm-screen {
    outline: none !important;
  }
  .xterm-screen:focus {
    outline: none !important;
  }
`;

if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.type = 'text/css';
  styleSheet.innerText = xtermStyles;
  document.head.appendChild(styleSheet);
}

function fallbackCopyToClipboard(text) {
  if (!text || typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textarea);
  }

  return copied;
}

const CODEX_DEVICE_AUTH_URL = 'https://auth.openai.com/codex/device';

function isCodexLoginCommand(command) {
  return typeof command === 'string' && /\bcodex\s+login\b/i.test(command);
}

function getPreferredProvider(selectedSession) {
  if (selectedSession?.__provider) {
    return selectedSession.__provider;
  }

  const storedProvider = localStorage.getItem('selected-provider');
  if (storedProvider === 'cursor' || storedProvider === 'codex' || storedProvider === 'claude' || storedProvider === 'gemini' || storedProvider === 'openrouter' || storedProvider === 'local' || storedProvider === 'nano') {
    return storedProvider;
  }

  return 'claude';
}

function buildShellWebSocketUrl(wsPath) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const baseUrl = `${protocol}//${window.location.host}${wsPath}`;

  if (IS_PLATFORM) {
    return baseUrl;
  }

  const token = localStorage.getItem('auth-token');
  if (!token) {
    return baseUrl;
  }

  return `${baseUrl}${wsPath.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

function Shell({ selectedProject, selectedSession, initialCommand, isPlainShell = false, onProcessComplete, minimal = false, autoConnect = false, wsPath = '/shell', shellInstanceId = null }) {
  const { t } = useTranslation('chat');
  const terminalRef = useRef(null);
  const terminal = useRef(null);
  const fitAddon = useRef(null);
  const ws = useRef(null);
  const reconnectTimer = useRef(null);
  const unmountedRef = useRef(false);
  const manuallyDisconnected = useRef(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [lastSessionId, setLastSessionId] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [authUrl, setAuthUrl] = useState('');
  const [authUrlCopyStatus, setAuthUrlCopyStatus] = useState('idle');
  const [isAuthPanelHidden, setIsAuthPanelHidden] = useState(false);

  const selectedProjectRef = useRef(selectedProject);
  const selectedSessionRef = useRef(selectedSession);
  const initialCommandRef = useRef(initialCommand);
  const isPlainShellRef = useRef(isPlainShell);
  const shellInstanceIdRef = useRef(shellInstanceId);
  const onProcessCompleteRef = useRef(onProcessComplete);
  const authUrlRef = useRef('');

  useEffect(() => {
    selectedProjectRef.current = selectedProject;
    selectedSessionRef.current = selectedSession;
    initialCommandRef.current = initialCommand;
    isPlainShellRef.current = isPlainShell;
    shellInstanceIdRef.current = shellInstanceId;
    onProcessCompleteRef.current = onProcessComplete;
  });

  const openAuthUrlInBrowser = useCallback((url = authUrlRef.current) => {
    if (!url) return false;

    const popup = window.open(url, '_blank', 'noopener,noreferrer');
    if (popup) {
      try {
        popup.opener = null;
      } catch {
        // Ignore cross-origin restrictions when trying to null opener
      }
      return true;
    }

    return false;
  }, []);

  const copyAuthUrlToClipboard = useCallback(async (url = authUrlRef.current) => {
    if (!url) return false;

    let copied = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      copied = fallbackCopyToClipboard(url);
    }

    return copied;
  }, []);

  const connectingLock = useRef(false);

  const connectWebSocket = useCallback(async () => {
    if (unmountedRef.current || manuallyDisconnected.current || connectingLock.current) return;
    if (ws.current && (ws.current.readyState === WebSocket.CONNECTING || ws.current.readyState === WebSocket.OPEN)) return;

    // Close any lingering socket in CLOSING state before opening a new one
    if (ws.current && ws.current.readyState === WebSocket.CLOSING) {
      ws.current.onopen = null;
      ws.current.onclose = null;
      ws.current.onerror = null;
      ws.current.onmessage = null;
      ws.current = null;
    }

    try {
      connectingLock.current = true;
      setIsConnecting(true);
      const wsUrl = buildShellWebSocketUrl(wsPath);

      ws.current = new WebSocket(wsUrl);
      const socket = ws.current;

      ws.current.onopen = () => {
        connectingLock.current = false;
        setIsConnected(true);
        setIsConnecting(false);
        authUrlRef.current = '';
        setAuthUrl('');
        setAuthUrlCopyStatus('idle');
        setIsAuthPanelHidden(false);

        setTimeout(() => {
          if (ws.current === socket && fitAddon.current && terminal.current && socket.readyState === WebSocket.OPEN) {
            fitAddon.current.fit();

            ws.current.send(JSON.stringify({
              type: 'init',
              projectPath: selectedProjectRef.current.fullPath || selectedProjectRef.current.path,
              sessionId: isPlainShellRef.current
                ? shellInstanceIdRef.current
                : selectedSessionRef.current?.id,
              hasSession: isPlainShellRef.current ? false : !!selectedSessionRef.current,
              provider: isPlainShellRef.current ? 'plain-shell' : getPreferredProvider(selectedSessionRef.current),
              cols: terminal.current.cols,
              rows: terminal.current.rows,
              initialCommand: initialCommandRef.current,
              isPlainShell: isPlainShellRef.current
            }));
          }
        }, 100);
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'output') {
            let output = data.data;

            if (isPlainShellRef.current && onProcessCompleteRef.current) {
              const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
              if (cleanOutput.includes('Process exited with code 0')) {
                onProcessCompleteRef.current(0);
              } else if (cleanOutput.match(/Process exited with code (\d+)/)) {
                const exitCode = parseInt(cleanOutput.match(/Process exited with code (\d+)/)[1]);
                if (exitCode !== 0) {
                  onProcessCompleteRef.current(exitCode);
                }
              }
            }

            if (terminal.current) {
              terminal.current.write(output);
            }
          } else if (data.type === 'auth_url' && data.url) {
            authUrlRef.current = data.url;
            setAuthUrl(data.url);
            setAuthUrlCopyStatus('idle');
            setIsAuthPanelHidden(false);
            if (data.autoOpen) {
              openAuthUrlInBrowser(data.url);
            }
          } else if (data.type === 'url_open') {
            if (data.url) {
              authUrlRef.current = data.url;
              setAuthUrl(data.url);
              setAuthUrlCopyStatus('idle');
              setIsAuthPanelHidden(false);
            }
          }
        } catch (error) {
          console.error('[Shell] Error handling WebSocket message:', error, event.data);
        }
      };

      ws.current.onclose = (event) => {
        connectingLock.current = false;
        setIsConnected(false);
        setIsConnecting(false);
        setAuthUrlCopyStatus('idle');
        setIsAuthPanelHidden(false);

        // Auto-reconnect after backend restarts (e.g. --watch mode)
        if (!unmountedRef.current && !manuallyDisconnected.current) {
          reconnectTimer.current = setTimeout(() => {
            if (!unmountedRef.current && !manuallyDisconnected.current) {
              connectWebSocket();
            }
          }, 3000);
        }
      };

      ws.current.onerror = (error) => {
        connectingLock.current = false;
        setIsConnected(false);
        setIsConnecting(false);
      };
    } catch (error) {
      connectingLock.current = false;
      setIsConnected(false);
      setIsConnecting(false);
    }
  }, [wsPath]);

  const connectToShell = useCallback(() => {
    if (!isInitialized) return;
    manuallyDisconnected.current = false;
    clearTimeout(reconnectTimer.current);
    connectWebSocket();
  }, [isInitialized, connectWebSocket]);

  const disconnectFromShell = useCallback(() => {
    manuallyDisconnected.current = true;
    clearTimeout(reconnectTimer.current);
    connectingLock.current = false;
    if (ws.current) {
      ws.current.onopen = null;
      ws.current.onclose = null;
      ws.current.onmessage = null;
      ws.current.onerror = null;
      ws.current.close();
      ws.current = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
    authUrlRef.current = '';
    setAuthUrl('');
    setAuthUrlCopyStatus('idle');
    setIsAuthPanelHidden(false);
  }, []);

  const sessionDisplayName = useMemo(() => {
    if (!selectedSession) return null;
    const rawName = selectedSession.summary || selectedSession.title || selectedSession.name || t('shell.status.newSession');
    return stripInternalContextPrefix(rawName) || t('shell.status.newSession');
  }, [selectedSession, t]);

  const restartShell = () => {
    setIsRestarting(true);
    clearTimeout(reconnectTimer.current);
    connectingLock.current = false;

    if (ws.current) {
      ws.current.onopen = null;
      ws.current.onclose = null;
      ws.current.onmessage = null;
      ws.current.onerror = null;
      ws.current.close();
      ws.current = null;
    }

    if (terminal.current) {
      terminal.current.dispose();
      terminal.current = null;
      fitAddon.current = null;
    }

    setIsConnected(false);
    setIsInitialized(false);
    authUrlRef.current = '';
    setAuthUrl('');
    setAuthUrlCopyStatus('idle');
    setIsAuthPanelHidden(false);

    setTimeout(() => {
      setIsRestarting(false);
    }, 200);
  };

  useEffect(() => {
    const currentSessionId = selectedSession?.id || null;

    if (lastSessionId !== null && lastSessionId !== currentSessionId && isInitialized) {
      disconnectFromShell();
    }

    setLastSessionId(currentSessionId);
  }, [selectedSession?.id, isInitialized, disconnectFromShell]);

  useEffect(() => {
    if (!terminalRef.current || !selectedProject || isRestarting || terminal.current) {
      return;
    }


    unmountedRef.current = false;
    manuallyDisconnected.current = false;
    terminal.current = new Terminal({
      cursorBlink: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      allowProposedApi: true,
      allowTransparency: false,
      convertEol: true,
      scrollback: 10000,
      tabStopWidth: 4,
      windowsMode: false,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#555555',
        selectionForeground: '#ffffff',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
        extendedAnsi: [
          '#000000', '#800000', '#008000', '#808000',
          '#000080', '#800080', '#008080', '#c0c0c0',
          '#808080', '#ff0000', '#00ff00', '#ffff00',
          '#0000ff', '#ff00ff', '#00ffff', '#ffffff'
        ]
      }
    });

    fitAddon.current = new FitAddon();
    const webglAddon = new WebglAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.current.loadAddon(fitAddon.current);
    // Disable xterm link auto-detection in minimal (login) mode to avoid partial wrapped URL links.
    if (!minimal) {
      terminal.current.loadAddon(webLinksAddon);
    }
    // Note: ClipboardAddon removed - we handle clipboard operations manually in attachCustomKeyEventHandler

    try {
      terminal.current.loadAddon(webglAddon);
    } catch (error) {
      console.warn('[Shell] WebGL renderer unavailable, using Canvas fallback');
    }

    terminal.current.open(terminalRef.current);

    terminal.current.attachCustomKeyEventHandler((event) => {
      const activeAuthUrl = isCodexLoginCommand(initialCommandRef.current)
        ? CODEX_DEVICE_AUTH_URL
        : authUrlRef.current;

      if (
        event.type === 'keydown' &&
        minimal &&
        isPlainShellRef.current &&
        activeAuthUrl &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key?.toLowerCase() === 'c'
      ) {
        copyAuthUrlToClipboard(activeAuthUrl).catch(() => {});
      }

      if (
        event.type === 'keydown' &&
        (event.ctrlKey || event.metaKey) &&
        event.key?.toLowerCase() === 'c' &&
        terminal.current.hasSelection()
      ) {
        event.preventDefault();
        event.stopPropagation();
        document.execCommand('copy');
        return false;
      }

      if (
        event.type === 'keydown' &&
        (event.ctrlKey || event.metaKey) &&
        event.key?.toLowerCase() === 'v'
      ) {
        // Block native browser/xterm paste so clipboard data is only sent after
        // the explicit clipboard-read flow resolves (avoids duplicate pastes).
        event.preventDefault();
        event.stopPropagation();

        navigator.clipboard.readText().then(text => {
          if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({
              type: 'input',
              data: text
            }));
          }
        }).catch(() => {});
        return false;
      }

      return true;
    });

    setTimeout(() => {
      if (fitAddon.current) {
        fitAddon.current.fit();
        if (terminal.current && ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({
            type: 'resize',
            cols: terminal.current.cols,
            rows: terminal.current.rows
          }));
        }
      }
    }, 100);

    setIsInitialized(true);
    terminal.current.onData((data) => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          type: 'input',
          data: data
        }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon.current && terminal.current) {
        setTimeout(() => {
          if (!fitAddon.current || !terminal.current || unmountedRef.current) return;
          fitAddon.current.fit();
          if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({
              type: 'resize',
              cols: terminal.current.cols,
              rows: terminal.current.rows
            }));
          }
        }, 50);
      }
    });

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      unmountedRef.current = true;
      connectingLock.current = false;
      clearTimeout(reconnectTimer.current);
      resizeObserver.disconnect();

      if (ws.current) {
        ws.current.onopen = null;
      ws.current.onclose = null;
        ws.current.onmessage = null;
        ws.current.onerror = null;
        if (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING) {
          ws.current.close();
        }
      }
      ws.current = null;

      if (terminal.current) {
        terminal.current.dispose();
        terminal.current = null;
      }
    };
  }, [selectedProject?.path || selectedProject?.fullPath, isRestarting, minimal, copyAuthUrlToClipboard]);

  useEffect(() => {
    if (!autoConnect || !isInitialized) return;
    connectToShell();
  }, [autoConnect, isInitialized, connectToShell]);

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">{t('shell.selectProject.title')}</h3>
          <p>{t('shell.selectProject.description')}</p>
        </div>
      </div>
    );
  }

  if (minimal) {
    const displayAuthUrl = isCodexLoginCommand(initialCommand)
      ? CODEX_DEVICE_AUTH_URL
      : authUrl;
    const hasAuthUrl = Boolean(displayAuthUrl);
    const showMobileAuthPanel = hasAuthUrl && !isAuthPanelHidden;
    const showMobileAuthPanelToggle = hasAuthUrl && isAuthPanelHidden;

    return (
      <div className="h-full w-full bg-[#1e1e1e] relative">
        <div ref={terminalRef} className="h-full w-full focus:outline-none" style={{ outline: 'none' }} />
        {showMobileAuthPanel && (
          <div className="absolute inset-x-0 bottom-14 z-20 border-t border-border bg-background p-3 text-foreground md:hidden">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">{t('shell.auth.hint')}</p>
                <button
                  type="button"
                  onClick={() => setIsAuthPanelHidden(true)}
                  className="min-h-11 rounded-md px-3 text-sm hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {t('shell.auth.hide')}
                </button>
              </div>
              <input
                type="text"
                value={displayAuthUrl}
                readOnly
                onClick={(event) => event.currentTarget.select()}
                className="w-full min-h-11 rounded-md border border-input bg-background px-2 text-base text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                aria-label={t('shell.auth.url')}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    openAuthUrlInBrowser(displayAuthUrl);
                  }}
                  className="min-h-11 flex-1 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {t('shell.auth.open')}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const copied = await copyAuthUrlToClipboard(displayAuthUrl);
                    setAuthUrlCopyStatus(copied ? 'copied' : 'failed');
                  }}
                  className="min-h-11 flex-1 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {t(authUrlCopyStatus === 'copied' ? 'shell.auth.copied' : 'shell.auth.copy')}
                </button>
              </div>
              {authUrlCopyStatus === 'failed' && <p role="alert" className="text-sm text-destructive">{t('shell.auth.copyFailed')}</p>}
            </div>
          </div>
        )}
        {showMobileAuthPanelToggle && (
          <div className="absolute bottom-14 right-3 z-20 md:hidden">
            <button
              type="button"
              onClick={() => setIsAuthPanelHidden(false)}
              className="min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
            >
              {t('shell.auth.show')}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 w-full flex-col bg-background text-foreground">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-3 py-1.5">
        <div role="status" className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${isConnected ? 'bg-green-600 dark:bg-green-400' : 'bg-muted-foreground'}`} />
          <span>{!isInitialized ? t('shell.status.initializing') : isConnecting ? t('shell.connecting') : isConnected ? t('shell.status.connected') : t('shell.status.disconnected')}</span>
        </div>
        <div className="flex items-center gap-1">
          {(isConnected || isConnecting) && <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8" onClick={disconnectFromShell} title={t('shell.actions.disconnectTitle')}>{t('shell.actions.disconnect')}</Button>}
          <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8" onClick={restartShell} disabled={isRestarting || isConnected || isConnecting} title={t('shell.actions.restartTitle')}>{t('shell.actions.restart')}</Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#1e1e1e] p-2">
        <div ref={terminalRef} className="h-full w-full focus:outline-none" />
        {!isInitialized && <div className="absolute inset-0 z-10 flex items-center justify-center bg-background text-sm" role="status">{t('shell.loading')}</div>}
        {isInitialized && !isConnected && !isConnecting && <div className="absolute inset-x-2 bottom-2 z-10 rounded-md border border-border bg-background p-3">
          <Button type="button" onClick={connectToShell} className="min-h-11 w-full whitespace-normal" title={t('shell.actions.connectTitle')}>{t('shell.actions.connect')}</Button>
          <p className="mt-2 break-words text-xs leading-relaxed text-muted-foreground">
            {isPlainShell ? (initialCommand ? t('shell.runCommand', { command: initialCommand, projectName: selectedProject.displayName }) : t('shell.openTerminal', { projectName: selectedProject.displayName })) : selectedSession ? t('shell.resumeSession', { displayName: sessionDisplayName }) : t('shell.startSession')}
          </p>
        </div>}
        {isConnecting && <div className="absolute inset-x-2 bottom-2 z-10 rounded-md border border-border bg-background p-3 text-sm text-muted-foreground" role="status">{t('shell.connecting')}</div>}
      </div>
    </div>
  );
}

export default Shell;
