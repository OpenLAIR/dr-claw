// ResearchFlow Phase 5 Electron hardening tests — static source assertions.
// These verify the desktop shell invariants (branding, security, spawn config,
// single-instance, startup-error UI, IPC allowlist) without launching Electron
// (no display in CI). They read the actual shipped sources, so they fail if a
// future edit silently removes a safeguard.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronDir = path.join(__dirname, '..', '..', 'electron');

let mainSrc;
let preloadSrc;

beforeAll(async () => {
  mainSrc = await readFile(path.join(electronDir, 'main.mjs'), 'utf8');
  preloadSrc = await readFile(path.join(electronDir, 'preload.mjs'), 'utf8');
});

describe('Electron branding (Phase 5)', () => {
  it('1. product name and appId are ResearchFlow', () => {
    expect(mainSrc).toMatch(/const productName = 'ResearchFlow';/);
    expect(mainSrc).toMatch(/const appId = 'io\.openlair\.researchflow';/);
    expect(mainSrc).not.toMatch(/const productName = 'Dr\. Claw';/);
  });

  it('2. window title derives from productName, not a hardcoded legacy name', () => {
    expect(mainSrc).toMatch(/title: productName/);
    expect(mainSrc).not.toMatch(/title: 'Dr\. Claw'/);
  });

  it('3. no hardcoded user home paths', () => {
    expect(mainSrc).not.toMatch(/C:\\\\Users\\\\/);
    expect(mainSrc).not.toMatch(/C:\\Users\b/);
  });
});

describe('Electron security invariants', () => {
  it('4. contextIsolation and sandbox remain enabled', () => {
    expect(mainSrc).toMatch(/contextIsolation:\s*true/);
    expect(mainSrc).toMatch(/sandbox:\s*true/);
  });

  it('5. external links only open for http/https', () => {
    expect(mainSrc).toMatch(/url\.startsWith\('https:\/\/'\) \|\| url\.startsWith\('http:\/\/'\)/);
  });

  it('6. preload IPC uses an allowlist and exposes no generic bridge', () => {
    expect(preloadSrc).toMatch(/ALLOWED_CHANNELS_INVOKE = new Set\(/);
    expect(preloadSrc).toMatch(/ALLOWED_CHANNELS_ON = new Set\(/);
    // No generic execute / readAnyFile / writeAnyFile capabilities.
    expect(preloadSrc).not.toMatch(/execute\(|exec\(|readAnyFile|writeAnyFile/);
    // ipcRenderer.invoke appears exactly once, inside the allowlisted safeInvoke
    // wrapper — no direct ipcRenderer use anywhere else.
    const invokeUses = preloadSrc.match(/ipcRenderer\.invoke\(/g) || [];
    expect(invokeUses).toHaveLength(1);
    expect(preloadSrc).toMatch(/ipcRenderer\.invoke\(channel, \.\.\.args\)/);
    expect(preloadSrc).not.toMatch(/ipcRenderer\.send\(/);
  });

  it('7. the new relaunch channel is purpose-specific and allowlisted', () => {
    expect(preloadSrc).toMatch(/'app:relaunch'/);
    expect(mainSrc).toMatch(/ipcMain\.handle\('app:relaunch'/);
  });

  it('8. no arbitrary shell execution bridge exists in preload', () => {
    expect(preloadSrc).not.toMatch(/child_process|node:child_process/);
  });
});

describe('Electron backend lifecycle', () => {
  it('9. backend is spawned once with ELECTRON_RUN_AS_NODE and a health check', () => {
    expect(mainSrc).toMatch(/ELECTRON_RUN_AS_NODE: '1'/);
    expect(mainSrc).toMatch(/waitForServer\(`http:\/\/\$\{env\.HOST\}:\$\{env\.PORT\}\/health`\)/);
    expect(mainSrc).toMatch(/spawn\(nodeBinary, \[entrypoint\]/);
  });

  it('10. production DB path lives under userData/researchflow.db', () => {
    expect(mainSrc).toMatch(/resolveProductionDatabasePath\(\)/);
    expect(mainSrc).toMatch(/researchflow\.db/);
    expect(mainSrc).toMatch(/app\.getPath\('userData'\)/);
    // Legacy Dr. Claw data is detected read-only, never auto-migrated.
    expect(mainSrc).toMatch(/Legacy Dr\. Claw database detected/);
    expect(mainSrc).toMatch(/not auto-migrating/);
  });

  it('11. single-instance lock prevents duplicate backends', () => {
    expect(mainSrc).toMatch(/requestSingleInstanceLock\(\)/);
    expect(mainSrc).toMatch(/second-instance/);
  });

  it('12. backend output is mirrored to logs/backend.log with rotation', () => {
    expect(mainSrc).toMatch(/appendBackendLog\(/);
    expect(mainSrc).toMatch(/backend\.log/);
    expect(mainSrc).toMatch(/2 \* 1024 \* 1024/);
  });

  it('13. child backend shutdown happens on quit', () => {
    expect(mainSrc).toMatch(/will-quit/);
    expect(mainSrc).toMatch(/stopServer\(\)/);
  });
});

describe('Electron startup error UX (Phase 5)', () => {
  it('14. startup failures show a friendly error window, not a blank page', () => {
    expect(mainSrc).toMatch(/function showStartupError\(/);
    expect(mainSrc).toMatch(/friendlyStartupMessage\(/);
    expect(mainSrc).toMatch(/loadURL\(`data:text\/html/);
    // Error window keeps sandbox + contextIsolation + allowlisted preload.
    expect(mainSrc).toMatch(/contextIsolation: true,\n\s+sandbox: true,/);
  });

  it('15. boot failure paths call showStartupError instead of only a dialog', () => {
    expect(mainSrc).toMatch(/showStartupError\('ResearchFlow could not start'/);
    expect(mainSrc).not.toMatch(/Failed to start Dr\. Claw/);
    expect(mainSrc).not.toMatch(/Dr\. Claw server exited/);
  });

  it('16. app diagnostics include database and log paths', () => {
    expect(mainSrc).toMatch(/databasePath: resolveProductionDatabasePath\(\)/);
    expect(mainSrc).toMatch(/logDir: path\.join\(app\.getPath\('userData'\), 'logs'\)/);
  });
});
