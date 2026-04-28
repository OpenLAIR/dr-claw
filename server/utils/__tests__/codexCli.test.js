import { describe, expect, it } from 'vitest';
import path from 'path';
import { buildCodexCliEnv, codexCommandForShell } from '../codexCli.js';

describe('codexCli', () => {
  it('removes Dr. Claw local node_modules/.bin from Codex CLI PATH probes', () => {
    const localBin = path.join(process.cwd(), 'node_modules', '.bin');
    const externalBin = path.join(path.sep, 'usr', 'local', 'bin');
    const env = buildCodexCliEnv({
      PATH: [localBin, externalBin].join(path.delimiter),
    });

    expect(env.PATH.split(path.delimiter)).toEqual([externalBin]);
  });

  it('uses CODEX_CLI_PATH as the shell command when configured', () => {
    expect(codexCommandForShell({ CODEX_CLI_PATH: '/opt/homebrew/bin/codex' }, 'darwin')).toBe("'/opt/homebrew/bin/codex'");
  });
});
