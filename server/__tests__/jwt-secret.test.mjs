import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveJwtSecret,
  loadOrCreateSecretFile,
  defaultSecretFilePath,
  LEGACY_DEFAULT_SECRET,
  SECRET_FILE_NAME,
} from '../utils/jwtSecret.js';

const silent = { log: () => {}, warn: () => {} };
const STRONG = 'a'.repeat(64);

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jwt-secret-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('resolveJwtSecret', () => {
  it('prefers JWT_SECRET from the environment', () => {
    const secret = resolveJwtSecret({ env: { JWT_SECRET: STRONG, DATABASE_PATH: path.join(tmp, 'auth.db') }, log: silent });
    expect(secret).toBe(STRONG);
    expect(fs.existsSync(path.join(tmp, SECRET_FILE_NAME))).toBe(false);
  });

  it('treats a whitespace-only JWT_SECRET as unset', () => {
    const env = { JWT_SECRET: '   ', DATABASE_PATH: path.join(tmp, 'auth.db') };
    const secret = resolveJwtSecret({ env, log: silent });
    expect(secret).toHaveLength(64);
    expect(fs.existsSync(path.join(tmp, SECRET_FILE_NAME))).toBe(true);
  });

  it('refuses the publicly known legacy default', () => {
    expect(() => resolveJwtSecret({ env: { JWT_SECRET: LEGACY_DEFAULT_SECRET }, log: silent }))
      .toThrow(/publicly known development default/);
  });

  it('refuses the legacy default even when it comes from a file', () => {
    const file = path.join(tmp, 'secret');
    fs.writeFileSync(file, `${LEGACY_DEFAULT_SECRET}\n`);
    expect(() => resolveJwtSecret({ env: { JWT_SECRET_FILE: file }, log: silent }))
      .toThrow(/publicly known development default/);
  });

  it('generates and persists a secret next to the database when nothing is configured', () => {
    const env = { DATABASE_PATH: path.join(tmp, 'nested', 'auth.db') };
    const first = resolveJwtSecret({ env, log: silent });
    const second = resolveJwtSecret({ env, log: silent });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);

    const file = path.join(tmp, 'nested', SECRET_FILE_NAME);
    expect(fs.readFileSync(file, 'utf8').trim()).toBe(first);
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it('honours JWT_SECRET_FILE over the database directory', () => {
    const file = path.join(tmp, 'custom', 'my-secret');
    const env = { JWT_SECRET_FILE: file, DATABASE_PATH: path.join(tmp, 'auth.db') };
    const secret = resolveJwtSecret({ env, log: silent });
    expect(fs.readFileSync(file, 'utf8').trim()).toBe(secret);
    expect(fs.existsSync(path.join(tmp, SECRET_FILE_NAME))).toBe(false);
  });

  it('reads an operator-provided secret file verbatim (trimmed)', () => {
    const file = path.join(tmp, 'secret');
    fs.writeFileSync(file, `  ${STRONG}\n`);
    expect(resolveJwtSecret({ env: { JWT_SECRET_FILE: file }, log: silent })).toBe(STRONG);
  });

  it('warns about short secrets but still accepts them', () => {
    const warnings = [];
    const log = { log: () => {}, warn: (m) => warnings.push(m) };
    expect(resolveJwtSecret({ env: { JWT_SECRET: 'short' }, log })).toBe('short');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/only 5 characters/);
  });
});

describe('loadOrCreateSecretFile', () => {
  it('rejects an existing empty file instead of silently regenerating', () => {
    const file = path.join(tmp, 'secret');
    fs.writeFileSync(file, '\n');
    expect(() => loadOrCreateSecretFile(file, { log: silent })).toThrow(/exists but is empty/);
  });
});

describe('defaultSecretFilePath', () => {
  it('sits beside DATABASE_PATH when set', () => {
    expect(defaultSecretFilePath({ DATABASE_PATH: '/data/dr-claw/auth.db' }))
      .toBe(path.join('/data/dr-claw', SECRET_FILE_NAME));
  });

  it('falls back to server/database when DATABASE_PATH is unset', () => {
    expect(defaultSecretFilePath({})).toMatch(new RegExp(`server[\\\\/]database[\\\\/]${SECRET_FILE_NAME}$`));
  });
});
