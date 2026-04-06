# Electron Desktop Shell

This directory contains the Electron wrapper for Dr. Claw.

## Architecture

- The existing Express/WebSocket backend runs unchanged as a child process.
- A `BrowserWindow` loads the local app URL after the embedded server starts.
- A **preload script** (`preload.mjs`) exposes a safe IPC bridge (`window.electronAPI`) using `contextBridge`.
- The renderer stays fully sandboxed with `contextIsolation: true` and `sandbox: true`.

## Features

### IPC Bridge (`window.electronAPI`)

The preload script exposes these capabilities to the web UI through a channel-allowlisted IPC bridge:

| Category | Methods |
|---|---|
| **App info** | `getAppInfo()` — version, platform, paths |
| **File dialogs** | `selectDirectory(options?)`, `selectFile(options?)` |
| **Shell** | `showItemInFolder(path)`, `openExternal(url)`, `openPath(path)` |
| **System** | `getSystemInfo()`, `checkDependencies()` |
| **Window** | `minimize()`, `maximize()`, `close()`, `isMaximized()` |
| **Clipboard** | `writeClipboard(text)`, `readClipboard()` |
| **Notifications** | `showNotification(title, body)` |
| **Events** | `on(channel, callback)` — listen for main→renderer events |

Client code accesses these through the `useDesktop()` hook (`src/hooks/useDesktop.ts`), which falls back gracefully in web mode.

### Native Application Menu

Standard macOS/Windows menu bar with:
- **File**: New Chat (Cmd/Ctrl+N), Open Workspace (Cmd/Ctrl+O)
- **Edit**: Undo, Redo, Cut, Copy, Paste, Select All
- **View**: Reload, DevTools, Zoom, Fullscreen
- **Window**: Minimize, Zoom/Close
- **Help**: Documentation, Report Issue, View Logs, Open Data Directory
- **macOS App menu**: About, Settings (Cmd+,), Services, Hide, Quit

### Window State Persistence

Window position, size, and maximized state are saved to `window-state.json` in the user data directory and restored on next launch.

### Desktop-Aware Onboarding

When running in Electron, the onboarding flow includes an extra **System Check** step that verifies local development tools (Node.js, npm, Git, Claude CLI, Codex CLI, Gemini CLI) are available, with versions displayed and a re-check button.

### Native File Picker

Settings > Default Project Path shows a **Browse** button (desktop only) that opens the OS-native folder picker dialog.

### External Link Handling

All `window.open` calls in the renderer are intercepted and opened in the system browser via `shell.openExternal`.

## Commands

- `npm run desktop:icons` — regenerate desktop icon assets (`build/icon.png`, `build/icon.ico`, macOS `build/icon.icns`).
- `npm run desktop:dev` — prepare native modules, build frontend, launch Electron.
- `npm run desktop:pack` — create an unpacked desktop bundle in `release/`.
- `npm run desktop:dist` — build installable packages for the current platform.

## Notes

- Native modules (`node-pty`, `better-sqlite3`, `sqlite3`) are rebuilt for Electron via `scripts/native-runtime.mjs`.
- Electron rebuild caches live in `.electron-gyp/` and `.electron-cache/` inside the repo.
- Window state, logs, and runtime data are stored under `app.getPath('userData')` (e.g., `~/Library/Application Support/Dr. Claw/` on macOS).
- The `DR_CLAW_DESKTOP=1` environment variable distinguishes desktop from web/npm server mode.

## CI/CD

- `.github/workflows/desktop-release.yml` builds macOS and Windows installers on GitHub Actions.
- Pushing a tag like `v1.2.3` publishes a GitHub Release with attached desktop artifacts.
- Manual workflow dispatch is also supported.
