import { describe, expect, it } from 'vitest';
import path from 'path';
import { buildCodexCliEnv, codexCommandForShell, getBundledCodexCliInvocation } from '../codexCli.js';

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

  describe('getBundledCodexCliInvocation', () => {
    it('runs the @openai/codex bundled with the SDK, not the codex on PATH', () => {
      const localBin = path.join(process.cwd(), 'node_modules', '.bin');
      const externalBin = path.join(path.sep, 'usr', 'local', 'bin');
      const { command, args, env } = getBundledCodexCliInvocation({
        PATH: [localBin, externalBin].join(path.delimiter),
      });

      expect(command).toBe(process.execPath);
      expect(args).toHaveLength(1);
      expect(path.normalize(args[0])).toBe(
        path.join(process.cwd(), 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
      );
      // The bundled entry point is addressed by path, so PATH is left untouched.
      expect(env.PATH).toBe([localBin, externalBin].join(path.delimiter));
    });

    it('lets CODEX_CLI_PATH override the bundled CLI', () => {
      const localBin = path.join(process.cwd(), 'node_modules', '.bin');
      const { command, args, env } = getBundledCodexCliInvocation({
        CODEX_CLI_PATH: '/opt/homebrew/bin/codex',
        PATH: localBin,
      });

      expect(command).toBe('/opt/homebrew/bin/codex');
      expect(args).toEqual([]);
      expect(env.PATH).toBe('');
    });
  });
});
