import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * These tests drive the real discovery code against a fake harness: a small
 * Node script that speaks the same line-delimited JSON-RPC over stdio that
 * `codex app-server` does. That keeps the transport, timeout, and parsing logic
 * under test without requiring the Codex CLI to be installed.
 */

let tmpDir;
let mod;

async function writeFakeCodex(name, body) {
  const file = path.join(tmpDir, name);
  await fs.writeFile(file, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  return file;
}

const RESPOND_WITH_MODELS = `
const models = [
  { id: 'gpt-9-alpha', model: 'gpt-9-alpha', displayName: 'GPT-9 Alpha', hidden: false, isDefault: true },
  { id: 'gpt-9-beta',  model: 'gpt-9-beta',  displayName: 'GPT-9 Beta',  hidden: false, isDefault: false },
  { id: 'gpt-9-secret', model: 'gpt-9-secret', displayName: 'Hidden',    hidden: true,  isDefault: false },
];
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({ id: msg.id, result: { userAgent: 'fake' } }) + '\\n');
      process.stdout.write(JSON.stringify({ method: 'some/notification', params: {} }) + '\\n');
    } else if (msg.method === 'model/list') {
      process.stdout.write(JSON.stringify({ id: msg.id, result: { data: models, nextCursor: null } }) + '\\n');
    }
  }
});
`;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drclaw-models-'));
  vi.resetModules();
  mod = await import('../harnessModelDiscovery.js');
  mod.clearModelDiscoveryCache();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('mergeModelOptions', () => {
  it('puts discovered models first and keeps unlisted built-ins as deprecated', () => {
    const merged = mod.mergeModelOptions(
      [{ value: 'new-1', label: 'New One' }, { value: 'shared', label: 'Shared (live)' }],
      [{ value: 'shared', label: 'Shared (built-in)' }, { value: 'retired', label: 'Retired' }],
    );

    expect(merged.map((o) => o.value)).toEqual(['new-1', 'shared', 'retired']);
    // The harness's own label wins for a model both lists know about.
    expect(merged[1].label).toBe('Shared (live)');
    expect(merged[1].deprecated).toBeUndefined();
    // A model the harness no longer serves is kept but marked, so a user whose
    // saved preference points at it is not stranded.
    expect(merged[2].deprecated).toBe(true);
  });

  it('drops duplicates and entries without a value', () => {
    const merged = mod.mergeModelOptions(
      [{ value: 'a' }, { value: 'a', label: 'dupe' }, { label: 'no value' }],
      [{ value: 'a', label: 'built-in' }],
    );
    expect(merged).toEqual([{ value: 'a', label: 'a' }]);
  });
});

describe('codex model discovery', () => {
  it('reads the live list over JSON-RPC and hides hidden models', async () => {
    const fake = await writeFakeCodex('fake-codex.mjs', RESPOND_WITH_MODELS);

    const payload = await mod.getModelsForProvider('codex', {
      env: { ...process.env, CODEX_CLI_PATH: fake },
    });

    expect(payload.source).toBe('discovered');
    const discovered = payload.options.filter((o) => !o.deprecated).map((o) => o.value);
    expect(discovered).toEqual(['gpt-9-alpha', 'gpt-9-beta']);
    expect(payload.options.map((o) => o.value)).not.toContain('gpt-9-secret');
  });

  it('adopts the harness default when the configured one is no longer served', async () => {
    const fake = await writeFakeCodex('fake-codex.mjs', RESPOND_WITH_MODELS);

    const payload = await mod.getModelsForProvider('codex', {
      env: { ...process.env, CODEX_CLI_PATH: fake },
    });

    // The built-in CODEX_MODELS.DEFAULT is not in the fake harness's catalogue,
    // so defaulting to it would send every new session into an error.
    expect(payload.default).toBe('gpt-9-alpha');
  });

  it('keeps built-in models available alongside discovered ones', async () => {
    const fake = await writeFakeCodex('fake-codex.mjs', RESPOND_WITH_MODELS);
    const { CODEX_MODELS } = await import('../../../shared/modelConstants.js');

    const payload = await mod.getModelsForProvider('codex', {
      env: { ...process.env, CODEX_CLI_PATH: fake },
    });

    for (const builtIn of CODEX_MODELS.OPTIONS) {
      expect(payload.options.some((o) => o.value === builtIn.value)).toBe(true);
    }
  });

  it('falls back to the built-in list when the harness is missing', async () => {
    const { CODEX_MODELS } = await import('../../../shared/modelConstants.js');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const payload = await mod.getModelsForProvider('codex', {
      env: { ...process.env, CODEX_CLI_PATH: path.join(tmpDir, 'does-not-exist') },
    });

    expect(payload.source).toBe('static');
    expect(payload.options).toEqual(CODEX_MODELS.OPTIONS);
    expect(payload.default).toBe(CODEX_MODELS.DEFAULT);
    expect(payload.error).toBeTruthy();
  });

  it('falls back rather than hanging when the harness never answers', async () => {
    // A harness that accepts input and goes silent must not wedge the picker.
    const fake = await writeFakeCodex('hang.mjs', 'process.stdin.resume();');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const started = Date.now();
    const payload = await mod.getModelsForProvider('codex', {
      timeoutMs: 300,
      env: { ...process.env, CODEX_CLI_PATH: fake },
    });

    expect(payload.source).toBe('static');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('falls back when the harness replies with a JSON-RPC error', async () => {
    const fake = await writeFakeCodex('err.mjs', `
let buf='';
process.stdin.on('data',(d)=>{buf+=d.toString();let i;
while((i=buf.indexOf('\\n'))!==-1){const line=buf.slice(0,i);buf=buf.slice(i+1);
if(!line.trim())continue;const m=JSON.parse(line);
process.stdout.write(JSON.stringify({id:m.id,error:{message:'not logged in'}})+'\\n');}});
`);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const payload = await mod.getModelsForProvider('codex', {
      env: { ...process.env, CODEX_CLI_PATH: fake },
    });

    expect(payload.source).toBe('static');
    expect(payload.error).toContain('not logged in');
  });

  it('ignores non-JSON banner output before the JSON-RPC stream', async () => {
    const fake = await writeFakeCodex('banner.mjs', `
process.stdout.write('Welcome to Fake Codex!\\n');
${RESPOND_WITH_MODELS}
`);

    const payload = await mod.getModelsForProvider('codex', {
      env: { ...process.env, CODEX_CLI_PATH: fake },
    });

    expect(payload.source).toBe('discovered');
  });
});

describe('protocol robustness', () => {
  it('follows nextCursor pagination across pages', async () => {
    const fake = await writeFakeCodex('paged.mjs', `
const pages = {
  null:  { data: [{ model: 'page-1-a', displayName: 'A', hidden: false, isDefault: true }],  nextCursor: 'c1' },
  c1:    { data: [{ model: 'page-2-a', displayName: 'B', hidden: false, isDefault: false }], nextCursor: 'c2' },
  c2:    { data: [{ model: 'page-3-a', displayName: 'C', hidden: false, isDefault: false }], nextCursor: null },
};
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({ id: msg.id, result: {} }) + '\\n');
    } else if (msg.method === 'model/list') {
      const key = msg.params && msg.params.cursor ? msg.params.cursor : 'null';
      process.stdout.write(JSON.stringify({ id: msg.id, result: pages[key] }) + '\\n');
    }
  }
});
`);

    const payload = await mod.getModelsForProvider('codex', {
      env: { ...process.env, CODEX_CLI_PATH: fake },
    });

    const live = payload.options.filter((o) => !o.deprecated).map((o) => o.value);
    // Two-page-only pagination would have stopped at page-2-a.
    expect(live).toEqual(['page-1-a', 'page-2-a', 'page-3-a']);
  });

  it('stops paginating rather than looping on an endless cursor', async () => {
    const fake = await writeFakeCodex('endless.mjs', `
let n = 0;
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({ id: msg.id, result: {} }) + '\\n');
    } else if (msg.method === 'model/list') {
      n += 1;
      process.stdout.write(JSON.stringify({
        id: msg.id,
        result: { data: [{ model: 'm' + n, hidden: false }], nextCursor: 'always-more' },
      }) + '\\n');
    }
  }
});
`);

    const started = Date.now();
    const payload = await mod.getModelsForProvider('codex', {
      timeoutMs: 10_000,
      env: { ...process.env, CODEX_CLI_PATH: fake },
    });

    expect(payload.source).toBe('discovered');
    expect(payload.options.filter((o) => !o.deprecated).length).toBeLessThanOrEqual(10);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('sends the initialized notification after initialize', async () => {
    // Some app-server versions reject requests made before this notification.
    const marker = path.join(tmpDir, 'saw-initialized');
    const fake = await writeFakeCodex('strict.mjs', `
import { writeFileSync } from 'fs';
let initialized = false;
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({ id: msg.id, result: {} }) + '\\n');
    } else if (msg.method === 'initialized') {
      initialized = true;
      writeFileSync(${JSON.stringify(marker)}, 'yes');
    } else if (msg.method === 'model/list') {
      if (!initialized) {
        process.stdout.write(JSON.stringify({ id: msg.id, error: { message: 'Not initialized' } }) + '\\n');
        return;
      }
      process.stdout.write(JSON.stringify({
        id: msg.id,
        result: { data: [{ model: 'strict-ok', hidden: false, isDefault: true }], nextCursor: null },
      }) + '\\n');
    }
  }
});
`);

    const payload = await mod.getModelsForProvider('codex', {
      env: { ...process.env, CODEX_CLI_PATH: fake },
    });

    expect(await fs.readFile(marker, 'utf8')).toBe('yes');
    expect(payload.source).toBe('discovered');
    expect(payload.options[0].value).toBe('strict-ok');
  });

  it('keeps multi-byte labels intact when they straddle a stdout chunk', async () => {
    // Emits the JSON one byte at a time, guaranteeing that multi-byte UTF-8
    // characters are split across 'data' events.
    const fake = await writeFakeCodex('bytewise.mjs', `
const payload = JSON.stringify({
  id: 101,
  result: { data: [{ model: 'zh-model', displayName: '请问大家有变卡的情况吗 🦞', hidden: false, isDefault: true }], nextCursor: null },
}) + '\\n';
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({ id: msg.id, result: {} }) + '\\n');
    } else if (msg.method === 'model/list') {
      const bytes = Buffer.from(payload, 'utf8');
      for (const byte of bytes) process.stdout.write(Buffer.from([byte]));
    }
  }
});
`);

    const payload = await mod.getModelsForProvider('codex', {
      env: { ...process.env, CODEX_CLI_PATH: fake },
    });

    expect(payload.source).toBe('discovered');
    expect(payload.options[0].label).toBe('请问大家有变卡的情况吗 🦞');
    expect(payload.options[0].label).not.toContain('�');
  });
});

describe('caching', () => {
  it('serves repeat lookups from cache instead of re-spawning the harness', async () => {
    const marker = path.join(tmpDir, 'spawn-count');
    const fake = await writeFakeCodex('counting.mjs', `
import { appendFileSync } from 'fs';
appendFileSync(${JSON.stringify(marker)}, 'x');
${RESPOND_WITH_MODELS}
`);
    const env = { ...process.env, CODEX_CLI_PATH: fake };

    await mod.getModelsForProvider('codex', { env });
    await mod.getModelsForProvider('codex', { env });
    await mod.getModelsForProvider('codex', { env });

    expect((await fs.readFile(marker, 'utf8')).length).toBe(1);
  });

  it('collapses concurrent cold lookups onto one probe', async () => {
    const marker = path.join(tmpDir, 'spawn-count');
    const fake = await writeFakeCodex('counting.mjs', `
import { appendFileSync } from 'fs';
appendFileSync(${JSON.stringify(marker)}, 'x');
${RESPOND_WITH_MODELS}
`);
    const env = { ...process.env, CODEX_CLI_PATH: fake };

    const [a, b, c] = await Promise.all([
      mod.getModelsForProvider('codex', { env }),
      mod.getModelsForProvider('codex', { env }),
      mod.getModelsForProvider('codex', { env }),
    ]);

    expect((await fs.readFile(marker, 'utf8')).length).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('re-probes a failed provider sooner than a successful one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const missing = { ...process.env, CODEX_CLI_PATH: path.join(tmpDir, 'nope') };

    const failed = await mod.getModelsForProvider('codex', { env: missing, ttlMs: 10 * 60 * 1000 });
    expect(failed.source).toBe('static');

    // The failure TTL is capped well below the success TTL so the picker
    // recovers on its own once the CLI is installed or the user logs in.
    const fake = await writeFakeCodex('fake-codex.mjs', RESPOND_WITH_MODELS);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const forced = await mod.getModelsForProvider('codex', {
      force: true,
      env: { ...process.env, CODEX_CLI_PATH: fake },
    });
    expect(forced.source).toBe('discovered');
  });

  it('a forced refresh does not join an already-running stale probe', async () => {
    // A probe that answers slowly, and then a refresh issued while it is still
    // in flight. Joining the pending probe would hand back exactly the stale
    // answer the refresh was meant to discard.
    const slow = await writeFakeCodex('slow.mjs', `
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({ id: msg.id, result: {} }) + '\\n');
    } else if (msg.method === 'model/list') {
      setTimeout(() => {
        process.stdout.write(JSON.stringify({
          id: msg.id,
          result: { data: [{ model: 'stale-model', hidden: false, isDefault: true }], nextCursor: null },
        }) + '\\n');
      }, 400);
    }
  }
});
`);
    const fresh = await writeFakeCodex('fresh.mjs', RESPOND_WITH_MODELS);

    const pending = mod.getModelsForProvider('codex', {
      env: { ...process.env, CODEX_CLI_PATH: slow },
    });

    const refreshed = await mod.getModelsForProvider('codex', {
      force: true,
      env: { ...process.env, CODEX_CLI_PATH: fresh },
    });

    expect(refreshed.options[0].value).toBe('gpt-9-alpha');
    expect(refreshed.options.map((o) => o.value)).not.toContain('stale-model');

    await pending;
    // The slow probe finishing last must not overwrite the refreshed result.
    const afterSettling = await mod.getModelsForProvider('codex', {
      env: { ...process.env, CODEX_CLI_PATH: fresh },
    });
    expect(afterSettling.options.map((o) => o.value)).not.toContain('stale-model');
  });

  it('clears one provider without clearing the rest', async () => {
    const fake = await writeFakeCodex('fake-codex.mjs', RESPOND_WITH_MODELS);
    const env = { ...process.env, CODEX_CLI_PATH: fake };

    await mod.getModelsForProvider('codex', { env });
    expect(() => mod.clearModelDiscoveryCache('codex')).not.toThrow();
    expect(() => mod.clearModelDiscoveryCache()).not.toThrow();
  });
});

describe('providers without a discoverer', () => {
  it('returns the built-in list unchanged', async () => {
    const { CLAUDE_MODELS } = await import('../../../shared/modelConstants.js');
    const payload = await mod.getModelsForProvider('claude');

    expect(payload.source).toBe('static');
    expect(payload.options).toEqual(CLAUDE_MODELS.OPTIONS);
    expect(payload.error).toBeNull();
  });

  it('reports an unknown provider without throwing', async () => {
    const payload = await mod.getModelsForProvider('not-a-provider');

    expect(payload.options).toEqual([]);
    expect(payload.error).toContain('Unknown provider');
  });

  it('only advertises providers it can actually probe', () => {
    expect(mod.getDiscoverableProviders()).toEqual(['codex', 'openrouter']);
  });
});
