import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build-electron-icons.mjs'], {
    cwd: projectRoot,
    stdio: 'pipe',
  });
});

describe('Electron icon generation', () => {
  it('builds transparent rounded macOS iconset assets for packaged apps', async () => {
    const iconPath = path.join(projectRoot, 'build/icon.iconset/icon_512x512.png');
    const { data, info } = await sharp(iconPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const alphaAt = (x, y) => data[((y * info.width) + x) * info.channels + 3];

    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(Math.floor(info.width / 2), Math.floor(info.height / 2))).toBe(255);
  });
});
